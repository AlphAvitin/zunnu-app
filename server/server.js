const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const { initDB, get, run } = require('./db');
const { setupWebSocket } = require('./ws');

const app = express();
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', async (req, res) => {
  try {
    const userCount = await get('SELECT COUNT(*) as c FROM users');
    res.json({ status: 'ok', version: '2.0.0', users: userCount?.c || 0, uptime: process.uptime() });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.use(express.static(path.join(__dirname, '..', 'www')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/posts', require('./routes/posts'));
app.use('/api/reels', require('./routes/reels'));
app.use('/api/pets', require('./routes/pets'));
app.use('/api/search', require('./routes/search'));
app.use('/api/places', require('./routes/places'));
app.use('/api/adoption', require('./routes/adoption'));
app.use('/api/products', require('./routes/products'));
app.use('/api/services', require('./routes/services'));
app.use('/api/match', require('./routes/match'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/events', require('./routes/events'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/stories', require('./routes/stories'));
app.use('/api/nearby', require('./routes/nearby'));
app.use('/api/social', require('./routes/social'));
app.use('/api/petgallery', require('./routes/petgallery'));
app.use('/api/aimatch', require('./routes/aimatch'));
app.use('/api/cart', require('./routes/cart'));
app.use('/api/groups', require('./routes/groups'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/lostpets', require('./routes/lostpets'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/business', require('./routes/business'));
app.use('/api/points', require('./routes/points'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/favorites', require('./routes/favorites'));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'www', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

async function start() {
  await initDB();
  const userCount = await get('SELECT COUNT(*) as c FROM users');
  if (userCount && userCount.c === 0) {
    console.log('Empty database, seeding...');
    const { run } = require('./db');
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync('123456', 10);
    const users = [
      ['Rodrigo', 'usuario@patai.com', hash, 'Pai do Bilu e da Mel', 'Centro', 'free', -2.5307, -44.2829],
      ['Mariana Costa', 'mariana@patai.com', hash, 'Tutora apaixonada pelo Thor', 'Centro', 'plus', -2.5290, -44.2780],
      ['PetCare VIP', 'petcare@patai.com', hash, 'Loja oficial de acessorios pet', 'Sao Luis', 'pro', -2.5350, -44.2900],
      ['Larissa', 'larissa@patai.com', hash, 'Mae da Amora', 'Centro', 'free', -2.5320, -44.2850],
      ['Marcos', 'marcos@patai.com', hash, 'Tutor do Apollo', 'Bairro Alto', 'plus', -2.5260, -44.2700]
    ];
    for (const u of users) await run('INSERT OR IGNORE INTO users (name, email, password_hash, bio, location, plan, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', u);
    const pets = [
      [1, 'Bilu', 'Cachorro', 'SRD', '3 anos', 'Centro', 1, 'Aries', 'https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?auto=format&fit=crop&w=400&q=80', -2.5307, -44.2829],
      [1, 'Mel', 'Gata', 'Siames Mestico', '2 anos', 'Bairro Alto', 1, 'Leao', 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?auto=format&fit=crop&w=400&q=80', -2.5295, -44.2810],
      [2, 'Thor', 'Cachorro', 'Pastor Alemao', '4 anos', 'Centro', 1, 'Escorpiao', 'https://images.unsplash.com/photo-1558788353-f76d92427f16?auto=format&fit=crop&w=400&q=80', -2.5290, -44.2780],
      [4, 'Amora', 'Cachorro', 'Labrador', '2 anos', 'Centro', 1, 'Leao', 'https://images.unsplash.com/photo-1537151608828-ea2b11777ee8?auto=format&fit=crop&w=400&q=80', -2.5320, -44.2850],
      [5, 'Apollo', 'Cachorro', 'Golden Retriever', '3 anos', 'Bairro Alto', 1, 'Aries', 'https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=400&q=80', -2.5260, -44.2700]
    ];
    for (const p of pets) await run('INSERT OR IGNORE INTO pets (user_id, name, species, breed, age, location, is_castrated, zodiac, image, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', p);
    const vaccines = [
      [1, 'Antirrabica', '02/09/2026', 'Em dia'], [1, 'V10', '15/11/2026', 'Agendada'],
      [2, 'V4 Felina', '15/09/2026', 'Em dia'], [3, 'Antirrabica', '01/10/2026', 'Em dia'],
      [3, 'V10', '20/12/2026', 'Agendada']
    ];
    for (const v of vaccines) await run('INSERT OR IGNORE INTO vaccines (pet_id, name, date, status) VALUES (?, ?, ?, ?)', v);
    await run('INSERT OR IGNORE INTO posts (user_id, text, image, likes, comments_count) VALUES (?, ?, ?, ?, ?)',
      [2, 'Passeio matinal do Thor depois do reforco vacinal!', 'https://images.unsplash.com/photo-1558788353-f76d92427f16?auto=format&fit=crop&w=600&q=80', 128, 14]);
    await run('INSERT OR IGNORE INTO posts (user_id, text, image, likes, comments_count) VALUES (?, ?, ?, ?, ?)',
      [3, 'Promocao de coleiras impermeaveis e guias na Loja ZUNNU!', 'https://images.unsplash.com/photo-1601758228041-f3b2795255f1?auto=format&fit=crop&w=600&q=80', 45, 3]);
    await run('INSERT OR IGNORE INTO products (seller_id, title, price, image) VALUES (?, ?, ?, ?)',
      [3, 'Coleira Confort Ajustavel', 49.90, 'https://images.unsplash.com/photo-1601758228041-f3b2795255f1?auto=format&fit=crop&w=400&q=80']);
    await run('INSERT OR IGNORE INTO products (seller_id, title, price, image) VALUES (?, ?, ?, ?)',
      [1, 'Cama Pet Ortopedica G', 139.00, 'https://images.unsplash.com/photo-1541599540903-216a46ca1dc0?auto=format&fit=crop&w=400&q=80']);
    await run('INSERT OR IGNORE INTO services (provider_id, title, price, duration, icon) VALUES (?, ?, ?, ?, ?)',
      [3, 'Banho & Tosa Higienica', 75.00, '1h 30m', 'B']);
    await run('INSERT OR IGNORE INTO services (provider_id, title, price, duration, icon) VALUES (?, ?, ?, ?, ?)',
      [3, 'Passeio Educativo', 35.00, '50 min', 'P']);
    await run('INSERT OR IGNORE INTO services (provider_id, title, price, duration, icon) VALUES (?, ?, ?, ?, ?)',
      [3, 'Consulta Veterinaria', 150.00, '1h', 'V']);
    const reels = [
      [1, 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4', 'O Bilu aprendendo a sentar!', 'Sertanejo Ao Vivo'],
      [2, 'https://test-videos.co.uk/vids/jellyfish/mp4/h264/720/Jellyfish_720_10s_1MB.mp4', 'Thor fazendoIncremento de 5km', 'Piseira Mix'],
      [4, 'https://test-videos.co.uk/vids/sintel/mp4/h264/720/Sintel_720_10s_1MB.mp4', 'Amora no parque!', 'MPB Classica'],
      [5, 'https://test-videos.co.uk/vids/subaru_outback_on_mountain/mp4/h264/720/Subaru_Outback_720_10s_1MB.mp4', 'Apollo correndo na praia', 'Eletro Pop'],
      [2, 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4', 'Thor no banho kkk', 'Forro Eletronico']
    ];
    for (const r of reels) await run('INSERT OR IGNORE INTO reels (user_id, video_url, caption, music) VALUES (?, ?, ?, ?)', r);
    console.log('Seed completed: 5 users, 5 pets, 5 reels');
  } else {
    console.log(`Database has ${userCount.c} users, skipping seed.`);
  }
  const places = [
    ['PetCare VIP Pet Shop', 'Pet Shop', 'Pet Shop', 'Sao Luis', 'Loja oficial de acessorios pet', '(98) 3333-0001', 'Av. dos Holandeses, 1200 - Sao Luis/MA', 'Seg a Sab, 8h-19h', 1, 1, -2.5350, -44.2900, 'https://images.unsplash.com/photo-1601758228041-f3b2795255f1?auto=format&fit=crop&w=600&q=80', 'https://instagram.com/zunnu', 3],
    ['Cafe & Pets Centro', 'Lazer', 'Lazer', 'Centro', 'Cafe pet friendly com area cercada para pets', '(98) 3333-0002', 'Rua Grande, 980 - Centro, Sao Luis/MA', 'Seg a Dom, 10h-22h', 0, 1, -2.5290, -44.2780, 'https://images.unsplash.com/photo-1541599540903-216a46ca1dc0?auto=format&fit=crop&w=600&q=80', '', 2],
    ['Parque Centro', 'Parque', 'Parque', 'Centro', 'Area verde para passeios e brincadeiras com pets', '', 'Av. Beira Mar - Sao Luis/MA', 'Todos os dias, 5h-23h', 0, 1, -2.5307, -44.2829, 'https://images.unsplash.com/photo-1533796582758-4c0fc8780abf?auto=format&fit=crop&w=600&q=80', '', null],
    ['VetCenter Patinhas', 'Veterinaria', 'Veterinaria', 'Bairro Alto', 'Clinica veterinaria com emergencia 24h', '(98) 3333-0003', 'Av. dos Franceses, 520 - Bairro Alto, Sao Luis/MA', '24 horas', 1, 0, -2.5260, -44.2700, 'https://images.unsplash.com/photo-1548767797-d8c844163c4c?auto=format&fit=crop&w=600&q=80', '', null],
    ['Bairro Alto Praca', 'Praca', 'Praca', 'Bairro Alto', 'Praca com espaco livre para encontros de pets', '', 'Praca do Bairro Alto - Sao Luis/MA', 'Todos os dias', 0, 1, -2.5260, -44.2710, 'https://images.unsplash.com/photo-1517971129774-8a2b38fa128e?auto=format&fit=crop&w=600&q=80', '', null]
  ];
  for (const p of places) {
    await run(`INSERT INTO business_profiles (business_name, business_type, category, city, description, phone, address, hours, verified, pet_friendly, latitude, longitude, image, links, user_id)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM business_profiles WHERE business_name = ?)`, [...p, p[0]]);
  }
  await run(`INSERT INTO place_reviews (place_id, user_id, rating, comment)
    SELECT (SELECT id FROM business_profiles WHERE business_name = 'PetCare VIP Pet Shop'), 1, 5, 'Ambiente pet friendly e atendimento excelente. Meu Bilu adorou!'
    WHERE NOT EXISTS (SELECT 1 FROM place_reviews WHERE place_id = (SELECT id FROM business_profiles WHERE business_name = 'PetCare VIP Pet Shop') AND user_id = 1)`);
  await run(`INSERT INTO place_reviews (place_id, user_id, rating, comment)
    SELECT (SELECT id FROM business_profiles WHERE business_name = 'Parque Centro'), 4, 5, 'O lugar perfeito para passear com a Amora.'
    WHERE NOT EXISTS (SELECT 1 FROM place_reviews WHERE place_id = (SELECT id FROM business_profiles WHERE business_name = 'Parque Centro') AND user_id = 4)`);
  console.log('Places seeded:', places.length);
  setupWebSocket(server);
  server.listen(PORT, () => {
    console.log(`ZUNNU server running on port ${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
