const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { run, get, all } = require('../db');
const { JWT_SECRET, authMiddleware } = require('../middleware/auth');
const { creditPoints } = require('./points');

const router = express.Router();

function calculateAge(birthDateString) {
  if (!birthDateString) return 0;
  const today = new Date();
  const birth = new Date(birthDateString);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

router.post('/register', async (req, res) => {
  try {
    const { name, email, password, birthDate, bio, location } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nome, email e senha sao obrigatorios' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Senha deve ter no minimo 6 caracteres' });
    }

    if (birthDate) {
      const age = calculateAge(birthDate);
      if (age < 18) {
        return res.status(400).json({ error: 'Cadastro restrito a maiores de 18 anos' });
      }
    }

    const existing = await get('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      return res.status(409).json({ error: 'Email ja cadastrado' });
    }

    const hash = bcrypt.hashSync(password, 10);
    const result = await run(
      'INSERT INTO users (name, email, password_hash, birth_date, bio, location) VALUES (?, ?, ?, ?, ?, ?)',
      [name, email, hash, birthDate || null, bio || '', location || '']
    );

    const token = jwt.sign(
      { userId: result.lastInsertRowid, plan: 'free' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const user = await get(
      'SELECT id, name, email, birth_date, bio, location, avatar, plan FROM users WHERE id = ?',
      [result.lastInsertRowid]
    );

    res.json({ token, user });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha sao obrigatorios' });
    }

    const user = await get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) {
      return res.status(401).json({ error: 'Email ou senha invalidos' });
    }

    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Email ou senha invalidos' });
    }

    const token = jwt.sign(
      { userId: user.id, plan: user.plan },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const { password_hash, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await get(
      'SELECT id, name, email, birth_date, bio, location, avatar, selfie_url, is_human_verified, is_admin, plan, is_private, points_balance, created_at FROM users WHERE id = ?',
      [req.userId]
    );

    if (!user) return res.status(404).json({ error: 'Usuario nao encontrado' });

    const pets = await get('SELECT COUNT(*) as count FROM pets WHERE user_id = ?', [req.userId]);
    const posts = await get('SELECT COUNT(*) as count FROM posts WHERE user_id = ?', [req.userId]);
    const matches = await get('SELECT COUNT(*) as count FROM matches WHERE user1_id = ? OR user2_id = ?', [req.userId, req.userId]);

    await creditPoints(req.userId, 'daily_login');

    res.json({
      ...user,
      stats: { pets: pets.count, posts: posts.count, matches: matches.count }
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.put('/me', authMiddleware, async (req, res) => {
  try {
    const { name, bio, location, avatar, selfieUrl, is_private } = req.body;
    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (bio !== undefined) { updates.push('bio = ?'); params.push(bio); }
    if (location !== undefined) { updates.push('location = ?'); params.push(location); }
    if (avatar !== undefined) { updates.push('avatar = ?'); params.push(avatar); }
    if (selfieUrl !== undefined) { updates.push('selfie_url = ?'); params.push(selfieUrl); }
    if (is_private !== undefined) { updates.push('is_private = ?'); params.push(is_private ? 1 : 0); }

    if (updates.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });

    params.push(req.userId);
    await run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

    const user = await get(
      'SELECT id, name, email, birth_date, bio, location, avatar, selfie_url, is_human_verified, is_admin, plan, is_private, points_balance FROM users WHERE id = ?',
      [req.userId]
    );

    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/verify-human', authMiddleware, async (req, res) => {
  try {
    await run('UPDATE users SET is_human_verified = 1 WHERE id = ?', [req.userId]);
    res.json({ verified: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/change-password', authMiddleware, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return res.status(400).json({ error: 'Informe a senha atual e a nova senha' });
    if (new_password.length < 6) return res.status(400).json({ error: 'A nova senha deve ter no minimo 6 caracteres' });
    const user = await get('SELECT password_hash FROM users WHERE id = ?', [req.userId]);
    if (!user) return res.status(404).json({ error: 'Usuario nao encontrado' });
    if (!bcrypt.compareSync(current_password, user.password_hash)) return res.status(401).json({ error: 'Senha atual incorreta' });
    await run('UPDATE users SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(new_password, 10), req.userId]);
    res.json({ success: true, message: 'Senha alterada com sucesso' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/user/:id', async (req, res) => {
  try {
    const user = await get(
      'SELECT id, name, bio, location, avatar, plan, created_at FROM users WHERE id = ?',
      [req.params.id]
    );

    if (!user) return res.status(404).json({ error: 'Usuario nao encontrado' });

    const pets = await all('SELECT id, name, species, breed, age, image, zodiac FROM pets WHERE user_id = ?', [req.params.id]);
    const postsCount = await get('SELECT COUNT(*) as count FROM posts WHERE user_id = ?', [req.params.id]);
    const matches = await get('SELECT COUNT(*) as count FROM matches WHERE user1_id = ? OR user2_id = ?', [req.params.id, req.params.id]);

    res.json({
      ...user,
      pets,
      stats: { pets: pets.length, posts: postsCount.count, matches: matches.count }
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
