const express = require('express');
const { run, get, all } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router();

const POINT_RULES = {
  complete_profile: { points: 50, desc: 'Perfil completo' },
  first_pet: { points: 100, desc: 'Primeiro pet cadastrado' },
  add_pet: { points: 30, desc: 'Pet cadastrado' },
  add_vaccine: { points: 20, desc: 'Vacina registrada' },
  daily_login: { points: 10, desc: 'Login diario' },
  create_post: { points: 15, desc: 'Post publicado' },
  partnership_accepted: { points: 50, desc: 'Parceria aceita' },
};

async function creditPoints(userId, reason, customPoints) {
  const rule = POINT_RULES[reason];
  const amount = customPoints || (rule ? rule.points : 0);
  if (amount <= 0) return;
  
  // Check daily login uniqueness
  if (reason === 'daily_login') {
    const today = new Date().toISOString().slice(0, 10);
    const existing = await get("SELECT id FROM points_transactions WHERE user_id = ? AND reason = 'daily_login' AND DATE(created_at) = ?", [userId, today]);
    if (existing) return;
  }
  
  await run('INSERT INTO points_transactions (user_id, amount, reason) VALUES (?, ?, ?)', [userId, amount, reason]);
  await run('UPDATE users SET points_balance = COALESCE(points_balance, 0) + ? WHERE id = ?', [amount, userId]);
}

router.get('/', authMiddleware, async (req, res) => {
  try {
    const user = await get('SELECT points_balance FROM users WHERE id = ?', [req.userId]);
    const history = await all('SELECT * FROM points_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [req.userId]);
    res.json({ balance: user?.points_balance || 0, history, rules: POINT_RULES });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Check and credit daily login
router.post('/daily-login', authMiddleware, async (req, res) => {
  try {
    await creditPoints(req.userId, 'daily_login');
    const user = await get('SELECT points_balance FROM users WHERE id = ?', [req.userId]);
    res.json({ balance: user?.points_balance || 0 });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Redeem points for subscription discount
router.post('/redeem', authMiddleware, async (req, res) => {
  try {
    const { reward } = req.body;
    const user = await get('SELECT points_balance FROM users WHERE id = ?', [req.userId]);
    const balance = user?.points_balance || 0;
    
    if (reward === 'plus_month' && balance >= 200) {
      await run('UPDATE users SET points_balance = points_balance - 200, plan = ? WHERE id = ?', ['plus', req.userId]);
      await run('INSERT INTO points_transactions (user_id, amount, reason) VALUES (?, ?, ?)', [req.userId, -200, 'redeem_plus_month']);
      return res.json({ success: true, message: 'Mes Plus ativado!', newBalance: balance - 200 });
    }
    if (reward === 'highlight_badge' && balance >= 100) {
      await run('UPDATE users SET points_balance = points_balance - 100 WHERE id = ?', [req.userId]);
      await run('INSERT INTO points_transactions (user_id, amount, reason) VALUES (?, ?, ?)', [req.userId, -100, 'redeem_highlight']);
      return res.json({ success: true, message: 'Selo de destaque ativado!', newBalance: balance - 100 });
    }
    
    res.status(400).json({ error: 'Saldo insuficiente ou recompensa invalida' });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
module.exports.creditPoints = creditPoints;