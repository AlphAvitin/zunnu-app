const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const { get } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'zunnu_secret_key_2026_mudar_em_producao';

const clients = new Map();

function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(4001, 'Token required');
      return;
    }

    let userId;
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      userId = decoded.userId;
    } catch (e) {
      ws.close(4001, 'Invalid token');
      return;
    }

    ws.userId = userId;
    ws.isAlive = true;

    if (!clients.has(userId)) {
      clients.set(userId, new Set());
    }
    clients.get(userId).add(ws);

    console.log(`[WS] User ${userId} connected (${clients.get(userId).size} sockets)`);

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        handleMessage(ws, userId, msg);
      } catch (e) {
        console.error('[WS] Invalid message:', e.message);
      }
    });

    ws.on('close', () => {
      const userSockets = clients.get(userId);
      if (userSockets) {
        userSockets.delete(ws);
        if (userSockets.size === 0) clients.delete(userId);
      }
      console.log(`[WS] User ${userId} disconnected`);
    });

    ws.send(JSON.stringify({ type: 'connected', userId }));
  });

  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}

function handleMessage(ws, userId, msg) {
  switch (msg.type) {
    case 'chat_message':
      if (msg.matchId && msg.text) {
        broadcastToMatch(msg.matchId, {
          type: 'chat_message',
          matchId: msg.matchId,
          senderId: userId,
          text: msg.text,
          timestamp: new Date().toISOString()
        }, userId);
      }
      break;
    case 'typing':
      if (msg.matchId) {
        broadcastToMatch(msg.matchId, {
          type: 'typing',
          matchId: msg.matchId,
          userId
        }, userId);
      }
      break;
    case 'read':
      if (msg.matchId) {
        broadcastToMatch(msg.matchId, {
          type: 'read',
          matchId: msg.matchId,
          userId
        }, userId);
      }
      break;
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }));
      break;
  }
}

async function broadcastToMatch(matchId, data, excludeUserId) {
  const match = await get('SELECT user1_id, user2_id FROM matches WHERE id = ?', [matchId]);
  if (!match) return;

  const ids = [match.user1_id, match.user2_id].filter(id => id !== excludeUserId);
  ids.forEach(id => sendToUser(id, data));
}

function sendToUser(userId, data) {
  const sockets = clients.get(userId);
  if (!sockets) return;
  const payload = JSON.stringify(data);
  sockets.forEach(ws => {
    if (ws.readyState === 1) {
      ws.send(payload);
    }
  });
}

function broadcast(data, excludeUserId) {
  const payload = JSON.stringify(data);
  clients.forEach((sockets, userId) => {
    if (userId === excludeUserId) return;
    sockets.forEach(ws => {
      if (ws.readyState === 1) {
        ws.send(payload);
      }
    });
  });
}

function isOnline(userId) {
  return clients.has(userId) && clients.get(userId).size > 0;
}

function getOnlineCount() {
  return clients.size;
}

module.exports = { setupWebSocket, sendToUser, broadcast, isOnline, getOnlineCount };
