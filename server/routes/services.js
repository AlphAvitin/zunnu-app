const express = require('express');
const { run, get, all } = require('../db');
const { authMiddleware, optionalAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', optionalAuth, (req, res) => {
  try {
    const { search } = req.query;
    let where = 'WHERE s.is_active = 1';
    const params = [];

    if (search) { where += ' AND (s.title LIKE ? OR u.name LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

    const services = all(`
      SELECT s.*, u.name as provider_name, u.avatar as provider_avatar, u.plan as provider_plan
      FROM services s JOIN users u ON s.provider_id = u.id
      ${where}
      ORDER BY s.created_at DESC
    `, params);

    res.json(services.map(s => ({
      ...s,
      provider_badge: s.provider_plan === 'pro' ? 'pro' : s.provider_plan === 'plus' ? 'plus' : 'free'
    })));
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/', authMiddleware, (req, res) => {
  try {
    if (req.userPlan !== 'pro') {
      return res.status(403).json({ error: 'Apenas assinantes PRO podem cadastrar servicos' });
    }

    const { title, price, duration, icon, description } = req.body;
    if (!title || !price) return res.status(400).json({ error: 'Titulo e preco obrigatorios' });

    const result = run('INSERT INTO services (provider_id, title, price, duration, icon, description) VALUES (?, ?, ?, ?, ?, ?)',
      [req.userId, title.trim(), parseFloat(price), duration || '', icon || '🩺', description || '']);

    const service = get('SELECT * FROM services WHERE id = ?', [result.lastInsertRowid]);
    res.json(service);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/:id', authMiddleware, (req, res) => {
  try {
    const service = get('SELECT * FROM services WHERE id = ?', [req.params.id]);
    if (!service) return res.status(404).json({ error: 'Servico nao encontrado' });
    if (service.provider_id !== req.userId) return res.status(403).json({ error: 'Sem permissao' });

    run('DELETE FROM services WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
