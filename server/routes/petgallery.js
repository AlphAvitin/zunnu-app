const express = require('express');
const { run, get, all } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.get('/:petId/photos', authMiddleware, (req, res) => {
  try {
    const photos = all(`
      SELECT pp.*, u.name as user_name
      FROM pet_photos pp JOIN users u ON pp.user_id = u.id
      WHERE pp.pet_id = ?
      ORDER BY pp.created_at DESC
    `, [req.params.petId]);
    res.json(photos);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/:petId/photos', authMiddleware, (req, res) => {
  try {
    const { image_url, caption, album } = req.body;
    if (!image_url) return res.status(400).json({ error: 'URL da imagem obrigatoria' });

    const pet = get('SELECT * FROM pets WHERE id = ?', [req.params.petId]);
    if (!pet) return res.status(404).json({ error: 'Pet nao encontrado' });

    const result = run(
      'INSERT INTO pet_photos (pet_id, user_id, image_url, caption, album) VALUES (?, ?, ?, ?, ?)',
      [req.params.petId, req.userId, image_url, caption || '', album || 'geral']
    );

    const photo = get('SELECT pp.*, u.name as user_name FROM pet_photos pp JOIN users u ON pp.user_id = u.id WHERE pp.id = ?',
      [result.lastInsertRowid]);
    res.json(photo);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/photos/:photoId', authMiddleware, (req, res) => {
  try {
    const photo = get('SELECT * FROM pet_photos WHERE id = ?', [req.params.photoId]);
    if (!photo) return res.status(404).json({ error: 'Foto nao encontrada' });
    if (photo.user_id !== req.userId) return res.status(403).json({ error: 'Sem permissao' });
    run('DELETE FROM pet_photos WHERE id = ?', [req.params.photoId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/:petId/milestones', authMiddleware, (req, res) => {
  try {
    const milestones = all(`
      SELECT pm.*, u.name as user_name
      FROM pet_milestones pm JOIN users u ON pm.user_id = u.id
      WHERE pm.pet_id = ?
      ORDER BY pm.date DESC
    `, [req.params.petId]);
    res.json(milestones);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/:petId/milestones', authMiddleware, (req, res) => {
  try {
    const { title, description, date, icon } = req.body;
    if (!title) return res.status(400).json({ error: 'Titulo obrigatorio' });

    const result = run(
      'INSERT INTO pet_milestones (pet_id, user_id, title, description, date, icon) VALUES (?, ?, ?, ?, ?, ?)',
      [req.params.petId, req.userId, title, description || '', date || new Date().toISOString().split('T')[0], icon || '128062']
    );

    const milestone = get('SELECT pm.*, u.name as user_name FROM pet_milestones pm JOIN users u ON pm.user_id = u.id WHERE pm.id = ?',
      [result.lastInsertRowid]);
    res.json(milestone);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/milestones/:id', authMiddleware, (req, res) => {
  try {
    const m = get('SELECT * FROM pet_milestones WHERE id = ?', [req.params.id]);
    if (!m) return res.status(404).json({ error: 'Marco nao encontrado' });
    if (m.user_id !== req.userId) return res.status(403).json({ error: 'Sem permissao' });
    run('DELETE FROM pet_milestones WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
