const express = require('express');
const { run, get, all } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

router.get('/products', async (req, res) => {
  try {
    const rows = await all(`
      SELECT p.*, u.name as seller_name, u.avatar as seller_avatar, u.plan as seller_plan,
        1 as is_favorite
      FROM product_favorites pf
      JOIN products p ON pf.product_id = p.id
      JOIN users u ON p.seller_id = u.id
      WHERE pf.user_id = ? AND p.is_active = 1
      ORDER BY pf.created_at DESC
    `, [req.userId]);
    res.json(rows.map(p => ({ ...p, seller_badge: p.seller_plan === 'pro' ? 'pro' : p.seller_plan === 'plus' ? 'plus' : 'free' })));
  } catch (err) {
    console.error('Favorite products error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/products/:id', async (req, res) => {
  try {
    const p = await get('SELECT id FROM products WHERE id = ?', [req.params.id]);
    if (!p) return res.status(404).json({ error: 'Produto nao encontrado' });
    const exists = await get('SELECT 1 FROM product_favorites WHERE user_id = ? AND product_id = ?', [req.userId, p.id]);
    if (exists) {
      await run('DELETE FROM product_favorites WHERE user_id = ? AND product_id = ?', [req.userId, p.id]);
      return res.json({ favorite: false });
    }
    await run('INSERT INTO product_favorites (user_id, product_id) VALUES (?, ?)', [req.userId, p.id]);
    res.json({ favorite: true });
  } catch (err) {
    console.error('Favorite product error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/products/:id', async (req, res) => {
  try {
    await run('DELETE FROM product_favorites WHERE user_id = ? AND product_id = ?', [req.userId, req.params.id]);
    res.json({ favorite: false });
  } catch (err) {
    console.error('Unfavorite product error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/services', async (req, res) => {
  try {
    const rows = await all(`
      SELECT s.*, u.name as provider_name, u.avatar as provider_avatar, u.plan as provider_plan,
        1 as is_favorite
      FROM service_favorites sf
      JOIN services s ON sf.service_id = s.id
      JOIN users u ON s.provider_id = u.id
      WHERE sf.user_id = ? AND s.is_active = 1
      ORDER BY sf.created_at DESC
    `, [req.userId]);
    res.json(rows.map(s => ({ ...s, provider_badge: s.provider_plan === 'pro' ? 'pro' : s.provider_plan === 'plus' ? 'plus' : 'free' })));
  } catch (err) {
    console.error('Favorite services error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/services/:id', async (req, res) => {
  try {
    const s = await get('SELECT id FROM services WHERE id = ?', [req.params.id]);
    if (!s) return res.status(404).json({ error: 'Servico nao encontrado' });
    const exists = await get('SELECT 1 FROM service_favorites WHERE user_id = ? AND service_id = ?', [req.userId, s.id]);
    if (exists) {
      await run('DELETE FROM service_favorites WHERE user_id = ? AND service_id = ?', [req.userId, s.id]);
      return res.json({ favorite: false });
    }
    await run('INSERT INTO service_favorites (user_id, service_id) VALUES (?, ?)', [req.userId, s.id]);
    res.json({ favorite: true });
  } catch (err) {
    console.error('Favorite service error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/services/:id', async (req, res) => {
  try {
    await run('DELETE FROM service_favorites WHERE user_id = ? AND service_id = ?', [req.userId, req.params.id]);
    res.json({ favorite: false });
  } catch (err) {
    console.error('Unfavorite service error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;