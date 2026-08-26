const express = require('express');
const { run, get, all } = require('../db');
const { authMiddleware, optionalAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', optionalAuth, (req, res) => {
  try {
    const { status } = req.query;
    let where = '';
    const params = [];
    if (status) { where = 'WHERE lp.status = ?'; params.push(status); }

    const pets = all(`
      SELECT lp.*, u.name as owner_name, u.avatar as owner_avatar
      FROM lost_pets lp
      JOIN users u ON lp.user_id = u.id
      ${where}
      ORDER BY lp.created_at DESC
    `, params);
    res.json(pets);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/', authMiddleware, (req, res) => {
  try {
    const { pet_name, species, breed, description, image, status, latitude, longitude } = req.body;
    if (!pet_name) return res.status(400).json({ error: 'Nome do pet obrigatorio' });

    const result = run(
      'INSERT INTO lost_pets (user_id, pet_name, species, breed, description, image, status, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [req.userId, pet_name, species || '', breed || '', description || '', image || '', status || 'lost', latitude || null, longitude || null]
    );

    const pet = get('SELECT * FROM lost_pets WHERE id = ?', [result.lastInsertRowid]);
    res.json(pet);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.put('/:id', authMiddleware, (req, res) => {
  try {
    const pet = get('SELECT * FROM lost_pets WHERE id = ?', [req.params.id]);
    if (!pet) return res.status(404).json({ error: 'Pet nao encontrado' });
    if (pet.user_id !== req.userId) return res.status(403).json({ error: 'Sem permissao' });

    const { pet_name, species, breed, description, image, status, latitude, longitude } = req.body;
    run(
      'UPDATE lost_pets SET pet_name = ?, species = ?, breed = ?, description = ?, image = ?, status = ?, latitude = ?, longitude = ? WHERE id = ?',
      [pet_name || pet.pet_name, species || pet.species, breed || pet.breed, description || pet.description, image || pet.image, status || pet.status, latitude || pet.latitude, longitude || pet.longitude, req.params.id]
    );

    res.json(get('SELECT * FROM lost_pets WHERE id = ?', [req.params.id]));
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/:id', authMiddleware, (req, res) => {
  try {
    const pet = get('SELECT * FROM lost_pets WHERE id = ?', [req.params.id]);
    if (!pet) return res.status(404).json({ error: 'Pet nao encontrado' });
    if (pet.user_id !== req.userId) return res.status(403).json({ error: 'Sem permissao' });

    run('DELETE FROM lost_pets WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
