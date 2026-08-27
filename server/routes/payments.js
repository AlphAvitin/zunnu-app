const express = require('express');
const axios = require('axios');
const { run, get } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const MP_BASE = 'https://api.mercadopago.com';
const MP_TOKEN = process.env.MP_ACCESS_TOKEN || '';

const PLANS = {
  plus: { name: 'Tutor Plus', price: 4.99, months: 1 },
  pro: { name: 'Vendedor PRO', price: 29.90, months: 1 }
};

function mpHeaders() {
  return {
    Authorization: `Bearer ${MP_TOKEN}`,
    'Content-Type': 'application/json',
    'X-Idempotency-Key': `zunnu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  };
}

router.get('/plans', (req, res) => {
  res.json(PLANS);
});

router.post('/create-pix', authMiddleware, async (req, res) => {
  try {
    const { plan } = req.body;
    if (!PLANS[plan]) return res.status(400).json({ error: 'Plano invalido' });

    const planData = PLANS[plan];
    const user = await get('SELECT id, name, email FROM users WHERE id = ?', [req.userId]);

    if (!MP_TOKEN) {
      const txid = `zunnu_${req.userId}_${Date.now()}`;
      await run('INSERT INTO payments (user_id, plan, amount, pix_code, txid, status) VALUES (?, ?, ?, ?, ?, ?)',
        [req.userId, plan, planData.price, null, txid, 'pending']);
      return res.json({ txid, plan, amount: planData.price, pixQrCode: null, pixCopyPaste: null, sandbox: true });
    }

    const mpRes = await axios.post(`${MP_BASE}/v1/payments`, {
      transaction_amount: planData.price,
      description: `ZUNNU - ${planData.name}`,
      payment_method_id: 'pix',
      payer: {
        email: user.email || 'pagamento@zunnu.com.br',
        first_name: user.name || 'ZUNNU User'
      },
      external_reference: `zunnu_${req.userId}_${plan}`
    }, { headers: mpHeaders() });

    const mpId = String(mpRes.data.id);
    const txData = mpRes.data.point_of_interaction?.transaction_data || {};

    await run('INSERT INTO payments (user_id, plan, amount, pix_code, txid, status) VALUES (?, ?, ?, ?, ?, ?)',
      [req.userId, plan, planData.price, txData.qr_code_base64 || null, mpId, 'pending']);

    res.json({
      txid: mpId,
      plan,
      amount: planData.price,
      pixQrCode: txData.qr_code_base64 || null,
      pixCopyPaste: txData.qr_code || null,
      ticketUrl: txData.ticket_url || null,
      sandbox: false
    });
  } catch (err) {
    console.error('Mercado Pago create-pix error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Erro ao criar pagamento Pix' });
  }
});

router.post('/create-product-pix', authMiddleware, async (req, res) => {
  try {
    const { productId, title, price } = req.body;
    if (!title || !price) return res.status(400).json({ error: 'Dados do produto invalidos' });

    const user = await get('SELECT id, name, email FROM users WHERE id = ?', [req.userId]);

    if (!MP_TOKEN) {
      const txid = `zunnu_prod_${req.userId}_${Date.now()}`;
      await run('INSERT INTO payments (user_id, plan, amount, pix_code, txid, status) VALUES (?, ?, ?, ?, ?, ?)',
        [req.userId, 'product', price, null, txid, 'pending']);
      return res.json({ txid, title, amount: price, pixQrCode: null, pixCopyPaste: null, sandbox: true });
    }

    const mpRes = await axios.post(`${MP_BASE}/v1/payments`, {
      transaction_amount: price,
      description: `ZUNNU - ${title}`,
      payment_method_id: 'pix',
      payer: {
        email: user.email || 'pagamento@zunnu.com.br',
        first_name: user.name || 'ZUNNU User'
      },
      external_reference: `zunnu_prod_${req.userId}_${productId || 'unknown'}`
    }, { headers: mpHeaders() });

    const mpId = String(mpRes.data.id);
    const txData = mpRes.data.point_of_interaction?.transaction_data || {};

    await run('INSERT INTO payments (user_id, plan, amount, pix_code, txid, status) VALUES (?, ?, ?, ?, ?, ?)',
      [req.userId, 'product', price, txData.qr_code_base64 || null, mpId, 'pending']);

    res.json({
      txid: mpId,
      title,
      amount: price,
      pixQrCode: txData.qr_code_base64 || null,
      pixCopyPaste: txData.qr_code || null,
      ticketUrl: txData.ticket_url || null,
      sandbox: false
    });
  } catch (err) {
    console.error('Mercado Pago create-product-pix error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Erro ao criar pagamento Pix' });
  }
});

router.post('/confirm/:txid', authMiddleware, async (req, res) => {
  try {
    const payment = await get('SELECT * FROM payments WHERE txid = ? AND user_id = ?',
      [req.params.txid, req.userId]);

    if (!payment) return res.status(404).json({ error: 'Pagamento nao encontrado' });
    if (payment.status === 'paid') return res.json({ status: 'paid', message: 'Ja pago' });

    if (!MP_TOKEN) {
      const created = new Date(payment.created_at).getTime();
      const elapsed = Date.now() - created;
      if (elapsed > 5000) {
        await run("UPDATE payments SET status = 'paid', paid_at = datetime('now') WHERE txid = ?",
          [payment.txid]);
        await run('UPDATE users SET plan = ? WHERE id = ?', [payment.plan, req.userId]);
        const { sendToUser } = require('../ws');
        sendToUser(req.userId, { type: 'notification', notification: { type: 'payment', message: `Plano ${payment.plan.toUpperCase()} ativado com sucesso!` } });
        return res.json({ status: 'paid', plan: payment.plan, message: 'Plano ativado com sucesso!' });
      }
      return res.json({ status: 'pending', message: 'Aguarde 5 segundos e tente novamente (sandbox).' });
    }

    const mpRes = await axios.get(`${MP_BASE}/v1/payments/${payment.txid}`, {
      headers: { Authorization: `Bearer ${MP_TOKEN}` }
    });

    const mpStatus = mpRes.data.status;
    if (mpStatus === 'approved') {
      await run("UPDATE payments SET status = 'paid', paid_at = datetime('now') WHERE txid = ?",
        [payment.txid]);
      await run('UPDATE users SET plan = ? WHERE id = ?', [payment.plan, req.userId]);
      return res.json({ status: 'paid', plan: payment.plan, message: 'Plano ativado com sucesso!' });
    }

    res.json({ status: mpStatus || 'pending', message: 'Pagamento ainda nao confirmado. Aguarde ou escaneie o QR Code novamente.' });
  } catch (err) {
    console.error('Mercado Pago confirm error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Erro ao confirmar pagamento' });
  }
});

router.post('/webhook', async (req, res) => {
  try {
    const { action, data } = req.body;

    if (action === 'payment.updated' && data?.id && MP_TOKEN) {
      const mpRes = await axios.get(`${MP_BASE}/v1/payments/${data.id}`, {
        headers: { Authorization: `Bearer ${MP_TOKEN}` }
      });

      const mpPayment = mpRes.data;
      if (mpPayment.status === 'approved') {
        const txid = String(mpPayment.id);
        const payment = await get('SELECT * FROM payments WHERE txid = ?', [txid]);
        if (payment && payment.status !== 'paid') {
          await run("UPDATE payments SET status = 'paid', paid_at = datetime('now') WHERE txid = ?", [txid]);
          await run('UPDATE users SET plan = ? WHERE id = ?', [payment.plan, payment.user_id]);
        }
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.sendStatus(200);
  }
});

router.get('/status', authMiddleware, async (req, res) => {
  try {
    const user = await get('SELECT plan FROM users WHERE id = ?', [req.userId]);
    const lastPayment = await get(
      'SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
      [req.userId]
    );

    res.json({ plan: user.plan, lastPayment: lastPayment || null });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
