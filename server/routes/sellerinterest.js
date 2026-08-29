const express = require('express');
const { run, get } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const row = await get('SELECT * FROM seller_interest WHERE user_id = ? ORDER BY id DESC LIMIT 1', [req.userId]);
    res.json(row || null);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, sell_desc, contact } = req.body;
    if (!name || !sell_desc || !contact) {
      return res.status(400).json({ error: 'Preencha todos os campos' });
    }
    const existing = await get('SELECT id FROM seller_interest WHERE user_id = ?', [req.userId]);
    if (existing) {
      await run('UPDATE seller_interest SET name = ?, sell_desc = ?, contact = ? WHERE user_id = ?', [name, sell_desc, contact, req.userId]);
    } else {
      await run('INSERT INTO seller_interest (user_id, name, sell_desc, contact) VALUES (?, ?, ?, ?)', [req.userId, name, sell_desc, contact]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
