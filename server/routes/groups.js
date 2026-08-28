const express = require('express');
const { run, get, all } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { sendToUser } = require('../ws');

const router = express.Router();

const CATEGORIES = ['encontros', 'passeios', 'apoio', 'adocao', 'outros'];

function cleanCategory(c) {
  return CATEGORIES.includes(c) ? c : 'outros';
}

router.get('/', authMiddleware, async (req, res) => {
  try {
    const uid = req.userId;
    const groups = await all(`
      SELECT g.*,
        (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) as member_count,
        (SELECT COUNT(*) FROM group_posts gp WHERE gp.group_id = g.id) as post_count,
        EXISTS (SELECT 1 FROM group_members mem WHERE mem.group_id = g.id AND mem.user_id = ?) as is_member,
        (g.owner_id = ?) as is_owner
      FROM groups g
      ORDER BY g.created_at DESC
    `, [uid, uid]);
    res.json({ groups });
  } catch (err) {
    console.error('Groups list error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, description, category, image } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Nome do grupo e obrigatorio' });
    }
    const result = await run(
      'INSERT INTO groups (owner_id, name, description, category, image) VALUES (?, ?, ?, ?, ?)',
      [req.userId, String(name).trim(), String(description || '').trim(), cleanCategory(category), String(image || '').trim()]
    );
    await run('INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)', [result.lastInsertRowid, req.userId, 'owner']);
    const group = await get('SELECT * FROM groups WHERE id = ?', [result.lastInsertRowid]);
    res.json({ group });
  } catch (err) {
    console.error('Group create error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const gid = parseInt(req.params.id);
    const uid = req.userId;
    const group = await get(`
      SELECT g.*,
        (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) as member_count,
        EXISTS (SELECT 1 FROM group_members mem WHERE mem.group_id = g.id AND mem.user_id = ?) as is_member,
        (SELECT role FROM group_members mem WHERE mem.group_id = g.id AND mem.user_id = ?) as my_role,
        (g.owner_id = ?) as is_owner
      FROM groups g WHERE g.id = ?
    `, [uid, uid, uid, gid]);
    if (!group) return res.status(404).json({ error: 'Grupo nao encontrado' });
    const members = await all(`
      SELECT u.id, u.name, u.avatar, gm.role
      FROM group_members gm JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = ?
      ORDER BY gm.role = 'owner' DESC, gm.created_at ASC
    `, [gid]);
    res.json({ group, members });
  } catch (err) {
    console.error('Group detail error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/:id/join', authMiddleware, async (req, res) => {
  try {
    const gid = parseInt(req.params.id);
    const grp = await get('SELECT * FROM groups WHERE id = ?', [gid]);
    if (!grp) return res.status(404).json({ error: 'Grupo nao encontrado' });
    await run('INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', [gid, req.userId, 'member']);
    if (grp.owner_id !== req.userId) {
      const me = await get('SELECT name FROM users WHERE id = ?', [req.userId]);
      const msg = `${me?.name || 'Alguem'} entrou no grupo "${grp.name}".`;
      await run('INSERT INTO notifications (user_id, type, message, reference_id) VALUES (?, ?, ?, ?)', [grp.owner_id, 'group_join', msg, gid]);
      sendToUser(grp.owner_id, { type: 'notification', notification: { type: 'group_join', message: msg, referenceId: gid } });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Group join error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/:id/leave', authMiddleware, async (req, res) => {
  try {
    const gid = parseInt(req.params.id);
    const uid = req.userId;
    const owner = await get('SELECT owner_id FROM groups WHERE id = ?', [gid]);
    if (!owner) return res.status(404).json({ error: 'Grupo nao encontrado' });
    if (owner.owner_id === uid) return res.status(400).json({ error: 'O criador nao pode sair do proprio grupo' });
    await run('DELETE FROM group_members WHERE group_id = ? AND user_id = ?', [gid, uid]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Group leave error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/:id/posts', authMiddleware, async (req, res) => {
  try {
    const gid = parseInt(req.params.id);
    const posts = await all(`
      SELECT gp.id, gp.group_id, gp.text, gp.image, gp.created_at,
        u.id as user_id, u.name as user_name, u.avatar as user_avatar
      FROM group_posts gp JOIN users u ON u.id = gp.user_id
      WHERE gp.group_id = ?
      ORDER BY gp.created_at DESC
    `, [gid]);
    res.json({ posts });
  } catch (err) {
    console.error('Group posts error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/:id/posts', authMiddleware, async (req, res) => {
  try {
    const gid = parseInt(req.params.id);
    const { text, image } = req.body;
    if (!text || !String(text).trim()) {
      return res.status(400).json({ error: 'Texto e obrigatorio' });
    }
    const member = await get('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?', [gid, req.userId]);
    if (!member) return res.status(403).json({ error: 'Entre no grupo para publicar' });
    const me = await get('SELECT name FROM users WHERE id = ?', [req.userId]);
    const grpName = await get('SELECT name FROM groups WHERE id = ?', [gid]);
    await run('INSERT INTO group_posts (group_id, user_id, text, image) VALUES (?, ?, ?, ?)',
      [gid, req.userId, String(text).trim(), String(image || '').trim()]);
    const members = await all('SELECT user_id FROM group_members WHERE group_id = ? AND user_id != ?', [gid, req.userId]);
    const msg = `${me?.name || 'Alguem'} publicou no grupo "${grpName?.name || 'voce'}"`;
    for (const mm of members) {
      await run('INSERT INTO notifications (user_id, type, message, reference_id) VALUES (?, ?, ?, ?)', [mm.user_id, 'group_post', msg, gid]);
      sendToUser(mm.user_id, { type: 'notification', notification: { type: 'group_post', message: msg, referenceId: gid } });
    }
    const post = await all(`
      SELECT gp.id, gp.group_id, gp.text, gp.image, gp.created_at,
        u.id as user_id, u.name as user_name, u.avatar as user_avatar
      FROM group_posts gp JOIN users u ON u.id = gp.user_id
      WHERE gp.group_id = ?
      ORDER BY gp.created_at DESC LIMIT 1
    `, [gid]);
    res.json({ post: post[0] });
  } catch (err) {
    console.error('Group post create error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/:id/posts/:postId', authMiddleware, async (req, res) => {
  try {
    const gid = parseInt(req.params.id);
    const postId = parseInt(req.params.postId);
    const post = await get('SELECT * FROM group_posts WHERE id = ? AND group_id = ?', [postId, gid]);
    if (!post) return res.status(404).json({ error: 'Publicacao nao encontrada' });
    const grp = await get('SELECT owner_id FROM groups WHERE id = ?', [gid]);
    if (post.user_id !== req.userId && !grp) return res.status(403).json({ error: 'Sem permissao' });
    if (post.user_id !== req.userId && grp.owner_id !== req.userId) return res.status(403).json({ error: 'Sem permissao' });
    await run('DELETE FROM group_posts WHERE id = ?', [postId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Group post delete error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const gid = parseInt(req.params.id);
    const grp = await get('SELECT * FROM groups WHERE id = ?', [gid]);
    if (!grp) return res.status(404).json({ error: 'Grupo nao encontrado' });
    if (grp.owner_id !== req.userId) return res.status(403).json({ error: 'Somente o criador pode editar o grupo' });
    const { name, description, category, image } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Nome do grupo e obrigatorio' });
    }
    await run('UPDATE groups SET name = ?, description = ?, category = ?, image = ? WHERE id = ?',
      [String(name).trim(), String(description || '').trim(), cleanCategory(category), String(image || '').trim(), gid]);
    const group = await get('SELECT * FROM groups WHERE id = ?', [gid]);
    res.json({ group });
  } catch (err) {
    console.error('Group update error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/:id/members/:userId', authMiddleware, async (req, res) => {
  try {
    const gid = parseInt(req.params.id);
    const targetId = parseInt(req.params.userId);
    const grp = await get('SELECT * FROM groups WHERE id = ?', [gid]);
    if (!grp) return res.status(404).json({ error: 'Grupo nao encontrado' });
    if (grp.owner_id !== req.userId) return res.status(403).json({ error: 'Somente o criador pode remover membros' });
    if (targetId === grp.owner_id) return res.status(400).json({ error: 'O criador nao pode ser removido' });
    await run('DELETE FROM group_members WHERE group_id = ? AND user_id = ?', [gid, targetId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Group member remove error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const gid = parseInt(req.params.id);
    const grp = await get('SELECT * FROM groups WHERE id = ?', [gid]);
    if (!grp) return res.status(404).json({ error: 'Grupo nao encontrado' });
    if (grp.owner_id !== req.userId) return res.status(403).json({ error: 'Somente o criador pode excluir o grupo' });
    await run('DELETE FROM group_posts WHERE group_id = ?', [gid]);
    await run('DELETE FROM group_members WHERE group_id = ?', [gid]);
    await run('DELETE FROM groups WHERE id = ?', [gid]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Group delete error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;