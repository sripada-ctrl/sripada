import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import {
  Bot,
  Check,
  Clock,
  Compass,
  Copy,
  Globe2,
  Heart,
  Lock,
  Menu,
  Moon,
  Music,
  Nut,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Radio,
  RefreshCw,
  Rocket,
  Send,
  Server,
  Settings,
  Sparkles,
  Sun,
  Sunrise,
  User,
  Users,
  Volume2,
  VolumeX,
  Wrench,
  X,
} from 'lucide-react';
import { EarthCanvas } from './components/EarthCanvas';
import { GameModals } from './components/GameModals';
import { MissionPlayArena } from './components/MissionPlayArena';
import { SpaceAcademyView } from './components/SpaceAcademyView';
import {
  BACKPACK_LEVELS,
  INITIAL_PROGRESS_STATE,
  MISSIONS,
  TECH_UPGRADES,
  isMissionUnlocked,
} from './data/gameData';
import {
  GameProgressState,
  MissionCoopState,
  MissionDefinition,
  ModalTab,
  RemotePlayerState,
  ScreenMode,
  SectorPingEvent,
  SquadChatMessage,
} from './types/game';
import { soundEngine } from './utils/audio';
import { ConnectionStatus, MultiplayerClient } from './utils/multiplayer';

const STORAGE_KEY = 'project_eclipse_save_v1';

function getInitialRoomId(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('room') ?? 'EARTH-ALPHA';
    const cleaned = raw.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 18);
    return cleaned || 'EARTH-ALPHA';
  } catch {
    return 'EARTH-ALPHA';
  }
}

function getInitialServerAddress(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    return (params.get('server') ?? '').trim();
  } catch {
    return '';
  }
}

interface ServerInfoData {
  port: number;
  hostAddress: string;
  joinUrl: string;
  primaryServerIp: string;
  lanAddresses: string[];
  wsPath: string;
  activeRooms: Array<{ id: string; playerCount: number }>;
}

function loadSavedProgress(): GameProgressState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return INITIAL_PROGRESS_STATE;
    const parsed = JSON.parse(raw) as Partial<GameProgressState>;
    return {
      ...INITIAL_PROGRESS_STATE,
      ...parsed,
      scrap: parsed.scrap ?? 0,
      backpackMaxCapacity: Math.max(20, parsed.backpackMaxCapacity ?? 20),
      settings: {
        ...INITIAL_PROGRESS_STATE.settings,
        ...(parsed.settings ?? {}),
      },
    };
  } catch {
    return INITIAL_PROGRESS_STATE;
  }
}

export default function App() {
  const [progress, setProgress] = useState<GameProgressState>(loadSavedProgress);
  const [screenMode, setScreenMode] = useState<ScreenMode>('opening');
  const [activeModal, setActiveModal] = useState<ModalTab>(null);
  const [selectedMission, setSelectedMission] = useState<MissionDefinition | null>(null);
  const [activeMission, setActiveMission] = useState<MissionDefinition | null>(null);
  const [divingMission, setDivingMission] = useState<MissionDefinition | null>(null);
  const [leftRibbonOpen, setLeftRibbonOpen] = useState<boolean>(true);
  const [rightRibbonOpen, setRightRibbonOpen] = useState<boolean>(true);
  const [hoveredInfo, setHoveredInfo] = useState<{
    mission: MissionDefinition;
    x: number;
    y: number;
  } | null>(null);
  const [webglFallback, setWebglFallback] = useState(false);
  const [solarMode, setSolarMode] = useState<'auto' | 'day' | 'sunset' | 'night'>('auto');
  const [solarHour, setSolarHour] = useState<number>(13.5);
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [nowTime, setNowTime] = useState<Date>(() => new Date());

  // Boot Loading Screen & Sector Deployment Transition State
  const [bootProgress, setBootProgress] = useState<number>(0);
  const [bootStage, setBootStage] = useState<string>('Initializing Planetary Telemetry');
  const [bootDone, setBootDone] = useState<boolean>(false);
  const [transitionScreen, setTransitionScreen] = useState<{
    title: string;
    subtitle: string;
    badge: string;
  } | null>(null);
  const transitionTimerRef = useRef<number | null>(null);
  const diveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const safety = window.setTimeout(() => setBootDone(true), 3500);
    return () => window.clearTimeout(safety);
  }, []);

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current);
      if (diveTimerRef.current) window.clearTimeout(diveTimerRef.current);
    };
  }, []);

  const runTransition = useCallback(
    (badge: string, title: string, subtitle: string, apply: () => void, durationMs = 420) => {
      if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current);
      setTransitionScreen({ badge, title, subtitle });
      transitionTimerRef.current = window.setTimeout(() => {
        apply();
        transitionTimerRef.current = window.setTimeout(() => {
          setTransitionScreen(null);
        }, 180);
      }, durationMs);
    },
    []
  );

  // Real-Time WebSocket Multiplayer State
  const mpClientRef = useRef<MultiplayerClient | null>(null);
  const [mpStatus, setMpStatus] = useState<ConnectionStatus>('connecting');
  const [selfPlayerId, setSelfPlayerId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string>(getInitialRoomId);
  const [roomInput, setRoomInput] = useState<string>(getInitialRoomId);
  const [remotePlayers, setRemotePlayers] = useState<RemotePlayerState[]>([]);
  const [chatMessages, setChatMessages] = useState<SquadChatMessage[]>([]);
  const [sectorPings, setSectorPings] = useState<SectorPingEvent[]>([]);
  const [coopSession, setCoopSession] = useState<MissionCoopState | null>(null);
  const [mpDrawerOpen, setMpDrawerOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [copiedServerIp, setCopiedServerIp] = useState(false);
  const [customServerAddress, setCustomServerAddress] = useState<string>(getInitialServerAddress);
  const [serverIpInput, setServerIpInput] = useState<string>(getInitialServerAddress);
  const [serverInfo, setServerInfo] = useState<ServerInfoData | null>(null);

  const liveSnapshotRef = useRef({
    progress,
    screenMode,
    selectedMission,
    activeMission,
    roomId,
    customServerAddress,
  });
  liveSnapshotRef.current = {
    progress,
    screenMode,
    selectedMission,
    activeMission,
    roomId,
    customServerAddress,
  };

  const refreshServerInfo = useCallback(async () => {
    try {
      const res = await fetch('/api/server-info');
      if (res.ok) {
        const data = (await res.json()) as ServerInfoData;
        setServerInfo(data);
      }
    } catch {
      // Ignore offline/network glitch
    }
  }, []);

  useEffect(() => {
    refreshServerInfo();
  }, [refreshServerInfo]);

  useEffect(() => {
    if (mpDrawerOpen) {
      refreshServerInfo();
    }
  }, [mpDrawerOpen, refreshServerInfo]);

  useEffect(() => {
    const client = new MultiplayerClient({
      onStatusChange: (status) => setMpStatus(status),
      onRoomInit: (payload) => {
        setSelfPlayerId(payload.selfId);
        setRoomId(payload.roomId);
        setRoomInput(payload.roomId);
        setRemotePlayers(payload.players);
        setChatMessages(payload.chatHistory.slice(-50));
        setCoopSession(payload.missionSession);
        if (payload.completedMissionIds.length > 0) {
          setProgress((prev) => {
            const merged = new Set([...prev.completedMissionIds, ...payload.completedMissionIds]);
            if (merged.size === prev.completedMissionIds.length) return prev;
            return { ...prev, completedMissionIds: Array.from(merged) };
          });
        }
      },
      onPlayersChange: (updater) => setRemotePlayers(updater),
      onMissionCompleted: (completedIds) => {
        if (completedIds.length === 0) return;
        setProgress((prev) => {
          const merged = new Set([...prev.completedMissionIds, ...completedIds]);
          if (merged.size === prev.completedMissionIds.length) return prev;
          soundEngine.missionComplete();
          return { ...prev, completedMissionIds: Array.from(merged) };
        });
      },
      onArenaSync: (session) => setCoopSession(session),
      onArenaNodeUpdated: ({ missionId, nodeId }) => {
        setCoopSession((prev) => {
          if (!prev || prev.missionId !== missionId) {
            return {
              missionId,
              completedNodeIds: [nodeId],
              bunkerFound: false,
              labDiscovered: false,
            };
          }
          if (prev.completedNodeIds.includes(nodeId)) return prev;
          return {
            ...prev,
            completedNodeIds: [...prev.completedNodeIds, nodeId],
          };
        });
      },
      onArenaDiscovered: ({ missionId, kind }) => {
        setCoopSession((prev) => {
          const base =
            prev && prev.missionId === missionId
              ? prev
              : { missionId, completedNodeIds: [], bunkerFound: false, labDiscovered: false };
          return {
            ...base,
            bunkerFound: base.bunkerFound || kind === 'bunker',
            labDiscovered: base.labDiscovered || kind === 'lab',
          };
        });
      },
      onSectorPing: (ping) => {
        setSectorPings((prev) => [...prev.filter((p) => p.id !== ping.id).slice(-11), ping]);
        soundEngine.scan();
      },
      onChatMessage: (message) => {
        setChatMessages((prev) => {
          if (prev.some((m) => m.id === message.id)) return prev;
          return [...prev.slice(-49), message];
        });
      },
    });

    mpClientRef.current = client;
    const snap = liveSnapshotRef.current;
    const focusMission = snap.activeMission ?? snap.selectedMission;
    client.connect({
      roomId: snap.roomId,
      playerName: snap.progress.playerName,
      screenMode: snap.screenMode,
      lat: focusMission?.lat ?? 20,
      lng: focusMission?.lng ?? 0,
      activeMissionId: snap.activeMission?.id ?? null,
      ecoPoints: snap.progress.ecoPoints,
      completedMissionIds: snap.progress.completedMissionIds,
      serverAddress: snap.customServerAddress || undefined,
    });

    const pruneTimer = window.setInterval(() => {
      const cutoff = Date.now() - 4000;
      setSectorPings((prev) => (prev.some((p) => p.createdAt < cutoff) ? prev.filter((p) => p.createdAt >= cutoff) : prev));
    }, 1500);

    return () => {
      window.clearInterval(pruneTimer);
      client.dispose();
      mpClientRef.current = null;
    };
  }, []);

  // Broadcast player presence updates (screen, selected/active sector, name, vehicle, ecoPoints)
  useEffect(() => {
    const focusMission = activeMission ?? selectedMission;
    mpClientRef.current?.send({
      type: 'player:update',
      name: progress.playerName,
      screenMode,
      lat: focusMission?.lat ?? 20,
      lng: focusMission?.lng ?? 0,
      activeMissionId: activeMission?.id ?? null,
      vehicleId: progress.activeVehicleId,
      ecoPoints: progress.ecoPoints,
    });
  }, [
    progress.playerName,
    progress.activeVehicleId,
    progress.ecoPoints,
    screenMode,
    selectedMission,
    activeMission,
  ]);

  // Update React HUD solar clock gently (~1.6Hz) instead of 60fps React re-renders; EarthCanvas interpolates 60fps internally
  useEffect(() => {
    if (screenMode === 'mission-active') return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min(2.0, (now - last) / 1000);
      last = now;
      if (solarMode === 'auto') {
        setSolarHour((h) => (h + dt * 0.08) % 24);
      } else {
        const target = solarMode === 'day' ? 12.8 : solarMode === 'sunset' ? 18.1 : 0.4;
        setSolarHour((h) => {
          let diff = target - h;
          if (diff > 12) diff -= 24;
          if (diff < -12) diff += 24;
          if (Math.abs(diff) < 0.02) return target;
          return (h + diff * Math.min(1, dt * 5.0) + 24) % 24;
        });
      }
    }, 600);
    return () => window.clearInterval(timer);
  }, [solarMode, screenMode]);

  // Live Exact Clock (updates every second)
  useEffect(() => {
    const updateClock = () => setNowTime(new Date());
    updateClock();
    const timer = window.setInterval(updateClock, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const formattedClockTime = useMemo(
    () =>
      nowTime.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    [nowTime]
  );

  // Persist save state & sync audio engine + space ambient music
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch {
      // Ignore storage quota errors
    }
    soundEngine.configure(progress.settings.soundEnabled, progress.settings.soundVolume);
  }, [progress]);

  useEffect(() => {
    soundEngine.setMusicEnabled(musicEnabled);
  }, [musicEnabled]);

  useEffect(() => {
    const unlockMusic = () => {
      soundEngine.startSpaceMusic();
      window.removeEventListener('pointerdown', unlockMusic);
      window.removeEventListener('keydown', unlockMusic);
    };
    window.addEventListener('pointerdown', unlockMusic, { passive: true });
    window.addEventListener('keydown', unlockMusic, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', unlockMusic);
      window.removeEventListener('keydown', unlockMusic);
      soundEngine.stopSpaceMusic();
    };
  }, []);

  // Global Restoration Progress %
  const globalProgressPct = useMemo(() => {
    const pct = Math.round((progress.completedMissionIds.length / MISSIONS.length) * 100);
    return Math.min(100, Math.max(0, pct));
  }, [progress.completedMissionIds.length]);

  // Planetary Health System % (rises as sectors, forests, reefs & recycling stabilize the biosphere)
  const earthHealthPct = useMemo(() => {
    const ecoBonus = Math.min(8, Math.floor((progress.totalTreesPlanted + progress.totalCoralsRestored) / 4));
    return Math.min(100, Math.max(28, 32 + Math.round(globalProgressPct * 0.62) + ecoBonus));
  }, [globalProgressPct, progress.totalTreesPlanted, progress.totalCoralsRestored]);

  const handleUpdateProgress = useCallback(
    (updater: (prev: GameProgressState) => GameProgressState) => {
      setProgress((prev) => updater(prev));
    },
    []
  );

  const handlePurchaseUpgrade = useCallback((upgradeId: string) => {
    const upg = TECH_UPGRADES.find((u) => u.id === upgradeId);
    if (!upg) return;

    setProgress((prev) => {
      if (prev.unlockedTechIds.includes(upgradeId)) return prev;
      if (upg.prerequisiteId && !prev.unlockedTechIds.includes(upg.prerequisiteId)) return prev;
      if (prev.ecoPoints < upg.cost) return prev;

      soundEngine.upgrade();

      let nextBackpackLevel = prev.backpackLevel;
      let nextBackpackCap = prev.backpackMaxCapacity;
      if (upgradeId === 'bp-lvl-2') {
        nextBackpackLevel = 2;
        nextBackpackCap = BACKPACK_LEVELS[2].capacity;
      } else if (upgradeId === 'bp-lvl-3') {
        nextBackpackLevel = 3;
        nextBackpackCap = BACKPACK_LEVELS[3].capacity;
      } else if (upgradeId === 'bp-lvl-4') {
        nextBackpackLevel = 4;
        nextBackpackCap = BACKPACK_LEVELS[4].capacity;
      }

      const nextVehicles = [...prev.unlockedVehicles];
      if (
        (upgradeId === 'vehicle-boat' ||
          upgradeId === 'vehicle-transport' ||
          upgradeId === 'vehicle-heli') &&
        !nextVehicles.includes(upgradeId)
      ) {
        nextVehicles.push(upgradeId);
      }

      return {
        ...prev,
        ecoPoints: prev.ecoPoints - upg.cost,
        unlockedTechIds: [...prev.unlockedTechIds, upgradeId],
        backpackLevel: nextBackpackLevel,
        backpackMaxCapacity: nextBackpackCap,
        robotUnlocked: prev.robotUnlocked || upgradeId === 'robot-unlock',
        unlockedVehicles: nextVehicles,
        activeVehicleId:
          prev.activeVehicleId ??
          (nextVehicles.length > 0 ? nextVehicles[0] : null),
      };
    });
  }, []);

  const handleEnterMission = useCallback(
    (mission: MissionDefinition) => {
      const { unlocked } = isMissionUnlocked(mission, progress, globalProgressPct);
      if (!unlocked) {
        soundEngine.warning();
        return;
      }
      if (divingMission) return;
      soundEngine.upgrade();
      setActiveModal(null);
      setHoveredInfo(null);

      const triggerArenaEntry = () => {
        setDivingMission(null);
        runTransition(
          mission.arenaConfig.isSpaceMission ? 'ORBITAL LAUNCH SEQUENCE' : 'ATMOSPHERIC DROP-POD DEPLOYMENT',
          mission.title,
          `Loading ${mission.locationName} · 1st-Person Biome & Atmosphere`,
          () => {
            setActiveMission(mission);
            setSelectedMission(null);
            setScreenMode('mission-active');
          },
          480
        );
      };

      if (screenMode === 'world-map' && !webglFallback) {
        setSelectedMission(null);
        setDivingMission(mission);
        if (diveTimerRef.current) window.clearTimeout(diveTimerRef.current);
        diveTimerRef.current = window.setTimeout(triggerArenaEntry, 680);
      } else {
        triggerArenaEntry();
      }
    },
    [progress, globalProgressPct, runTransition, divingMission, screenMode, webglFallback]
  );

  const handleMissionComplete = useCallback(
    (
      mission: MissionDefinition,
      stats: {
        ecoEarned: number;
        recycledNow: number;
        treesPlanted: number;
        coralsRestored: number;
        teammatesRescued: number;
        labDiscovered: boolean;
      }
    ) => {
      setProgress((prev) => {
        const alreadyDone = prev.completedMissionIds.includes(mission.id);
        const completed = alreadyDone
          ? prev.completedMissionIds
          : [...prev.completedMissionIds, mission.id];
        const bonus = alreadyDone ? Math.round(mission.rewardEcoPoints * 0.4) : mission.rewardEcoPoints;

        return {
          ...prev,
          ecoPoints: prev.ecoPoints + bonus,
          totalEcoPointsEarned: prev.totalEcoPointsEarned + bonus,
          completedMissionIds: completed,
          endingAchieved: prev.endingAchieved || Boolean(mission.arenaConfig.isFinalMission),
        };
      });

      mpClientRef.current?.send({
        type: 'mission:complete',
        missionId: mission.id,
      });

      if (mission.arenaConfig.isFinalMission) {
        window.setTimeout(() => {
          setActiveMission(null);
          setScreenMode('ending-cinematic');
        }, 1600);
      }
    },
    []
  );

  const handleHoverMission = useCallback(
    (mission: MissionDefinition | null, screenPos?: { x: number; y: number }) => {
      if (!mission || !screenPos) {
        setHoveredInfo(null);
      } else {
        setHoveredInfo({ mission, x: screenPos.x, y: screenPos.y });
      }
    },
    []
  );

  const handleResetProgress = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    if (diveTimerRef.current) window.clearTimeout(diveTimerRef.current);
    setDivingMission(null);
    setProgress(INITIAL_PROGRESS_STATE);
    setSelectedMission(null);
    setActiveMission(null);
    setScreenMode('opening');
  }, []);

  const orbitalMission = useMemo(
    () => MISSIONS.find((m) => m.id === 'space-academy-orbital')!,
    []
  );
  const finalMission = useMemo(
    () => MISSIONS.find((m) => m.id === 'exo-terra-final')!,
    []
  );
  const finalUnlockStatus = useMemo(
    () => isMissionUnlocked(finalMission, progress, globalProgressPct),
    [finalMission, progress, globalProgressPct]
  );
  const secretGlobalMission = useMemo(
    () => MISSIONS.find((m) => m.id === 'gaia-convergence')!,
    []
  );

  return (
    <MotionConfig reducedMotion="user">
    <div className="relative w-screen h-screen overflow-hidden bg-[#030712] text-slate-100 select-none">
      {/* Persistent 3D Earth in Space */}
      {!webglFallback ? (
        <EarthCanvas
          screenMode={screenMode}
          missions={MISSIONS}
          progress={progress}
          globalProgressPct={globalProgressPct}
          selectedMissionId={selectedMission?.id ?? null}
          divingMission={divingMission}
          solarHour={solarHour}
          solarMode={solarMode}
          remotePlayers={remotePlayers}
          selfPlayerId={selfPlayerId}
          sectorPings={sectorPings}
          onSelectMission={(m) => {
            soundEngine.click();
            setSelectedMission(m);
          }}
          onQuickEnterMission={handleEnterMission}
          onHoverMission={handleHoverMission}
          onWebGLUnavailable={() => {
            setWebglFallback(true);
            setBootDone(true);
          }}
          onLoadProgress={(pct, stage) => {
            setBootProgress((prev) => Math.max(prev, pct));
            setBootStage(stage);
          }}
          onSceneReady={() => {
            setBootProgress(100);
            setBootStage('Orbital Command Systems Online');
            setBootDone(true);
          }}
        />
      ) : (
        <div className="fixed inset-0 z-0 flex flex-col items-center justify-center bg-[radial-gradient(circle_at_center,#0f294a_0%,#030712_70%)] p-6">
          <div className="max-w-3xl w-full bg-[#091120] border border-cyan-500/30 rounded-2xl p-6 space-y-4">
            <h2 className="text-xl font-bold text-white">Interactive Earth Sector Directory</h2>
            <p className="text-xs text-slate-400">
              2D Tactical Earth view active. Select any planetary sector below to inspect and deploy.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[55vh] overflow-y-auto">
              {MISSIONS.map((m) => {
                const done = progress.completedMissionIds.includes(m.id);
                return (
                  <button
                    key={m.id}
                    onClick={() => setSelectedMission(m)}
                    className="p-3 text-left bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl flex items-center justify-between"
                  >
                    <div>
                      <div className="text-sm font-bold text-white">{m.title}</div>
                      <div className="text-xs text-slate-400">{m.locationName}</div>
                    </div>
                    <span className={`text-xs font-mono-num font-bold ${done ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {done ? 'RESTORED' : 'ALERT'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* OPENING SCREEN OVERLAY (Solar Smash–inspired asymmetric space command framing) */}
      <AnimatePresence>
      {screenMode === 'opening' && (
        <motion.div
          key="opening-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: bootDone ? 1 : 0 }}
          exit={{ opacity: 0, transition: { duration: 0.25 } }}
          transition={{ duration: 0.45 }}
          className="relative z-10 w-full h-full flex flex-col justify-between p-5 sm:p-10 pointer-events-none"
        >
          {/* Top Utility Bar */}
          <motion.div
            initial={{ opacity: 0, y: -14 }}
            animate={{ opacity: bootDone ? 1 : 0, y: bootDone ? 0 : -14 }}
            transition={{ duration: 0.45, delay: 0.08 }}
            className="flex flex-wrap items-center justify-between gap-3 pointer-events-auto"
          >
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center gap-3 px-3.5 py-1.5 bg-[#050b18]/85 border border-cyan-500/30 rounded-lg">
                <span className="font-display text-xs sm:text-sm font-bold tracking-[0.22em] text-cyan-300">
                  ECLIPSE // PLANETARY COMMAND
                </span>
              </div>
              <div
                className="flex items-center gap-2 px-3 py-1.5 bg-[#050b18]/85 border border-cyan-500/30 rounded-lg font-mono-num text-xs sm:text-sm font-bold text-slate-100 tabular-nums"
                title="Exact Local Time"
              >
                <Clock className="w-3.5 h-3.5 text-cyan-400" />
                <span>{formattedClockTime}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  soundEngine.click();
                  setMpDrawerOpen((v) => !v);
                }}
                className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold bg-[#050b18]/85 hover:bg-slate-800 border border-cyan-500/35 rounded-lg text-cyan-200 transition-colors cursor-pointer"
                title="Open Multiplayer Server IP & Squad Co-Op"
              >
                <Users className="w-4 h-4 text-cyan-400" />
                <span>Squad · Server IP ({Math.max(1, remotePlayers.length)})</span>
              </button>
              <button
                onClick={() => {
                  setMusicEnabled((m) => !m);
                }}
                aria-label="Toggle Space Music"
                title={musicEnabled ? 'Space Music On' : 'Space Music Off'}
                className={`p-2.5 bg-[#050b18]/85 hover:bg-slate-800 border rounded-lg transition-colors cursor-pointer ${
                  musicEnabled && progress.settings.soundEnabled
                    ? 'border-cyan-400/50 text-cyan-300'
                    : 'border-cyan-500/30 text-slate-500'
                }`}
              >
                <Music className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  setProgress((p) => ({
                    ...p,
                    settings: { ...p.settings, soundEnabled: !p.settings.soundEnabled },
                  }));
                }}
                aria-label="Toggle Sound"
                className="p-2.5 bg-[#050b18]/85 hover:bg-slate-800 border border-cyan-500/30 rounded-lg text-slate-300 hover:text-white transition-colors cursor-pointer"
              >
                {progress.settings.soundEnabled ? (
                  <Volume2 className="w-4 h-4 text-cyan-400" />
                ) : (
                  <VolumeX className="w-4 h-4 text-slate-500" />
                )}
              </button>
              <button
                onClick={() => {
                  soundEngine.click();
                  setActiveModal('settings');
                }}
                aria-label="Settings"
                className="p-2.5 bg-[#050b18]/85 hover:bg-slate-800 border border-cyan-500/30 rounded-lg text-slate-300 hover:text-white transition-colors cursor-pointer"
              >
                <Settings className="w-4 h-4 text-cyan-300" />
              </button>
              <button
                onClick={() => {
                  soundEngine.click();
                  setActiveModal('main-menu');
                }}
                className="flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-[#050b18]/85 hover:bg-slate-800 border border-cyan-500/35 rounded-lg text-slate-100 transition-colors cursor-pointer"
              >
                <Menu className="w-4 h-4 text-cyan-400" />
                Command Menu
              </button>
            </div>
          </motion.div>

          {/* Lower-Left Hero Title & Beveled Command Stack (leaves 3D Earth & horizon sun unobstructed) */}
          <motion.div
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: bootDone ? 1 : 0, x: bootDone ? 0 : -24 }}
            transition={{ duration: 0.55, delay: 0.14, ease: 'easeOut' }}
            className="max-w-xl space-y-5 pb-4 sm:pb-8 pointer-events-auto"
          >
            <div className="border-l-4 border-cyan-400 pl-4 sm:pl-5 space-y-2.5">
              <div className="text-[11px] sm:text-xs font-mono-num tracking-[0.26em] text-cyan-300 uppercase">
                Earth Restoration · Disaster Survival · Space Academy
              </div>
              <h1 className="font-display text-4xl sm:text-6xl lg:text-7xl font-black tracking-[0.08em] text-transparent bg-clip-text bg-gradient-to-b from-slate-100 via-slate-200 to-cyan-200 drop-shadow-[0_0_16px_rgba(56,189,248,0.22)]">
                PROJECT ECLIPSE
              </h1>
              <p className="text-base sm:text-lg text-slate-200 font-medium leading-snug">
                One planet. Three worlds. One mission. Save Earth.
              </p>
            </div>

            <div className="flex flex-col gap-3 max-w-sm pt-1">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  soundEngine.upgrade();
                  setScreenMode('world-map');
                }}
                className="flex items-center justify-center gap-3 px-8 py-4 text-sm sm:text-base font-extrabold tracking-[0.16em] uppercase bg-gradient-to-r from-cyan-400 via-sky-400 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 text-slate-950 rounded-xl border border-white/30 shadow-[0_0_20px_rgba(34,211,238,0.32)] cursor-pointer"
              >
                <Play className="w-5 h-5 fill-slate-950" />
                START MISSION
              </motion.button>

              <div className="grid grid-cols-3 gap-2">
                <motion.button
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => {
                    soundEngine.click();
                    setScreenMode('world-map');
                    setActiveModal('missions');
                  }}
                  className="flex items-center justify-center gap-1.5 py-2.5 px-2 text-xs font-semibold bg-[#060e1f]/90 hover:bg-slate-800 border border-cyan-500/30 rounded-xl text-slate-200 transition-colors cursor-pointer"
                >
                  <Compass className="w-3.5 h-3.5 text-cyan-400" />
                  Missions
                </motion.button>
                <motion.button
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => {
                    soundEngine.click();
                    runTransition(
                      'ORBITAL SHUTTLE TRANSFER',
                      'Space Academy & Research Centre',
                      'World 3 · Low-Earth Orbit Docks',
                      () => setScreenMode('space-academy')
                    );
                  }}
                  className="flex items-center justify-center gap-1.5 py-2.5 px-2 text-xs font-semibold bg-[#060e1f]/90 hover:bg-slate-800 border border-cyan-500/30 rounded-xl text-slate-200 transition-colors cursor-pointer"
                >
                  <Rocket className="w-3.5 h-3.5 text-sky-400" />
                  Academy
                </motion.button>
                <motion.button
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => {
                    soundEngine.click();
                    setScreenMode('world-map');
                    setActiveModal('tech-tree');
                  }}
                  className="flex items-center justify-center gap-1.5 py-2.5 px-2 text-xs font-semibold bg-[#060e1f]/90 hover:bg-slate-800 border border-cyan-500/30 rounded-xl text-slate-200 transition-colors cursor-pointer"
                >
                  <Wrench className="w-3.5 h-3.5 text-amber-400" />
                  Upgrades
                </motion.button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* WORLD MAP HUD OVERLAY: Top-Center Progress + Day/Night + Health · Left & Right Ribbon Bars */}
      {screenMode === 'world-map' && (() => {
        const formattedSolarTime = `${String(Math.floor(solarHour)).padStart(2, '0')}:${String(
          Math.floor((solarHour % 1) * 60)
        ).padStart(2, '0')}`;
        const isNightPhase = solarHour < 6 || solarHour >= 19.5;
        const isSunsetPhase = !isNightPhase && (solarHour < 7.8 || solarHour >= 16.8);
        const phaseLabel = isNightPhase ? 'Night' : isSunsetPhase ? 'Twilight' : 'Daylight';
        const healthStatusLabel =
          earthHealthPct >= 85
            ? 'Thriving'
            : earthHealthPct >= 65
            ? 'Stabilized'
            : earthHealthPct >= 45
            ? 'Recovering'
            : 'Critical';

        return (
          <>
            {/* Top Bar: Pushed neatly upward for maximum 3D viewing area */}
            <motion.header
              initial={{ opacity: 0, y: -16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              className="fixed top-0 left-0 right-0 z-20 flex flex-wrap lg:flex-nowrap items-center justify-between gap-2 sm:gap-3 px-3 sm:px-5 pt-1.5 pb-1 pointer-events-none"
            >
              <div className="pointer-events-auto flex items-center gap-2 shrink-0">
                <button
                  onClick={() => {
                    soundEngine.click();
                    setSelectedMission(null);
                  }}
                  className="px-3.5 py-2 bg-[#070e1c]/92 border border-cyan-500/25 rounded-xl font-display text-xs sm:text-sm font-bold tracking-[0.18em] text-white whitespace-nowrap shadow-lg"
                >
                  PROJECT ECLIPSE
                </button>
                <div
                  className="flex items-center gap-1.5 px-3 py-2 bg-[#070e1c]/92 border border-cyan-500/25 rounded-xl font-mono-num text-xs font-bold text-cyan-100 tabular-nums shadow-lg whitespace-nowrap"
                  title="Exact Local Time"
                >
                  <Clock className="w-3.5 h-3.5 text-cyan-400" />
                  <span>{formattedClockTime}</span>
                </div>
              </div>

              {/* TOP-CENTER: Progress Bar · Day & Night System · Health System */}
              <div className="pointer-events-auto order-3 lg:order-none w-full lg:w-auto flex flex-wrap items-center justify-center gap-3 sm:gap-4 px-3.5 sm:px-4 py-2 bg-[#070e1c]/95 border border-cyan-500/35 rounded-2xl shadow-2xl">
                {/* 1. Planetary Restoration Progress Bar */}
                <div className="w-36 sm:w-44 space-y-1">
                  <div className="flex items-center justify-between text-[11px] font-mono-num">
                    <span className="flex items-center gap-1 text-cyan-300 font-semibold">
                      <Globe2 className="w-3.5 h-3.5 text-cyan-400" />
                      PROGRESS
                    </span>
                    <span className="text-white font-bold">
                      {progress.completedMissionIds.length}/{MISSIONS.length} · {globalProgressPct}%
                    </span>
                  </div>
                  <div className="h-2 bg-slate-800/90 rounded-full overflow-hidden border border-cyan-500/20">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all duration-300"
                      style={{ width: `${globalProgressPct}%` }}
                    />
                  </div>
                </div>

                <div className="hidden sm:block h-7 w-px bg-slate-700/80" />

                {/* 2. Day & Night Solar Cycle System */}
                <button
                  onClick={() => {
                    soundEngine.click();
                    setSolarMode((m) =>
                      m === 'auto' ? 'day' : m === 'day' ? 'sunset' : m === 'sunset' ? 'night' : 'auto'
                    );
                  }}
                  className="w-36 sm:w-44 text-left space-y-1 group cursor-pointer"
                  title="Click to cycle Auto / Daylight / Twilight / Night"
                >
                  <div className="flex items-center justify-between text-[11px] font-mono-num">
                    <span className="flex items-center gap-1 text-amber-300 font-semibold">
                      {isNightPhase ? (
                        <Moon className="w-3.5 h-3.5 text-indigo-300" />
                      ) : isSunsetPhase ? (
                        <Sunrise className="w-3.5 h-3.5 text-amber-400" />
                      ) : (
                        <Sun className="w-3.5 h-3.5 text-amber-300" />
                      )}
                      {phaseLabel.toUpperCase()}
                    </span>
                    <span className="text-white font-bold">
                      {formattedSolarTime} · {solarMode === 'auto' ? '5m AUTO' : solarMode.toUpperCase()}
                    </span>
                  </div>
                  <div className="h-2 bg-slate-800/90 rounded-full overflow-hidden border border-amber-400/20">
                    <div
                      className={`h-full transition-all duration-150 ${
                        isNightPhase
                          ? 'bg-gradient-to-r from-indigo-500 to-blue-400'
                          : isSunsetPhase
                          ? 'bg-gradient-to-r from-amber-500 to-rose-400'
                          : 'bg-gradient-to-r from-amber-300 to-cyan-300'
                      }`}
                      style={{ width: `${Math.round((solarHour / 24) * 100)}%` }}
                    />
                  </div>
                </button>

                <div className="hidden sm:block h-7 w-px bg-slate-700/80" />

                {/* 3. Earth Health System */}
                <div className="w-36 sm:w-44 space-y-1">
                  <div className="flex items-center justify-between text-[11px] font-mono-num">
                    <span className="flex items-center gap-1 text-rose-300 font-semibold">
                      <Heart className="w-3.5 h-3.5 text-rose-400" />
                      HEALTH
                    </span>
                    <span className="text-white font-bold">
                      {earthHealthPct}% · {healthStatusLabel}
                    </span>
                  </div>
                  <div className="h-2 bg-slate-800/90 rounded-full overflow-hidden border border-rose-400/20">
                    <div
                      className={`h-full transition-all duration-300 ${
                        earthHealthPct >= 75
                          ? 'bg-emerald-400'
                          : earthHealthPct >= 50
                          ? 'bg-amber-400'
                          : 'bg-rose-500'
                      }`}
                      style={{ width: `${earthHealthPct}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Right Quick Actions */}
              <div className="pointer-events-auto flex items-center gap-2 shrink-0">
                <button
                  onClick={() => {
                    soundEngine.click();
                    setMpDrawerOpen((v) => !v);
                  }}
                  className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold border rounded-xl transition-colors whitespace-nowrap shadow-lg cursor-pointer ${
                    mpDrawerOpen
                      ? 'bg-cyan-500/25 border-cyan-400 text-cyan-100'
                      : 'bg-[#070e1c]/92 hover:bg-slate-800 border-cyan-500/30 text-cyan-200'
                  }`}
                >
                  <Users className="w-4 h-4 text-cyan-400" />
                  <span className="font-mono-num">
                    {Math.max(1, remotePlayers.length)} · {roomId}
                  </span>
                </button>
                <button
                  onClick={() => setMusicEnabled((m) => !m)}
                  aria-label="Toggle Space Music"
                  title={musicEnabled ? 'Space Music On' : 'Space Music Off'}
                  className={`p-2 bg-[#070e1c]/92 hover:bg-slate-800 border rounded-xl transition-colors cursor-pointer ${
                    musicEnabled && progress.settings.soundEnabled
                      ? 'border-cyan-400/50 text-cyan-300'
                      : 'border-cyan-500/25 text-slate-500'
                  }`}
                >
                  <Music className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    setProgress((p) => ({
                      ...p,
                      settings: { ...p.settings, soundEnabled: !p.settings.soundEnabled },
                    }));
                  }}
                  aria-label="Toggle Audio"
                  className="p-2 bg-[#070e1c]/92 hover:bg-slate-800 border border-cyan-500/25 rounded-xl text-slate-300 hover:text-white transition-colors"
                >
                  {progress.settings.soundEnabled ? (
                    <Volume2 className="w-4 h-4 text-cyan-400" />
                  ) : (
                    <VolumeX className="w-4 h-4 text-slate-500" />
                  )}
                </button>
                <button
                  onClick={() => {
                    soundEngine.click();
                    setActiveModal('main-menu');
                  }}
                  className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-xl transition-colors whitespace-nowrap shadow-lg"
                >
                  <Menu className="w-4 h-4" />
                  <span className="hidden sm:inline">Main Menu</span>
                </button>
              </div>
            </motion.header>

            {/* LEFT VERTICAL RIBBON BAR (Collapsible Navigation & Worlds) */}
            <AnimatePresence mode="wait">
            {leftRibbonOpen ? (
              <motion.aside
                key="left-ribbon-open"
                initial={{ opacity: 0, x: -28 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -28 }}
                transition={{ duration: 0.24, ease: 'easeOut' }}
                aria-label="Left Command Ribbon"
                className="fixed left-2.5 sm:left-4 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-1.5 p-2 bg-[#070e1c]/92 border border-cyan-500/30 rounded-2xl shadow-2xl w-[72px] sm:w-[88px]"
              >
                <button
                  onClick={() => {
                    soundEngine.click();
                    setLeftRibbonOpen(false);
                  }}
                  title="Close Navigation Sidebar"
                  className="flex items-center justify-center gap-1 py-1 px-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 text-slate-400 hover:text-cyan-200 text-[10px] font-semibold transition-colors cursor-pointer"
                >
                  <PanelLeftClose className="w-3.5 h-3.5" />
                  <span>Hide</span>
                </button>

                <button
                  onClick={() => {
                    soundEngine.click();
                    setActiveModal('missions');
                  }}
                  className="flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-xl bg-slate-900/75 hover:bg-cyan-500/20 border border-slate-800 hover:border-cyan-400/50 text-slate-200 hover:text-cyan-200 transition-colors cursor-pointer"
                >
                  <Compass className="w-4 h-4 text-cyan-400" />
                  <span className="text-[10px] font-semibold tracking-tight">Missions</span>
                </button>

                <button
                  onClick={() => {
                    soundEngine.click();
                    setActiveModal('tech-tree');
                  }}
                  className="flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-xl bg-slate-900/75 hover:bg-amber-500/20 border border-slate-800 hover:border-amber-400/50 text-slate-200 hover:text-amber-200 transition-colors cursor-pointer"
                >
                  <Wrench className="w-4 h-4 text-amber-400" />
                  <span className="text-[10px] font-semibold tracking-tight">Tech Tree</span>
                </button>

                <button
                  onClick={() => {
                    soundEngine.click();
                    setActiveModal('inventory');
                  }}
                  className="flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-xl bg-slate-900/75 hover:bg-emerald-500/20 border border-slate-800 hover:border-emerald-400/50 text-slate-200 hover:text-emerald-200 transition-colors cursor-pointer"
                >
                  <Package className="w-4 h-4 text-emerald-400" />
                  <span className="text-[10px] font-semibold tracking-tight">Inventory</span>
                </button>

                <button
                  onClick={() => {
                    soundEngine.click();
                    runTransition(
                      'ORBITAL SHUTTLE TRANSFER',
                      'Space Academy & Research Centre',
                      'World 3 · Low-Earth Orbit Docks',
                      () => setScreenMode('space-academy')
                    );
                  }}
                  className="flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/30 border border-cyan-500/35 text-cyan-200 transition-colors cursor-pointer"
                >
                  <Rocket className="w-4 h-4 text-cyan-300" />
                  <span className="text-[10px] font-semibold tracking-tight text-center leading-tight">
                    Academy
                  </span>
                </button>

                <button
                  onClick={() => {
                    soundEngine.click();
                    setSelectedMission(secretGlobalMission);
                  }}
                  className="flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-xl bg-purple-500/15 hover:bg-purple-500/30 border border-purple-500/35 text-purple-200 transition-colors cursor-pointer"
                >
                  <Radio className="w-4 h-4 text-purple-300" />
                  <span className="text-[10px] font-semibold tracking-tight">Global</span>
                </button>

                <button
                  onClick={() => {
                    soundEngine.click();
                    setActiveModal('profile');
                  }}
                  className="flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-xl bg-slate-900/75 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
                >
                  <User className="w-4 h-4 text-slate-300" />
                  <span className="text-[10px] font-semibold tracking-tight">Profile</span>
                </button>

                <button
                  onClick={() => {
                    soundEngine.click();
                    setActiveModal('settings');
                  }}
                  className="flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-xl bg-slate-900/75 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
                >
                  <Settings className="w-4 h-4 text-slate-400" />
                  <span className="text-[10px] font-semibold tracking-tight">Settings</span>
                </button>
              </motion.aside>
            ) : (
              <motion.button
                key="left-ribbon-closed"
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.2 }}
                onClick={() => {
                  soundEngine.click();
                  setLeftRibbonOpen(true);
                }}
                title="Open Navigation Sidebar"
                className="fixed left-2.5 sm:left-4 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-1 px-2 py-3 bg-[#070e1c]/92 hover:bg-slate-800 border border-cyan-500/35 rounded-xl text-cyan-200 shadow-2xl cursor-pointer"
              >
                <PanelLeftOpen className="w-4 h-4 text-cyan-400" />
                <span className="text-[9px] font-bold uppercase tracking-wider">Nav</span>
              </motion.button>
            )}
            </AnimatePresence>

            {/* RIGHT VERTICAL RIBBON BAR (Collapsible Resources & Day/Night Controls) */}
            <AnimatePresence mode="wait">
            {rightRibbonOpen ? (
              <motion.aside
                key="right-ribbon-open"
                initial={{ opacity: 0, x: 28 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 28 }}
                transition={{ duration: 0.24, ease: 'easeOut' }}
                aria-label="Right Systems Ribbon"
                className="fixed right-2.5 sm:right-4 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-2 p-2 bg-[#070e1c]/92 border border-cyan-500/30 rounded-2xl shadow-2xl w-[74px] sm:w-[90px]"
              >
                <button
                  onClick={() => {
                    soundEngine.click();
                    setRightRibbonOpen(false);
                  }}
                  title="Close Systems Sidebar"
                  className="flex items-center justify-center gap-1 py-1 px-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 text-slate-400 hover:text-cyan-200 text-[10px] font-semibold transition-colors cursor-pointer"
                >
                  <PanelRightClose className="w-3.5 h-3.5" />
                  <span>Hide</span>
                </button>

                <div className="flex flex-col items-center py-2 px-1 rounded-xl bg-slate-900/80 border border-amber-500/25 text-center">
                  <Sparkles className="w-4 h-4 text-amber-400 mb-0.5" />
                  <span className="font-mono-num text-xs sm:text-sm font-bold text-amber-300">
                    {progress.ecoPoints}
                  </span>
                  <span className="text-[9px] uppercase tracking-wider text-slate-400">Eco Pts</span>
                </div>

                <div className="flex flex-col items-center py-2 px-1 rounded-xl bg-slate-900/80 border border-orange-500/25 text-center">
                  <Nut className="w-4 h-4 text-orange-400 mb-0.5" />
                  <span className="font-mono-num text-xs sm:text-sm font-bold text-orange-300">
                    {progress.scrap}
                  </span>
                  <span className="text-[9px] uppercase tracking-wider text-slate-400">Scrap</span>
                </div>

                <div className="flex flex-col items-center py-2 px-1 rounded-xl bg-slate-900/80 border border-emerald-500/25 text-center">
                  <Package className="w-4 h-4 text-emerald-400 mb-0.5" />
                  <span className="font-mono-num text-xs font-bold text-white">
                    {progress.currentBackpackItems}/{progress.backpackMaxCapacity}
                  </span>
                  <span className="text-[9px] uppercase tracking-wider text-slate-400">Bag</span>
                </div>

                <div className="flex flex-col items-center py-2 px-1 rounded-xl bg-slate-900/80 border border-cyan-500/25 text-center">
                  <Bot className="w-4 h-4 text-cyan-400 mb-0.5" />
                  <span className="font-mono-num text-[10px] font-bold text-slate-100">
                    {progress.robotUnlocked ? 'ECHO-7' : 'Locked'}
                  </span>
                  <span className="text-[9px] uppercase tracking-wider text-slate-400">Drone</span>
                </div>

                {/* Lighting / Day-Night Phase Selector */}
                <div className="pt-1 border-t border-slate-800 space-y-1">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-center text-slate-400">
                    Lighting
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      onClick={() => {
                        soundEngine.click();
                        setSolarMode('auto');
                      }}
                      title="Auto 5-Min 24h Day/Night Cycle"
                      className={`flex flex-col items-center py-1.5 rounded-lg border text-[9px] font-semibold transition-colors ${
                        solarMode === 'auto'
                          ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200'
                          : 'bg-slate-900/70 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      <RefreshCw className="w-3 h-3 mb-0.5" />
                      Auto
                    </button>
                    <button
                      onClick={() => {
                        soundEngine.click();
                        setSolarMode('day');
                      }}
                      title="Full Daylight"
                      className={`flex flex-col items-center py-1.5 rounded-lg border text-[9px] font-semibold transition-colors ${
                        solarMode === 'day'
                          ? 'bg-amber-500/25 border-amber-400 text-amber-200'
                          : 'bg-slate-900/70 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      <Sun className="w-3 h-3 mb-0.5" />
                      Day
                    </button>
                    <button
                      onClick={() => {
                        soundEngine.click();
                        setSolarMode('sunset');
                      }}
                      title="Sunset Terminator"
                      className={`flex flex-col items-center py-1.5 rounded-lg border text-[9px] font-semibold transition-colors ${
                        solarMode === 'sunset'
                          ? 'bg-orange-500/25 border-orange-400 text-orange-200'
                          : 'bg-slate-900/70 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      <Sunrise className="w-3 h-3 mb-0.5" />
                      Dusk
                    </button>
                    <button
                      onClick={() => {
                        soundEngine.click();
                        setSolarMode('night');
                      }}
                      title="City Lights & Aurora Night"
                      className={`flex flex-col items-center py-1.5 rounded-lg border text-[9px] font-semibold transition-colors ${
                        solarMode === 'night'
                          ? 'bg-indigo-500/25 border-indigo-400 text-indigo-200'
                          : 'bg-slate-900/70 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      <Moon className="w-3 h-3 mb-0.5" />
                      Night
                    </button>
                  </div>
                </div>

                {/* Globe Auto-Spin Toggle */}
                <button
                  onClick={() => {
                    soundEngine.click();
                    setProgress((p) => ({
                      ...p,
                      settings: { ...p.settings, autoRotateGlobe: !p.settings.autoRotateGlobe },
                    }));
                  }}
                  className={`flex flex-col items-center py-1.5 px-1 rounded-xl border text-[10px] font-semibold transition-colors cursor-pointer ${
                    progress.settings.autoRotateGlobe
                      ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200'
                      : 'bg-slate-900/75 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  <Globe2 className="w-3.5 h-3.5 mb-0.5" />
                  <span>{progress.settings.autoRotateGlobe ? 'Spin On' : 'Spin Off'}</span>
                </button>
              </motion.aside>
            ) : (
              <motion.button
                key="right-ribbon-closed"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 16 }}
                transition={{ duration: 0.2 }}
                onClick={() => {
                  soundEngine.click();
                  setRightRibbonOpen(true);
                }}
                title="Open Systems Sidebar"
                className="fixed right-2.5 sm:right-4 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-1 px-2 py-3 bg-[#070e1c]/92 hover:bg-slate-800 border border-cyan-500/35 rounded-xl text-cyan-200 shadow-2xl cursor-pointer"
              >
                <PanelRightOpen className="w-4 h-4 text-cyan-400" />
                <span className="text-[9px] font-bold uppercase tracking-wider">Hud</span>
              </motion.button>
            )}
            </AnimatePresence>

            {/* ORBITAL DIVE HUD BANNER (while camera zooms smoothly into the clicked Earth marker) */}
            <AnimatePresence>
              {divingMission && (
                <motion.div
                  key="orbital-dive-banner"
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 12 }}
                  transition={{ duration: 0.22 }}
                  className="fixed bottom-7 left-1/2 -translate-x-1/2 z-30 pointer-events-none px-5 py-3 bg-[#060d1c]/92 border border-cyan-400/50 rounded-2xl shadow-2xl text-center min-w-[280px]"
                >
                  <div className="font-mono-num text-[10px] tracking-[0.26em] text-cyan-300 uppercase">
                    ORBITAL DROP POD LOCKED · ENTERING SECTOR
                  </div>
                  <div className="font-display text-base sm:text-lg font-bold text-white mt-0.5">
                    {divingMission.title}
                  </div>
                  <div className="text-[11px] font-mono-num text-emerald-300">
                    {divingMission.locationName} ({divingMission.lat.toFixed(1)}°, {divingMission.lng.toFixed(1)}°)
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 3D Marker Hover Tooltip */}
            {hoveredInfo && !selectedMission && !divingMission && (
              <div
                className="fixed z-20 pointer-events-none px-3 py-2 bg-[#091120]/95 border border-cyan-500/40 rounded-lg shadow-xl text-xs"
                style={{
                  left: Math.min(window.innerWidth - 260, Math.max(96, hoveredInfo.x + 14)),
                  top: Math.max(82, hoveredInfo.y - 24),
                }}
              >
                <div className="font-bold text-white">{hoveredInfo.mission.title}</div>
                <div className="text-slate-400">
                  {hoveredInfo.mission.locationName} ·{' '}
                  {progress.completedMissionIds.includes(hoveredInfo.mission.id)
                    ? 'Restored'
                    : 'Click to Inspect · Click Again to Enter'}
                </div>
              </div>
            )}

            {/* Selected Mission Briefing Card (Docked cleanly inside of Right Ribbon, zero overlap) */}
            <AnimatePresence>
            {selectedMission && !divingMission && (
              <motion.div
                key={selectedMission.id}
                initial={{ opacity: 0, x: 24, scale: 0.97 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 24, scale: 0.97 }}
                transition={{ duration: 0.24, ease: 'easeOut' }}
                className={`fixed top-20 z-20 w-[calc(100vw-6.5rem)] sm:w-[390px] max-h-[78vh] overflow-y-auto p-5 bg-[#091120]/96 border border-cyan-500/35 rounded-2xl shadow-2xl space-y-4 ${
                  rightRibbonOpen ? 'right-[88px] sm:right-[114px]' : 'right-3 sm:right-16'
                }`}
              >
                {(() => {
                  const completed = progress.completedMissionIds.includes(selectedMission.id);
                  const { unlocked, reason } = isMissionUnlocked(
                    selectedMission,
                    progress,
                    globalProgressPct
                  );
                  return (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-xs font-mono-num text-cyan-300">
                            {selectedMission.locationName}
                          </div>
                          <h3 className="text-xl font-bold text-white mt-0.5">
                            {selectedMission.title}
                          </h3>
                        </div>
                        <button
                          onClick={() => setSelectedMission(null)}
                          aria-label="Close briefing"
                          className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300 font-mono-num">
                        <span>Difficulty: {selectedMission.difficulty}</span>
                        <span>·</span>
                        <span>Reward: +{selectedMission.rewardEcoPoints} EP</span>
                        <span>·</span>
                        <span className={completed ? 'text-emerald-400' : unlocked ? 'text-rose-400' : 'text-amber-400'}>
                          {completed ? 'Restored' : unlocked ? 'Alert Active' : 'Locked'}
                        </span>
                      </div>

                      <p className="text-sm text-slate-300 leading-relaxed">
                        {selectedMission.problemSummary}
                      </p>

                      <div className="space-y-1.5">
                        <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
                          Mission Objectives
                        </div>
                        <ul className="space-y-1.5 text-xs text-slate-200">
                          {selectedMission.objectives.map((obj, idx) => (
                            <li key={idx} className="flex items-start gap-2">
                              <span className="font-mono-num text-cyan-400">0{idx + 1}.</span>
                              <span>{obj}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="text-xs text-emerald-300/90 bg-emerald-950/30 border border-emerald-500/25 rounded-lg p-2.5">
                        Reward Impact: {selectedMission.rewardBonusNote}
                      </div>

                      {unlocked ? (
                        <div className="space-y-2">
                          <button
                            onClick={() => handleEnterMission(selectedMission)}
                            className="w-full py-3 px-4 font-bold text-sm tracking-wide bg-gradient-to-r from-cyan-400 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 text-slate-950 rounded-xl shadow-lg transition-transform active:scale-[0.99] cursor-pointer"
                          >
                            {completed ? 'REPLAY RESTORED SECTOR' : 'ENTER MISSION'}
                          </button>
                          <button
                            onClick={() => {
                              soundEngine.scan();
                              mpClientRef.current?.send({
                                type: 'ping:sector',
                                missionId: selectedMission.id,
                                lat: selectedMission.lat,
                                lng: selectedMission.lng,
                                title: selectedMission.title,
                              });
                            }}
                            className="w-full py-2 px-3 text-xs font-semibold bg-slate-900 hover:bg-slate-800 border border-cyan-500/35 text-cyan-200 rounded-xl flex items-center justify-center gap-2 transition-colors cursor-pointer"
                          >
                            <Radio className="w-3.5 h-3.5 text-cyan-400" />
                            Ping Sector to Squad
                          </button>
                        </div>
                      ) : (
                        <div className="p-3 bg-amber-950/40 border border-amber-500/40 rounded-xl flex items-center gap-2.5 text-xs text-amber-200">
                          <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                          <span>{reason}</span>
                        </div>
                      )}
                    </>
                  );
                })()}
              </motion.div>
            )}
            </AnimatePresence>
          </>
        );
      })()}

      {/* ACTIVE PLAYABLE MISSION ARENA */}
      {screenMode === 'mission-active' && activeMission && (
        <MissionPlayArena
          mission={activeMission}
          progress={progress}
          initialSolarHour={solarHour}
          liveClockText={formattedClockTime}
          selfPlayerId={selfPlayerId}
          remotePlayers={remotePlayers}
          coopSession={coopSession && coopSession.missionId === activeMission.id ? coopSession : null}
          onSendPlayerArenaPos={(x, z) => {
            mpClientRef.current?.send({
              type: 'player:update',
              arenaX: x,
              arenaZ: z,
            });
          }}
          onSendNodeAction={(missionId, nodeId, kind) => {
            mpClientRef.current?.send({
              type: 'arena:node_action',
              missionId,
              nodeId,
              kind,
            });
          }}
          onSendDiscovery={(missionId, kind) => {
            mpClientRef.current?.send({
              type: 'arena:discovery',
              missionId,
              kind,
            });
          }}
          onResetCoopArena={(missionId) => {
            mpClientRef.current?.send({
              type: 'arena:reset',
              missionId,
            });
          }}
          onUpdateProgress={handleUpdateProgress}
          onMissionComplete={handleMissionComplete}
          onExitMission={() => {
            runTransition(
              'ORBITAL ASCENT TELEMETRY',
              'Returning to 3D Planetary Command',
              'Syncing Biosphere Recovery Data',
              () => {
                setActiveMission(null);
                setScreenMode('world-map');
              },
              480
            );
          }}
        />
      )}

      {/* SPACE ACADEMY HUB (WORLD 3) */}
      {screenMode === 'space-academy' && (
        <SpaceAcademyView
          progress={progress}
          orbitalMission={orbitalMission}
          finalMission={finalMission}
          finalMissionUnlocked={finalUnlockStatus.unlocked}
          finalMissionLockReason={finalUnlockStatus.reason}
          onUpdateProgress={handleUpdateProgress}
          onLaunchMission={(m) => handleEnterMission(m)}
          onBackToEarth={() => {
            runTransition(
              'EARTH RE-ENTRY VECTOR',
              'Returning to Orbital Globe',
              'Sol System · Sector Overview',
              () => setScreenMode('world-map'),
              450
            );
          }}
        />
      )}

      {/* CINEMATIC RESTORED EARTH ENDING */}
      {screenMode === 'ending-cinematic' && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55 }}
          className="relative z-20 w-full h-full flex flex-col items-center justify-end p-8 sm:p-14 text-center pointer-events-none"
        >
          <div className="max-w-3xl p-8 bg-[#091120]/90 border border-emerald-400/50 rounded-2xl shadow-2xl space-y-4 pointer-events-auto">
            <div className="text-xs font-mono-num tracking-[0.25em] text-emerald-300">
              EXO-TERRA ATMOSPHERIC SEED DEPLOYED · EARTH RESTORATION COMPLETE
            </div>
            <h1 className="text-2xl sm:text-4xl font-bold tracking-wider text-white">
              THE FUTURE OF EARTH IS IN OUR HANDS.
            </h1>
            <p className="text-sm sm:text-base text-slate-300">
              Through environmental protection, ecosystem restoration, teamwork, and scientific space exploration, Commander {progress.playerName} helped guide Earth toward a thriving sustainable future.
            </p>
            <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={() => {
                  soundEngine.click();
                  setScreenMode('world-map');
                }}
                className="px-6 py-2.5 text-sm font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg transition-colors"
              >
                Explore Restored Earth
              </button>
              <button
                onClick={() => {
                  soundEngine.click();
                  setActiveModal('profile');
                }}
                className="px-6 py-2.5 text-sm font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors"
              >
                View Career Impact
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {/* MODALS (Main Menu, Missions, Tech Tree, Inventory, Profile, Settings) */}
      <GameModals
        activeModal={activeModal}
        progress={progress}
        globalProgressPct={globalProgressPct}
        onClose={() => setActiveModal(null)}
        onSwitchModal={(tab) => setActiveModal(tab)}
        onStartWorldMap={() => setScreenMode('world-map')}
        onOpenSpaceAcademy={() => {
          runTransition(
            'ORBITAL SHUTTLE TRANSFER',
            'Space Academy & Research Centre',
            'World 3 · Low-Earth Orbit Docks',
            () => setScreenMode('space-academy')
          );
        }}
        onSelectMission={(m) => {
          setScreenMode('world-map');
          setSelectedMission(m);
        }}
        onEnterMission={(m) => handleEnterMission(m)}
        onPurchaseUpgrade={handlePurchaseUpgrade}
        onUpdateProgress={handleUpdateProgress}
        onResetProgress={handleResetProgress}
      />

      {/* MULTIPLAYER SQUAD CO-OP & RADIO DRAWER */}
      <AnimatePresence>
      {mpDrawerOpen && screenMode !== 'mission-active' && (
        <motion.div
          key="mp-squad-drawer"
          initial={{ opacity: 0, y: -14, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -14, scale: 0.97 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="fixed right-3 sm:right-6 top-16 z-40 w-[calc(100vw-1.5rem)] sm:w-96 max-h-[80vh] flex flex-col bg-[#081020]/96 border border-cyan-500/35 rounded-2xl shadow-2xl overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 py-3 bg-[#0c1830] border-b border-cyan-500/20">
            <div>
              <div className="font-display text-xs font-bold tracking-[0.16em] text-cyan-300 uppercase">
                Squad Co-Op // {roomId}
              </div>
              <div className="text-[11px] font-mono-num text-slate-400">
                Status:{' '}
                <span
                  className={
                    mpStatus === 'connected'
                      ? 'text-emerald-400'
                      : mpStatus === 'reconnecting' || mpStatus === 'connecting'
                      ? 'text-amber-300'
                      : 'text-rose-400'
                  }
                >
                  {mpStatus.toUpperCase()}
                </span>{' '}
                · {Math.max(1, remotePlayers.length)} Commander{remotePlayers.length === 1 ? '' : 's'}
              </div>
            </div>
            <button
              onClick={() => setMpDrawerOpen(false)}
              aria-label="Close Squad Drawer"
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-3.5 space-y-3 overflow-y-auto flex-1">
            {/* Shareable Server IP & Direct Friend Join */}
            <div className="space-y-2.5 p-3 bg-slate-900/90 border border-cyan-500/30 rounded-xl">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-cyan-300">
                  <Server className="w-3.5 h-3.5 text-cyan-400" />
                  Server IP & Direct Join
                </span>
                <span className="font-mono-num text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-400/30 text-emerald-300">
                  PORT {serverInfo?.port ?? 3000}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 px-2.5 py-2 bg-slate-950 border border-slate-800 rounded-lg">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">
                    Share This Server IP With Friends
                  </div>
                  <div className="font-mono-num text-xs font-bold text-white truncate">
                    {customServerAddress || serverInfo?.primaryServerIp || window.location.host}
                  </div>
                  {serverInfo && serverInfo.hostAddress !== serverInfo.primaryServerIp && (
                    <div className="font-mono-num text-[10px] text-cyan-300/80 truncate">
                      Web Host: {serverInfo.hostAddress}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const ipToCopy =
                      customServerAddress || serverInfo?.primaryServerIp || window.location.host;
                    navigator.clipboard?.writeText(ipToCopy).catch(() => {});
                    setCopiedServerIp(true);
                    soundEngine.click();
                    window.setTimeout(() => setCopiedServerIp(false), 1800);
                  }}
                  className="shrink-0 px-2.5 py-1.5 text-[11px] font-semibold bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/40 text-cyan-200 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                >
                  {copiedServerIp ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-cyan-300" />
                  )}
                  <span>{copiedServerIp ? 'Copied IP' : 'Copy IP'}</span>
                </button>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const nextAddr = serverIpInput.trim();
                  setCustomServerAddress(nextAddr);
                  const focusMission = activeMission ?? selectedMission;
                  mpClientRef.current?.connect({
                    roomId,
                    playerName: progress.playerName,
                    screenMode,
                    lat: focusMission?.lat ?? 20,
                    lng: focusMission?.lng ?? 0,
                    activeMissionId: activeMission?.id ?? null,
                    ecoPoints: progress.ecoPoints,
                    completedMissionIds: progress.completedMissionIds,
                    serverAddress: nextAddr || undefined,
                  });
                  soundEngine.click();
                }}
                className="space-y-1.5"
              >
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Join Friend&apos;s Server IP
                </div>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={serverIpInput}
                    onChange={(e) => setServerIpInput(e.target.value)}
                    placeholder="e.g. 192.168.1.42:3000"
                    className="flex-1 min-w-0 px-2.5 py-1.5 text-xs font-mono-num bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-cyan-400"
                  />
                  <button
                    type="submit"
                    className="px-2.5 py-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg transition-colors cursor-pointer"
                  >
                    Connect
                  </button>
                  {customServerAddress && (
                    <button
                      type="button"
                      onClick={() => {
                        setServerIpInput('');
                        setCustomServerAddress('');
                        const focusMission = activeMission ?? selectedMission;
                        mpClientRef.current?.connect({
                          roomId,
                          playerName: progress.playerName,
                          screenMode,
                          lat: focusMission?.lat ?? 20,
                          lng: focusMission?.lng ?? 0,
                          activeMissionId: activeMission?.id ?? null,
                          ecoPoints: progress.ecoPoints,
                          completedMissionIds: progress.completedMissionIds,
                        });
                        soundEngine.click();
                      }}
                      className="px-2 py-1.5 text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-lg cursor-pointer"
                      title="Reset to local host server"
                    >
                      Host
                    </button>
                  )}
                </div>
              </form>
            </div>

            {/* Room Switcher & Invite Link */}
            <div className="space-y-2 p-2.5 bg-slate-900/80 border border-slate-800 rounded-xl">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Squad Room Code
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const cleaned = roomInput
                    .toUpperCase()
                    .replace(/[^A-Z0-9_-]/g, '')
                    .slice(0, 18);
                  const nextRoom = cleaned || 'EARTH-ALPHA';
                  setRoomInput(nextRoom);
                  setRoomId(nextRoom);
                  const focusMission = activeMission ?? selectedMission;
                  mpClientRef.current?.connect({
                    roomId: nextRoom,
                    playerName: progress.playerName,
                    screenMode,
                    lat: focusMission?.lat ?? 20,
                    lng: focusMission?.lng ?? 0,
                    activeMissionId: activeMission?.id ?? null,
                    ecoPoints: progress.ecoPoints,
                    completedMissionIds: progress.completedMissionIds,
                    serverAddress: customServerAddress || undefined,
                  });
                  soundEngine.click();
                }}
                className="flex gap-1.5"
              >
                <input
                  type="text"
                  value={roomInput}
                  onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
                  placeholder="EARTH-ALPHA"
                  maxLength={18}
                  className="flex-1 min-w-0 px-2.5 py-1.5 text-xs font-mono-num bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-cyan-400"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-lg transition-colors cursor-pointer"
                >
                  Join
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const serverQuery = customServerAddress
                      ? `&server=${encodeURIComponent(customServerAddress)}`
                      : '';
                    const url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomId)}${serverQuery}`;
                    navigator.clipboard?.writeText(url).catch(() => {});
                    setCopiedInvite(true);
                    soundEngine.click();
                    window.setTimeout(() => setCopiedInvite(false), 1800);
                  }}
                  title="Copy Invite Link"
                  className="px-2.5 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                >
                  {copiedInvite ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-cyan-300" />
                  )}
                  <span>{copiedInvite ? 'Copied' : 'Invite'}</span>
                </button>
              </form>
              {serverInfo && serverInfo.activeRooms.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {serverInfo.activeRooms.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        setRoomInput(r.id);
                        setRoomId(r.id);
                        const focusMission = activeMission ?? selectedMission;
                        mpClientRef.current?.connect({
                          roomId: r.id,
                          playerName: progress.playerName,
                          screenMode,
                          lat: focusMission?.lat ?? 20,
                          lng: focusMission?.lng ?? 0,
                          activeMissionId: activeMission?.id ?? null,
                          ecoPoints: progress.ecoPoints,
                          completedMissionIds: progress.completedMissionIds,
                          serverAddress: customServerAddress || undefined,
                        });
                        soundEngine.click();
                      }}
                      className={`px-2 py-0.5 text-[10px] font-mono-num rounded border transition-colors cursor-pointer ${
                        r.id === roomId
                          ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-200'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {r.id} ({r.playerCount})
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Active Squad Roster */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Orbital Roster
                </span>
                {selectedMission && (
                  <button
                    onClick={() => {
                      soundEngine.scan();
                      mpClientRef.current?.send({
                        type: 'ping:sector',
                        missionId: selectedMission.id,
                        lat: selectedMission.lat,
                        lng: selectedMission.lng,
                        title: selectedMission.title,
                      });
                    }}
                    className="text-[11px] font-semibold text-cyan-300 hover:text-cyan-200 flex items-center gap-1 cursor-pointer"
                  >
                    <Radio className="w-3 h-3" />
                    Ping {selectedMission.locationName}
                  </button>
                )}
              </div>
              <div className="space-y-1.5 max-h-36 overflow-y-auto">
                {remotePlayers.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-slate-400 bg-slate-900/60 border border-slate-800 rounded-lg">
                    Connecting to planetary orbital relay...
                  </div>
                ) : (
                  remotePlayers.map((rp) => {
                    const isSelf = rp.id === selfPlayerId;
                    const sectorTitle = rp.activeMissionId
                      ? MISSIONS.find((m) => m.id === rp.activeMissionId)?.title ?? 'Active Sector'
                      : rp.screenMode === 'space-academy'
                      ? 'Space Academy'
                      : 'Orbital View';
                    return (
                      <div
                        key={rp.id}
                        className="flex items-center justify-between px-2.5 py-2 bg-slate-900/75 border border-slate-800 rounded-lg text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: rp.color }}
                          />
                          <span className="font-semibold text-white truncate">
                            {rp.name} {isSelf ? '(You)' : ''}
                          </span>
                        </div>
                        <span className="font-mono-num text-[11px] text-cyan-300 truncate max-w-[140px]">
                          {sectorTitle}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Live Squad Radio Chat */}
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Squad Radio
              </div>
              <div className="h-44 overflow-y-auto p-2.5 bg-slate-950/90 border border-slate-800 rounded-xl space-y-2 text-xs">
                {chatMessages.length === 0 ? (
                  <div className="text-slate-500 text-center py-6">
                    Open frequency ready. Coordinate sector cleanups with your squad.
                  </div>
                ) : (
                  chatMessages.map((msg) => (
                    <div key={msg.id} className="leading-snug">
                      <span className="font-semibold mr-1.5" style={{ color: msg.color }}>
                        {msg.playerName}:
                      </span>
                      <span className="text-slate-200 break-words">{msg.text}</span>
                    </div>
                  ))
                )}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const text = chatInput.trim();
                  if (!text) return;
                  mpClientRef.current?.send({ type: 'chat:send', text });
                  setChatInput('');
                }}
                className="flex gap-1.5"
              >
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Transmit to squad..."
                  maxLength={220}
                  className="flex-1 min-w-0 px-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-cyan-400"
                />
                <button
                  type="submit"
                  aria-label="Send Radio Message"
                  className="px-3 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-lg transition-colors cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          </div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* SECTOR DEPLOYMENT / ORBITAL WARP TRANSITION LOADING SCREEN */}
      <AnimatePresence>
        {transitionScreen && (
          <motion.div
            key="sector-transition-loader"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#020612] p-6 text-center"
          >
            <div className="relative w-28 h-28 flex items-center justify-center mb-6">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 2.2, repeat: Infinity, ease: 'linear' }}
                className="absolute inset-0 rounded-full border-2 border-cyan-400/20 border-t-cyan-400 border-r-sky-300"
              />
              <motion.div
                animate={{ rotate: -360 }}
                transition={{ duration: 3.4, repeat: Infinity, ease: 'linear' }}
                className="absolute inset-3 rounded-full border-2 border-emerald-400/20 border-b-emerald-400"
              />
              <Rocket className="w-8 h-8 text-cyan-300" />
            </div>
            <div className="font-mono-num text-[11px] tracking-[0.28em] text-cyan-400 uppercase mb-2">
              {transitionScreen.badge}
            </div>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-wider text-white mb-1">
              {transitionScreen.title}
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 font-mono-num mb-6">
              {transitionScreen.subtitle}
            </p>
            <div className="w-64 sm:w-80 h-1.5 bg-slate-900 border border-cyan-500/30 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: '10%' }}
                animate={{ width: '100%' }}
                transition={{ duration: 0.55, ease: 'easeInOut' }}
                className="h-full bg-gradient-to-r from-cyan-400 via-sky-300 to-emerald-400"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* INITIAL PLANETARY ENGINE BOOT LOADING SCREEN */}
      <AnimatePresence>
        {!bootDone && (
          <motion.div
            key="boot-loading-screen"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.55, ease: 'easeInOut' }}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#02050f] p-6 text-center"
          >
            <div className="relative w-32 h-32 flex items-center justify-center mb-7">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 4.5, repeat: Infinity, ease: 'linear' }}
                className="absolute inset-0 rounded-full border-2 border-cyan-500/20 border-t-cyan-400"
              />
              <motion.div
                animate={{ rotate: -360 }}
                transition={{ duration: 3.1, repeat: Infinity, ease: 'linear' }}
                className="absolute inset-3 rounded-full border-2 border-amber-400/20 border-r-amber-300"
              />
              <motion.div
                animate={{ scale: [0.94, 1.04, 0.94] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                className="w-16 h-16 rounded-full bg-gradient-to-br from-cyan-400/30 via-sky-500/20 to-emerald-500/30 border border-cyan-400/50 flex items-center justify-center"
              >
                <Globe2 className="w-8 h-8 text-cyan-300" />
              </motion.div>
            </div>

            <div className="font-mono-num text-[11px] tracking-[0.32em] text-cyan-400 uppercase mb-2">
              ECLIPSE // PLANETARY GRAPHICS ENGINE
            </div>
            <h1 className="font-display text-3xl sm:text-5xl font-black tracking-[0.1em] text-transparent bg-clip-text bg-gradient-to-b from-white via-slate-200 to-cyan-300 mb-3">
              PROJECT ECLIPSE
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 font-mono-num mb-5 min-h-[20px]">
              {bootStage}
            </p>

            <div className="w-72 sm:w-96 space-y-2">
              <div className="h-2 bg-slate-900 border border-cyan-500/35 rounded-full overflow-hidden">
                <motion.div
                  animate={{ width: `${Math.max(4, bootProgress)}%` }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="h-full bg-gradient-to-r from-cyan-400 via-sky-300 to-emerald-400"
                />
              </div>
              <div className="flex items-center justify-between text-[11px] font-mono-num text-slate-400">
                <span>ULTRA 3K SHADERS · 4X MSAA</span>
                <span className="text-cyan-300 font-bold">{bootProgress}%</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </MotionConfig>
  );
}
