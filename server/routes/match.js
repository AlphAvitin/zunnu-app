const express = require('express');
const { run, get, all } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { sendToUser } = require('../ws');

const router = express.Router();

router.get('/deck', authMiddleware, (req, res) => {
  try {
    const swiped = all('SELECT swiped_id FROM match_swipes WHERE swiper_id = ?', [req.userId]).map(r => r.swiped_id);

    const pets = all(`
      SELECT p.*, u.name as tutor_name, u.avatar as tutor_avatar, u.bio as tutor_bio
      FROM pets p
      JOIN users u ON p.user_id = u.id
      WHERE p.user_id != ? ${swiped.length ? `AND p.user_id NOT IN (${swiped.map(() => '?').join(',')})` : ''}
      ORDER BY RANDOM()
      LIMIT 20
    `, [req.userId, ...swiped]);

    res.json(pets);
  } catch (err) {
    console.error('Match deck error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/swipe/:targetUserId', authMiddleware, (req, res) => {
  try {
    const { isLike } = req.body;
    const targetUserId = parseInt(req.params.targetUserId);

    if (targetUserId === req.userId) return res.status(400).json({ error: 'Nao pode curtir a si mesmo' });

    const existing = get('SELECT * FROM match_swipes WHERE swiper_id = ? AND swiped_id = ?',
      [req.userId, targetUserId]);

    if (existing) {
      if (existing.is_like && isLike) {
        return res.json({ match: false, message: 'Ja curtiu este perfil' });
      }
      run('UPDATE match_swipes SET is_like = ? WHERE swiper_id = ? AND swiped_id = ?',
        [isLike ? 1 : 0, req.userId, targetUserId]);
    } else {
      run('INSERT INTO match_swipes (swiper_id, swiped_id, is_like) VALUES (?, ?, ?)',
        [req.userId, targetUserId, isLike ? 1 : 0]);
    }

    if (isLike) {
      const mutualSwipe = get('SELECT * FROM match_swipes WHERE swiper_id = ? AND swiped_id = ? AND is_like = 1',
        [targetUserId, req.userId]);

      if (mutualSwipe) {
        const existingMatch = get(
          'SELECT * FROM matches WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)',
          [req.userId, targetUserId, targetUserId, req.userId]
        );

        if (!existingMatch) {
          run('INSERT INTO matches (user1_id, user2_id) VALUES (?, ?)', [req.userId, targetUserId]);
          const match = get('SELECT * FROM matches ORDER BY id DESC LIMIT 1', []);

          run('INSERT INTO notifications (user_id, type, message, reference_id) VALUES (?, ?, ?, ?)',
            [targetUserId, 'match', `Voce e ${req.userId} fizeram match!`, match.id]);

          sendToUser(targetUserId, { type: 'new_match', matchId: match.id, partnerId: req.userId });
          sendToUser(req.userId, { type: 'new_match', matchId: match.id, partnerId: targetUserId });
          sendToUser(targetUserId, { type: 'notification', notification: { type: 'match', message: `Voce fizeram match!` } });

          return res.json({ match: true, matchId: match.id });
        }
      }
    }

    res.json({ match: false });
  } catch (err) {
    console.error('Swipe error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/matches', authMiddleware, (req, res) => {
  try {
    const matches = all(`
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

router.get('/matches/:matchId/messages', authMiddleware, (req, res) => {
  try {
    const match = get('SELECT * FROM matches WHERE id = ? AND (user1_id = ? OR user2_id = ?)',
      [req.params.matchId, req.userId, req.userId]);

    if (!match) return res.status(403).json({ error: 'Sem acesso a esta conversa' });

    const messages = all(`
      SELECT m.*, u.name as sender_name, u.avatar as sender_avatar
      FROM messages m JOIN users u ON m.sender_id = u.id
      WHERE m.match_id = ?
      ORDER BY m.created_at ASC
    `, [req.params.matchId]);

    run('UPDATE messages SET is_read = 1 WHERE match_id = ? AND sender_id != ? AND is_read = 0',
      [req.params.matchId, req.userId]);

    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/matches/:matchId/messages', authMiddleware, (req, res) => {
  try {
    const match = get('SELECT * FROM matches WHERE id = ? AND (user1_id = ? OR user2_id = ?)',
      [req.params.matchId, req.userId, req.userId]);

    if (!match) return res.status(403).json({ error: 'Sem acesso' });

    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Mensagem obrigatoria' });

    const result = run('INSERT INTO messages (match_id, sender_id, text) VALUES (?, ?, ?)',
      [req.params.matchId, req.userId, text.trim()]);

    const message = get(`
      SELECT m.*, u.name as sender_name, u.avatar as sender_avatar
      FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?
    `, [result.lastInsertRowid]);

    const partnerId = match.user1_id === req.userId ? match.user2_id : match.user1_id;
    run('INSERT INTO notifications (user_id, type, message, reference_id) VALUES (?, ?, ?, ?)',
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
