const express = require('express');
const { run, get, all } = require('../db');
const { authMiddleware, optionalAuth } = require('../middleware/auth');
const { sendToUser } = require('../ws');

const router = express.Router();

const SPECIES = ['cachorro', 'gato', 'passaro', 'coelho', 'hamster', 'outros'];
const STATUS = { available: 'Disponivel', in_process: 'Em processo de adocao', adopted: 'Adotado' };

async function rowToAdoption(row, viewerId) {
  if (!row) return null;
  const owner = await get('SELECT id, name, avatar, is_human_verified, plan FROM users WHERE id = ?', [row.user_id]);
  const requests = await get('SELECT COUNT(*) as c FROM adoption_requests WHERE adoption_id = ?', [row.id]);
  let requestedByMe = false;
  let myRequest = null;
  if (viewerId) {
    const mr = await get('SELECT * FROM adoption_requests WHERE adoption_id = ? AND user_id = ?', [row.id, viewerId]);
    if (mr) { requestedByMe = true; myRequest = mr; }
  }
  const isOwner = viewerId === row.user_id;
  return {
    ...row,
    contact: isOwner || requestedByMe ? row.contact_phone : null,
    owner,
    count_requests: requests?.c || 0,
    requested_by_me: requestedByMe,
    my_request: myRequest,
    is_owner: isOwner,
    status_label: STATUS[row.status] || row.status
  };
}

router.get('/', optionalAuth, async (req, res) => {
  try {
    const { q, species, sex, porte, city, status, mine, limit } = req.query;
    const max = Math.min(parseInt(limit) || 100, 300);
    const where = [];
    const params = [];
    if (mine === '1' && req.userId) { where.push('a.user_id = ?'); params.push(req.userId); }
    else if (status) { where.push('a.status = ?'); params.push(status); }
    else { where.push("a.status != 'adopted'"); }
    if (q) { where.push('(LOWER(a.name) LIKE ? OR LOWER(a.story) LIKE ? OR LOWER(a.city) LIKE ?)'); const like = `%${q.toLowerCase()}%`; params.push(like, like, like); }
    if (species) { where.push('a.species = ?'); params.push(species); }
    if (sex) { where.push('a.sex = ?'); params.push(sex); }
    if (porte) { where.push('a.porte = ?'); params.push(porte); }
    if (city) { where.push('LOWER(a.city) LIKE ?'); params.push(`%${city.toLowerCase()}%`); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = await all(`SELECT a.* FROM adoption_pets a ${whereSql} ORDER BY a.created_at DESC LIMIT ${max}`, params);
    const out = [];
    for (const r of rows) out.push(await rowToAdoption(r, req.userId));
    res.json({ adoptions: out, species: SPECIES, statuses: STATUS });
  } catch (err) {
    console.error('Adoption list error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/mine', authMiddleware, async (req, res) => {
  try {
    const rows = await all("SELECT * FROM adoption_pets WHERE user_id = ? ORDER BY created_at DESC", [req.userId]);
    const out = [];
    for (const r of rows) out.push(await rowToAdoption(r, req.userId));
    res.json(out);
  } catch (err) {
    console.error('Adoption mine error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const row = await get('SELECT * FROM adoption_pets WHERE id = ?', [parseInt(req.params.id)]);
    if (!row) return res.status(404).json({ error: 'Anuncio nao encontrado' });
    res.json(await rowToAdoption(row, req.userId));
  } catch (err) {
    console.error('Adoption detail error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, species, sex, age, porte, city, story, temperament, special_needs, contact_phone, image } = req.body;
    if (!species) return res.status(400).json({ error: 'Especie obrigatoria' });
    if (!city) return res.status(400).json({ error: 'Cidade obrigatoria' });
    if (!contact_phone && !req.body.contact_email) return res.status(400).json({ error: 'Informe um contato (telefone ou email)' });

    const result = await run(`
      INSERT INTO adoption_pets (user_id, name, species, sex, age, porte, city, story, temperament, special_needs, contact_phone, image)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [req.userId, name || 'Pet', species, sex || '', age || '', porte || '', city, story || '', temperament || '',
        special_needs || '', contact_phone || (req.body.contact_email ? req.body.contact_email + ' (email)' : ''), image || '']);

    res.json(await rowToAdoption(await get('SELECT * FROM adoption_pets WHERE id = ?', [result.lastInsertRowid]), req.userId));
  } catch (err) {
    console.error('Adoption create error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const row = await get('SELECT * FROM adoption_pets WHERE id = ?', [parseInt(req.params.id)]);
    if (!row) return res.status(404).json({ error: 'Anuncio nao encontrado' });
    if (row.user_id !== req.userId) return res.status(403).json({ error: 'Sem permissao' });

    const { name, species, sex, age, porte, city, story, temperament, special_needs, contact_phone, image, status } = req.body;
    await run(`
      UPDATE adoption_pets SET name = ?, species = ?, sex = ?, age = ?, porte = ?, city = ?, story = ?, temperament = ?, special_needs = ?, contact_phone = ?, image = ?, status = ?
      WHERE id = ?
    `, [name !== undefined ? name : row.name, species || row.species, sex !== undefined ? sex : row.sex,
        age !== undefined ? age : row.age, porte !== undefined ? porte : row.porte, city || row.city,
        story !== undefined ? story : row.story, temperament !== undefined ? temperament : row.temperament,
        special_needs !== undefined ? special_needs : row.special_needs,
        contact_phone !== undefined ? contact_phone : row.contact_phone,
        image !== undefined ? image : row.image, status || row.status, row.id]);

    res.json(await rowToAdoption(await get('SELECT * FROM adoption_pets WHERE id = ?', [row.id]), req.userId));
  } catch (err) {
    console.error('Adoption update error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const row = await get('SELECT * FROM adoption_pets WHERE id = ?', [parseInt(req.params.id)]);
    if (!row) return res.status(404).json({ error: 'Anuncio nao encontrado' });
    if (row.user_id !== req.userId) return res.status(403).json({ error: 'Sem permissao' });
    await run('DELETE FROM adoption_requests WHERE adoption_id = ?', [row.id]);
    await run('DELETE FROM adoption_pets WHERE id = ?', [row.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Adoption delete error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Contact request: reveals contact only to a genuine requester and notifies the owner
router.post('/:id/contact', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const row = await get('SELECT * FROM adoption_pets WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Anuncio nao encontrado' });
    if (row.status === 'adopted') return res.status(400).json({ error: 'Este pet ja foi adotado' });
    if (row.user_id === req.userId) return res.status(400).json({ error: 'Voce e o responsavel por este anuncio' });

    const existing = await get('SELECT * FROM adoption_requests WHERE adoption_id = ? AND user_id = ?', [id, req.userId]);
    if (existing) {
      return res.json(await rowToAdoption(row, req.userId));
    }

    const message = (req.body.message || '').trim();
    const result = await run('INSERT INTO adoption_requests (adoption_id, user_id, message) VALUES (?, ?, ?)',
      [id, req.userId, message]);

    const me = await get('SELECT name FROM users WHERE id = ?', [req.userId]);
    await run('INSERT INTO notifications (user_id, type, message, reference_id) VALUES (?, ?, ?, ?)',
      [row.user_id, 'adoption_request', `${me?.name || 'Alguem'} quer adotar "${row.name || 'um pet'}"`, id]);
    sendToUser(row.user_id, {
      type: 'notification',
      notification: { type: 'adoption_request', message: `${me?.name || 'Alguem'} quer adotar "${row.name || 'um pet'}"`, referenceId: id }
    });

    res.json({ ...(await rowToAdoption(row, req.userId)), my_request: { id: result.lastInsertRowid, status: 'pending' }, requested_by_me: true });
  } catch (err) {
    console.error('Adoption contact error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/:id/requests', authMiddleware, async (req, res) => {
  try {
    const row = await get('SELECT * FROM adoption_pets WHERE id = ?', [parseInt(req.params.id)]);
    if (!row) return res.status(404).json({ error: 'Anuncio nao encontrado' });
    if (row.user_id !== req.userId) return res.status(403).json({ error: 'Sem permissao' });
    const requests = await all(`
      SELECT ar.*, u.name as applicant_name, u.avatar as applicant_avatar, u.location as applicant_location
      FROM adoption_requests ar JOIN users u ON ar.user_id = u.id
      WHERE ar.adoption_id = ? ORDER BY ar.created_at DESC
    `, [row.id]);
    res.json(requests);
  } catch (err) {
    console.error('Adoption requests error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Owner responds: approved = 1 (accept) / 0 (reject)
router.put('/:id/requests/:requestId', authMiddleware, async (req, res) => {
  try {
    const row = await get('SELECT * FROM adoption_pets WHERE id = ?', [parseInt(req.params.id)]);
    if (!row) return res.status(404).json({ error: 'Anuncio nao encontrado' });
    if (row.user_id !== req.userId) return res.status(403).json({ error: 'Sem permissao' });

    const request = await get('SELECT * FROM adoption_requests WHERE id = ? AND adoption_id = ?', [parseInt(req.params.requestId), row.id]);
    if (!request) return res.status(404).json({ error: 'Solicitacao nao encontrada' });

    const approved = req.body.approved ? 1 : 0;
    await run('UPDATE adoption_requests SET status = ? WHERE id = ?', [approved ? 'approved' : 'rejected', request.id]);

    if (approved) {
      await run("UPDATE adoption_pets SET status = 'in_process' WHERE id = ?", [row.id]);
      const me = await get('SELECT name FROM users WHERE id = ?', [req.userId]);
      await run('INSERT INTO notifications (user_id, type, message, reference_id) VALUES (?, ?, ?, ?)',
        [request.user_id, 'adoption_approved', `Seu pedido para adotar "${row.name}" foi aceito! Entre em contato com ${me?.name}.`, row.id]);
      sendToUser(request.user_id, {
        type: 'notification',
        notification: { type: 'adoption_approved', message: `Seu pedido para adotar "${row.name}" foi aceito!`, referenceId: row.id }
      });
    }

    res.json({ success: true, approved });
  } catch (err) {
    console.error('Adoption respond error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;