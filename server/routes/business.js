const express = require('express');
const { run, get } = require('../db');
const { authMiddleware, optionalAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/profile', authMiddleware, (req, res) => {
  try {
    const profile = get('SELECT * FROM business_profiles WHERE user_id = ?', [req.userId]);
    res.json(profile || null);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/profile', authMiddleware, (req, res) => {
  try {
    const { business_name, business_type, description, phone, address, hours } = req.body;
    if (!business_name) return res.status(400).json({ error: 'Nome do negocio obrigatorio' });

    const existing = get('SELECT * FROM business_profiles WHERE user_id = ?', [req.userId]);
    if (existing) {
      run(
        'UPDATE business_profiles SET business_name = ?, business_type = ?, description = ?, phone = ?, address = ?, hours = ? WHERE user_id = ?',
        [business_name, business_type || '', description || '', phone || '', address || '', hours || '', req.userId]
      );
    } else {
      run(
        'INSERT INTO business_profiles (user_id, business_name, business_type, description, phone, address, hours) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [req.userId, business_name, business_type || '', description || '', phone || '', address || '', hours || '']
      );
    }

    res.json(get('SELECT * FROM business_profiles WHERE user_id = ?', [req.userId]));
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/:userId', optionalAuth, (req, res) => {
  try {
    const profile = get(`
      SELECT bp.*, u.name as owner_name, u.avatar as owner_avatar
      FROM business_profiles bp
      JOIN users u ON bp.user_id = u.id
      WHERE bp.user_id = ?
    `, [req.params.userId]);
    if (!profile) return res.status(404).json({ error: 'Perfil comercial nao encontrado' });
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
