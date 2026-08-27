const { initDB, run } = require('./db');
const bcrypt = require('bcryptjs');

async function seed() {
  await initDB();
  const hash = bcrypt.hashSync('123456', 10);

  const users = [
    ['Rodrigo', 'usuario@patai.com', hash, 'Pai do Bilu e da Mel', 'Centro', 'free', -2.5307, -44.2829],
    ['Mariana Costa', 'mariana@patai.com', hash, 'Tutora apaixonada pelo Thor', 'Centro', 'plus', -2.5290, -44.2780],
    ['PetCare VIP', 'petcare@patai.com', hash, 'Loja oficial de acessorios pet', 'Sao Luis', 'pro', -2.5350, -44.2900],
    ['Larissa', 'larissa@patai.com', hash, 'Mae da Amora', 'Centro', 'free', -2.5320, -44.2850],
    ['Marcos', 'marcos@patai.com', hash, 'Tutor do Apollo', 'Bairro Alto', 'plus', -2.5260, -44.2700]
  ];

  for (const u of users) {
    await run('INSERT OR IGNORE INTO users (name, email, password_hash, bio, location, plan, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', u);
  }

  const pets = [
    [1, 'Bilu', 'Cachorro', 'SRD', '3 anos', 'Centro', 1, 'Aries', 'https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?auto=format&fit=crop&w=400&q=80', -2.5307, -44.2829],
    [1, 'Mel', 'Gata', 'Siames Mestico', '2 anos', 'Bairro Alto', 1, 'Leao', 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?auto=format&fit=crop&w=400&q=80', -2.5295, -44.2810],
    [2, 'Thor', 'Cachorro', 'Pastor Alemao', '4 anos', 'Centro', 1, 'Escorpiao', 'https://images.unsplash.com/photo-1558788353-f76d92427f16?auto=format&fit=crop&w=400&q=80', -2.5290, -44.2780],
    [4, 'Amora', 'Cachorro', 'Labrador', '2 anos', 'Centro', 1, 'Leao', 'https://images.unsplash.com/photo-1537151608828-ea2b11777ee8?auto=format&fit=crop&w=400&q=80', -2.5320, -44.2850],
    [5, 'Apollo', 'Cachorro', 'Golden Retriever', '3 anos', 'Bairro Alto', 1, 'Aries', 'https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=400&q=80', -2.5260, -44.2700]
  ];

  for (const p of pets) {
    await run('INSERT OR IGNORE INTO pets (user_id, name, species, breed, age, location, is_castrated, zodiac, image, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', p);
  }

  const vaccines = [
    [1, 'Antirrabica', '02/09/2026', 'Em dia'],
    [1, 'V10', '15/11/2026', 'Agendada'],
    [2, 'V4 Felina', '15/09/2026', 'Em dia'],
    [3, 'Antirrabica', '01/10/2026', 'Em dia'],
    [3, 'V10', '20/12/2026', 'Agendada']
  ];

  for (const v of vaccines) {
    await run('INSERT OR IGNORE INTO vaccines (pet_id, name, date, status) VALUES (?, ?, ?, ?)', v);
  }

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

  for (const r of reels) {
    await run('INSERT OR IGNORE INTO reels (user_id, video_url, caption, music) VALUES (?, ?, ?, ?)', r);
  }

  console.log('Seed concluido!');
  console.log('- 5 usuarios (senha: 123456)');
  console.log('- 5 pets');
  console.log('- 5 vacinas');
  console.log('- 2 posts');
  console.log('- 2 produtos');
  console.log('- 3 servicos');
  console.log('- 5 reels (videos de demonstracao)');
}

seed().catch(console.error);
