const express = require('express');
const fs = require('fs');
const path = require('path');
const { authMiddleware } = require('../middleware/auth');
const { run } = require('../db');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'avatars');

function ensureDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

router.post('/avatar', authMiddleware, async (req, res) => {
  try {
    const { data } = req.body || {};
    if (!data || typeof data !== 'string') {
      return res.status(400).json({ error: 'Imagem invalida' });
    }
    const m = data.match(/^data:(image\/[a-z]+);base64,(.+)$/i);
    if (!m) return res.status(400).json({ error: 'Formato de imagem invalido' });
    const ext = MIME_EXT[m[1].toLowerCase()] || 'png';
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 6 * 1024 * 1024) {
      return res.status(400).json({ error: 'Imagem muito grande (max 6MB)' });
    }
    ensureDir();
    const filename = `u${req.userId}_${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), buf);
    const url = `/uploads/avatars/${filename}`;
    await run('UPDATE users SET avatar = ? WHERE id = ?', [url, req.userId]);
    res.json({ url, avatar: url });
  } catch (err) {
    console.error('Upload avatar error:', err);
    res.status(500).json({ error: 'Erro interno no upload' });
  }
});

module.exports = router;
