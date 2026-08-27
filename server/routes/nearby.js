const express = require('express');
const { run, get, all } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

router.get('/pets', authMiddleware, async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const radius = parseFloat(req.query.radius) || 10;
    const species = req.query.species || null;

    if (isNaN(lat) || isNaN(lng)) {
      return res.json([]);
    }

    let query = `
      SELECT p.*, u.name as owner_name, u.avatar as owner_avatar,
        (SELECT COUNT(*) FROM follows WHERE follower_id = ? AND following_id = u.id) as i_follow
      FROM pets p
      JOIN users u ON p.user_id = u.id
      WHERE p.latitude IS NOT NULL AND p.longitude IS NOT NULL
      AND (p.visibility IS NULL OR p.visibility IN ('public','friends') OR p.user_id = ?)
    `;
    const params = [req.userId, req.userId];

    if (species) {
      query += ` AND p.species = ?`;
      params.push(species);
    }

    query += ` ORDER BY p.created_at DESC`;
    const pets = await all(query, params);

    const nearby = pets.map(p => {
      const dist = haversine(lat, lng, p.latitude, p.longitude);
      return { ...p, distance: Math.round(dist * 10) / 10 };
    }).filter(p => p.distance <= radius)
      .sort((a, b) => a.distance - b.distance);

    res.json(nearby);
  } catch (err) {
    console.error('Nearby pets error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/users', authMiddleware, async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const radius = parseFloat(req.query.radius) || 10;

    if (isNaN(lat) || isNaN(lng)) {
      return res.json([]);
    }

    const users = await all(`
      SELECT id, name, avatar, bio, location, plan, latitude, longitude
      FROM users
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND id != ?
    `, [req.userId]);

    const nearby = users.map(u => {
      const dist = haversine(lat, lng, u.latitude, u.longitude);
      return { ...u, distance: Math.round(dist * 10) / 10 };
    }).filter(u => u.distance <= radius)
      .sort((a, b) => a.distance - b.distance);

    res.json(nearby);
  } catch (err) {
    console.error('Nearby users error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/location', authMiddleware, async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    if (isNaN(latitude) || isNaN(longitude)) {
      return res.status(400).json({ error: 'Coordenadas invalidas' });
    }
    await run('UPDATE users SET latitude = ?, longitude = ? WHERE id = ?',
      [latitude, longitude, req.userId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
