const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'zunnu.db');
let _db = null;

async function initDB() {
  if (_db) return _db;
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    _db = new SQL.Database(buf);
  } else {
    _db = new SQL.Database();
  }
  _db.run('PRAGMA foreign_keys = ON');
  createTables(_db);
  saveDB();
  return _db;
}

function getDB() {
  if (!_db) throw new Error('Database not initialized. Call initDB() first.');
  return _db;
}

function saveDB() {
  if (!_db) return;
  const data = _db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function createTables(db) {
  db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    birth_date TEXT,
    bio TEXT DEFAULT '',
    location TEXT DEFAULT '',
    avatar TEXT DEFAULT '',
    selfie_url TEXT,
    is_human_verified INTEGER DEFAULT 0,
    plan TEXT DEFAULT 'free',
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    image TEXT,
    likes INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`
  CREATE TABLE IF NOT EXISTS post_likes (
    user_id INTEGER NOT NULL,
    post_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, post_id)
  )`);
  db.run(`
  CREATE TABLE IF NOT EXISTS pets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    species TEXT DEFAULT 'Pet',
    breed TEXT DEFAULT 'SRD',
    age TEXT DEFAULT '',
    location TEXT DEFAULT '',
    image TEXT DEFAULT '',
    is_castrated INTEGER DEFAULT 0,
    zodiac TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`
  CREATE TABLE IF NOT EXISTS vaccines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pet_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    date TEXT,
    status TEXT DEFAULT 'A agendar'
  )`);
  db.run(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    price REAL NOT NULL,
    image TEXT DEFAULT '',
    description TEXT DEFAULT '',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`
  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    price REAL NOT NULL,
    duration TEXT DEFAULT '',
    icon TEXT DEFAULT '',
    description TEXT DEFAULT '',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`
  CREATE TABLE IF NOT EXISTS match_swipes (
    swiper_id INTEGER NOT NULL,
    swiped_id INTEGER NOT NULL,
    is_like INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (swiper_id, swiped_id)
  )`);
  db.run(`
  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user1_id INTEGER NOT NULL,
    user2_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id INTEGER NOT NULL,
    post_id INTEGER,
    reason TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    reference_id INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    plan TEXT NOT NULL,
    amount REAL NOT NULL,
    pix_code TEXT,
    status TEXT DEFAULT 'pending',
    txid TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    paid_at TEXT
  )`);
  try { db.run(`ALTER TABLE users ADD COLUMN latitude REAL`); } catch(e) {}
  try { db.run(`ALTER TABLE users ADD COLUMN longitude REAL`); } catch(e) {}
  try { db.run(`ALTER TABLE pets ADD COLUMN latitude REAL`); } catch(e) {}
  try { db.run(`ALTER TABLE pets ADD COLUMN longitude REAL`); } catch(e) {}
  db.run(`CREATE TABLE IF NOT EXISTS follows (
    follower_id INTEGER NOT NULL,
    following_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (follower_id, following_id)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS pet_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pet_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    image_url TEXT NOT NULL,
    caption TEXT DEFAULT '',
    album TEXT DEFAULT 'geral',
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS pet_milestones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pet_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    date TEXT DEFAULT (date('now')),
    icon TEXT DEFAULT '128062',
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS pet_ai_match (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pet1_id INTEGER NOT NULL,
    pet2_id INTEGER NOT NULL,
    score REAL DEFAULT 0,
    reason TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`
  CREATE TABLE IF NOT EXISTS stories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    pet_id INTEGER,
    image_url TEXT NOT NULL,
    caption TEXT DEFAULT '',
    type TEXT DEFAULT 'story',
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT DEFAULT (datetime('now', '+24 hours'))
  )`);
  db.run(`
  CREATE TABLE IF NOT EXISTS story_views (
    story_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    viewed_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (story_id, user_id)
  )`);
  db.run(`
  CREATE TABLE IF NOT EXISTS reels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    pet_id INTEGER,
    video_url TEXT NOT NULL,
    thumbnail TEXT DEFAULT '',
    caption TEXT DEFAULT '',
    music TEXT DEFAULT '',
    likes_count INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    views_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`
  CREATE TABLE IF NOT EXISTS reel_likes (
    user_id INTEGER NOT NULL,
    reel_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, reel_id)
  )`);
  db.run(`
  CREATE TABLE IF NOT EXISTS reel_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reel_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`
  CREATE TABLE IF NOT EXISTS cart_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    product_id INTEGER,
    quantity INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    buyer_id INTEGER,
    total REAL,
    status TEXT DEFAULT 'pending',
    shipping_name TEXT,
    shipping_address TEXT,
    shipping_phone TEXT,
    payment_method TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    paid_at DATETIME
  )`);
  db.run(`
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    product_id INTEGER,
    seller_id INTEGER,
    title TEXT,
    price_at_purchase REAL,
    quantity INTEGER
  )`);
  db.run(`
  CREATE TABLE IF NOT EXISTS lost_pets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    pet_name TEXT,
    species TEXT,
    breed TEXT,
    description TEXT,
    image TEXT,
    status TEXT DEFAULT 'lost',
    latitude REAL,
    longitude REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`
  CREATE TABLE IF NOT EXISTS reports_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id INTEGER,
    target_type TEXT,
    target_id INTEGER,
    reason TEXT,
    category TEXT,
    status TEXT DEFAULT 'pending',
    admin_note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    provider_id INTEGER,
    service_id INTEGER,
    service_title TEXT,
    date TEXT,
    time TEXT,
    pet_name TEXT,
    notes TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`
  CREATE TABLE IF NOT EXISTS business_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE,
    business_name TEXT,
    business_type TEXT,
    description TEXT,
    phone TEXT,
    address TEXT,
    hours TEXT,
    verified INTEGER DEFAULT 0
  )`);
  db.run(`
  CREATE TABLE IF NOT EXISTS follow_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id INTEGER,
    target_id INTEGER,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`
  CREATE TABLE IF NOT EXISTS chat_stickers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    url TEXT,
    category TEXT
  )`);
  try { db.run(`ALTER TABLE users ADD COLUMN is_private INTEGER DEFAULT 0`); } catch(e) {}
  try { db.run(`ALTER TABLE users ADD COLUMN business_type TEXT`); } catch(e) {}
  try { db.run(`ALTER TABLE products ADD COLUMN stock INTEGER DEFAULT 99`); } catch(e) {}
  try { db.run(`ALTER TABLE posts ADD COLUMN video_url TEXT`); } catch(e) {}
  try { db.run(`ALTER TABLE users ADD COLUMN points_balance INTEGER DEFAULT 0`); } catch(e) {}
  db.run(`
  CREATE TABLE IF NOT EXISTS partnership_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id INTEGER,
    requester_pet_id INTEGER,
    target_id INTEGER,
    target_pet_id INTEGER,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`
  CREATE TABLE IF NOT EXISTS points_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    amount INTEGER,
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  try { db.run("ALTER TABLE users ADD COLUMN points_balance INTEGER DEFAULT 0"); } catch(e) {}
}

function run(sql, params = []) {
  const db = getDB();
  db.run(sql, params);
  const lastId = db.exec('SELECT last_insert_rowid() as id');
  const changes = db.getRowsModified();
  saveDB();
  return { lastInsertRowid: lastId[0] ? lastId[0].values[0][0] : 0, changes };
}

function get(sql, params = []) {
  const db = getDB();
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  if (stmt.step()) {
    const cols = stmt.getColumnNames();
    const vals = stmt.get();
    stmt.free();
    const row = {};
    cols.forEach((c, i) => row[c] = vals[i]);
    return row;
  }
  stmt.free();
  return undefined;
}

function all(sql, params = []) {
  const db = getDB();
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    const cols = stmt.getColumnNames();
    const vals = stmt.get();
    const row = {};
    cols.forEach((c, i) => row[c] = vals[i]);
    rows.push(row);
  }
  stmt.free();
  return rows;
}

module.exports = { initDB, getDB, saveDB, run, get, all };
