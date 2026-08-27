const express = require('express');
const { run, get, all } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    const items = await all(`
      SELECT ci.*, p.title, p.price, p.image, p.stock, u.name as seller_name
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      JOIN users u ON p.seller_id = u.id
      WHERE ci.user_id = ?
      ORDER BY ci.created_at DESC
    `, [req.userId]);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { productId, quantity } = req.body;
    if (!productId) return res.status(400).json({ error: 'Produto obrigatorio' });

    const product = await get('SELECT * FROM products WHERE id = ? AND is_active = 1', [productId]);
    if (!product) return res.status(404).json({ error: 'Produto nao encontrado' });

    const existing = await get('SELECT * FROM cart_items WHERE user_id = ? AND product_id = ?', [req.userId, productId]);
    if (existing) {
      await run('UPDATE cart_items SET quantity = quantity + ? WHERE id = ?', [quantity || 1, existing.id]);
    } else {
      await run('INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?)', [req.userId, productId, quantity || 1]);
    }

    const items = await all(`
      SELECT ci.*, p.title, p.price, p.image, p.stock, u.name as seller_name
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      JOIN users u ON p.seller_id = u.id
      WHERE ci.user_id = ?
      ORDER BY ci.created_at DESC
    `, [req.userId]);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const item = await get('SELECT * FROM cart_items WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
    if (!item) return res.status(404).json({ error: 'Item nao encontrado' });

    const { quantity } = req.body;
    if (!quantity || quantity < 1) return res.status(400).json({ error: 'Quantidade invalida' });

    await run('UPDATE cart_items SET quantity = ? WHERE id = ?', [quantity, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const item = await get('SELECT * FROM cart_items WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
    if (!item) return res.status(404).json({ error: 'Item nao encontrado' });

    await run('DELETE FROM cart_items WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/', async (req, res) => {
  try {
    await run('DELETE FROM cart_items WHERE user_id = ?', [req.userId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
