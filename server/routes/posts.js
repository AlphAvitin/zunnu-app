const express = require('express');
const { run, get, all } = require('../db');
const { authMiddleware, optionalAuth } = require('../middleware/auth');
const { broadcast, sendToUser } = require('../ws');
const { creditPoints } = require('./points');

const router = express.Router();

const BLOCKED_WORDS = [
  'palavrao', 'idiota', 'desgraca', 'vagabundo', 'lixo', 'safado',
  'nudez', 'sexo', 'porno', 'puta', 'merda', 'caralho', 'fudeu',
  'porra', 'arrombado', 'babaca', 'buceta', 'corno', 'vadia'
];

function containsOffensiveText(text) {
  if (!text) return false;
  const clean = text.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[0-9@$!310]/g, m => ({ '0': 'o', '1': 'i', '3': 'e', '@': 'a', '$': 's', '!': 'i' }[m] || m));
  return BLOCKED_WORDS.some(w => new RegExp(`\\b${w}\\b`, 'i').test(clean));
}

router.get('/', optionalAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';

    let whereClause = '';
    const params = [];

    if (search) {
      whereClause = 'WHERE p.text LIKE ? OR u.name LIKE ?';
      params.push(`%${search}%`, `%${search}%`);
    }

    const posts = await all(`
      SELECT p.id, p.text, p.image, p.video_url, p.likes, p.comments_count, p.created_at,
             u.id as user_id, u.name as user_name, u.avatar as user_avatar, u.plan as user_plan
      FROM posts p
      JOIN users u ON p.user_id = u.id
      ${whereClause}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const total = await get(`
      SELECT COUNT(*) as count FROM posts p
      JOIN users u ON p.user_id = u.id
      ${whereClause}
    `, [...params]);

    let userLikes = [];
    if (req.userId) {
      userLikes = await all('SELECT post_id FROM post_likes WHERE user_id = ?', [req.userId]).then(rows => rows.map(r => r.post_id));
    }

    const result = posts.map(p => ({
      ...p,
      user_badge: p.user_plan === 'pro' ? 'pro' : p.user_plan === 'plus' ? 'plus' : 'free',
      time: formatTime(p.created_at),
      liked_by_user: userLikes.includes(p.id)
    }));

    res.json({ posts: result, total: total.count, page, pages: Math.ceil(total.count / limit) });
  } catch (err) {
    console.error('Posts list error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const { text, image, video_url } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Texto e obrigatorio' });
    }

    if (containsOffensiveText(text)) {
      return res.status(400).json({ error: 'Mensagem contem termos ofensivos' });
    }

    const result = await run('INSERT INTO posts (user_id, text, image, video_url) VALUES (?, ?, ?, ?)',
      [req.userId, text.trim(), image || null, video_url || null]);

    const post = await get(`
      SELECT p.*, u.name as user_name, u.avatar as user_avatar, u.plan as user_plan
      FROM posts p JOIN users u ON p.user_id = u.id WHERE p.id = ?
    `, [result.lastInsertRowid]);

    await creditPoints(req.userId, 'create_post');

    res.json({
      ...post,
      user_badge: post.user_plan === 'pro' ? 'pro' : post.user_plan === 'plus' ? 'plus' : 'free',
      time: 'agora',
      liked_by_user: false,
      comments_count: 0,
      likes: 0
    });

    broadcast({
      type: 'new_post',
      post: { ...post, user_badge: post.user_plan, time: 'agora', liked_by_user: false, comments_count: 0, likes: 0 }
    }, req.userId);
  } catch (err) {
    console.error('Post create error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const post = await get('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    if (!post) return res.status(404).json({ error: 'Post nao encontrado' });
    if (post.user_id !== req.userId) return res.status(403).json({ error: 'Sem permissao' });

    const { text } = req.body;
    if (text && containsOffensiveText(text)) {
      return res.status(400).json({ error: 'Mensagem contem termos ofensivos' });
    }

    await run('UPDATE posts SET text = ? WHERE id = ?', [text || post.text, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const post = await get('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    if (!post) return res.status(404).json({ error: 'Post nao encontrado' });
    if (post.user_id !== req.userId) return res.status(403).json({ error: 'Sem permissao' });

    await run('DELETE FROM posts WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/:id/like', authMiddleware, async (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    const post = await get('SELECT user_id FROM posts WHERE id = ?', [postId]);
    if (!post) return res.status(404).json({ error: 'Post nao encontrado' });
    const existing = await get('SELECT * FROM post_likes WHERE user_id = ? AND post_id = ?', [req.userId, postId]);

    if (existing) {
      await run('DELETE FROM post_likes WHERE user_id = ? AND post_id = ?', [req.userId, postId]);
      await run('UPDATE posts SET likes = MAX(0, likes - 1) WHERE id = ?', [postId]);
    } else {
      await run('INSERT INTO post_likes (user_id, post_id) VALUES (?, ?)', [req.userId, postId]);
      await run('UPDATE posts SET likes = likes + 1 WHERE id = ?', [postId]);
      if (post.user_id !== req.userId) {
        const liker = await get('SELECT name FROM users WHERE id = ?', [req.userId]);
        await run('INSERT INTO notifications (user_id, type, message, reference_id) VALUES (?, ?, ?, ?)',
          [post.user_id, 'like', `${liker?.name||'Alguem'} curtiu seu post!`, postId]);
      }
    }

    const updated = await get('SELECT likes FROM posts WHERE id = ?', [postId]);
    res.json({ likes: updated.likes, liked: !existing });

    broadcast({ type: 'post_like', postId, likes: updated.likes, liked: !existing, userId: req.userId }, req.userId);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/:id/comments', optionalAuth, async (req, res) => {
  try {
    const comments = await all(`
      SELECT c.id, c.text, c.created_at, u.id as user_id, u.name as user_name, u.avatar as user_avatar
      FROM comments c JOIN users u ON c.user_id = u.id
      WHERE c.post_id = ?
      ORDER BY c.created_at DESC
    `, [req.params.id]);

    res.json(comments.map(c => ({ ...c, time: formatTime(c.created_at) })));
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/:id/comments', authMiddleware, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Texto obrigatorio' });

    if (containsOffensiveText(text)) {
      return res.status(400).json({ error: 'Comentario contem termos ofensivos' });
    }

    const postId = parseInt(req.params.id);
    const post = await get('SELECT user_id FROM posts WHERE id = ?', [postId]);
    if (!post) return res.status(404).json({ error: 'Post nao encontrado' });

    await run('INSERT INTO comments (post_id, user_id, text) VALUES (?, ?, ?)',
      [postId, req.userId, text.trim()]);

    await run('UPDATE posts SET comments_count = comments_count + 1 WHERE id = ?', [postId]);

    const comment = await get(`
      SELECT c.*, u.name as user_name, u.avatar as user_avatar
      FROM comments c JOIN users u ON c.user_id = u.id
      ORDER BY c.id DESC LIMIT 1
    `);

    if (post.user_id !== req.userId) {
      const commenter = await get('SELECT name FROM users WHERE id = ?', [req.userId]);
      await run('INSERT INTO notifications (user_id, type, message, reference_id) VALUES (?, ?, ?, ?)',
        [post.user_id, 'comment', `${commenter?.name||'Alguem'} comentou no seu post!`, postId]);
    }

    res.json({ ...comment, time: 'agora' });

    broadcast({ type: 'new_comment', postId, comment: { ...comment, time: 'agora' } }, req.userId);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/:id/report', authMiddleware, async (req, res) => {
  try {
    const { reason } = req.body;
    await run('INSERT INTO reports (reporter_id, post_id, reason) VALUES (?, ?, ?)',
      [req.userId, req.params.id, reason || 'Nao especificado']);
    res.json({ success: true, message: 'Denuncia recebida' });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

function formatTime(dateStr) {
  if (!dateStr) return 'agora';
  const diff = (Date.now() - new Date(dateStr + 'Z').getTime()) / 1000;
  if (diff < 60) return 'agora';
  if (diff < 3600) return `ha ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `ha ${Math.floor(diff / 3600)}h`;
  return `ha ${Math.floor(diff / 86400)} dias`;
}

module.exports = router;
