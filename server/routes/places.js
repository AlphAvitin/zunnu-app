const express = require('express');
const { run, get, all, USE_PG } = require('../db');
const { authMiddleware, optionalAuth } = require('../middleware/auth');

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

const BASE_COLS = `
  b.id, b.user_id as owner_id, b.business_name as name, b.business_type, b.category,
  b.description, b.phone, b.address, b.hours, b.city, b.verified, b.pet_friendly,
  b.image, b.latitude, b.longitude, b.links,
  u.name as owner_name, u.avatar as owner_avatar`;

function rowToPlace(r, uid) {
  return {
    ...r,
    rating: r.rating != null ? Number(Number(r.rating).toFixed(1)) : r.rating,
    reviews_count: parseInt(r.reviews_count || 0, 10),
    favorites_count: parseInt(r.favorites_count || 0, 10),
    verified: r.verified ? 1 : 0,
    pet_friendly: r.pet_friendly ? 1 : 0,
    is_favorite: r.is_favorite ? 1 : 0,
    my_rating: r.my_rating != null ? Number(r.my_rating) : null,
    distance: r.latitude != null && r.my_lat != null && r.my_lat !== '' && r.my_lng != null && r.my_lng !== '' ? Math.round(haversine(Number(r.my_lat), Number(r.my_lng), Number(r.latitude), Number(r.longitude)) * 10) / 10 : null
  };
}

router.get('/', optionalAuth, async (req, res) => {
  try {
    const uid = req.userId || -1;
    const { category, q, city, lat, lng, radius } = req.query;
    let where = [];
    let params = [];
    const p = (v) => { params.push(v); return '?'; };
    if (category) { where.push('LOWER(b.category) = ?'); params.push(String(category).toLowerCase()); }
    if (q) { params.push(`%${q}%`, `%${q}%`, `%${q}%`); where.push('(LOWER(b.business_name) LIKE ? OR LOWER(b.city) LIKE ? OR LOWER(b.address) LIKE ?)'); }
    if (city) { params.push(`%${city}%`); where.push('LOWER(b.city) LIKE ?'); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = await all(`
      SELECT ${BASE_COLS},
        (SELECT ROUND(AVG(rating), 1) FROM place_reviews rv WHERE rv.place_id = b.id) as rating,
        (SELECT COUNT(*) FROM place_reviews rv WHERE rv.place_id = b.id) as reviews_count,
        (SELECT COUNT(*) FROM place_favorites f WHERE f.place_id = b.id) as favorites_count,
        CASE WHEN EXISTS (SELECT 1 FROM place_favorites f WHERE f.place_id = b.id AND f.user_id = ?) THEN 1 ELSE 0 END as is_favorite,
        ? as my_lat, ? as my_lng
      FROM business_profiles b
      LEFT JOIN users u ON u.id = b.user_id
      ${whereSql}
      ORDER BY b.verified DESC, favorites_count DESC, b.id ASC
    `, [uid, lat || null, lng || null, ...params]);
    let places = rows.map(r => rowToPlace(r, uid));
    if (!isNaN(parseFloat(lat)) && !isNaN(parseFloat(lng))) {
      const rad = parseFloat(radius) || 20;
      places = places
        .filter(x => x.latitude != null && x.longitude != null && haversine(Number(lat), Number(lng), Number(x.latitude), Number(x.longitude)) <= rad)
        .sort((a, b) => (a.distance || 99999) - (b.distance || 99999));
    }
    res.json(places);
  } catch (err) {
    console.error('Places list error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/my', authMiddleware, async (req, res) => {
  try {
    const rows = await all(`
      SELECT ${BASE_COLS},
        (SELECT ROUND(AVG(rating), 1) FROM place_reviews rv WHERE rv.place_id = b.id) as rating,
        (SELECT COUNT(*) FROM place_reviews rv WHERE rv.place_id = b.id) as reviews_count,
        (SELECT COUNT(*) FROM place_favorites f WHERE f.place_id = b.id) as favorites_count,
        CASE WHEN EXISTS (SELECT 1 FROM place_favorites f WHERE f.place_id = b.id AND f.user_id = ?) THEN 1 ELSE 0 END as is_favorite,
        '' as my_r
      FROM business_profiles b
      LEFT JOIN users u ON u.id = b.user_id
      WHERE b.user_id = ?
      ORDER BY b.id DESC
    `, [req.userId, req.userId]);
    res.json(rows.map(r => rowToPlace(r, req.userId)));
  } catch (err) {
    console.error('Places my error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/suggestions', authMiddleware, async (req, res) => {
  try {
    const rows = await all('SELECT * FROM place_suggestions WHERE suggested_by = ? ORDER BY created_at DESC', [req.userId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/suggestions/:id', authMiddleware, async (req, res) => {
  try {
    const s = await get('SELECT * FROM place_suggestions WHERE id = ? AND suggested_by = ?', [req.params.id, req.userId]);
    if (!s) return res.status(404).json({ error: 'Sugestao nao encontrada' });
    await run('DELETE FROM place_suggestions WHERE id = ?', [req.params.id]);
    res.json({ message: 'Sugestao removida' });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const uid = req.userId || -1;
    const r = await get(`
      SELECT ${BASE_COLS},
        (SELECT ROUND(AVG(rating), 1) FROM place_reviews rv WHERE rv.place_id = b.id) as rating,
        (SELECT COUNT(*) FROM place_reviews rv WHERE rv.place_id = b.id) as reviews_count,
        (SELECT COUNT(*) FROM place_favorites f WHERE f.place_id = b.id) as favorites_count,
        CASE WHEN EXISTS (SELECT 1 FROM place_favorites f WHERE f.place_id = b.id AND f.user_id = ?) THEN 1 ELSE 0 END as is_favorite,
        (SELECT rating FROM place_reviews rv WHERE rv.place_id = b.id AND rv.user_id = ?) as my_rating
      FROM business_profiles b
      LEFT JOIN users u ON u.id = b.user_id
      WHERE b.id = ?
    `, [uid, uid, req.params.id]);
    if (!r) return res.status(404).json({ error: 'Lugar nao encontrado' });
    const reviews = await all(`
      SELECT rv.*, u.name as user_name, u.avatar as user_avatar
      FROM place_reviews rv JOIN users u ON u.id = rv.user_id
      WHERE rv.place_id = ? ORDER BY rv.created_at DESC
    `, [req.params.id]);
    res.json({ place: rowToPlace(r, uid), reviews });
  } catch (err) {
    console.error('Place detail error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, category, city, address, phone, hours, description, latitude, longitude, image, pet_friendly, links } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Informe o nome do lugar' });
    const result = await run(`INSERT INTO business_profiles (business_name, business_type, category, city, address, phone, hours, description, latitude, longitude, image, pet_friendly, links, user_id, verified)
      VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [name.trim(), category || '', city || '', address || '', phone || '', hours || '', description || '',
       latitude != null ? Number(latitude) : null, longitude != null ? Number(longitude) : null, image || '', pet_friendly ? 1 : 0, links || '', req.userId]);
    res.status(201).json({ id: result.lastInsertRowid, message: 'Lugar criado!' });
  } catch (err) {
    console.error('Place create error:', err);
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'Voce ja cadastrou este lugar.' });
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const r = await get('SELECT * FROM business_profiles WHERE id = ?', [req.params.id]);
    if (!r) return res.status(404).json({ error: 'Lugar nao encontrado' });
    if (r.user_id !== req.userId) return res.status(403).json({ error: 'Somente o dono pode editar' });
    const { name, category, city, address, phone, hours, description, latitude, longitude, image, pet_friendly, links } = req.body;
    await run(`UPDATE business_profiles SET business_name = ?, category = ?, city = ?, address = ?, phone = ?, hours = ?, description = ?, latitude = ?, longitude = ?, image = ?, pet_friendly = ?, links = ? WHERE id = ?`,
      [name || r.business_name, category != null ? category : r.category, city != null ? city : r.city, address != null ? address : r.address,
       phone != null ? phone : r.phone, hours != null ? hours : r.hours, description != null ? description : r.description,
       latitude != null ? Number(latitude) : r.latitude, longitude != null ? Number(longitude) : r.longitude,
       image != null ? image : r.image, pet_friendly != null ? (pet_friendly ? 1 : 0) : r.pet_friendly, links != null ? links : r.links, req.params.id]);
    res.json({ message: 'Lugar atualizado!' });
  } catch (err) {
    console.error('Place update error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const r = await get('SELECT * FROM business_profiles WHERE id = ?', [req.params.id]);
    if (!r) return res.status(404).json({ error: 'Lugar nao encontrado' });
    if (r.user_id !== req.userId) return res.status(403).json({ error: 'Somente o dono pode remover' });
    await run('DELETE FROM place_reviews WHERE place_id = ?', [req.params.id]);
    await run('DELETE FROM place_favorites WHERE place_id = ?', [req.params.id]);
    await run('DELETE FROM business_profiles WHERE id = ?', [req.params.id]);
    res.json({ message: 'Lugar removido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/:id/favorite', authMiddleware, async (req, res) => {
  try {
    const pid = parseInt(req.params.id, 10);
    const exists = await get('SELECT 1 FROM place_favorites WHERE user_id = ? AND place_id = ?', [req.userId, pid]);
    if (exists) {
      await run('DELETE FROM place_favorites WHERE user_id = ? AND place_id = ?', [req.userId, pid]);
    } else {
      await run('INSERT INTO place_favorites (user_id, place_id) VALUES (?, ?)', [req.userId, pid]);
    }
    const cnt = await get('SELECT COUNT(*) as c FROM place_favorites WHERE place_id = ?', [pid]);
    res.json({ favorite: !exists, count: parseInt(cnt.c || 0, 10) });
  } catch (err) {
    console.error('Favorite error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/:id/review', authMiddleware, async (req, res) => {
  try {
    const pid = parseInt(req.params.id, 10);
    const rating = parseInt(req.body.rating, 10);
    if (isNaN(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'Avaliacao deve ser entre 1 e 5' });
    const comment = String(req.body.comment || '').trim();
    const has = await get('SELECT 1 FROM place_reviews WHERE place_id = ? AND user_id = ?', [pid, req.userId]);
    if (has) {
      await run('UPDATE place_reviews SET rating = ?, comment = ? WHERE place_id = ? AND user_id = ?', [rating, comment, pid, req.userId]);
    } else {
      if (USE_PG) {
        await run('INSERT INTO place_reviews (place_id, user_id, rating, comment) VALUES (?, ?, ?, ?) ON CONFLICT (place_id, user_id) DO UPDATE SET rating = ?, comment = ?', [pid, req.userId, rating, comment, rating, comment]);
      } else {
        await run('INSERT OR REPLACE INTO place_reviews (place_id, user_id, rating, comment) VALUES (?, ?, ?, ?)', [pid, req.userId, rating, comment]);
      }
    }
    res.json({ message: 'Avaliacao registrada!' });
  } catch (err) {
    console.error('Review error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/:id/review', authMiddleware, async (req, res) => {
  try {
    await run('DELETE FROM place_reviews WHERE place_id = ? AND user_id = ?', [req.params.id, req.userId]);
    res.json({ message: 'Avaliacao removida' });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/suggest', authMiddleware, async (req, res) => {
  try {
    const { name, category, city, address, reason, links } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Informe o nome do lugar' });
    const result = await run(`INSERT INTO place_suggestions (name, category, city, address, reason, links, suggested_by, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [name.trim(), category || '', city || '', address || '', reason || '', links || '', req.userId]);
    res.status(201).json({ id: result.lastInsertRowid, message: 'Sugestao enviada! Nossa equipe vai avaliar.' });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;