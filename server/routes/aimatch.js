const express = require('express');
const { run, get, all } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

function calculateMatchScore(pet1, pet2) {
  let score = 0;
  let reasons = [];

  if (pet1.species === pet2.species) {
    score += 30;
    reasons.push('Mesma especie');
  }

  if (pet1.breed === pet2.breed) {
    score += 15;
    reasons.push('Mesma raca');
  }

  if (pet1.location === pet2.location) {
    score += 20;
    reasons.push('Mesma regiao');
  }

  const age1 = parseInt(pet1.age) || 0;
  const age2 = parseInt(pet2.age) || 0;
  if (age1 && age2) {
    const diff = Math.abs(age1 - age2);
    if (diff <= 1) { score += 15; reasons.push('Idades parecidas'); }
    else if (diff <= 2) { score += 8; }
  }

  if (pet1.zodiac && pet2.zodiac) {
    const compat = {
      'Aries': ['Leao', 'Sagitario', 'Aquario'],
      'Touro': ['Virgem', 'Capricornio', 'Cancer'],
      'Gemeos': ['Libra', 'Aquario', 'Leao'],
      'Cancer': ['Peixes', 'Escorpiao', 'Touro'],
      'Leao': ['Aries', 'Sagitario', 'Gemeos'],
      'Virgem': ['Touro', 'Capricornio', 'Cancer'],
      'Libra': ['Gemeos', 'Aquario', 'Leao'],
      'Escorpiao': ['Cancer', 'Peixes', 'Capricornio'],
      'Sagitario': ['Aries', 'Leao', 'Libra'],
      'Capricornio': ['Touro', 'Virgem', 'Escorpiao'],
      'Aquario': ['Gemeos', 'Libra', 'Sagitario'],
      'Peixes': ['Cancer', 'Escorpiao', 'Touro']
    };
    if (compat[pet1.zodiac]?.includes(pet2.zodiac)) {
      score += 15;
      reasons.push('Signos compatíveis');
    } else if (pet1.zodiac === pet2.zodiac) {
      score += 10;
      reasons.push('Mesmo signo');
    }
  }

  if (pet1.is_castrated === pet2.is_castrated && pet1.is_castrated) {
    score += 5;
    reasons.push('Ambos castrados');
  }

  score = Math.min(score, 100);

  return { score, reasons: reasons.join(', ') || 'Perfil complementar' };
}

router.get('/suggestions', authMiddleware, (req, res) => {
  try {
    const myPets = all('SELECT * FROM pets WHERE user_id = ?', [req.userId]);
    if (myPets.length === 0) return res.json([]);

    const otherPets = all(`
      SELECT p.*, u.name as owner_name, u.avatar as owner_avatar
      FROM pets p JOIN users u ON p.user_id = u.id
      WHERE p.user_id != ?
      ORDER BY RANDOM() LIMIT 20
    `, [req.userId]);

    const suggestions = [];
    for (const myPet of myPets) {
      for (const otherPet of otherPets) {
        if (otherPet.user_id === req.userId) continue;
        const existing = get('SELECT * FROM pet_ai_match WHERE pet1_id = ? AND pet2_id = ?',
          [myPet.id, otherPet.id]);
        if (existing) continue;

        const { score, reasons } = calculateMatchScore(myPet, otherPet);
        if (score >= 30) {
          suggestions.push({
            my_pet: { id: myPet.id, name: myPet.name, image: myPet.image },
            match_pet: otherPet,
            score,
            reasons
          });
        }
      }
    }

    suggestions.sort((a, b) => b.score - a.score);

    res.json(suggestions.slice(0, 10));
  } catch (err) {
    console.error('AI match error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/accept', authMiddleware, (req, res) => {
  try {
    const { pet1_id, pet2_id } = req.body;
    run('INSERT INTO pet_ai_match (pet1_id, pet2_id, score) VALUES (?, ?, ?)',
      [pet1_id, pet2_id, req.body.score || 0]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
