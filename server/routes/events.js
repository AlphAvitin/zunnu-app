const express = require('express');
const { run, get, all } = require('../db');
const { authMiddleware, optionalAuth } = require('../middleware/auth');
const { sendToUser } = require('../ws');
const { bumpIntimacy, getMatchBetweenUsers, INTIMACY, todayStr } = require('../partnership');

const router = express.Router();

const CATEGORIES = ['encontro','adocao','passeio','feira','educacao','saude','show','outros'];

function isAutoApproved(user) {
  return user && (user.plan === 'plus' || user.plan === 'pro' || user.is_human_verified === 1 || user.is_admin === 1);
}

async function rowToEvent(row, userId) {
  if (!row) return null;
  const organizer = await get('SELECT id, name, avatar, plan, is_human_verified, is_admin FROM users WHERE id = ?', [row.organizer_id]);
  const going = await get('SELECT COUNT(*) as c FROM event_participants WHERE event_id = ? AND status = ?', [row.id, 'going']);
  const interested = await get('SELECT COUNT(*) as c FROM event_participants WHERE event_id = ? AND status = ?', [row.id, 'interested']);
  const confirmed = await get('SELECT COUNT(*) as c FROM event_participants WHERE event_id = ? AND status = ?', [row.id, 'confirmed']);
  const saved = await get('SELECT COUNT(*) as c FROM event_saves WHERE event_id = ?', [row.id]);
  let myStatus = null;
  let savedByMe = false;
  if (userId) {
    const mine = await get('SELECT status FROM event_participants WHERE event_id = ? AND user_id = ?', [row.id, userId]);
    myStatus = mine ? mine.status : null;
    const sv = await get('SELECT 1 as x FROM event_saves WHERE event_id = ? AND user_id = ?', [row.id, userId]);
    savedByMe = !!sv;
  }
  return {
    ...row,
    organizer,
    count_going: going?.c || 0,
    count_interested: interested?.c || 0,
    count_confirmed: confirmed?.c || 0,
    count_saved: saved?.c || 0,
    count_participants: (going?.c || 0) + (interested?.c || 0) + (confirmed?.c || 0),
    my_status: myStatus,
    saved_by_me: savedByMe,
    is_organizer: userId ? userId === row.organizer_id : false
  };
}

// Public list (approved events) with filters
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { q, category, city, status, mine, upcoming, past, lat, lng, radius } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 60, 200);
    const offset = parseInt(req.query.offset) || 0;
    const userId = req.userId;

    const where = [];
    const params = [];

    // Guest or regular user: only approved; organizers always see their own
    if (userId && mine === '1') {
      where.push(`(e.organizer_id = ? OR e.id IN (SELECT event_id FROM event_participants WHERE user_id = ?))`);
      params.push(userId, userId);
    } else if (userId) {
      where.push(`(e.status = 'approved' OR e.organizer_id = ?)`);
      params.push(userId);
    } else {
      where.push(`e.status = 'approved'`);
    }
    if (status) { where.push(`e.status = ?`); params.push(status); }
    if (q) { where.push(`(LOWER(e.name) LIKE ? OR LOWER(e.description) LIKE ? OR LOWER(e.location) LIKE ? OR LOWER(e.city) LIKE ?)`); const like = `%${q.toLowerCase()}%`; params.push(like, like, like, like); }
    if (category) { where.push(`e.category = ?`); params.push(category); }
    if (city) { where.push(`(LOWER(e.city) LIKE ? OR LOWER(e.location) LIKE ?)`); const like = `%${city.toLowerCase()}%`; params.push(like, like); }
    const today = new Date().toISOString().slice(0, 10);
    if (upcoming === '1') { where.push(`e.date >= ?`); params.push(today); }
    if (past === '1') { where.push(`e.date < ?`); params.push(today); }
    if (lat && lng && radius) {
      where.push(`(6371 * acos(least(1, cos(radians(?)) * cos(radians(e.latitude)) * cos(radians(e.longitude) - radians(?)) + sin(radians(?)) * sin(radians(e.latitude))))) <= ?`);
      params.push(parseFloat(lat), parseFloat(lng), parseFloat(lat), parseFloat(radius));
    }

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = await all(`
      SELECT e.*, u.name as organizer_name
      FROM events e
      JOIN users u ON e.organizer_id = u.id
      ${whereSql}
      ORDER BY e.date ASC, e.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `, params);

    const out = [];
    for (const r of rows) out.push(await rowToEvent(r, userId));
    const total = await get(`SELECT COUNT(*) as c FROM events e ${whereSql}`, params);
    res.json({ events: out, total: total?.c || 0, categories: CATEGORIES });
  } catch (err) {
    console.error('Events list error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/mine', authMiddleware, async (req, res) => {
  try {
    const rows = await all(`
      SELECT e.* FROM events e
      WHERE e.organizer_id = ? OR e.id IN (SELECT event_id FROM event_participants WHERE user_id = ?)
      ORDER BY e.date ASC
    `, [req.userId, req.userId]);
    const out = [];
    for (const r of rows) out.push(await rowToEvent(r, req.userId));
    res.json(out);
  } catch (err) {
    console.error('My events error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/categories', (req, res) => res.json(CATEGORIES));

router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const row = await get('SELECT * FROM events WHERE id = ?', [parseInt(req.params.id)]);
    if (!row) return res.status(404).json({ error: 'Evento nao encontrado' });
    const userId = req.userId;
    if (row.status !== 'approved' && !(userId && userId === row.organizer_id)) {
      return res.status(404).json({ error: 'Evento nao encontrado' });
    }
    res.json(await rowToEvent(row, userId));
  } catch (err) {
    console.error('Event detail error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, image, description, date, time, location, city, latitude, longitude, category, participant_limit } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Nome do evento obrigatorio' });
    if (!date) return res.status(400).json({ error: 'Data obrigatoria' });

    const me = await get('SELECT plan, is_human_verified, is_admin FROM users WHERE id = ?', [req.userId]);
    const status = isAutoApproved(me) ? 'approved' : 'pending';

    const result = await run(`
      INSERT INTO events (organizer_id, name, image, description, date, time, location, city, latitude, longitude, category, status, participant_limit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [req.userId, name.trim(), image || '', description || '', date, time || '', location || '', city || '',
        latitude != null ? latitude : null, longitude != null ? longitude : null, category || 'outros', status, participant_limit ? parseInt(participant_limit) : null]);

    const row = await get('SELECT * FROM events WHERE id = ?', [result.lastInsertRowid]);
    res.status(status === 'approved' ? 200 : 201).json(await rowToEvent(row, req.userId));
  } catch (err) {
    console.error('Event create error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const row = await get('SELECT * FROM events WHERE id = ?', [parseInt(req.params.id)]);
    if (!row) return res.status(404).json({ error: 'Evento nao encontrado' });
    if (row.organizer_id !== req.userId) return res.status(403).json({ error: 'Sem permissao' });

    const { name, image, description, date, time, location, city, latitude, longitude, category } = req.body;
    await run(`
      UPDATE events SET name = ?, image = ?, description = ?, date = ?, time = ?, location = ?, city = ?, latitude = ?, longitude = ?, category = ?
      WHERE id = ?
    `, [name || row.name, image !== undefined ? image : row.image, description !== undefined ? description : row.description,
        date || row.date, time !== undefined ? time : row.time, location !== undefined ? location : row.location,
        city !== undefined ? city : row.city, latitude !== undefined ? latitude : row.latitude, longitude !== undefined ? longitude : row.longitude,
        category || row.category, row.id]);

    res.json(await rowToEvent(await get('SELECT * FROM events WHERE id = ?', [row.id]), req.userId));
  } catch (err) {
    console.error('Event update error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const row = await get('SELECT * FROM events WHERE id = ?', [parseInt(req.params.id)]);
    if (!row) return res.status(404).json({ error: 'Evento nao encontrado' });
    const me = await get('SELECT is_admin FROM users WHERE id = ?', [req.userId]);
    if (row.organizer_id !== req.userId && !(me && me.is_admin)) return res.status(403).json({ error: 'Sem permissao' });

    await run('DELETE FROM event_participants WHERE event_id = ?', [row.id]);
    await run('DELETE FROM event_saves WHERE event_id = ?', [row.id]);
    await run('DELETE FROM events WHERE id = ?', [row.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Event delete error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// go / interested / cancel (status null or 'none')
router.post('/:id/participate', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const row = await get('SELECT * FROM events WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Evento nao encontrado' });
    if (row.status !== 'approved' && row.organizer_id !== req.userId) return res.status(403).json({ error: 'Evento nao esta aberto' });

    const newStatus = req.body.status === 'going' || req.body.status === 'interested' ? req.body.status : null;
    const existing = await get('SELECT 1 as x FROM event_participants WHERE event_id = ? AND user_id = ?', [id, req.userId]);

    if (!newStatus) {
      if (existing) await run('DELETE FROM event_participants WHERE event_id = ? AND user_id = ?', [id, req.userId]);
    } else if (existing) {
      const old = await get('SELECT status FROM event_participants WHERE event_id = ? AND user_id = ?', [id, req.userId]);
      await run('UPDATE event_participants SET status = ? WHERE event_id = ? AND user_id = ?', [newStatus, id, req.userId]);
      if (newStatus === 'going' && old && old.status !== 'going') {
        await bumpEncounterIntimacy(id, req.userId);
      }
    } else {
      await run('INSERT INTO event_participants (event_id, user_id, status) VALUES (?, ?, ?)', [id, req.userId, newStatus]);
      if (newStatus === 'going') {
        await bumpEncounterIntimacy(id, req.userId);
      }
      if (row.organizer_id !== req.userId) {
        const me = await get('SELECT name FROM users WHERE id = ?', [req.userId]);
        const reading = newStatus === 'going' ? 'vai participar de' : 'tem interesse em';
        await run('INSERT INTO notifications (user_id, type, message, reference_id) VALUES (?, ?, ?, ?)',
          [row.organizer_id, 'event_participation', `${me?.name || 'Alguem'} ${reading} seu evento "${row.name}"`, id]);
        sendToUser(row.organizer_id, {
          type: 'notification',
          notification: { type: 'event_participation', message: `${me?.name || 'Alguem'} ${reading} "${row.name}"`, referenceId: id }
        });
      }
    }
    res.json(await rowToEvent(await get('SELECT * FROM events WHERE id = ?', [id]), req.userId));
  } catch (err) {
    console.error('Event participate error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Organizer marks presence confirmed
router.post('/:id/confirm', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const row = await get('SELECT * FROM events WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Evento nao encontrado' });
    if (row.organizer_id !== req.userId) return res.status(403).json({ error: 'Somente o organizador' });
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'Usuario obrigatorio' });
    const p = await get('SELECT 1 as x FROM event_participants WHERE event_id = ? AND user_id = ?', [id, userId]);
    if (!p) return res.status(404).json({ error: 'Participante nao encontrado' });
    await run("UPDATE event_participants SET status = 'confirmed' WHERE event_id = ? AND user_id = ?", [id, userId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Event confirm error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/:id/save', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const row = await get('SELECT * FROM events WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Evento nao encontrado' });
    if (row.status !== 'approved' && row.organizer_id !== req.userId) return res.status(403).json({ error: 'Evento nao esta aberto' });
    const existing = await get('SELECT 1 as x FROM event_saves WHERE event_id = ? AND user_id = ?', [id, req.userId]);
    if (existing) {
      await run('DELETE FROM event_saves WHERE event_id = ? AND user_id = ?', [id, req.userId]);
    } else {
      await run('INSERT INTO event_saves (event_id, user_id) VALUES (?, ?)', [id, req.userId]);
    }
    res.json(await rowToEvent(await get('SELECT * FROM events WHERE id = ?', [id]), req.userId));
  } catch (err) {
    console.error('Event save error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/:id/share', optionalAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const row = await get('SELECT * FROM events WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Evento nao encontrado' });
    await run('UPDATE events SET shares = shares + 1 WHERE id = ?', [id]);
    res.json(await rowToEvent(await get('SELECT * FROM events WHERE id = ?', [id]), req.userId));
  } catch (err) {
    console.error('Event share error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/:id/participants', optionalAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const row = await get('SELECT * FROM events WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Evento nao encontrado' });
    const userId = req.userId;
    if (row.status !== 'approved' && !(userId && userId === row.organizer_id)) return res.status(404).json({ error: 'Evento nao encontrado' });
    const isOwner = userId === row.organizer_id;
    const participants = await all(`
      SELECT ep.user_id, ep.status, ep.created_at, u.name, u.avatar
      FROM event_participants ep
      JOIN users u ON ep.user_id = u.id
      WHERE ep.event_id = ?
      ORDER BY CASE ep.status WHEN 'confirmed' THEN 0 WHEN 'going' THEN 1 ELSE 2 END, ep.created_at ASC
    `, [id]);
    res.json({ participants, is_organizer: isOwner, participant_limit: row.participant_limit });
  } catch (err) {
    console.error('Event participants error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

async function bumpEncounterIntimacy(eventId, userId) {
  try {
    const participantCount = await get('SELECT COUNT(*) as going FROM event_participants WHERE event_id = ? AND status = ?', [eventId, 'going']);
    if ((participantCount?.going || 0) < 2) return;
    const goers = await all('SELECT user_id FROM event_participants WHERE event_id = ? AND status = ?', [eventId, 'going']);
    if (!goers || goers.length < 2) return;
    for (let i = 0; i < goers.length; i++) {
      for (let j = i + 1; j < goers.length; j++) {
        const a = goers[i].user_id, b = goers[j].user_id;
        const match = await getMatchBetweenUsers(a, b);
        if (match) {
          // Count an event once per match
          const already = await get('SELECT 1 as x FROM match_interaction_days WHERE match_id = ? AND day = ? AND event_together = 1', [match.id, todayStr()]);
          await bumpIntimacy(match.id, INTIMACY.event_together);
          await run('UPDATE match_interaction_days SET event_together = 1 WHERE match_id = ? AND day = ?', [match.id, todayStr()]);
        }
      }
    }
  } catch (e) {
    console.error('bumpEncounterIntimacy error:', e);
  }
}

router.get('/:id/liveloc', optionalAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const row = await get('SELECT * FROM events WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Evento nao encontrado' });
    const active = row.status === 'approved' && String(row.date || '').slice(0, 10) >= todayStr();
    res.json({
      event_id: id,
      enabled: active ? (row.live_location_enabled === 1) : false,
      lat: active && row.live_location_enabled === 1 ? row.live_lat : null,
      lng: active && row.live_location_enabled === 1 ? row.live_lng : null,
      updated_at: active && row.live_location_enabled === 1 ? row.live_updated_at : null,
      active
    });
  } catch (err) {
    console.error('Event liveloc get error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/:id/liveloc', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const row = await get('SELECT * FROM events WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Evento nao encontrado' });
    if (row.organizer_id !== req.userId) return res.status(403).json({ error: 'Somente o organizador pode ativar' });
    if (row.status !== 'approved' || String(row.date || '').slice(0, 10) < todayStr()) {
      return res.status(400).json({ error: 'Localizacao ao vivo so durante o evento ativo' });
    }
    const enabled = !!req.body.enabled;
    const lat = enabled ? parseFloat(req.body.lat) : null;
    const lng = enabled ? parseFloat(req.body.lng) : null;
    if (enabled && (!isFinite(lat) || !isFinite(lng))) return res.status(400).json({ error: 'Coordenadas invalidas' });
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    await run('UPDATE events SET live_location_enabled = ?, live_lat = ?, live_lng = ?, live_updated_at = ? WHERE id = ?',
      [enabled ? 1 : 0, enabled ? lat : null, enabled ? lng : null, enabled ? now : row.live_updated_at, id]);
    res.json({ ok: true, enabled, lat: enabled ? lat : null, lng: enabled ? lng : null, updated_at: enabled ? now : null });
  } catch (err) {
    console.error('Event liveloc set error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
module.exports.CATEGORIES = CATEGORIES;