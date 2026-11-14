import {
  MissionCoopState,
  RemotePlayerState,
  SectorPingEvent,
  SquadChatMessage,
} from '../types/game';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface MultiplayerCallbacks {
  onStatusChange: (status: ConnectionStatus) => void;
  onRoomInit: (payload: {
    selfId: string;
    roomId: string;
    players: RemotePlayerState[];
    completedMissionIds: string[];
    missionSession: MissionCoopState | null;
    chatHistory: SquadChatMessage[];
  }) => void;
  onPlayersChange: (updater: (prev: RemotePlayerState[]) => RemotePlayerState[]) => void;
  onMissionCompleted: (completedMissionIds: string[], missionId: string, byPlayerName: string) => void;
  onArenaSync: (session: MissionCoopState) => void;
  onArenaNodeUpdated: (payload: {
    missionId: string;
    nodeId: string;
    kind: string;
    byPlayerId: string;
    byPlayerName: string;
  }) => void;
  onArenaDiscovered: (payload: {
    missionId: string;
    kind: 'bunker' | 'lab';
    byPlayerName: string;
  }) => void;
  onSectorPing: (ping: SectorPingEvent) => void;
  onChatMessage: (message: SquadChatMessage) => void;
}

export function normalizeServerWsUrl(serverAddress?: string): string {
  const fallbackProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const fallback = `${fallbackProto}//${window.location.host}/ws`;
  const trimmed = (serverAddress ?? '').trim();
  if (!trimmed || trimmed.toLowerCase() === 'host' || trimmed.toLowerCase() === 'local') {
    return fallback;
  }

  let raw = trimmed;
  if (raw.startsWith('http://')) {
    raw = 'ws://' + raw.slice(7);
  } else if (raw.startsWith('https://')) {
    raw = 'wss://' + raw.slice(8);
  } else if (!raw.startsWith('ws://') && !raw.startsWith('wss://')) {
    const isIpOrLocal = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/.*)?$/i.test(raw) || /^localhost(:\d+)?(\/.*)?$/i.test(raw);
    const proto = isIpOrLocal ? 'ws://' : `${fallbackProto}//`;
    raw = proto + raw;
  }

  try {
    const parsed = new URL(raw);
    const bareIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(parsed.hostname) || parsed.hostname === 'localhost';
    if (!parsed.port && bareIp && !trimmed.includes(':')) {
      parsed.port = '3000';
    }
    const cleanPath = parsed.pathname.replace(/\/+$/, '');
    parsed.pathname = cleanPath.endsWith('/ws') ? cleanPath : `${cleanPath}/ws`;
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return fallback;
  }
}

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private pendingQueue: string[] = [];
  private disposed = false;
  private lastJoinPayload: Record<string, unknown> | null = null;
  private activeWsUrl: string = normalizeServerWsUrl();
  private callbacks: MultiplayerCallbacks;

  constructor(callbacks: MultiplayerCallbacks) {
    this.callbacks = callbacks;
  }

  getActiveServerUrl(): string {
    return this.activeWsUrl;
  }

  connect(joinPayload: {
    roomId: string;
    playerName: string;
    screenMode: string;
    lat: number;
    lng: number;
    activeMissionId: string | null;
    ecoPoints: number;
    completedMissionIds: string[];
    serverAddress?: string;
  }) {
    const { serverAddress, ...rest } = joinPayload;
    const targetUrl = normalizeServerWsUrl(serverAddress);
    const serverChanged = targetUrl !== this.activeWsUrl;
    this.activeWsUrl = targetUrl;
    this.lastJoinPayload = { type: 'room:join', ...rest };

    if (serverChanged && this.ws) {
      if (this.reconnectTimer) {
        window.clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(this.lastJoinPayload));
      return;
    }
    this.openSocket();
  }

  private openSocket() {
    if (this.disposed) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const wsUrl = this.activeWsUrl || normalizeServerWsUrl();
    this.callbacks.onStatusChange(this.reconnectTimer ? 'reconnecting' : 'connecting');

    try {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.onopen = () => {
        if (this.disposed) {
          ws.close();
          return;
        }
        this.callbacks.onStatusChange('connected');
        if (this.lastJoinPayload) {
          ws.send(JSON.stringify(this.lastJoinPayload));
        }
        while (this.pendingQueue.length > 0 && ws.readyState === WebSocket.OPEN) {
          const item = this.pendingQueue.shift();
          if (item) ws.send(item);
        }
      };

      ws.onmessage = (event) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(event.data)) as Record<string, unknown>;
        } catch {
          return;
        }

        switch (msg.type) {
          case 'room:init': {
            this.callbacks.onRoomInit({
              selfId: String(msg.selfId ?? ''),
              roomId: String(msg.roomId ?? 'EARTH-ALPHA'),
              players: Array.isArray(msg.players) ? (msg.players as RemotePlayerState[]) : [],
              completedMissionIds: Array.isArray(msg.completedMissionIds)
                ? (msg.completedMissionIds as string[])
                : [],
              missionSession: (msg.missionSession as MissionCoopState | null) ?? null,
              chatHistory: Array.isArray(msg.chatHistory)
                ? (msg.chatHistory as SquadChatMessage[])
                : [],
            });
            break;
          }
          case 'player:joined': {
            const p = msg.player as RemotePlayerState | undefined;
            if (!p) break;
            this.callbacks.onPlayersChange((prev) => {
              if (prev.some((item) => item.id === p.id)) {
                return prev.map((item) => (item.id === p.id ? p : item));
              }
              return [...prev, p];
            });
            break;
          }
          case 'player:updated': {
            const p = msg.player as RemotePlayerState | undefined;
            if (!p) break;
            this.callbacks.onPlayersChange((prev) =>
              prev.some((item) => item.id === p.id)
                ? prev.map((item) => (item.id === p.id ? p : item))
                : [...prev, p]
            );
            break;
          }
          case 'player:left': {
            const pid = String(msg.playerId ?? '');
            if (!pid) break;
            this.callbacks.onPlayersChange((prev) => prev.filter((item) => item.id !== pid));
            break;
          }
          case 'mission:completed': {
            const ids = Array.isArray(msg.completedMissionIds)
              ? (msg.completedMissionIds as string[])
              : [];
            this.callbacks.onMissionCompleted(
              ids,
              String(msg.missionId ?? ''),
              String(msg.byPlayerName ?? 'Teammate')
            );
            break;
          }
          case 'arena:sync': {
            this.callbacks.onArenaSync({
              missionId: String(msg.missionId ?? ''),
              completedNodeIds: Array.isArray(msg.completedNodeIds)
                ? (msg.completedNodeIds as string[])
                : [],
              bunkerFound: Boolean(msg.bunkerFound),
              labDiscovered: Boolean(msg.labDiscovered),
            });
            break;
          }
          case 'arena:node_updated': {
            this.callbacks.onArenaNodeUpdated({
              missionId: String(msg.missionId ?? ''),
              nodeId: String(msg.nodeId ?? ''),
              kind: String(msg.kind ?? ''),
              byPlayerId: String(msg.byPlayerId ?? ''),
              byPlayerName: String(msg.byPlayerName ?? 'Teammate'),
            });
            break;
          }
          case 'arena:discovered': {
            const kind = msg.kind === 'bunker' ? 'bunker' : 'lab';
            this.callbacks.onArenaDiscovered({
              missionId: String(msg.missionId ?? ''),
              kind,
              byPlayerName: String(msg.byPlayerName ?? 'Teammate'),
            });
            break;
          }
          case 'ping:sector': {
            this.callbacks.onSectorPing({
              id: String(msg.id ?? `ping-${Date.now()}`),
              missionId: String(msg.missionId ?? ''),
              lat: Number(msg.lat ?? 0),
              lng: Number(msg.lng ?? 0),
              title: String(msg.title ?? 'Sector'),
              byPlayerName: String(msg.byPlayerName ?? 'Teammate'),
              color: String(msg.color ?? '#22d3ee'),
              createdAt: Number(msg.createdAt ?? Date.now()),
            });
            break;
          }
          case 'chat:message': {
            if (msg.message) {
              this.callbacks.onChatMessage(msg.message as SquadChatMessage);
            }
            break;
          }
        }
      };

      ws.onclose = () => {
        if (this.disposed) return;
        this.callbacks.onStatusChange('reconnecting');
        if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
        this.reconnectTimer = window.setTimeout(() => {
          this.openSocket();
        }, 2000);
      };

      ws.onerror = () => {
        // onclose handles reconnect
      };
    } catch {
      this.callbacks.onStatusChange('offline');
    }
  }

  send(payload: Record<string, unknown>) {
    if (this.disposed) return;
    if (payload.type === 'room:join') {
      this.lastJoinPayload = payload;
    }
    const raw = JSON.stringify(payload);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(raw);
    } else if (payload.type !== 'player:update') {
      // Buffer non-high-frequency state mutations for send on reconnect
      this.pendingQueue = [...this.pendingQueue.slice(-19), raw];
    }
  }

  dispose() {
    this.disposed = true;
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
