const express = require('express');
const { run, get, all } = require('../db');
const { authMiddleware, optionalAuth } = require('../middleware/auth');
const { creditPoints } = require('./points');

const router = express.Router();

router.get('/', authMiddleware, async (req, res) => {
  try {
    const pets = await all('SELECT * FROM pets WHERE user_id = ? ORDER BY created_at DESC', [req.userId]);
    for (const p of pets) {
      p.vaccines = await all('SELECT * FROM vaccines WHERE pet_id = ?', [p.id]);
      p.is_castrated = !!p.is_castrated;
    }
    res.json(pets);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/all', optionalAuth, async (req, res) => {
  try {
    const pets = await all(`
      SELECT p.*, u.name as tutor_name, u.avatar as tutor_avatar
      FROM pets p JOIN users u ON p.user_id = u.id
      ORDER BY p.created_at DESC
    `);
    for (const p of pets) {
      p.vaccines = await all('SELECT * FROM vaccines WHERE pet_id = ?', [p.id]);
      p.is_castrated = !!p.is_castrated;
    }
    res.json(pets);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const pet = await get(`
      SELECT p.*, u.name as tutor_name, u.avatar as tutor_avatar, u.id as user_id
      FROM pets p JOIN users u ON p.user_id = u.id WHERE p.id = ?
    `, [req.params.id]);

    if (!pet) return res.status(404).json({ error: 'Pet nao encontrado' });

    pet.vaccines = await all('SELECT * FROM vaccines WHERE pet_id = ?', [pet.id]);
    pet.is_castrated = !!pet.is_castrated;

    res.json(pet);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, species, breed, age, location, image, isCastrated, zodiac } = req.body;

    if (!name || !name.trim()) return res.status(400).json({ error: 'Nome do pet obrigatorio' });

    const user = await get('SELECT name, location FROM users WHERE id = ?', [req.userId]);

    const result = await run(`
      INSERT INTO pets (user_id, name, species, breed, age, location, image, is_castrated, zodiac)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      req.userId,
      name.trim(),
      species || 'Pet',
      breed || 'SRD',
      age || '',
      location || user.location || '',
      image || '',
      isCastrated ? 1 : 0,
      zodiac || ''
    ]);

    const pet = await get('SELECT * FROM pets WHERE id = ?', [result.lastInsertRowid]);
    pet.vaccines = [];
    pet.is_castrated = !!pet.is_castrated;

    await creditPoints(req.userId, 'add_pet');

    res.json(pet);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const pet = await get('SELECT * FROM pets WHERE id = ?', [req.params.id]);
    if (!pet) return res.status(404).json({ error: 'Pet nao encontrado' });
    if (pet.user_id !== req.userId) return res.status(403).json({ error: 'Sem permissao' });

    const { name, species, breed, age, location, image, isCastrated, zodiac } = req.body;

    await run(`
      UPDATE pets SET name = ?, species = ?, breed = ?, age = ?, location = ?, image = ?, is_castrated = ?, zodiac = ?
      WHERE id = ?
    `, [
      name || pet.name, species || pet.species, breed || pet.breed,
      age || pet.age, location || pet.location, image || pet.image,
      isCastrated !== undefined ? (isCastrated ? 1 : 0) : pet.is_castrated,
      zodiac || pet.zodiac, req.params.id
    ]);

    const updated = await get('SELECT * FROM pets WHERE id = ?', [req.params.id]);
    updated.vaccines = await all('SELECT * FROM vaccines WHERE pet_id = ?', [updated.id]);
    updated.is_castrated = !!updated.is_castrated;
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const pet = await get('SELECT * FROM pets WHERE id = ?', [req.params.id]);
    if (!pet) return res.status(404).json({ error: 'Pet nao encontrado' });
    if (pet.user_id !== req.userId) return res.status(403).json({ error: 'Sem permissao' });

    await run('DELETE FROM pets WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/:id/vaccines', authMiddleware, async (req, res) => {
  try {
    const pet = await get('SELECT * FROM pets WHERE id = ?', [req.params.id]);
    if (!pet) return res.status(404).json({ error: 'Pet nao encontrado' });
    if (pet.user_id !== req.userId) return res.status(403).json({ error: 'Sem permissao' });

    const { name, date, status } = req.body;
    if (!name) return res.status(400).json({ error: 'Nome da vacina obrigatorio' });

    await run('INSERT INTO vaccines (pet_id, name, date, status) VALUES (?, ?, ?, ?)',
      [req.params.id, name.trim(), date || '', status || 'A agendar']);

    const vaccines = await all('SELECT * FROM vaccines WHERE pet_id = ?', [req.params.id]);
    res.json(vaccines);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/:petId/vaccines/:vaccineId', authMiddleware, async (req, res) => {
  try {
    const pet = await get('SELECT * FROM pets WHERE id = ?', [req.params.petId]);
    if (!pet) return res.status(404).json({ error: 'Pet nao encontrado' });
    if (pet.user_id !== req.userId) return res.status(403).json({ error: 'Sem permissao' });

    await run('DELETE FROM vaccines WHERE id = ? AND pet_id = ?', [req.params.vaccineId, req.params.petId]);

    const vaccines = await all('SELECT * FROM vaccines WHERE pet_id = ?', [req.params.petId]);
    res.json(vaccines);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
