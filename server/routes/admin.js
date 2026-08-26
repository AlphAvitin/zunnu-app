const express = require('express');
const { run, get, all } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

router.get('/reports', (req, res) => {
  try {
    const reports = all(`
      SELECT rv.*, u.name as reporter_name
      FROM reports_v2 rv
      JOIN users u ON rv.reporter_id = u.id
      ORDER BY rv.created_at DESC
    `);
    res.json(reports);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.put('/reports/:id', (req, res) => {
  try {
    const report = get('SELECT * FROM reports_v2 WHERE id = ?', [req.params.id]);
    if (!report) return res.status(404).json({ error: 'Denuncia nao encontrada' });

    const { status, admin_note } = req.body;
    run('UPDATE reports_v2 SET status = ?, admin_note = ? WHERE id = ?', [status || report.status, admin_note || report.admin_note, req.params.id]);
    res.json(get('SELECT * FROM reports_v2 WHERE id = ?', [req.params.id]));
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
