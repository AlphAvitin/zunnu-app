const express = require('express');
const { run, get, all } = require('../db');
const { authMiddleware, optionalAuth } = require('../middleware/auth');
const { creditPoints } = require('./points');

const router = express.Router();

const HEALTH_CATS = ['vermifugos', 'medicamentos', 'alergias', 'restricoes', 'veterinario', 'observacoes'];

async function decoratePet(p) {
  if (!p) return p;
  p.vaccines = await all('SELECT * FROM vaccines WHERE pet_id = ? ORDER BY id DESC', [p.id]);
  p.health = await all('SELECT * FROM pet_health_records WHERE pet_id = ? ORDER BY id DESC', [p.id]);
  p.is_castrated = !!p.is_castrated;
  return p;
}

router.get('/', authMiddleware, async (req, res) => {
  try {
    const pets = await all('SELECT * FROM pets WHERE user_id = ? ORDER BY created_at DESC', [req.userId]);
    for (const p of pets) await decoratePet(p);
    res.json(pets);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/all', optionalAuth, async (req, res) => {
  try {
    const uid = req.userId || -1;
    const pets = await all(`
      SELECT p.*, u.name as tutor_name, u.avatar as tutor_avatar
      FROM pets p JOIN users u ON p.user_id = u.id
      WHERE p.visibility IS NULL OR p.visibility IN ('public','friends') OR p.user_id = ?
      ORDER BY p.created_at DESC
    `, [uid]);
    for (const p of pets) await decoratePet(p);
    res.json(pets);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const pet = await get(`
      SELECT p.*, u.name as tutor_name, u.avatar as tutor_avatar, u.id as user_id, u.location as tutor_location
      FROM pets p JOIN users u ON p.user_id = u.id WHERE p.id = ?
    `, [req.params.id]);

    if (!pet) return res.status(404).json({ error: 'Pet nao encontrado' });
    if (pet.visibility === 'private' && pet.user_id !== (req.userId || -1)) {
      return res.status(403).json({ error: 'Perfil privado' });
    }

    await decoratePet(pet);
    res.json(pet);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

function pickPetFields(body, pet) {
  const prev = (v, old) => (v === undefined ? old : v);
  return {
    name: String(prev(body.name, pet ? pet.name : '') || '').trim(),
    species: prev(body.species, pet ? pet.species : '') || 'Pet',
    breed: prev(body.breed, pet ? pet.breed : '') || 'SRD',
    age: prev(body.age, pet ? pet.age : '') || '',
    location: prev(body.location, pet ? pet.location : '') || '',
    image: prev(body.image, pet ? pet.image : '') || '',
    isCastrated: body.isCastrated !== undefined ? (body.isCastrated ? 1 : 0) : (pet ? pet.is_castrated : 0),
    zodiac: prev(body.zodiac, pet ? pet.zodiac : '') || '',
    sex: prev(body.sex, pet ? pet.sex : '') || '',
    birthDate: prev(body.birthDate, pet ? pet.birth_date : '') || '',
    porte: prev(body.porte, pet ? pet.porte : '') || '',
    cor: prev(body.cor, pet ? pet.cor : '') || '',
    peso: body.peso !== undefined && body.peso !== '' && body.peso !== null ? parseFloat(body.peso) : (pet ? pet.peso : null),
    microchip: prev(body.microchip, pet ? pet.microchip : '') || '',
    traits: prev(body.traits, pet ? pet.traits : '') || '',
    visibility: prev(body.visibility, pet ? pet.visibility : '') || 'public'
  };
}

router.post('/', authMiddleware, async (req, res) => {
  try {
    const f = pickPetFields(req.body, null);
    if (!f.name) return res.status(400).json({ error: 'Nome do pet obrigatorio' });

    const user = await get('SELECT name, location FROM users WHERE id = ?', [req.userId]);
    if (!f.location) f.location = (user && user.location) || '';

    const result = await run(`
      INSERT INTO pets (user_id, name, species, breed, age, location, image, is_castrated, zodiac, sex, birth_date, porte, cor, peso, microchip, traits, visibility)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      req.userId, f.name, f.species, f.breed, f.age, f.location, f.image,
      f.isCastrated, f.zodiac, f.sex, f.birthDate, f.porte, f.cor,
      f.peso, f.microchip, f.traits, f.visibility
    ]);

    const pet = await get('SELECT * FROM pets WHERE id = ?', [result.lastInsertRowid]);
    pet.vaccines = [];
    pet.health = [];
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

    const f = pickPetFields(req.body, pet);
    if (!f.name) return res.status(400).json({ error: 'Nome do pet obrigatorio' });

    await run(`
      UPDATE pets SET name = ?, species = ?, breed = ?, age = ?, location = ?, image = ?, is_castrated = ?, zodiac = ?,
        sex = ?, birth_date = ?, porte = ?, cor = ?, peso = ?, microchip = ?, traits = ?, visibility = ?
      WHERE id = ?
    `, [
      f.name, f.species, f.breed, f.age, f.location, f.image, f.isCastrated, f.zodiac,
      f.sex, f.birthDate, f.porte, f.cor, f.peso, f.microchip, f.traits, f.visibility,
      req.params.id
    ]);

    const updated = await get('SELECT * FROM pets WHERE id = ?', [req.params.id]);
    await decoratePet(updated);
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
    await run('DELETE FROM vaccines WHERE pet_id = ?', [req.params.id]);
    await run('DELETE FROM pet_health_records WHERE pet_id = ?', [req.params.id]);
    await run('DELETE FROM pet_photos WHERE pet_id = ?', [req.params.id]);
    await run('DELETE FROM pet_milestones WHERE pet_id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ---- Vacinas ----
router.post('/:id/vaccines', authMiddleware, async (req, res) => {
  try {
    const pet = await get('SELECT * FROM pets WHERE id = ?', [req.params.id]);
    if (!pet) return res.status(404).json({ error: 'Pet nao encontrado' });
    if (pet.user_id !== req.userId) return res.status(403).json({ error: 'Sem permissao' });

    const { name, date, status } = req.body;
    if (!name) return res.status(400).json({ error: 'Nome da vacina obrigatorio' });

    await run('INSERT INTO vaccines (pet_id, name, date, status) VALUES (?, ?, ?, ?)',
      [req.params.id, String(name).trim(), date || '', status || 'A agendar']);

    const vaccines = await all('SELECT * FROM vaccines WHERE pet_id = ? ORDER BY id DESC', [req.params.id]);
    res.json(vaccines);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.put('/:petId/vaccines/:vaccineId', authMiddleware, async (req, res) => {
  try {
    const pet = await get('SELECT * FROM pets WHERE id = ?', [req.params.petId]);
    if (!pet) return res.status(404).json({ error: 'Pet nao encontrado' });
    if (pet.user_id !== req.userId) return res.status(403).json({ error: 'Sem permissao' });

    const vac = await get('SELECT * FROM vaccines WHERE id = ? AND pet_id = ?', [req.params.vaccineId, req.params.petId]);
    if (!vac) return res.status(404).json({ error: 'Vacina nao encontrada' });

    const { name, date, status } = req.body;
    await run('UPDATE vaccines SET name = ?, date = ?, status = ? WHERE id = ?',
      [name !== undefined && String(name).trim() ? String(name).trim() : vac.name,
        date !== undefined ? date : vac.date,
        status !== undefined ? status : vac.status,
        req.params.vaccineId]);

    const vaccines = await all('SELECT * FROM vaccines WHERE pet_id = ? ORDER BY id DESC', [req.params.petId]);
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

    const vaccines = await all('SELECT * FROM vaccines WHERE pet_id = ? ORDER BY id DESC', [req.params.petId]);
    res.json(vaccines);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ---- Registros de saude (vermifugos, medicamentos, alergias, restricoes, veterinario, observacoes) ----
router.get('/:id/health', authMiddleware, async (req, res) => {
  try {
    const pet = await get('SELECT * FROM pets WHERE id = ?', [req.params.id]);
    if (!pet) return res.status(404).json({ error: 'Pet nao encontrado' });
    if (pet.user_id !== req.userId) return res.status(403).json({ error: 'Sem permissao' });
    const records = await all('SELECT * FROM pet_health_records WHERE pet_id = ? ORDER BY id DESC', [req.params.id]);
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/:id/health', authMiddleware, async (req, res) => {
  try {
    const pet = await get('SELECT * FROM pets WHERE id = ?', [req.params.id]);
    if (!pet) return res.status(404).json({ error: 'Pet nao encontrado' });
    if (pet.user_id !== req.userId) return res.status(403).json({ error: 'Sem permissao' });

    const { category, text } = req.body;
    if (!category || !HEALTH_CATS.includes(category)) return res.status(400).json({ error: 'Categoria invalida' });
    if (!text || !String(text).trim()) return res.status(400).json({ error: 'Texto obrigatorio' });

    await run('INSERT INTO pet_health_records (pet_id, category, text) VALUES (?, ?, ?)',
      [req.params.id, category, String(text).trim()]);

    const records = await all('SELECT * FROM pet_health_records WHERE pet_id = ? ORDER BY id DESC', [req.params.id]);
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.put('/:petId/health/:recId', authMiddleware, async (req, res) => {
  try {
    const pet = await get('SELECT * FROM pets WHERE id = ?', [req.params.petId]);
    if (!pet) return res.status(404).json({ error: 'Pet nao encontrado' });
    if (pet.user_id !== req.userId) return res.status(403).json({ error: 'Sem permissao' });

    const rec = await get('SELECT * FROM pet_health_records WHERE id = ? AND pet_id = ?', [req.params.recId, req.params.petId]);
    if (!rec) return res.status(404).json({ error: 'Registro nao encontrado' });

    const { text } = req.body;
    if (!text || !String(text).trim()) return res.status(400).json({ error: 'Texto obrigatorio' });

    await run('UPDATE pet_health_records SET text = ? WHERE id = ?', [String(text).trim(), req.params.recId]);

    const records = await all('SELECT * FROM pet_health_records WHERE pet_id = ? ORDER BY id DESC', [req.params.petId]);
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/:petId/health/:recId', authMiddleware, async (req, res) => {
  try {
    const pet = await get('SELECT * FROM pets WHERE id = ?', [req.params.petId]);
    if (!pet) return res.status(404).json({ error: 'Pet nao encontrado' });
    if (pet.user_id !== req.userId) return res.status(403).json({ error: 'Sem permissao' });

    await run('DELETE FROM pet_health_records WHERE id = ? AND pet_id = ?', [req.params.recId, req.params.petId]);

    const records = await all('SELECT * FROM pet_health_records WHERE pet_id = ? ORDER BY id DESC', [req.params.petId]);
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;