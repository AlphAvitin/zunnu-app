const express = require('express');
const { run, get, all } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  try {
    const bookings = all(`
      SELECT b.*, u.name as provider_name
      FROM bookings b
      JOIN users u ON b.provider_id = u.id
      WHERE b.user_id = ?
      ORDER BY b.date DESC, b.time DESC
    `, [req.userId]);
    res.json(bookings);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/', (req, res) => {
  try {
    const { provider_id, service_id, service_title, date, time, pet_name, notes } = req.body;
    if (!provider_id || !date || !time) return res.status(400).json({ error: 'Dados obrigatorios: provider_id, date, time' });

    const result = run(
      'INSERT INTO bookings (user_id, provider_id, service_id, service_title, date, time, pet_name, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [req.userId, provider_id, service_id || null, service_title || '', date, time, pet_name || '', notes || '']
    );

    const booking = get('SELECT * FROM bookings WHERE id = ?', [result.lastInsertRowid]);
    res.json(booking);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.put('/:id/status', (req, res) => {
  try {
    const booking = get('SELECT * FROM bookings WHERE id = ?', [req.params.id]);
    if (!booking) return res.status(404).json({ error: 'Agendamento nao encontrado' });
    if (booking.provider_id !== req.userId && booking.user_id !== req.userId) {
      return res.status(403).json({ error: 'Sem permissao' });
    }

    const { status } = req.body;
    run('UPDATE bookings SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json(get('SELECT * FROM bookings WHERE id = ?', [req.params.id]));
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
