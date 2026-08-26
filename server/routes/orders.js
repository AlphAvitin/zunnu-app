const express = require('express');
const { run, get, all } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  try {
    const orders = all('SELECT * FROM orders WHERE buyer_id = ? ORDER BY created_at DESC', [req.userId]);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/', (req, res) => {
  try {
    const { shipping_name, shipping_address, shipping_phone, payment_method } = req.body;
    if (!shipping_name || !shipping_address) return res.status(400).json({ error: 'Dados de envio obrigatorios' });

    const items = all(`
      SELECT ci.*, p.title, p.price, p.seller_id
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.user_id = ?
    `, [req.userId]);

    if (!items.length) return res.status(400).json({ error: 'Carrinho vazio' });

    const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const result = run(
      'INSERT INTO orders (buyer_id, total, shipping_name, shipping_address, shipping_phone, payment_method) VALUES (?, ?, ?, ?, ?, ?)',
      [req.userId, total, shipping_name, shipping_address, shipping_phone || '', payment_method || 'pix']
    );

    const orderId = result.lastInsertRowid;
    for (const item of items) {
      run(
        'INSERT INTO order_items (order_id, product_id, seller_id, title, price_at_purchase, quantity) VALUES (?, ?, ?, ?, ?, ?)',
        [orderId, item.product_id, item.seller_id, item.title, item.price, item.quantity]
      );
      run('UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?', [item.quantity, item.product_id]);
    }

    run('DELETE FROM cart_items WHERE user_id = ?', [req.userId]);

    const order = get('SELECT * FROM orders WHERE id = ?', [orderId]);
    order.items = all('SELECT * FROM order_items WHERE order_id = ?', [orderId]);
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/:id', (req, res) => {
  try {
    const order = get('SELECT * FROM orders WHERE id = ? AND buyer_id = ?', [req.params.id, req.userId]);
    if (!order) return res.status(404).json({ error: 'Pedido nao encontrado' });

    order.items = all('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.put('/:id/status', (req, res) => {
  try {
    const order = get('SELECT o.*, oi.seller_id FROM orders o JOIN order_items oi ON o.id = oi.order_id WHERE o.id = ? LIMIT 1', [req.params.id]);
    if (!order) return res.status(404).json({ error: 'Pedido nao encontrado' });

    const sellerItem = get('SELECT seller_id FROM order_items WHERE order_id = ? LIMIT 1', [req.params.id]);
    if (!sellerItem || sellerItem.seller_id !== req.userId) return res.status(403).json({ error: 'Sem permissao' });

    const { status } = req.body;
    const paidAt = status === 'paid' ? new Date().toISOString() : null;
    if (paidAt) {
      run('UPDATE orders SET status = ?, paid_at = ? WHERE id = ?', [status, paidAt, req.params.id]);
    } else {
      run('UPDATE orders SET status = ? WHERE id = ?', [status, req.params.id]);
    }

    res.json(get('SELECT * FROM orders WHERE id = ?', [req.params.id]));
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
