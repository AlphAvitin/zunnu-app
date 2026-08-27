const express = require('express');
const { get, all } = require('../db');
const { authMiddleware, optionalAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', optionalAuth, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const type = req.query.type || 'all';
    const uid = req.userId || -1;
    const species = req.query.species ? String(req.query.species).trim() : '';
    const sex = req.query.sex ? String(req.query.sex).trim() : '';
    const porte = req.query.porte ? String(req.query.porte).trim() : '';
    const city = req.query.city ? String(req.query.city).trim() : '';
    const limit = Math.min(parseInt(req.query.limit) || 5, 20);

    const out = { q, type, pets: [], users: [], posts: [] };

    if (!q && !species && !sex && !porte && !city) {
      return res.json(out);
    }

    const like = (v) => `%${v || ''}%`;
    const pt = (v) => String(v || '').toLowerCase();

    if (type === 'all' || type === 'pets') {
      const conds = [
        '(p.visibility IS NULL OR p.visibility IN (\'public\',\'friends\') OR p.user_id = ?)',
        `NOT (p.user_id = ? AND p.visibility = 'private')`
      ];
      const params = [uid, uid];
      const hasQ = () => !!(q || species || sex || porte || city);
      if (q) {
        conds.push(`(LOWER(p.name) LIKE ? OR LOWER(p.breed) LIKE ? OR LOWER(p.species) LIKE ? OR LOWER(p.location) LIKE ? OR LOWER(p.traits) LIKE ? OR LOWER(p.age) LIKE ?)`);
        params.push(like(q), like(q), like(q), like(q), like(q), like(q));
      }
      if (species) { conds.push('LOWER(p.species) = ?'); params.push(pt(species)); }
      if (sex) { conds.push(`(p.sex IS NULL OR p.sex = '' OR LOWER(p.sex) = ?)`); params.push(pt(sex)); }
      if (porte) { conds.push(`(p.porte IS NULL OR p.porte = '' OR LOWER(p.porte) = ?)`); params.push(pt(porte)); }
      if (city) { conds.push('LOWER(p.location) LIKE ?'); params.push(like(city)); }
      if (!hasQ()) conds.length = 0;
      if (conds.length) {
        const pets = await all(`
          SELECT p.*, u.name as tutor_name, u.avatar as tutor_avatar, u.location as tutor_location
          FROM pets p JOIN users u ON p.user_id = u.id
          WHERE ${conds.join(' AND ')}
          ORDER BY p.created_at DESC
          LIMIT ?
        `, [...params, limit]);
        out.pets = pets;
      }
    }

    if (type === 'all' || type === 'users') {
      if (q) {
        const users = await all(`
          SELECT u.id, u.name, u.avatar, u.bio, u.location, u.plan, u.is_human_verified,
            (SELECT COUNT(*) FROM pets WHERE user_id = u.id) as pets_count,
            (SELECT COUNT(*) FROM follows WHERE follower_id = ? AND following_id = u.id) as i_follow
          FROM users u
          WHERE u.id != ?
            AND (u.is_private IS NULL OR u.is_private = 0)
            AND (LOWER(u.name) LIKE ? OR LOWER(u.location) LIKE ?)
          ORDER BY u.name ASC
          LIMIT ?
        `, [uid, uid, like(q), like(q), limit]);
        out.users = users;
      }
    }

    if (type === 'all' || type === 'posts') {
      if (q) {
        const posts = await all(`
          SELECT p.id, p.text, p.image, p.video_url, p.likes, p.comments_count, p.shares,
            p.location as post_location, p.visibility as post_visibility, p.created_at,
            u.id as user_id, u.name as user_name, u.avatar as user_avatar, u.plan as user_plan,
            pt.id as pet_id, pt.name as pet_name, pt.species as pet_species, pt.image as pet_image
          FROM posts p
          JOIN users u ON p.user_id = u.id
          LEFT JOIN pets pt ON pt.id = p.pet_id
          WHERE LOWER(p.text) LIKE ?
            AND (p.visibility = 'public' OR p.user_id = ? OR
              (p.visibility = 'friends' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.following_id = p.user_id)))
            AND NOT EXISTS (SELECT 1 FROM blocks bl WHERE (bl.blocker_id = ? AND bl.blocked_id = p.user_id) OR (bl.blocker_id = p.user_id AND bl.blocked_id = ?))
          ORDER BY p.created_at DESC
          LIMIT ?
        `, [like(q), uid, uid, uid, uid, limit]);
        out.posts = posts.map(p => ({
          ...p,
          user_badge: p.user_plan === 'pro' ? 'pro' : p.user_plan === 'plus' ? 'plus' : 'free',
          time: formatTime(p.created_at)
        }));
      }
    }

    res.json(out);
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

function formatTime(dateStr) {
  if (!dateStr) return '';
  const diff = (Date.now() - new Date(dateStr + 'Z').getTime()) / 1000;
  if (diff < 60) return 'agora';
  if (diff < 3600) return `ha ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `ha ${Math.floor(diff / 3600)}h`;
  return `ha ${Math.floor(diff / 86400)} dias`;
}

module.exports = router;