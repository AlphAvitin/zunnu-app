const express = require('express');
const { run, get, all } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { broadcast, sendToUser } = require('../ws');

const router = express.Router();

router.get('/', authMiddleware, (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const reels = all(`
      SELECT r.*, u.name as user_name, u.avatar as user_avatar, u.plan as user_plan,
        (SELECT COUNT(*) FROM reel_likes WHERE reel_id = r.id) as likes_count,
        (SELECT COUNT(*) FROM reel_likes WHERE reel_id = r.id AND user_id = ?) as liked_by_user,
        (SELECT COUNT(*) FROM reel_comments WHERE reel_id = r.id) as comments_count
      FROM reels r
      JOIN users u ON r.user_id = u.id
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `, [req.userId, limit, offset]);

    res.json(reels);
  } catch (err) {
    console.error('Reels list error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/', authMiddleware, (req, res) => {
  try {
    const { video_url, thumbnail, caption, music, pet_id } = req.body;
    if (!video_url) return res.status(400).json({ error: 'Video obrigatorio' });

    const result = run(
      'INSERT INTO reels (user_id, pet_id, video_url, thumbnail, caption, music) VALUES (?, ?, ?, ?, ?, ?)',
      [req.userId, pet_id || null, video_url, thumbnail || '', caption || '', music || '']
    );

    const reel = get(`
      SELECT r.*, u.name as user_name, u.avatar as user_avatar, u.plan as user_plan
      FROM reels r JOIN users u ON r.user_id = u.id WHERE r.id = ?
    `, [result.lastInsertRowid]);

    res.json({ ...reel, likes_count: 0, comments_count: 0, liked_by_user: false });

    broadcast({ type: 'new_reel', reel: { ...reel, likes_count: 0, comments_count: 0 } }, req.userId);
  } catch (err) {
    console.error('Reel create error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/:id/like', authMiddleware, (req, res) => {
  try {
    const reelId = parseInt(req.params.id);
    const reel = get('SELECT user_id FROM reels WHERE id = ?', [reelId]);
    if (!reel) return res.status(404).json({ error: 'Reel nao encontrado' });
    const existing = get('SELECT * FROM reel_likes WHERE user_id = ? AND reel_id = ?',
      [req.userId, reelId]);

    if (existing) {
      run('DELETE FROM reel_likes WHERE user_id = ? AND reel_id = ?', [req.userId, reelId]);
    } else {
      run('INSERT INTO reel_likes (user_id, reel_id) VALUES (?, ?)', [req.userId, reelId]);
      if (reel.user_id !== req.userId) {
        const liker = get('SELECT name FROM users WHERE id = ?', [req.userId]);
        run('INSERT INTO notifications (user_id, type, message, reference_id) VALUES (?, ?, ?, ?)',
          [reel.user_id, 'reel_like', `${liker?.name||'Alguem'} curtiu seu reel!`, reelId]);
        sendToUser(reel.user_id, { type: 'notification', notification: { type: 'reel_like', message: `${liker?.name||'Alguem'} curtiu seu reel!` } });
      }
    }

    const count = get('SELECT COUNT(*) as c FROM reel_likes WHERE reel_id = ?', [reelId]);
    res.json({ likes: count.c, liked: !existing });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/:id/comments', authMiddleware, (req, res) => {
  try {
    const comments = all(`
      SELECT c.*, u.name as user_name, u.avatar as user_avatar
      FROM reel_comments c JOIN users u ON c.user_id = u.id
      WHERE c.reel_id = ?
      ORDER BY c.created_at DESC
    `, [req.params.id]);

    res.json(comments);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/:id/comments', authMiddleware, (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Texto obrigatorio' });

    const reelId = parseInt(req.params.id);
    const reel = get('SELECT user_id FROM reels WHERE id = ?', [reelId]);
    if (!reel) return res.status(404).json({ error: 'Reel nao encontrado' });

    run('INSERT INTO reel_comments (reel_id, user_id, text) VALUES (?, ?, ?)',
      [reelId, req.userId, text.trim()]);

    const comment = get(`
      SELECT c.*, u.name as user_name, u.avatar as user_avatar
      FROM reel_comments c JOIN users u ON c.user_id = u.id
      ORDER BY c.id DESC LIMIT 1
    `);

    if (reel.user_id !== req.userId) {
      const commenter = get('SELECT name FROM users WHERE id = ?', [req.userId]);
      run('INSERT INTO notifications (user_id, type, message, reference_id) VALUES (?, ?, ?, ?)',
        [reel.user_id, 'reel_comment', `${commenter?.name||'Alguem'} comentou no seu reel!`, reelId]);
      sendToUser(reel.user_id, { type: 'notification', notification: { type: 'reel_comment', message: `${commenter?.name||'Alguem'} comentou no seu reel!` } });
    }

    res.json(comment);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/:id/view', authMiddleware, (req, res) => {
  try {
    run('UPDATE reels SET views_count = views_count + 1 WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/:id', authMiddleware, (req, res) => {
  try {
    const reel = get('SELECT * FROM reels WHERE id = ?', [req.params.id]);
    if (!reel) return res.status(404).json({ error: 'Reel nao encontrado' });
    if (reel.user_id !== req.userId) return res.status(403).json({ error: 'Sem permissao' });

    run('DELETE FROM reels WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
