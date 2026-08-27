const express = require('express');
const { run, get, all } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { sendToUser } = require('../ws');

const router = express.Router();
router.use(authMiddleware);

async function adminOnly(req, res, next) {
  const me = await get('SELECT is_admin FROM users WHERE id = ?', [req.userId]);
  if (!me || !me.is_admin) return res.status(403).json({ error: 'Acesso restrito a administradores' });
  next();
}
router.use(adminOnly);

router.get('/dashboard', async (req, res) => {
  try {
    const c = async (q, p = []) => (await get(q, p))?.c || 0;
    const users = await c('SELECT COUNT(*) as c FROM users');
    const posts = await c('SELECT COUNT(*) as c FROM posts');
    const pets = await c('SELECT COUNT(*) as c FROM pets');
    const places = await c('SELECT COUNT(*) as c FROM business_profiles');
    const events = await c('SELECT COUNT(*) as c FROM events');
    const adoptions = await c('SELECT COUNT(*) as c FROM adoption_pets');
    const matches = await c('SELECT COUNT(*) as c FROM matches');
    const products = await c('SELECT COUNT(*) as c FROM products');
    const reportsPending = await c("SELECT COUNT(*) as c FROM reports_v2 WHERE status = 'pending'");
    const eventsPending = await c("SELECT COUNT(*) as c FROM events WHERE status = 'pending'");
    const suggestionsPending = await c("SELECT COUNT(*) as c FROM place_suggestions WHERE status = 'pending'");
    res.json({ users, posts, pets, places, events, adoptions, matches, products, reportsPending, eventsPending, suggestionsPending });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/reports', async (req, res) => {
  try {
    const { status } = req.query;
    const where = status ? 'WHERE rv.status = ?' : '';
    const params = status ? [status] : [];
    const reports = await all(`
      SELECT rv.*, u.name as reporter_name
      FROM reports_v2 rv
      JOIN users u ON rv.reporter_id = u.id
      ${where}
      ORDER BY rv.created_at DESC
    `, params);
    res.json(reports);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.put('/reports/:id', async (req, res) => {
  try {
    const report = await get('SELECT * FROM reports_v2 WHERE id = ?', [req.params.id]);
    if (!report) return res.status(404).json({ error: 'Denuncia nao encontrada' });

    const { status, admin_note } = req.body;
    await run('UPDATE reports_v2 SET status = ?, admin_note = ? WHERE id = ?',
      [status || report.status, admin_note !== undefined ? admin_note : report.admin_note, req.params.id]);

    sendToUser(report.reporter_id, {
      type: 'notification',
      notification: { type: 'moderation', message: `Sua denuncia foi ${status || report.status === 'resolved' ? 'avaliada' : 'avaliada'}.` }
    });
    await run('INSERT INTO notifications (user_id, type, message, reference_id) VALUES (?, ?, ?, ?)',
      [report.reporter_id, 'moderation', 'Sua denuncia foi avaliada pela equipe.', report.id]);

    res.json(await get('SELECT * FROM reports_v2 WHERE id = ?', [req.params.id]));
  } catch (err) {
    console.error('Admin report update error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/events', async (req, res) => {
  try {
    const { status } = req.query;
    const where = status ? 'WHERE status = ?' : '';
    const rows = await all(`
      SELECT e.*, u.name as organizer_name
      FROM events e JOIN users u ON e.organizer_id = u.id
      ${where}
      ORDER BY e.created_at DESC LIMIT 100
    `, status ? [status] : []);
    res.json(rows);
  } catch (err) {
    console.error('Admin events error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.put('/events/:id', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Status invalido' });
    const row = await get('SELECT * FROM events WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Evento nao encontrado' });
    await run('UPDATE events SET status = ? WHERE id = ?', [status, row.id]);
    if (status === 'approved') {
      await run('INSERT INTO notifications (user_id, type, message, reference_id) VALUES (?, ?, ?, ?)',
        [row.organizer_id, 'moderation', `Seu evento "${row.name}" foi aprovado!`, row.id]);
      sendToUser(row.organizer_id, { type: 'notification', notification: { type: 'moderation', message: `Seu evento "${row.name}" foi aprovado!`, referenceId: row.id } });
    } else {
      await run('INSERT INTO notifications (user_id, type, message, reference_id) VALUES (?, ?, ?, ?)',
        [row.organizer_id, 'moderation', `Seu evento "${row.name}" nao foi aprovado.`, row.id]);
    }
    res.json(await get('SELECT * FROM events WHERE id = ?', [row.id]));
  } catch (err) {
    console.error('Admin event update error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const { q } = req.query;
    const like = `%${q || ''}%`;
    const rows = await all(`
      SELECT id, name, email, plan, is_admin, is_human_verified, is_private, points_balance, created_at
      FROM users
      WHERE (LOWER(name) LIKE ? OR LOWER(email) LIKE ?)
      ORDER BY created_at DESC LIMIT 100
    `, [like, like]);
    res.json(rows);
  } catch (err) {
    console.error('Admin users error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.put('/users/:id', async (req, res) => {
  try {
    const { is_admin } = req.body;
    const target = await get('SELECT id FROM users WHERE id = ?', [req.params.id]);
    if (!target) return res.status(404).json({ error: 'Usuario nao encontrado' });
    if (parseInt(req.params.id) === req.userId) return res.status(400).json({ error: 'Nao pode alterar o proprio papel' });
    if (is_admin !== undefined) await run('UPDATE users SET is_admin = ? WHERE id = ?', [is_admin ? 1 : 0, target.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Admin user update error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/posts/:id', async (req, res) => {
  try {
    const row = await get('SELECT user_id FROM posts WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Post nao encontrado' });
    await run('DELETE FROM comments WHERE post_id = ?', [row.id]);
    await run('DELETE FROM likes WHERE post_id = ?', [row.id]);
    await run('DELETE FROM hidden_posts WHERE post_id = ?', [row.id]);
    await run('DELETE FROM posts WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Admin post delete error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/pets/:id', async (req, res) => {
  try {
    const row = await get('SELECT id FROM pets WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Pet nao encontrado' });
    await run('DELETE FROM pets WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Admin pet delete error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/adoption/:id', async (req, res) => {
  try {
    const row = await get('SELECT id FROM adoption_pets WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Anuncio nao encontrado' });
    await run('DELETE FROM adoption_requests WHERE adoption_id = ?', [req.params.id]);
    await run('DELETE FROM adoption_pets WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Admin adoption delete error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;