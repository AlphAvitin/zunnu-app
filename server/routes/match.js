const express = require('express');
const { run, get, all } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { sendToUser } = require('../ws');
const { creditPoints } = require('./points');

const router = express.Router();

// Send partnership request
router.post('/request', authMiddleware, async (req, res) => {
  try {
    const { targetUserId, targetPetId, requesterPetId } = req.body;
    if (!targetUserId) return res.status(400).json({ error: 'Destinatario obrigatorio' });
    if (targetUserId === req.userId) return res.status(400).json({ error: 'Nao pode pedir parceria para si mesmo' });
    
    // Check if already connected
    const existingMatch = await get('SELECT * FROM matches WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)',
      [req.userId, targetUserId, targetUserId, req.userId]);
    if (existingMatch) return res.status(400).json({ error: 'Ja sao parceiros' });
    
    // Check if pending request already exists
    const existing = await get('SELECT * FROM partnership_requests WHERE requester_id = ? AND target_id = ? AND status = ?',
      [req.userId, targetUserId, 'pending']);
    if (existing) return res.status(400).json({ error: 'Solicitacao ja enviada' });
    
    const result = await run('INSERT INTO partnership_requests (requester_id, requester_pet_id, target_id, target_pet_id) VALUES (?, ?, ?, ?)',
      [req.userId, requesterPetId || null, targetUserId, targetPetId || null]);
    
    // Get requester name for notification
    const user = await get('SELECT name FROM users WHERE id = ?', [req.userId]);
    
    await run('INSERT INTO notifications (user_id, type, message, reference_id) VALUES (?, ?, ?, ?)',
      [targetUserId, 'partnership_request', `${user?.name || 'Alguem'} pediu parceria para os pets!`, result.lastInsertRowid]);
    
    sendToUser(targetUserId, {
      type: 'partnership_request',
      requestId: result.lastInsertRowid,
      fromUserId: req.userId,
      fromUserName: user?.name,
      message: `${user?.name || 'Alguem'} pediu parceria para os pets!`
    });
    
    sendToUser(targetUserId, {
      type: 'notification',
      notification: { type: 'partnership_request', message: `Nova solicitacao de parceria!` }
    });
    
    res.json({ success: true, requestId: result.lastInsertRowid });
  } catch (err) {
    console.error('Partnership request error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Accept/reject partnership
router.post('/respond/:requestId', authMiddleware, async (req, res) => {
  try {
    const { accept } = req.body;
    const requestId = parseInt(req.params.requestId);
    
    const request = await get('SELECT * FROM partnership_requests WHERE id = ? AND target_id = ? AND status = ?',
      [requestId, req.userId, 'pending']);
    if (!request) return res.status(404).json({ error: 'Solicitacao nao encontrada' });
    
    if (accept) {
      // Create match
      await run('INSERT INTO matches (user1_id, user2_id) VALUES (?, ?)', [request.requester_id, request.target_id]);
      const match = await get('SELECT * FROM matches ORDER BY id DESC LIMIT 1', []);
      
      await run('UPDATE partnership_requests SET status = ? WHERE id = ?', ['accepted', requestId]);
      
      // Notify requester
      await run('INSERT INTO notifications (user_id, type, message, reference_id) VALUES (?, ?, ?, ?)',
        [request.requester_id, 'partnership_accepted', 'Sua solicitacao de parceria foi aceita!', match.id]);
      
      const user = await get('SELECT name FROM users WHERE id = ?', [req.userId]);
      sendToUser(request.requester_id, { type: 'new_match', matchId: match.id, partnerId: req.userId });
      sendToUser(request.requester_id, { type: 'notification', notification: { type: 'partnership_accepted', message: `${user?.name} aceitou sua parceria!` } });

      // Award points
      await creditPoints(req.userId, 'partnership_accepted');
      await creditPoints(request.requester_id, 'partnership_accepted');

      res.json({ success: true, match: true, matchId: match.id });
    } else {
      await run('UPDATE partnership_requests SET status = ? WHERE id = ?', ['rejected', requestId]);
      
      await run('INSERT INTO notifications (user_id, type, message, reference_id) VALUES (?, ?, ?, ?)',
        [request.requester_id, 'partnership_rejected', 'Sua solicitacao de parceria foi recusada.', requestId]);
      
      sendToUser(request.requester_id, { type: 'notification', notification: { type: 'partnership_rejected', message: 'Parceria recusada.' } });
      
      res.json({ success: true, match: false });
    }
  } catch (err) {
    console.error('Partnership respond error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Get pending partnership requests (received)
router.get('/requests', authMiddleware, async (req, res) => {
  try {
    const requests = await all(`
      SELECT pr.*, u.name as requester_name, u.avatar as requester_avatar,
        p.name as requester_pet_name, p.image as requester_pet_image
      FROM partnership_requests pr
      JOIN users u ON pr.requester_id = u.id
      LEFT JOIN pets p ON pr.requester_pet_id = p.id
      WHERE pr.target_id = ? AND pr.status = 'pending'
      ORDER BY pr.created_at DESC
    `, [req.userId]);
    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Get sent partnership requests
router.get('/requests/sent', authMiddleware, async (req, res) => {
  try {
    const requests = await all(`
      SELECT pr.*, u.name as target_name, u.avatar as target_avatar,
        p.name as target_pet_name
      FROM partnership_requests pr
      JOIN users u ON pr.target_id = u.id
      LEFT JOIN pets p ON pr.target_pet_id = p.id
      WHERE pr.requester_id = ? AND pr.status = 'pending'
      ORDER BY pr.created_at DESC
    `, [req.userId]);
    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Check if partnership exists between two users
router.get('/status/:userId', authMiddleware, async (req, res) => {
  try {
    const targetId = parseInt(req.params.userId);
    const match = await get('SELECT * FROM matches WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)',
      [req.userId, targetId, targetId, req.userId]);
    const pending = await get('SELECT * FROM partnership_requests WHERE requester_id = ? AND target_id = ? AND status = ?',
      [req.userId, targetId, 'pending']);
    res.json({ connected: !!match, pending: !!pending, matchId: match?.id });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/matches', authMiddleware, async (req, res) => {
  try {
    const matches = await all(`
      SELECT m.*,
        CASE WHEN m.user1_id = ? THEN u2.id ELSE u1.id END as partner_id,
        CASE WHEN m.user1_id = ? THEN u2.name ELSE u1.name END as partner_name,
        CASE WHEN m.user1_id = ? THEN u2.avatar ELSE u1.avatar END as partner_avatar
      FROM matches m
      JOIN users u1 ON m.user1_id = u1.id
      JOIN users u2 ON m.user2_id = u2.id
      WHERE m.user1_id = ? OR m.user2_id = ?
      ORDER BY m.created_at DESC
    `, [req.userId, req.userId, req.userId, req.userId, req.userId]);

    res.json(matches);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/matches/:matchId/messages', authMiddleware, async (req, res) => {
  try {
    const match = await get('SELECT * FROM matches WHERE id = ? AND (user1_id = ? OR user2_id = ?)',
      [req.params.matchId, req.userId, req.userId]);

    if (!match) return res.status(403).json({ error: 'Sem acesso a esta conversa' });

    const messages = await all(`
      SELECT m.*, u.name as sender_name, u.avatar as sender_avatar
      FROM messages m JOIN users u ON m.sender_id = u.id
      WHERE m.match_id = ?
      ORDER BY m.created_at ASC
    `, [req.params.matchId]);

    await run('UPDATE messages SET is_read = 1 WHERE match_id = ? AND sender_id != ? AND is_read = 0',
      [req.params.matchId, req.userId]);

    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/matches/:matchId/messages', authMiddleware, async (req, res) => {
  try {
    const match = await get('SELECT * FROM matches WHERE id = ? AND (user1_id = ? OR user2_id = ?)',
      [req.params.matchId, req.userId, req.userId]);

    if (!match) return res.status(403).json({ error: 'Sem acesso' });

    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Mensagem obrigatoria' });

    const result = await run('INSERT INTO messages (match_id, sender_id, text) VALUES (?, ?, ?)',
      [req.params.matchId, req.userId, text.trim()]);

    const message = await get(`
      SELECT m.*, u.name as sender_name, u.avatar as sender_avatar
      FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?
    `, [result.lastInsertRowid]);

    const partnerId = match.user1_id === req.userId ? match.user2_id : match.user1_id;
    await run('INSERT INTO notifications (user_id, type, message, reference_id) VALUES (?, ?, ?, ?)',
      [partnerId, 'message', `Nova mensagem de ${message.sender_name}`, match.id]);

    sendToUser(partnerId, {
      type: 'new_message',
      matchId: parseInt(req.params.matchId),
      message
    });

    sendToUser(partnerId, {
      type: 'notification',
      notification: { type: 'message', message: `Nova mensagem de ${message.sender_name}` }
    });

    res.json(message);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;