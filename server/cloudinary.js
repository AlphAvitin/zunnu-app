const fs = require('fs');
const path = require('path');

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || '';
const API_KEY = process.env.CLOUDINARY_API_KEY || '';
const API_SECRET = process.env.CLOUDINARY_API_SECRET || '';

const UPLOAD_DIR = path.join(__dirname, 'uploads', 'media');

function useCloudinary() {
  return !!(CLOUD_NAME && API_KEY && API_SECRET);
}

let _cloudinary = null;
function getCloudinary() {
  if (!_cloudinary) {
    const cloudinary = require('cloudinary').v2;
    cloudinary.config({ cloud_name: CLOUD_NAME, api_key: API_KEY, api_secret: API_SECRET });
    _cloudinary = cloudinary;
  }
  return _cloudinary;
}

function ensureLocalDir() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

async function uploadBuffer(buf, { folder = 'zunnu', resourceType = 'auto', filename } = {}) {
  if (useCloudinary()) {
    const cld = getCloudinary();
    return await new Promise((resolve, reject) => {
      const stream = cld.uploader.upload_stream(
        { folder, resource_type: resourceType, use_filename: true, unique_filename: true, overwrite: false },
        (err, result) => (err ? reject(err) : resolve(result.secure_url))
      );
      stream.end(buf);
    });
  }
  // fallback local
  ensureLocalDir();
  const ext = (path.extname(filename || '').toLowerCase() || '.bin').slice(0, 10);
  const name = `m_${Date.now()}_${Math.floor(Math.random() * 10000)}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return `/uploads/media/${name}`;
}

module.exports = { uploadBuffer, useCloudinary, UPLOAD_DIR };
