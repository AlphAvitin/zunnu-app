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

    const out = { q, type, pets: [], users: [], posts: [], events: [], products: [], services: [], adoptions: [], places: [] };

    if (!q && !species && !sex && !porte && !city) {
      return res.json(out);
    }

    const like = (v) => `%${String(v || '').toLowerCase()}%`;
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

if (type === 'all' || type === 'events') {
      if (q) {
        out.events = await all(`
          SELECT e.id, e.name, e.description, e.category, e.date, e.time, e.location, e.city, e.image,
            (SELECT COUNT(*) FROM event_participants ep WHERE ep.event_id = e.id) as participants
          FROM events e
          WHERE e.status = 'approved'
            AND (LOWER(e.name) LIKE ? OR LOWER(e.description) LIKE ? OR LOWER(e.location) LIKE ? OR LOWER(e.city) LIKE ? OR LOWER(e.category) LIKE ?)
          ORDER BY e.date ASC, e.time ASC
          LIMIT ?
        `, [like(q), like(q), like(q), like(q), like(q), limit]);
      }
    }

    if (type === 'all' || type === 'products') {
      if (q) {
        out.products = await all(`
          SELECT pr.id, pr.title, pr.price, pr.image, pr.description, u.id as seller_id, u.name as seller_name, u.avatar as seller_avatar
          FROM products pr JOIN users u ON pr.seller_id = u.id
          WHERE pr.is_active = 1
            AND (LOWER(pr.title) LIKE ? OR LOWER(pr.description) LIKE ?)
          ORDER BY pr.created_at DESC
          LIMIT ?
        `, [like(q), like(q), limit]);
      }
    }

    if (type === 'all' || type === 'services') {
      if (q) {
        out.services = await all(`
          SELECT s.id, s.title, s.price, s.duration, s.icon, s.description, u.id as provider_id, u.name as provider_name, u.avatar as provider_avatar
          FROM services s JOIN users u ON s.provider_id = u.id
          WHERE s.is_active = 1
            AND (LOWER(s.title) LIKE ? OR LOWER(s.description) LIKE ?)
          ORDER BY s.created_at DESC
          LIMIT ?
        `, [like(q), like(q), limit]);
      }
    }

    if (type === 'all' || type === 'adoptions') {
      if (q) {
        out.adoptions = await all(`
          SELECT a.id, a.name, a.species, a.sex, a.age, a.porte, a.city, a.image, a.story,
            u.id as owner_id, u.name as owner_name
          FROM adoption_pets a JOIN users u ON a.user_id = u.id
          WHERE a.status != 'adopted'
            AND (LOWER(a.name) LIKE ? OR LOWER(a.story) LIKE ? OR LOWER(a.city) LIKE ?)
          ORDER BY a.created_at DESC
          LIMIT ?
        `, [like(q), like(q), like(q), limit]);
      }
    }

    if (type === 'all' || type === 'places') {
      if (q) {
        out.places = await all(`
          SELECT bp.id, bp.business_name as name, bp.category, bp.address, bp.city, bp.hours,
            (SELECT ROUND(AVG(rating), 1) FROM place_reviews rv WHERE rv.place_id = bp.id) as rating,
            u.id as owner_id, u.name as owner_name
          FROM business_profiles bp LEFT JOIN users u ON bp.user_id = u.id
          WHERE bp.business_name IS NOT NULL AND bp.business_name != ''
            AND (LOWER(bp.business_name) LIKE ? OR LOWER(COALESCE(bp.category,'')) LIKE ? OR LOWER(COALESCE(bp.city,'')) LIKE ?)
          ORDER BY bp.id DESC
          LIMIT ?
        `, [like(q), like(q), like(q), limit]);
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