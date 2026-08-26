const express = require('express');
const { run, get, all } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.get('/', authMiddleware, (req, res) => {
  try {
    const notifications = all(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      [req.userId]
    );

    const unread = get(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
      [req.userId]
    );

    res.json({ notifications, unreadCount: unread.count });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/read', authMiddleware, (req, res) => {
  try {
    run('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.userId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/read/:id', authMiddleware, (req, res) => {
  try {
    run('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
