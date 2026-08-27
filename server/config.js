const crypto = require('crypto');

const isProd = process.env.NODE_ENV === 'production';

const JWT_SECRET = process.env.JWT_SECRET || (() => {
  if (isProd) throw new Error('JWT_SECRET nao definido. Configure a variavel de ambiente JWT_SECRET no Render.');
  return crypto.randomBytes(32).toString('hex');
})();

module.exports = { JWT_SECRET };