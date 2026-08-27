const express = require('express');
const { run, get, all } = require('../db');
const { authMiddleware, optionalAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', optionalAuth, async (req, res) => {
  try {
    const { search, minPrice, maxPrice } = req.query;
    let where = 'WHERE p.is_active = 1';
    const params = [req.userId || -1];

    if (search) { where += ' AND (p.title LIKE ? OR u.name LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    if (minPrice) { where += ' AND p.price >= ?'; params.push(parseFloat(minPrice)); }
    if (maxPrice) { where += ' AND p.price <= ?'; params.push(parseFloat(maxPrice)); }

    const products = await all(`
      SELECT p.*, u.name as seller_name, u.avatar as seller_avatar, u.plan as seller_plan,
        (SELECT COUNT(*) FROM product_favorites pf WHERE pf.product_id = p.id AND pf.user_id = ?) as is_favorite
      FROM products p JOIN users u ON p.seller_id = u.id
      ${where}
      ORDER BY p.created_at DESC
    `, params);

    res.json(products.map(p => ({
      ...p,
      seller_badge: p.seller_plan === 'pro' ? 'pro' : p.seller_plan === 'plus' ? 'plus' : 'free'
    })));
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const product = await get(`
      SELECT p.*, u.name as seller_name, u.avatar as seller_avatar, u.plan as seller_plan,
        (SELECT COUNT(*) FROM product_favorites pf WHERE pf.product_id = p.id AND pf.user_id = ?) as is_favorite
      FROM products p JOIN users u ON p.seller_id = u.id WHERE p.id = ?
    `, [req.userId || -1, req.params.id]);

    if (!product) return res.status(404).json({ error: 'Produto nao encontrado' });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    if (req.userPlan !== 'pro') {
      return res.status(403).json({ error: 'Apenas assinantes PRO podem cadastrar produtos' });
    }

    const { title, price, image, description } = req.body;
    if (!title || !price) return res.status(400).json({ error: 'Titulo e preco obrigatorios' });

    const result = await run('INSERT INTO products (seller_id, title, price, image, description) VALUES (?, ?, ?, ?, ?)',
      [req.userId, title.trim(), parseFloat(price), image || '', description || '']);

    const product = await get('SELECT * FROM products WHERE id = ?', [result.lastInsertRowid]);
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const product = await get('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (!product) return res.status(404).json({ error: 'Produto nao encontrado' });
    if (product.seller_id !== req.userId) return res.status(403).json({ error: 'Sem permissao' });

    const { title, price, image, description } = req.body;
    await run('UPDATE products SET title = ?, price = ?, image = ?, description = ? WHERE id = ?',
      [title || product.title, price || product.price, image || product.image, description || product.description, req.params.id]);

    res.json(await get('SELECT * FROM products WHERE id = ?', [req.params.id]));
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const product = await get('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (!product) return res.status(404).json({ error: 'Produto nao encontrado' });
    if (product.seller_id !== req.userId) return res.status(403).json({ error: 'Sem permissao' });

    await run('DELETE FROM products WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
