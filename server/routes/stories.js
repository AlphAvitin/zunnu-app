const express = require('express');
const { run, get, all } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { broadcast } = require('../ws');

const router = express.Router();

router.get('/', authMiddleware, (req, res) => {
  try {
    run("DELETE FROM stories WHERE expires_at < datetime('now')");

    const stories = all(`
      SELECT s.*, u.name as user_name, u.avatar as user_avatar,
        (SELECT COUNT(*) FROM story_views WHERE story_id = s.id) as view_count,
        (SELECT COUNT(*) FROM story_views WHERE story_id = s.id AND user_id = ?) as i_viewed
      FROM stories s
      JOIN users u ON s.user_id = u.id
      ORDER BY s.created_at DESC
    `, [req.userId]);

    const grouped = {};
    stories.forEach(s => {
      if (!grouped[s.user_id]) {
        grouped[s.user_id] = {
          user_id: s.user_id,
          user_name: s.user_name,
          user_avatar: s.user_avatar,
          stories: [],
          has_unviewed: false
        };
      }
      grouped[s.user_id].stories.push(s);
      if (!s.i_viewed) grouped[s.user_id].has_unviewed = true;
    });

    const myStory = stories.find(s => s.user_id === req.userId);
    const result = Object.values(grouped);
    result.sort((a, b) => {
      if (a.user_id === req.userId) return -1;
      if (b.user_id === req.userId) return 1;
      if (a.has_unviewed && !b.has_unviewed) return -1;
      if (!a.has_unviewed && b.has_unviewed) return 1;
      return 0;
    });

    res.json({ stories: result, my_story: myStory || null });
  } catch (err) {
    console.error('Stories list error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/', authMiddleware, (req, res) => {
  try {
    const { image_url, caption, pet_id } = req.body;
    if (!image_url) return res.status(400).json({ error: 'Imagem obrigatoria' });

    const result = run(
      'INSERT INTO stories (user_id, pet_id, image_url, caption) VALUES (?, ?, ?, ?)',
      [req.userId, pet_id || null, image_url, caption || '']
    );

    const story = get(`
      SELECT s.*, u.name as user_name, u.avatar as user_avatar
      FROM stories s JOIN users u ON s.user_id = u.id WHERE s.id = ?
    `, [result.lastInsertRowid]);

    res.json(story);

    broadcast({ type: 'new_story', story }, req.userId);
  } catch (err) {
    console.error('Story create error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/:id/view', authMiddleware, (req, res) => {
  try {
    const story = get('SELECT * FROM stories WHERE id = ?', [req.params.id]);
    if (!story) return res.status(404).json({ error: 'Story nao encontrado' });

    const existing = get('SELECT * FROM story_views WHERE story_id = ? AND user_id = ?',
      [req.params.id, req.userId]);
    if (!existing) {
      run('INSERT INTO story_views (story_id, user_id) VALUES (?, ?)',
        [req.params.id, req.userId]);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/:id', authMiddleware, (req, res) => {
  try {
    const story = get('SELECT * FROM stories WHERE id = ?', [req.params.id]);
    if (!story) return res.status(404).json({ error: 'Story nao encontrado' });
    if (story.user_id !== req.userId) return res.status(403).json({ error: 'Sem permissao' });

    run('DELETE FROM stories WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
