const express = require('express');
const { run, get, all } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { sendToUser } = require('../ws');

const router = express.Router();

router.get('/user/:id', authMiddleware, (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const user = get(`
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

    const pets = all('SELECT * FROM pets WHERE user_id = ?', [userId]);
    const recentPosts = all(`
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

router.post('/follow/:id', authMiddleware, (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    if (targetId === req.userId) return res.status(400).json({ error: 'Nao pode seguir a si mesmo' });

    const target = get('SELECT id FROM users WHERE id = ?', [targetId]);
    if (!target) return res.status(404).json({ error: 'Usuario nao encontrado' });

    const existing = get('SELECT * FROM follows WHERE follower_id = ? AND following_id = ?',
      [req.userId, targetId]);

    if (existing) {
      run('DELETE FROM follows WHERE follower_id = ? AND following_id = ?', [req.userId, targetId]);
      res.json({ following: false });
    } else {
      run('INSERT INTO follows (follower_id, following_id) VALUES (?, ?)', [req.userId, targetId]);
      const follower = get('SELECT name FROM users WHERE id = ?', [req.userId]);
      run('INSERT INTO notifications (user_id, type, message, reference_id) VALUES (?, ?, ?, ?)',
        [targetId, 'follow', `${follower?.name||'Alguem'} comecou a te seguir!`, req.userId]);
      res.json({ following: true });
      sendToUser(targetId, { type: 'new_follower', followerId: req.userId });
      sendToUser(targetId, { type: 'notification', notification: { type: 'follow', message: `${follower?.name||'Alguem'} comecou a te seguir!` } });
    }
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/followers/:id', authMiddleware, (req, res) => {
  try {
    const users = all(`
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

router.get('/following/:id', authMiddleware, (req, res) => {
  try {
    const users = all(`
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

router.get('/feed', authMiddleware, (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const posts = all(`
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
