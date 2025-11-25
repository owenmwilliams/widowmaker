const crypto = require('crypto');

const QR_TYPES = {
  item: 'item',
  container: 'container',
};

const DEFAULT_BASE_URL =
  process.env.QR_BASE_URL ||
  (process.env.NODE_ENV === 'production'
    ? 'https://reloprep.com'
    : 'http://localhost:5173');

const buildQrUrl = (type, token) => {
  const sanitizedBase = DEFAULT_BASE_URL.replace(/\/$/, '');
  return `${sanitizedBase}/qr/${type}/${token}`;
};

const randomToken = (prefix = 'qr') => {
  const id = crypto.randomBytes(8).toString('base64url');
  return `${prefix}_${id}`;
};

async function generateUniqueToken(knex, tableName, prefix) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = randomToken(prefix);
    const existing = await knex(tableName).where({ qr_code: token }).first();
    if (!existing) {
      return token;
    }
  }
  throw new Error('Failed to generate unique QR token');
}

const extractQrToken = (value) => {
  if (!value) return null;
  const text = String(value).trim();
  const match = text.match(/qr\/(?:container|item)\/([^/?#]+)/i);
  if (match && match[1]) {
    return match[1];
  }
  if (/^(ct_|it_|qr_)/i.test(text)) {
    return text;
  }
  return text;
};

module.exports = {
  QR_TYPES,
  buildQrUrl,
  generateUniqueToken,
  extractQrToken,
};
