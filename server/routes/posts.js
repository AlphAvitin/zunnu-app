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

const POST_COLS = `p.id, p.text, p.image, p.video_url, p.likes, p.comments_count, p.shares,
  p.location as post_location, p.visibility as post_visibility, p.created_at,
  u.id as user_id, u.name as user_name, u.avatar as user_avatar, u.plan as user_plan,
  pt.id as pet_id, pt.name as pet_name, pt.species as pet_species, pt.image as pet_image,
  pt.visibility as pet_visibility`;

router.get('/', optionalAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const filter = req.query.filter || 'for_you';
    const petFilter = parseInt(req.query.pet_id) || null;
    const uid = req.userId;
    let where = [];
    let params = [];
    const u = (val) => { params.push(val); return '?'; };

    if (petFilter) {
      where.push(`p.pet_id = ${u(petFilter)}`);
    }

    if (uid) {
      where.push(`NOT EXISTS (SELECT 1 FROM blocks bl WHERE (bl.blocker_id = ${u(uid)} AND bl.blocked_id = p.user_id) OR (bl.blocker_id = p.user_id AND bl.blocked_id = ${u(uid)}))`);
      where.push(`NOT EXISTS (SELECT 1 FROM hidden_posts hp WHERE hp.user_id = ${u(uid)} AND hp.post_id = p.id)`);
    }
    if (search) {
      where.push(`(p.text LIKE ? OR u.name LIKE ?)`);
      params.push(`%${search}%`, `%${search}%`);
    }
    if (uid) {
      where.push(`(p.visibility = 'public' OR p.user_id = ${u(uid)} OR
        (p.visibility = 'friends' AND EXISTS (SELECT 1 FROM follows q1 WHERE q1.follower_id = ${u(uid)} AND q1.following_id = p.user_id)))`);
      where.push(`(pt.id IS NULL OR pt.visibility = 'public' OR pt.visibility = 'friends' OR pt.user_id = ${u(uid)})`);
    } else {
      where.push(`p.visibility = 'public'`);
      where.push(`(pt.id IS NULL OR pt.visibility = 'public' OR pt.visibility = 'friends')`);
    }

    if (filter === 'following' && uid) {
      where.push(`(p.user_id = ${u(uid)} OR EXISTS (SELECT 1 FROM follows f2 WHERE f2.follower_id = ${u(uid)} AND f2.following_id = p.user_id))`);
    } else if (filter === 'nearby') {
      let lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng);
      if (!isFinite(lat) || !isFinite(lng)) {
        const me = uid ? await get('SELECT latitude, longitude FROM users WHERE id = ?', [uid]) : null;
        if (me && me.latitude != null && me.longitude != null) { lat = me.latitude; lng = me.longitude; }
      }
      if (isFinite(lat) && isFinite(lng)) {
        const rad = 20;
        const dLat = rad / 111;
        const dLng = rad / (111 * Math.cos(lat * Math.PI / 180) || 111);
        where.push(`(u.latitude IS NOT NULL AND u.longitude IS NOT NULL AND u.latitude BETWEEN ${u(lat - dLat)} AND ${u(lat + dLat)} AND u.longitude BETWEEN ${u(lng - dLng)} AND ${u(lng + dLng)})`);
      }
    }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const posts = await all(`
      SELECT ${POST_COLS}
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN pets pt ON pt.id = p.pet_id
      ${whereClause}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const total = await get(`
      SELECT COUNT(*) as count FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN pets pt ON pt.id = p.pet_id
      ${whereClause}
    `, [...params]);

    let userLikes = [];
    if (uid) {
      userLikes = await all('SELECT post_id FROM post_likes WHERE user_id = ?', [uid]).then(rows => rows.map(r => r.post_id));
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
    const { text, image, video_url, pet_id, location, visibility } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Texto e obrigatorio' });
    }

    if (containsOffensiveText(text)) {
      return res.status(400).json({ error: 'Mensagem contem termos ofensivos' });
    }

    let pid = parseInt(pet_id) || null;
    if (pid) {
      const pet = await get('SELECT id, user_id FROM pets WHERE id = ?', [pid]);
      if (!pet) return res.status(400).json({ error: 'Pet nao encontrado' });
      if (pet.user_id !== req.userId) return res.status(403).json({ error: 'Este pet nao e seu' });
    }

    const result = await run('INSERT INTO posts (user_id, text, image, video_url, pet_id, location, visibility, shares) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
      [req.userId, text.trim(), image || null, video_url || null, pid, String(location || '').trim(), visibility === 'friends' ? 'friends' : visibility === 'private' ? 'private' : 'public']);

    const post = await get(`
      SELECT ${POST_COLS}
      FROM posts p JOIN users u ON p.user_id = u.id
      LEFT JOIN pets pt ON pt.id = p.pet_id
      WHERE p.id = ?
    `, [result.lastInsertRowid]);

    await creditPoints(req.userId, 'create_post');

    const out = {
      ...post,
      user_badge: post.user_plan === 'pro' ? 'pro' : post.user_plan === 'plus' ? 'plus' : 'free',
      time: 'agora',
      liked_by_user: false,
      comments_count: 0,
      likes: 0
    };
    res.json(out);

    broadcast({ type: 'new_post', post: out }, req.userId);
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
    await run('DELETE FROM post_likes WHERE post_id = ?', [req.params.id]);
    await run('DELETE FROM comments WHERE post_id = ?', [req.params.id]);
    await run('DELETE FROM hidden_posts WHERE post_id = ?', [req.params.id]);
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

router.post('/:id/share', authMiddleware, async (req, res) => {
  try {
    const post = await get('SELECT id FROM posts WHERE id = ?', [req.params.id]);
    if (!post) return res.status(404).json({ error: 'Post nao encontrado' });
    await run('UPDATE posts SET shares = shares + 1 WHERE id = ?', [req.params.id]);
    const updated = await get('SELECT shares FROM posts WHERE id = ?', [req.params.id]);
    res.json({ shares: updated.shares });
    broadcast({ type: 'post_share', postId: parseInt(req.params.id), shares: updated.shares }, req.userId);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/:id/hide', authMiddleware, async (req, res) => {
  try {
    const post = await get('SELECT id FROM posts WHERE id = ?', [req.params.id]);
    if (!post) return res.status(404).json({ error: 'Post nao encontrado' });
    await run('INSERT OR IGNORE INTO hidden_posts (user_id, post_id) VALUES (?, ?)', [req.userId, parseInt(req.params.id)]);
    res.json({ success: true });
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

    const ids = [...new Set(comments.map(c => c.user_id))];
    let petMap = {};
    if (ids.length) {
      const ph = ids.map(() => '?').join(', ');
      const rows = await all(`SELECT user_id, name, image FROM pets WHERE user_id IN (${ph}) ORDER BY id ASC`, ids);
      for (const r of rows) { if (!petMap[r.user_id]) petMap[r.user_id] = r; }
    }

    res.json(comments.map(c => {
      const pet = petMap[c.user_id];
      return {
        ...c,
        time: formatTime(c.created_at),
        pet_id: pet ? pet.id : null,
        pet_name: pet ? pet.name : null,
        pet_image: pet ? pet.image : null
      };
    }));
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

    const myPet = await get('SELECT id, name, image FROM pets WHERE user_id = ? ORDER BY id ASC LIMIT 1', [req.userId]);

    if (post.user_id !== req.userId) {
      const commenter = await get('SELECT name FROM users WHERE id = ?', [req.userId]);
      await run('INSERT INTO notifications (user_id, type, message, reference_id) VALUES (?, ?, ?, ?)',
        [post.user_id, 'comment', `${commenter?.name||'Alguem'} comentou no seu post!`, postId]);
    }

    const out = { ...comment, time: 'agora', pet_id: myPet?.id || null, pet_name: myPet?.name || null, pet_image: myPet?.image || null };
    res.json(out);

    broadcast({ type: 'new_comment', postId, comment: out }, req.userId);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/:id/comments/:commentId', authMiddleware, async (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    const commentId = parseInt(req.params.commentId);
    const comment = await get('SELECT * FROM comments WHERE id = ? AND post_id = ?', [commentId, postId]);
    if (!comment) return res.status(404).json({ error: 'Comentario nao encontrado' });
    const post = await get('SELECT user_id FROM posts WHERE id = ?', [postId]);
    if (comment.user_id !== req.userId && post?.user_id !== req.userId) {
      return res.status(403).json({ error: 'Sem permissao' });
    }

    await run('DELETE FROM comments WHERE id = ?', [commentId]);
    await run('UPDATE posts SET comments_count = MAX(0, comments_count - 1) WHERE id = ?', [postId]);
    res.json({ success: true });
    broadcast({ type: 'comment_deleted', postId, commentId }, req.userId);
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