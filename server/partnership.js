const { run, get, all } = require('./db');

function todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function yyyymmdd(str) {
  if (!str) return null;
  const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m.slice(1).join('-') : null;
}

const INTIMACY = {
  message: 3,
  post_tag: 5,
  event_together: 10
};

async function bumpIntimacy(matchId, points, day) {
  if (!matchId) return;
  const match = await get('SELECT * FROM matches WHERE id = ?', [matchId]);
  if (!match) return;
  const d = day || todayStr();
  await run('INSERT INTO match_interaction_days (match_id, day) VALUES (?, ?) ON CONFLICT(match_id, day) DO NOTHING', [matchId, d]);
  await run('UPDATE matches SET intimacy = COALESCE(intimacy, 0) + ?, last_interaction_date = ? WHERE id = ?', [points, d, matchId]);
}

async function bumpIntimacyByMatchId(matchId, points) {
  await bumpIntimacy(matchId, points);
}

function daysBetween(aStr, bStr) {
  const a = new Date(aStr + 'T00:00:00Z').getTime();
  const b = new Date(bStr + 'T00:00:00Z').getTime();
  return Math.max(0, Math.round((b - a) / 86400000));
}

async function getMatchStats(matchId) {
  const match = await get('SELECT * FROM matches WHERE id = ?', [matchId]);
  if (!match) return null;
  const rows = await all('SELECT day FROM match_interaction_days WHERE match_id = ? ORDER BY day DESC', [matchId]);
  const daysSet = new Set(rows.map(r => yyyymmdd(r.day)).filter(Boolean));
  const today = todayStr();
  let streak = 0;
  let cursor = daysSet.has(today) ? today : String(new Date(Date.now() - 86400000).toISOString().slice(0, 10));
  while (daysSet.has(cursor)) {
    streak++;
    const prev = new Date(cursor + 'T00:00:00Z');
    prev.setUTCDate(prev.getUTCDate() - 1);
    cursor = prev.toISOString().slice(0, 10);
  }
  const juntosDias = daysBetween(yyyymmdd(match.created_at), today);
  return {
    matchId: match.id,
    juntos_dias: juntosDias,
    intimidade: match.intimacy || 0,
    streak,
    last_interaction_date: match.last_interaction_date || null
  };
}

async function getMatchBetweenUsers(userIdA, userIdB) {
  return get('SELECT * FROM matches WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)',
    [userIdA, userIdB, userIdB, userIdA]);
}

async function getPartnersForUser(userId) {
  const matches = await all(`SELECT * FROM matches WHERE user1_id = ? OR user2_id = ? ORDER BY id DESC`, [userId, userId]);
  return matches;
}

module.exports = { bumpIntimacy, bumpIntimacyByMatchId, getMatchStats, getMatchBetweenUsers, getPartnersForUser, INTIMACY, todayStr };