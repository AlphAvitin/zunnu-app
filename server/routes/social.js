const express = require('express');
const { run, get, all } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { sendToUser } = require('../ws');

const router = express.Router();

router.get('/user/:id', authMiddleware, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const user = await get(`
      SELECT id, name, avatar, bio, location, plan, created_at, is_human_verified,
        (SELECT COUNT(*) FROM follows WHERE follower_id = ? AND following_id = ?) as i_follow,
        (SELECT COUNT(*) FROM follows WHERE follower_id = ? AND following_id = ?) as they_follow,
        (SELECT COUNT(*) FROM follows WHERE following_id = ?) as followers,
        (SELECT COUNT(*) FROM follows WHERE follower_id = ?) as following,
        (SELECT COUNT(*) FROM posts WHERE user_id = ?) as posts_count,
        (SELECT COUNT(*) FROM pets WHERE user_id = ?) as pets_count
      FROM users WHERE id = ?
    `, [req.userId, userId, userId, req.userId, userId, userId, userId, userId, userId]);
    if (!user) return res.status(404).json({ error: 'Usuario nao encontrado' });

    const pets = await all('SELECT * FROM pets WHERE user_id = ?', [userId]);
    const recentPosts = await all(`
      SELECT p.*, u.name as user_name, u.avatar as user_avatar, u.plan as user_badge,
        (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comments_count,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as likes,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id AND user_id = ?) as liked_by_user
      FROM posts p JOIN users u ON p.user_id = u.id
      WHERE p.user_id = ?
      ORDER BY p.created_at DESC LIMIT 10
    `, [req.userId, userId]);

    res.json({ user, pets, recent_posts: recentPosts });
  } catch (err) {
    console.error('User profile error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/follow/:id', authMiddleware, async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    if (targetId === req.userId) return res.status(400).json({ error: 'Nao pode seguir a si mesmo' });

    const target = await get('SELECT id FROM users WHERE id = ?', [targetId]);
    if (!target) return res.status(404).json({ error: 'Usuario nao encontrado' });

    const existing = await get('SELECT * FROM follows WHERE follower_id = ? AND following_id = ?',
      [req.userId, targetId]);

    if (existing) {
      await run('DELETE FROM follows WHERE follower_id = ? AND following_id = ?', [req.userId, targetId]);
      res.json({ following: false });
    } else {
      await run('INSERT INTO follows (follower_id, following_id) VALUES (?, ?)', [req.userId, targetId]);
      const follower = await get('SELECT name FROM users WHERE id = ?', [req.userId]);
      await run('INSERT INTO notifications (user_id, type, message, reference_id) VALUES (?, ?, ?, ?)',
        [targetId, 'follow', `${follower?.name||'Alguem'} comecou a te seguir!`, req.userId]);
      res.json({ following: true });
      sendToUser(targetId, { type: 'new_follower', followerId: req.userId });
      sendToUser(targetId, { type: 'notification', notification: { type: 'follow', message: `${follower?.name||'Alguem'} comecou a te seguir!` } });
    }
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/followers/:id', authMiddleware, async (req, res) => {
  try {
    const users = await all(`
      SELECT u.id, u.name, u.avatar, u.plan, u.bio,
        (SELECT COUNT(*) FROM follows WHERE follower_id = ? AND following_id = u.id) as i_follow
      FROM follows f JOIN users u ON f.follower_id = u.id
      WHERE f.following_id = ?
      ORDER BY f.created_at DESC
    `, [req.userId, req.params.id]);
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/following/:id', authMiddleware, async (req, res) => {
  try {
    const users = await all(`
      SELECT u.id, u.name, u.avatar, u.plan, u.bio,
        (SELECT COUNT(*) FROM follows WHERE follower_id = ? AND following_id = u.id) as i_follow
      FROM follows f JOIN users u ON f.following_id = u.id
      WHERE f.follower_id = ?
      ORDER BY f.created_at DESC
    `, [req.userId, req.params.id]);
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/block/:id', authMiddleware, async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    if (targetId === req.userId) return res.status(400).json({ error: 'Nao pode bloquear a si mesmo' });
    const target = await get('SELECT id FROM users WHERE id = ?', [targetId]);
    if (!target) return res.status(404).json({ error: 'Usuario nao encontrado' });
    await run('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)', [req.userId, targetId]);
    await run('DELETE FROM follows WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)',
      [req.userId, targetId, targetId, req.userId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Block error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/block/:id', authMiddleware, async (req, res) => {
  try {
    await run('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?', [req.userId, parseInt(req.params.id)]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/blocked', authMiddleware, async (req, res) => {
  try {
    const rows = await all(`
      SELECT b.blocked_id as id, u.name, u.avatar, u.plan
      FROM blocks b JOIN users u ON u.id = b.blocked_id
      WHERE b.blocker_id = ?
      ORDER BY b.created_at DESC
    `, [req.userId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/feed', authMiddleware, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const posts = await all(`
      SELECT p.*, u.name as user_name, u.avatar as user_avatar, u.plan as user_badge,
        (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comments_count,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as likes,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id AND user_id = ?) as liked_by_user
      FROM posts p JOIN users u ON p.user_id = u.id
      WHERE p.user_id IN (SELECT following_id FROM follows WHERE follower_id = ?)
         OR p.user_id = ?
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `, [req.userId, req.userId, req.userId, limit, offset]);

    res.json(posts);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
