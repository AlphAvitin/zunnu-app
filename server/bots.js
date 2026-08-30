const bcrypt = require('bcryptjs');
const { run, get, all } = require('./db');

const BOTS = [
  {
    email: 'bot.dora@zunnu.app', name: 'Dora', bio: 'Mae de duas bolinhas de pelos', location: 'Centro', plan: 'free',
    avatar: 'https://i.pravatar.cc/150?img=47',
    pets: [ { name: 'Mel', species: 'Cachorro', breed: 'Shih Tzu', image: 'https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?auto=format&fit=crop&w=400&q=80' } ]
  },
  {
    email: 'bot.luna@zunnu.app', name: 'Luna', bio: 'Mamae coruja da Mimi', location: 'Sao Luis', plan: 'plus',
    avatar: 'https://i.pravatar.cc/150?img=32',
    pets: [ { name: 'Mimi', species: 'Gato', breed: 'SDR', image: 'https://images.unsplash.com/photo-1514888286974-6c03e2ca2/blogs' } ]
  },
  {
    email: 'bot.thor.pai@zunnu.app', name: 'Rafa', bio: 'Apaixonado pelo meu Golden', location: 'Bairro Alto', plan: 'free',
    avatar: 'https://i.pravatar.cc/150?img=12',
    pets: [ { name: 'Zico', species: 'Cachorro', breed: 'Golden Retriever', image: 'https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=400&q=80' } ]
  },
  {
    email: 'bot.nina@zunnu.app', name: 'Nina', bio: 'Mamae da Cacau e da Pipoca', location: 'Centro', plan: 'free',
    avatar: 'https://i.pravatar.cc/150?img=44',
    pets: [ { name: 'Cacau', species: 'Cachorro', breed: 'Caramelo', image: 'https://images.unsplash.com/photo-1561037404-61cd46aa615b?auto=format&fit=crop&w=400&q=80' } ]
  }
];

const POST_TEXTS = [
  'Passeio matinal do meu amorzinho, energia la em cima hoje!',
  'Dia de banho e tosa, cheirando a shampoo o dia todo.',
  'Alguem mais tem um pet que dorme de barriga pra cima?',
  'Descobriu um cantinho novo do parque, feliz demais!',
  'Primeiro dia de caminhada depois de dias de chuva. Melhor momento!',
  'Meu parceiro de todas as horas me esperando na porta.',
  'Quem mais acha que pet fofinho cura qualquer dia?',
  'Aula de obediencia hoje, ele esta se saindo muito bem!'
];

const COMMENT_TEXTS = [
  'Que fofo!', 'Amei essa foto!', 'Que carinha de sapeca haha',
  'Lindinho demais!', 'Muito amor nessa foto', 'Cadê a caminha dessa fofura?',
  'Que sorte a sua de ter esse companheiro!', 'Me apaixonei! Que neném!',
  'Essa raça é uma graça mesmo', 'Que barriguda boa haha'
];

function normalizeImg(url){
  if(!url) return '';
  if(/^https?:\/\//i.test(url)) return url;
  return `https://images.unsplash.com/${url}`;
}

let seeded = false;

async function ensureBots(){
  const hash = bcrypt.hashSync('123456', 10);
  for (const b of BOTS) {
    let u = await get('SELECT id FROM users WHERE email = ?', [b.email]);
    if (!u) {
      const r = await run('INSERT INTO users (name, email, password_hash, bio, location, plan, avatar, is_admin) VALUES (?,?,?,?,?,?,?,0)',
        [b.name, b.email, hash, b.bio, b.location, b.plan, b.avatar]);
      u = { id: r.lastInsertRowid };
    }
    const pet = await get('SELECT id, name FROM pets WHERE user_id = ? ORDER BY id ASC LIMIT 1', [u.id]);
    if (!pet) {
      await run('INSERT INTO pets (user_id, name, species, breed, location, image, visibility) VALUES (?,?,?,?,?,?,?)',
        [u.id, b.pets[0].name, b.pets[0].species, b.pets[0].breed, b.location, normalizeImg(b.pets[0].image), 'public']);
    }
  }
}

function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max){ return Math.floor(Math.random() * (max - min + 1)) + min; }

async function botState(userId){
  const pet = await get('SELECT id FROM pets WHERE user_id = ? ORDER BY id ASC LIMIT 1', [userId]);
  return { petId: pet ? pet.id : null };
}

async function botPost(bot){
  const u = await get('SELECT id FROM users WHERE email = ?', [bot.email]);
  if (!u) return;
  const st = await botState(u.id);
  const text = pick(POST_TEXTS);
  const img = st.petId ? pick(POST_IMAGES_OF_PET) : '';
  await run('INSERT INTO posts (user_id, text, image, pet_id, visibility) VALUES (?,?,?,?,?)',
    [u.id, text, img, st.petId, 'public']);
}

const POST_IMAGES_OF_PET = [
  'https://images.unsplash.com/photo-1558788353-f76d92427f16?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1537151608828-ea2b11777ee8?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=600&q=80'
];

async function botLikeBotLikes(){
  // bots like a random sample of recent real/other posts
  const recent = await all('SELECT id, user_id FROM posts ORDER BY id DESC LIMIT 20');
  for (const p of recent) {
    const bots = await all('SELECT id FROM users WHERE email IN (?,?,?,?)', BOTS.map(b => b.email));
    for (const b of bots.slice(0, 2)) {
      if (b.id === p.user_id) continue;
      const exists = await get('SELECT 1 FROM post_likes WHERE user_id = ? AND post_id = ?', [b.id, p.id]);
      if (!exists) {
        await run('INSERT OR IGNORE INTO post_likes (user_id, post_id) VALUES (?,?)', [b.id, p.id]);
        await run('UPDATE posts SET likes = likes + 1 WHERE id = ?', [p.id]);
        break;
      }
    }
  }
}

async function botComments(){
  const recent = await all('SELECT id, user_id FROM posts ORDER BY id DESC LIMIT 15');
  for (const p of recent) {
    const bot = pick(BOTS);
    const bu = await get('SELECT id FROM users WHERE email = ?', [bot.email]);
    if (!bu || bu.id === p.user_id) continue;
    if (Math.random() > 0.4) continue;
    await run('INSERT INTO comments (post_id, user_id, text) VALUES (?,?,?)', [p.id, bu.id, pick(COMMENT_TEXTS)]);
    await run('UPDATE posts SET comments_count = comments_count + 1 WHERE id = ?', [p.id]);
    break;
  }
}

async function runActivity(){
  try {
    const action = randInt(1, 10);
    const bot = pick(BOTS);
    if (action <= 3) {
      await botPost(bot);
    } else if (action <= 6) {
      await botLikeBotLikes();
    } else if (action <= 9) {
      await botComments();
    } else {
      await botPost(bot);
      await botComments();
    }
  } catch (e) {
    console.error('Bot activity error:', e.message);
  }
}

let timer = null;

async function seedInitialBots(){
  try {
    // ensure a pool of posts so the feed feels alive from the start
    const botCount = await get('SELECT COUNT(*) as c FROM users WHERE email LIKE ?', ['bot.%@zunnu.app']);
    if (botCount && botCount.c >= 4) {
      const humans = await get('SELECT COUNT(*) as c FROM users WHERE email NOT LIKE ?', ['bot.%@zunnu.app']);
      const humanPosts = await get('SELECT COUNT(*) as c FROM posts');
      if (humanPosts.c < 8) {
        for (const b of BOTS.slice(0, 3)) await botPost(b);
      }
      // a few likes/comments to warm the feed
      await botLikeBotLikes();
      await botComments();
    }
  } catch (e) {
    console.error('Seed bots error:', e.message);
  }
}

async function configureBots(){
  if (seeded) return;
  seeded = true;
  await ensureBots();
  await seedInitialBots();
  if (timer) clearInterval(timer);
  timer = setInterval(runActivity, 120 * 1000);
  if (timer.unref) timer.unref();
}

module.exports = { configureBots, runActivity, ensureBots, BOTS };
