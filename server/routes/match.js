const express = require('express');
const { run, get, all } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { sendToUser } = require('../ws');
const { creditPoints } = require('./points');
const { bumpIntimacy, getMatchStats, INTIMACY } = require('../partnership');

const router = express.Router();

function juntosDias(createdAt) {
  if (!createdAt) return 0;
  const m = String(createdAt).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return 0;
  const start = new Date(m.slice(1).join('-') + 'T00:00:00Z').getTime();
  return Math.max(0, Math.round((Date.now() - start) / 86400000));
}

// Send partnership request
router.post('/request', authMiddleware, async (req, res) => {
  try {
    const { targetUserId, targetPetId, requesterPetId, type } = req.body;
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
    
    const pType = type === 'relacionamento' ? 'relacionamento' : 'amigos';
    const result = await run('INSERT INTO partnership_requests (requester_id, requester_pet_id, target_id, target_pet_id, partnership_type) VALUES (?, ?, ?, ?, ?)',
      [req.userId, requesterPetId || null, targetUserId, targetPetId || null, pType]);
    
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
      const pType = request.partnership_type === 'relacionamento' ? 'relacionamento' : 'amigos';
      await run('INSERT INTO matches (user1_id, user2_id, partnership_type) VALUES (?, ?, ?)', [request.requester_id, request.target_id, pType]);
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

// Candidate deck: public pets I haven't swiped yet
router.get('/deck', authMiddleware, async (req, res) => {
  try {
    const pets = await all(`
      SELECT p.*, u.id as user_id, u.name as tutor_name, u.avatar as tutor_avatar, u.location as tutor_location, u.bio as tutor_bio
      FROM pets p JOIN users u ON p.user_id = u.id
      WHERE u.id != ?
        AND (p.visibility IS NULL OR p.visibility IN ('public','friends'))
        AND p.user_id NOT IN (SELECT swiped_id FROM match_swipes WHERE swiper_id = ?)
      ORDER BY RANDOM() LIMIT 30
    `, [req.userId, req.userId]);
    res.json(pets);
  } catch (err) {
    console.error('Match deck error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Swipe (like/dislike). Mutual like creates a match.
router.post('/swipe/:userId', authMiddleware, async (req, res) => {
  try {
    const targetId = parseInt(req.params.userId);
    if (!targetId || targetId === req.userId) return res.status(400).json({ error: 'Usuario invalido' });
    const isLike = req.body.isLike ? 1 : 0;

    await run('INSERT INTO match_swipes (swiper_id, swiped_id, is_like) VALUES (?, ?, ?) ON CONFLICT (swiper_id, swiped_id) DO UPDATE SET is_like = ?',
      [req.userId, targetId, isLike, isLike]);

    if (!isLike) return res.json({ liked: false, match: false });

    const target = await get('SELECT id, name FROM users WHERE id = ?', [targetId]);
    if (!target) return res.status(404).json({ error: 'Usuario nao encontrado' });

    const mutual = await get('SELECT * FROM match_swipes WHERE swiper_id = ? AND swiped_id = ? AND is_like = 1', [targetId, req.userId]);

    if (!mutual) return res.json({ liked: true, match: false });

    const existingMatch = await get('SELECT * FROM matches WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)',
      [req.userId, targetId, targetId, req.userId]);

    if (existingMatch) return res.json({ liked: true, match: true, matchId: existingMatch.id });

    const pType = req.body.type === 'relacionamento' ? 'relacionamento' : 'amigos';
    const result = await run('INSERT INTO matches (user1_id, user2_id, partnership_type) VALUES (?, ?, ?)', [req.userId, targetId, pType]);
    const matchId = result.lastInsertRowid;

    const me = await get('SELECT name FROM users WHERE id = ?', [req.userId]);

    await run('INSERT INTO notifications (user_id, type, message, reference_id) VALUES (?, ?, ?, ?)',
      [targetId, 'new_match', `${me?.name || 'Alguem'} deu match com voce!`, matchId]);
    await run('INSERT INTO notifications (user_id, type, message, reference_id) VALUES (?, ?, ?, ?)',
      [req.userId, 'new_match', `Novo match com ${target.name}!`, matchId]);

    sendToUser(targetId, { type: 'new_match', matchId, partnerId: req.userId, partnerName: me?.name });
    sendToUser(targetId, { type: 'notification', notification: { type: 'new_match', message: `Novo match com ${me?.name}!`, referenceId: matchId } });

    await creditPoints(req.userId, 'partnership_accepted');
    await creditPoints(targetId, 'partnership_accepted');

    res.json({ liked: true, match: true, matchId });
  } catch (err) {
    console.error('Match swipe error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/matches', authMiddleware, async (req, res) => {
  try {
    const matches = await all(`
      SELECT m.*,
        CASE WHEN m.user1_id = ? THEN u2.id ELSE u1.id END as partner_id,
        CASE WHEN m.user1_id = ? THEN u2.name ELSE u1.name END as partner_name,
        CASE WHEN m.user1_id = ? THEN u2.avatar ELSE u1.avatar END as partner_avatar,
        (SELECT COUNT(*) FROM messages ms WHERE ms.match_id = m.id AND ms.sender_id != ? AND ms.is_read = 0) as unread,
        (SELECT text FROM messages ms2 WHERE ms2.match_id = m.id ORDER BY ms2.id DESC LIMIT 1) as last_message,
        (SELECT sender_id FROM messages ms3 WHERE ms3.match_id = m.id ORDER BY ms3.id DESC LIMIT 1) as last_sender_id,
        (SELECT created_at FROM messages ms4 WHERE ms4.match_id = m.id ORDER BY ms4.id DESC LIMIT 1) as last_message_time
      FROM matches m
      JOIN users u1 ON m.user1_id = u1.id
      JOIN users u2 ON m.user2_id = u2.id
      WHERE m.user1_id = ? OR m.user2_id = ?
      ORDER BY COALESCE((SELECT ms4.created_at FROM messages ms4 WHERE ms4.match_id = m.id ORDER BY ms4.id DESC LIMIT 1), m.created_at) DESC
    `, [req.userId, req.userId, req.userId, req.userId, req.userId, req.userId]);

    const ids = matches.map(x => x.id);
    let daysByMatch = {};
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      const days = await all(`SELECT match_id, day FROM match_interaction_days WHERE match_id IN (${placeholders})`, ids);
      daysByMatch = days.reduce((acc, r) => {
        (acc[r.match_id] = acc[r.match_id] || []).push(r.day);
        return acc;
      }, {});
    }
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const computeStreak = (daysArr) => {
      const set = new Set(daysArr || []);
      let streak = 0;
      let cursor = set.has(todayStr) ? todayStr : new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      while (set.has(cursor)) {
        streak++;
        cursor = new Date(new Date(cursor + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
      }
      return streak;
    };

    const out = matches.map(m => ({
      ...m,
      juntos_dias: juntosDias(m.created_at),
      streak: computeStreak(daysByMatch[m.id])
    }));

    res.json(out);
  } catch (err) {
    console.error('Match list error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/matches/:matchId/stats', authMiddleware, async (req, res) => {
  try {
    const matchId = parseInt(req.params.matchId);
    const match = await get('SELECT * FROM matches WHERE id = ? AND (user1_id = ? OR user2_id = ?)',
      [matchId, req.userId, req.userId]);
    if (!match) return res.status(404).json({ error: 'Parceria nao encontrada' });
    const stats = await getMatchStats(matchId);
    const partnerId = match.user1_id === req.userId ? match.user2_id : match.user1_id;
    const partner = await get('SELECT id, name, avatar FROM users WHERE id = ?', [partnerId]);
    res.json({ ...stats, partner_id: partnerId, partner_name: partner?.name, partner_avatar: partner?.avatar });
  } catch (err) {
    console.error('Match stats error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/matches/:matchId/messages', authMiddleware, async (req, res) => {
  try {
    const match = await get('SELECT * FROM matches WHERE id = ? AND (user1_id = ? OR user2_id = ?)',
      [req.params.matchId, req.userId, req.userId]);

    if (!match) return res.status(403).json({ error: 'Sem acesso a esta conversa' });

    const unreadSenders = await all('SELECT DISTINCT sender_id FROM messages WHERE match_id = ? AND sender_id != ? AND is_read = 0', [req.params.matchId, req.userId]);

    const messages = await all(`
      SELECT m.*, u.name as sender_name, u.avatar as sender_avatar
      FROM messages m JOIN users u ON m.sender_id = u.id
      WHERE m.match_id = ?
      ORDER BY m.created_at ASC
    `, [req.params.matchId]);

    await run('UPDATE messages SET is_read = 1 WHERE match_id = ? AND sender_id != ? AND is_read = 0',
      [req.params.matchId, req.userId]);

    unreadSenders.forEach(r => sendToUser(r.sender_id, { type: 'read', matchId: parseInt(req.params.matchId) }));

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

    await bumpIntimacy(match.id, INTIMACY.message);

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