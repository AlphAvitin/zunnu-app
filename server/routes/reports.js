const express = require('express');
const { run, get, all } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const ALLOWED_TYPES = ['user', 'pet', 'post', 'comment', 'event', 'place', 'product', 'service', 'adoption', 'lostpet', 'message', 'conversation', 'story', 'business'];

// Submit a report against any target
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { target_type, target_id, category, reason } = req.body;
    if (!target_type || !ALLOWED_TYPES.includes(target_type)) return res.status(400).json({ error: 'Tipo de alvo invalido' });
    const tid = parseInt(target_id);
    if (!tid) return res.status(400).json({ error: 'Alvo invalido' });
    if (target_type === 'user' && tid === req.userId) return res.status(400).json({ error: 'Nao pode denunciar a si mesmo' });

    const recent = await get(
      "SELECT id FROM reports_v2 WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
      [req.userId, target_type, tid]);
    if (recent) return res.status(400).json({ error: 'Voce ja denunciou este item. A equipe vai avaliar.' });

    await run('INSERT INTO reports_v2 (reporter_id, target_type, target_id, reason, category) VALUES (?, ?, ?, ?, ?)',
      [req.userId, target_type, tid, reason || '', category || '']);

    res.status(201).json({ success: true, message: 'Denuncia enviada' });
  } catch (err) {
    console.error('Report error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// My reports
router.get('/my', authMiddleware, async (req, res) => {
  try {
    const reports = await all('SELECT * FROM reports_v2 WHERE reporter_id = ? ORDER BY created_at DESC LIMIT 50', [req.userId]);
    res.json(reports);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;