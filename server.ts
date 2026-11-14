import express from 'express';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getLanIpv4Addresses(): string[] {
  const nets = os.networkInterfaces();
  const ips: string[] = [];
  for (const name of Object.keys(nets)) {
    const entries = nets[name];
    if (!entries) continue;
    for (const net of entries) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}

interface ServerPlayer {
  id: string;
  name: string;
  color: string;
  screenMode: string;
  lat: number;
  lng: number;
  activeMissionId: string | null;
  arenaX: number;
  arenaZ: number;
  vehicleId: string | null;
  ecoPoints: number;
}

interface MissionSessionState {
  completedNodeIds: Set<string>;
  bunkerFound: boolean;
  labDiscovered: boolean;
}

interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  color: string;
  text: string;
  timestamp: number;
}

interface RoomState {
  id: string;
  players: Map<string, { player: ServerPlayer; ws: WebSocket }>;
  completedMissionIds: Set<string>;
  missionSessions: Map<string, MissionSessionState>;
  chatHistory: ChatMessage[];
  cleanupTimer: NodeJS.Timeout | null;
}

const PLAYER_COLORS = [
  '#22d3ee', // cyan
  '#34d399', // emerald
  '#fbbf24', // amber
  '#f472b6', // pink
  '#a78bfa', // violet
  '#60a5fa', // sky
  '#fb7185', // rose
  '#4ade80', // green
];

const rooms = new Map<string, RoomState>();

function sanitizeRoomId(raw: unknown): string {
  const cleaned = String(raw ?? 'EARTH-ALPHA')
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 18);
  return cleaned || 'EARTH-ALPHA';
}

function sanitizeName(raw: unknown): string {
  const cleaned = String(raw ?? 'Commander').trim().slice(0, 24);
  return cleaned || 'Commander';
}

function getOrCreateRoom(roomId: string): RoomState {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      id: roomId,
      players: new Map(),
      completedMissionIds: new Set(),
      missionSessions: new Map(),
      chatHistory: [],
      cleanupTimer: null,
    };
    rooms.set(roomId, room);
  }
  if (room.cleanupTimer) {
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = null;
  }
  return room;
}

function getOrCreateMissionSession(room: RoomState, missionId: string): MissionSessionState {
  let session = room.missionSessions.get(missionId);
  if (!session) {
    session = {
      completedNodeIds: new Set(),
      bunkerFound: false,
      labDiscovered: false,
    };
    room.missionSessions.set(missionId, session);
  }
  return session;
}

function broadcast(room: RoomState, payload: unknown, excludePlayerId?: string) {
  const raw = JSON.stringify(payload);
  room.players.forEach(({ ws }, pid) => {
    if (pid === excludePlayerId) return;
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(raw);
    }
  });
}

function serializePlayers(room: RoomState): ServerPlayer[] {
  return Array.from(room.players.values()).map((entry) => entry.player);
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      activeRooms: rooms.size,
      totalPlayers: Array.from(rooms.values()).reduce((sum, r) => sum + r.players.size, 0),
    });
  });

  app.get('/api/server-info', (req, res) => {
    const port = Number(process.env.PORT ?? 3000);
    const forwardedHost = String(req.get('x-forwarded-host') ?? req.get('host') ?? `localhost:${port}`);
    const forwardedProto = String(req.get('x-forwarded-proto') ?? req.protocol ?? 'http').split(',')[0].trim();
    const lanIps = getLanIpv4Addresses();
    const lanAddresses = lanIps.map((ip) => `${ip}:${port}`);
    const primaryServerIp = lanAddresses[0] ?? forwardedHost;
    res.json({
      port,
      hostAddress: forwardedHost,
      joinUrl: `${forwardedProto}://${forwardedHost}`,
      primaryServerIp,
      lanAddresses,
      wsPath: '/ws',
      activeRooms: Array.from(rooms.values()).map((r) => ({
        id: r.id,
        playerCount: r.players.size,
      })),
    });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  let nextIdCounter = 1;

  wss.on('connection', (ws) => {
    const playerId = `cmd-${Date.now().toString(36)}-${(nextIdCounter++).toString(36)}`;
    let currentRoomId: string | null = null;

    const leaveCurrentRoom = () => {
      if (!currentRoomId) return;
      const room = rooms.get(currentRoomId);
      if (room && room.players.has(playerId)) {
        const leaving = room.players.get(playerId)?.player;
        room.players.delete(playerId);
        broadcast(room, { type: 'player:left', playerId });
        if (leaving) {
          const sysMsg: ChatMessage = {
            id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            playerId: 'system',
            playerName: 'Orbital Relay',
            color: '#94a3b8',
            text: `${leaving.name} disconnected from ${room.id}.`,
            timestamp: Date.now(),
          };
          room.chatHistory = [...room.chatHistory.slice(-49), sysMsg];
          broadcast(room, { type: 'chat:message', message: sysMsg });
        }
        if (room.players.size === 0) {
          room.cleanupTimer = setTimeout(() => {
            if (room.players.size === 0) {
              rooms.delete(room.id);
            }
          }, 120_000);
        }
      }
      currentRoomId = null;
    };

    ws.on('message', (data) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(data)) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = String(msg.type ?? '');

      if (type === 'room:join') {
        const targetRoomId = sanitizeRoomId(msg.roomId);
        if (currentRoomId && currentRoomId !== targetRoomId) {
          leaveCurrentRoom();
        }
        const room = getOrCreateRoom(targetRoomId);
        currentRoomId = targetRoomId;

        const colorIdx = Math.abs(nextIdCounter + room.players.size) % PLAYER_COLORS.length;
        const player: ServerPlayer = {
          id: playerId,
          name: sanitizeName(msg.playerName),
          color: PLAYER_COLORS[colorIdx],
          screenMode: String(msg.screenMode ?? 'world-map'),
          lat: Number.isFinite(Number(msg.lat)) ? Number(msg.lat) : 20,
          lng: Number.isFinite(Number(msg.lng)) ? Number(msg.lng) : 0,
          activeMissionId: msg.activeMissionId ? String(msg.activeMissionId) : null,
          arenaX: Number.isFinite(Number(msg.arenaX)) ? Number(msg.arenaX) : -20,
          arenaZ: Number.isFinite(Number(msg.arenaZ)) ? Number(msg.arenaZ) : 6,
          vehicleId: msg.vehicleId ? String(msg.vehicleId) : null,
          ecoPoints: Number.isFinite(Number(msg.ecoPoints)) ? Number(msg.ecoPoints) : 0,
        };

        // Merge any missions the joining player already completed into the room if room is fresh
        if (Array.isArray(msg.completedMissionIds)) {
          msg.completedMissionIds.forEach((mid) => {
            if (typeof mid === 'string' && mid.length < 64) {
              room.completedMissionIds.add(mid);
            }
          });
        }

        const isAlreadyInRoom = room.players.has(playerId);
        room.players.set(playerId, { player, ws });

        const activeMissionSession = player.activeMissionId
          ? getOrCreateMissionSession(room, player.activeMissionId)
          : null;

        ws.send(
          JSON.stringify({
            type: 'room:init',
            selfId: playerId,
            roomId: room.id,
            players: serializePlayers(room),
            completedMissionIds: Array.from(room.completedMissionIds),
            missionSession: activeMissionSession
              ? {
                  missionId: player.activeMissionId,
                  completedNodeIds: Array.from(activeMissionSession.completedNodeIds),
                  bunkerFound: activeMissionSession.bunkerFound,
                  labDiscovered: activeMissionSession.labDiscovered,
                }
              : null,
            chatHistory: room.chatHistory,
          })
        );

        if (!isAlreadyInRoom) {
          broadcast(room, { type: 'player:joined', player }, playerId);
          const sysMsg: ChatMessage = {
            id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            playerId: 'system',
            playerName: 'Orbital Relay',
            color: '#94a3b8',
            text: `${player.name} joined squad room ${room.id}.`,
            timestamp: Date.now(),
          };
          room.chatHistory = [...room.chatHistory.slice(-49), sysMsg];
          broadcast(room, { type: 'chat:message', message: sysMsg });
        }
        return;
      }

      if (!currentRoomId) return;
      const room = rooms.get(currentRoomId);
      if (!room) return;
      const entry = room.players.get(playerId);
      if (!entry) return;

      if (type === 'player:update') {
        const p = entry.player;
        const prevMission = p.activeMissionId;

        if (typeof msg.name === 'string') p.name = sanitizeName(msg.name);
        if (typeof msg.screenMode === 'string') p.screenMode = msg.screenMode;
        if (typeof msg.lat === 'number' && Number.isFinite(msg.lat)) p.lat = msg.lat;
        if (typeof msg.lng === 'number' && Number.isFinite(msg.lng)) p.lng = msg.lng;
        if (msg.activeMissionId === null || typeof msg.activeMissionId === 'string') {
          p.activeMissionId = msg.activeMissionId;
        }
        if (typeof msg.arenaX === 'number' && Number.isFinite(msg.arenaX)) p.arenaX = msg.arenaX;
        if (typeof msg.arenaZ === 'number' && Number.isFinite(msg.arenaZ)) p.arenaZ = msg.arenaZ;
        if (msg.vehicleId === null || typeof msg.vehicleId === 'string') {
          p.vehicleId = msg.vehicleId;
        }
        if (typeof msg.ecoPoints === 'number' && Number.isFinite(msg.ecoPoints)) {
          p.ecoPoints = msg.ecoPoints;
        }

        // If player just entered a mission, send them the authoritative mission node state
        if (p.activeMissionId && p.activeMissionId !== prevMission) {
          const session = getOrCreateMissionSession(room, p.activeMissionId);
          ws.send(
            JSON.stringify({
              type: 'arena:sync',
              missionId: p.activeMissionId,
              completedNodeIds: Array.from(session.completedNodeIds),
              bunkerFound: session.bunkerFound,
              labDiscovered: session.labDiscovered,
            })
          );
        }

        broadcast(room, { type: 'player:updated', player: p }, playerId);
        return;
      }

      if (type === 'arena:node_action') {
        const missionId = String(msg.missionId ?? '');
        const nodeId = String(msg.nodeId ?? '');
        const kind = String(msg.kind ?? '');
        if (!missionId || !nodeId) return;

        const session = getOrCreateMissionSession(room, missionId);
        if (session.completedNodeIds.has(nodeId)) {
          return; // Idempotent guard against duplicate pickup/restoration
        }
        session.completedNodeIds.add(nodeId);

        broadcast(room, {
          type: 'arena:node_updated',
          missionId,
          nodeId,
          kind,
          byPlayerId: playerId,
          byPlayerName: entry.player.name,
        });
        return;
      }

      if (type === 'arena:discovery') {
        const missionId = String(msg.missionId ?? '');
        const kind = msg.kind === 'bunker' ? 'bunker' : msg.kind === 'lab' ? 'lab' : null;
        if (!missionId || !kind) return;

        const session = getOrCreateMissionSession(room, missionId);
        if (kind === 'bunker' && session.bunkerFound) return;
        if (kind === 'lab' && session.labDiscovered) return;

        if (kind === 'bunker') session.bunkerFound = true;
        if (kind === 'lab') session.labDiscovered = true;

        broadcast(room, {
          type: 'arena:discovered',
          missionId,
          kind,
          byPlayerName: entry.player.name,
        });
        return;
      }

      if (type === 'arena:reset') {
        const missionId = String(msg.missionId ?? '');
        if (!missionId) return;
        const session = getOrCreateMissionSession(room, missionId);
        session.completedNodeIds.clear();
        session.bunkerFound = false;
        session.labDiscovered = false;
        broadcast(room, {
          type: 'arena:sync',
          missionId,
          completedNodeIds: [],
          bunkerFound: false,
          labDiscovered: false,
        });
        return;
      }

      if (type === 'mission:complete') {
        const missionId = String(msg.missionId ?? '');
        if (!missionId) return;
        room.completedMissionIds.add(missionId);
        room.missionSessions.delete(missionId);
        broadcast(room, {
          type: 'mission:completed',
          missionId,
          completedMissionIds: Array.from(room.completedMissionIds),
          byPlayerName: entry.player.name,
        });
        return;
      }

      if (type === 'ping:sector') {
        const missionId = String(msg.missionId ?? '');
        const lat = Number(msg.lat ?? 0);
        const lng = Number(msg.lng ?? 0);
        const title = String(msg.title ?? 'Sector').slice(0, 64);
        if (!missionId || !Number.isFinite(lat) || !Number.isFinite(lng)) return;

        broadcast(room, {
          type: 'ping:sector',
          id: `ping-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          missionId,
          lat,
          lng,
          title,
          byPlayerName: entry.player.name,
          color: entry.player.color,
          createdAt: Date.now(),
        });
        return;
      }

      if (type === 'chat:send') {
        const text = String(msg.text ?? '').trim().slice(0, 220);
        if (!text) return;
        const chatMsg: ChatMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          playerId,
          playerName: entry.player.name,
          color: entry.player.color,
          text,
          timestamp: Date.now(),
        };
        room.chatHistory = [...room.chatHistory.slice(-49), chatMsg];
        broadcast(room, { type: 'chat:message', message: chatMsg });
      }
    });

    ws.on('close', leaveCurrentRoom);
    ws.on('error', leaveCurrentRoom);
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT ?? 3000);
  server.listen(PORT, '0.0.0.0', () => {
    const lanIps = getLanIpv4Addresses();
    const lanDisplay = lanIps.length > 0 ? ` | LAN Server IP: ${lanIps[0]}:${PORT}` : '';
    console.log(`Project Eclipse multiplayer server listening on http://0.0.0.0:${PORT}${lanDisplay}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
