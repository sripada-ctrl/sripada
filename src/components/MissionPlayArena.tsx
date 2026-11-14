import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import {
  Activity,
  ArrowLeft,
  Bot,
  CheckCircle2,
  Clock,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Compass,
  Droplets,
  Eye,
  Flame,
  Gauge,
  Heart,
  Moon,
  Navigation,
  Nut,
  Package,
  PanelRightClose,
  PanelRightOpen,
  Radio,
  Recycle,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Sun,
  Sunrise,
  Thermometer,
  Trees,
  Users,
  Utensils,
  Waves,
  Wind,
  Wrench,
  Zap,
} from 'lucide-react';
import {
  GameProgressState,
  MissionCoopState,
  MissionDefinition,
  RemotePlayerState,
  SquadMember,
} from '../types/game';
import { soundEngine } from '../utils/audio';
import { getMissionClimateProfile } from '../utils/missionWeather';
import {
  createDetailedRockGeometry,
  createGrassTuftGeometry,
  createLayeredPineCanopyGeometry,
  createMissionPbrTextureLibrary,
  createOrganicCanopyGeometry,
  createSnowflakeSpriteTexture,
  createWildflowerClusterGeometry,
  MissionPbrTextureLibrary,
} from '../utils/missionPbrAssets';

interface MissionPlayArenaProps {
  mission: MissionDefinition;
  progress: GameProgressState;
  initialSolarHour?: number;
  liveClockText?: string;
  selfPlayerId?: string | null;
  remotePlayers?: RemotePlayerState[];
  coopSession?: MissionCoopState | null;
  onSendPlayerArenaPos?: (x: number, z: number) => void;
  onSendNodeAction?: (missionId: string, nodeId: string, kind: string) => void;
  onSendDiscovery?: (missionId: string, kind: 'bunker' | 'lab') => void;
  onResetCoopArena?: (missionId: string) => void;
  onUpdateProgress: (updater: (prev: GameProgressState) => GameProgressState) => void;
  onMissionComplete: (
    mission: MissionDefinition,
    stats: {
      ecoEarned: number;
      recycledNow: number;
      treesPlanted: number;
      coralsRestored: number;
      teammatesRescued: number;
      labDiscovered: boolean;
    }
  ) => void;
  onExitMission: () => void;
}

type BiomeTheme = 'tokyo-cyber' | 'coral-reef' | 'forest' | 'town' | 'space';

interface BodyPartHealth {
  head: number;
  body: number;
  leftArm: number;
  rightArm: number;
  leftLeg: number;
  rightLeg: number;
}

interface VitalityState {
  energy: number;
  hunger: number;
  thirst: number;
  speed: number;
  parts: BodyPartHealth;
}

function resolveBiomeTheme(mission: MissionDefinition): BiomeTheme {
  if (mission.arenaConfig.biomeTheme) return mission.arenaConfig.biomeTheme;
  if (mission.arenaConfig.isSpaceMission) return 'space';
  if (mission.category === 'polluted-ocean') return 'coral-reef';
  if (mission.category === 'damaged-forest' || mission.id.includes('wildfire')) return 'forest';
  if (mission.id === 'sunspire-coast' || mission.id.includes('cyber')) return 'tokyo-cyber';
  return 'town';
}

function createSeededRng(seedStr: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface WorldNode3D {
  id: string;
  kind:
    | 'rubbish'
    | 'tree-plot'
    | 'coral-plot'
    | 'equipment'
    | 'toxic-node'
    | 'citizen'
    | 'med-pod'
    | 'ration-pod'
    | 'water-pod'
    | 'smog-stack'
    | 'runoff-pipe';
  x: number;
  z: number;
  hidden: boolean;
  revealed: boolean;
  completed: boolean;
  mesh: THREE.Group;
  restoredMesh?: THREE.Group;
}

interface HazardZone3D {
  x: number;
  z: number;
  radius: number;
  kind: 'fire' | 'deep-current' | 'toxic-cloud';
  mesh: THREE.Group;
}

interface Wildlife3D {
  x: number;
  z: number;
  vx: number;
  vz: number;
  yOffset: number;
  mesh: THREE.Group;
}

// Expanded open-world terrain (-70 to +70 playable meters, terrain skirt out to ±135m)
const WORLD_SIZE = 140;
const HALF_WORLD = WORLD_SIZE / 2;
const PLAY_LIMIT = HALF_WORLD - 6;

function groundHeightAt(x: number, z: number, theme: BiomeTheme): number {
  if (theme === 'space') return 0;
  if (theme === 'tokyo-cyber' || theme === 'town') {
    // Smooth paved urban core with gentle natural hills outside the central grid
    const radial = Math.hypot(x, z);
    const cityFlat = Math.max(0, Math.min(1, (radial - 46) / 28));
    const hills =
      Math.sin(x * 0.06) * Math.cos(z * 0.06) * 2.2 +
      Math.sin(x * 0.14 + z * 0.1) * 0.7;
    const distEdge = Math.max(Math.abs(x), Math.abs(z));
    const rim = Math.max(0, (distEdge - 60) / 16);
    return hills * cityFlat + rim * rim * 3.2;
  }
  const distEdge = Math.max(Math.abs(x), Math.abs(z));
  const rim = Math.max(0, (distEdge - 58) / 16);
  const rollingHills =
    Math.sin(x * 0.065) * Math.cos(z * 0.065) * (theme === 'coral-reef' ? 1.05 : 1.55) +
    Math.sin(x * 0.14 + z * 0.11) * (theme === 'coral-reef' ? 0.5 : 0.65) +
    Math.cos(x * 0.27 - z * 0.21) * 0.22;
  const hubDist1 = Math.hypot(x + 24, z);
  const hubDist2 = Math.hypot(x - 28, z + 14);
  const hubFlat = Math.min(1, Math.min(hubDist1, hubDist2) / 10);
  return rollingHills * (0.35 + 0.65 * hubFlat) + rim * rim * 3.8;
}

function createCyberBillboardTexture(text: string, sub: string, accent: string, bg: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 256);

  ctx.strokeStyle = accent;
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, 492, 236);

  ctx.fillStyle = accent;
  ctx.font = 'bold 58px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, 256, 128);

  ctx.fillStyle = '#e2e8f0';
  ctx.font = '600 28px monospace';
  ctx.fillText(sub, 256, 192);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createSkyscraperFacadeTexture(accentHex: string, seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d')!;
  const rng = createSeededRng(`facade-${seed}`);

  ctx.fillStyle = '#090f1d';
  ctx.fillRect(0, 0, 512, 512);

  // Structural aluminum mullions
  ctx.fillStyle = '#131d33';
  for (let y = 0; y < 512; y += 32) {
    ctx.fillRect(0, y, 512, 5);
  }
  for (let x = 0; x < 512; x += 32) {
    ctx.fillRect(x, 0, 4, 512);
  }

  // Individual illuminated interior office windows
  for (let row = 0; row < 16; row++) {
    const floorActive = rng() > 0.22;
    for (let col = 0; col < 16; col++) {
      const wx = col * 32 + 6;
      const wy = row * 32 + 7;
      const litRoll = rng();
      if (floorActive && litRoll > 0.36) {
        if (litRoll > 0.88) {
          ctx.fillStyle = accentHex;
        } else if (litRoll > 0.62) {
          ctx.fillStyle = '#bae6fd';
        } else {
          ctx.fillStyle = '#fde68a';
        }
        ctx.fillRect(wx, wy, 20, 18);
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.fillRect(wx, wy, 20, 4);
      } else {
        ctx.fillStyle = '#0f1a2e';
        ctx.fillRect(wx, wy, 20, 18);
      }
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function createTerrainTextures(
  theme: BiomeTheme,
  restoredRatio: number
): {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  aoMap: THREE.CanvasTexture;
} {
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;

  const nCanvas = document.createElement('canvas');
  nCanvas.width = size;
  nCanvas.height = size;
  const nCtx = nCanvas.getContext('2d')!;

  const rCanvas = document.createElement('canvas');
  rCanvas.width = size;
  rCanvas.height = size;
  const rCtx = rCanvas.getContext('2d')!;

  const aoCanvas = document.createElement('canvas');
  aoCanvas.width = size;
  aoCanvas.height = size;
  const aoCtx = aoCanvas.getContext('2d')!;

  const rng = createSeededRng(`terrain-${theme}-${restoredRatio > 0.5 ? 1 : 0}`);

  if (theme === 'coral-reef') {
    ctx.fillStyle = restoredRatio > 0.45 ? '#157c94' : '#243a47';
    ctx.fillRect(0, 0, size, size);
    rCtx.fillStyle = '#626262';
    rCtx.fillRect(0, 0, size, size);

    // Seabed current sand ripples
    for (let y = 0; y < size; y += 6) {
      const wave = Math.sin((y / size) * Math.PI * 16) * 10;
      ctx.strokeStyle =
        restoredRatio > 0.45 ? 'rgba(186, 230, 253, 0.11)' : 'rgba(100, 116, 139, 0.1)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, y + wave);
      ctx.lineTo(size, y - wave);
      ctx.stroke();
    }

    for (let i = 0; i < 9500; i++) {
      const rx = rng() * size;
      const ry = rng() * size;
      const rad = 1.2 + rng() * 4.5;
      ctx.fillStyle =
        restoredRatio > 0.45
          ? i % 3 === 0
            ? 'rgba(103, 232, 249, 0.18)'
            : i % 3 === 1
            ? 'rgba(253, 224, 171, 0.14)'
            : 'rgba(14, 116, 144, 0.16)'
          : i % 3 === 0
          ? 'rgba(148, 163, 184, 0.15)'
          : 'rgba(30, 41, 59, 0.2)';
      ctx.beginPath();
      ctx.arc(rx, ry, rad, 0, Math.PI * 2);
      ctx.fill();
      if (i % 2 === 0) {
        rCtx.fillStyle = i % 4 === 0 ? '#343434' : '#7a7a7a';
        rCtx.fillRect(rx, ry, 5, 5);
      }
    }
  } else if (theme === 'space') {
    ctx.fillStyle = '#11192c';
    ctx.fillRect(0, 0, size, size);
    rCtx.fillStyle = '#4c4c4c';
    rCtx.fillRect(0, 0, size, size);

    // Brushed titanium grain
    for (let i = 0; i < 4000; i++) {
      const rx = rng() * size;
      const ry = rng() * size;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(148, 163, 184, 0.08)' : 'rgba(15, 23, 42, 0.15)';
      ctx.fillRect(rx, ry, 18 + rng() * 26, 2);
    }

    // Precision hull deck panels & rivets
    const step = size / 16;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.28)';
    ctx.lineWidth = 3;
    rCtx.strokeStyle = '#1c1c1c';
    rCtx.lineWidth = 4;
    for (let g = 0; g <= size; g += step) {
      ctx.beginPath();
      ctx.moveTo(g, 0);
      ctx.lineTo(g, size);
      ctx.moveTo(0, g);
      ctx.lineTo(size, g);
      ctx.stroke();

      rCtx.beginPath();
      rCtx.moveTo(g, 0);
      rCtx.lineTo(g, size);
      rCtx.moveTo(0, g);
      rCtx.lineTo(size, g);
      rCtx.stroke();
    }
    ctx.fillStyle = 'rgba(186, 230, 253, 0.35)';
    for (let gx = 0; gx < size; gx += step) {
      for (let gy = 0; gy < size; gy += step) {
        ctx.fillRect(gx + 6, gy + 6, 3, 3);
        ctx.fillRect(gx + step - 9, gy + step - 9, 3, 3);
      }
    }
  } else if (theme === 'tokyo-cyber') {
    // Ultra-detailed wet tarmac with mineral asphalt speckle, rain puddles & crisp lane markings
    ctx.fillStyle = restoredRatio > 0.55 ? '#1b2434' : '#171922';
    ctx.fillRect(0, 0, size, size);
    rCtx.fillStyle = '#4e4e4e';
    rCtx.fillRect(0, 0, size, size);

    // Asphalt mineral aggregate
    for (let i = 0; i < 12000; i++) {
      const rx = rng() * size;
      const ry = rng() * size;
      const sz = 1.5 + rng() * 3.5;
      ctx.fillStyle =
        i % 5 === 0
          ? 'rgba(148, 163, 184, 0.14)'
          : i % 3 === 0
          ? 'rgba(15, 23, 42, 0.35)'
          : 'rgba(51, 65, 85, 0.22)';
      ctx.fillRect(rx, ry, sz, sz);
      if (i % 3 === 0) {
        rCtx.fillStyle = i % 6 === 0 ? '#686868' : '#3a3a3a';
        rCtx.fillRect(rx, ry, sz * 1.4, sz * 1.4);
      }
    }

    // Mirror-glossy rain puddle patches
    for (let p = 0; p < 18; p++) {
      const px = rng() * size;
      const py = rng() * size;
      const pr = 26 + rng() * 58;
      const grad = ctx.createRadialGradient(px, py, 4, px, py, pr);
      grad.addColorStop(0, 'rgba(6, 12, 24, 0.45)');
      grad.addColorStop(1, 'rgba(6, 12, 24, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fill();

      rCtx.fillStyle = '#0c0c0c';
      rCtx.beginPath();
      rCtx.arc(px, py, pr * 0.78, 0, Math.PI * 2);
      rCtx.fill();
    }

    // Urban expansion plate seams
    ctx.strokeStyle = 'rgba(10, 14, 24, 0.55)';
    ctx.lineWidth = 3;
    for (let g = 0; g <= size; g += size / 8) {
      ctx.beginPath();
      ctx.moveTo(g, 0);
      ctx.lineTo(g, size);
      ctx.moveTo(0, g);
      ctx.lineTo(size, g);
      ctx.stroke();
    }

    // Neon lane borders & crosswalk bars
    ctx.strokeStyle = restoredRatio > 0.55 ? 'rgba(34, 211, 238, 0.58)' : 'rgba(244, 63, 94, 0.48)';
    ctx.lineWidth = 10;
    ctx.strokeRect(size * 0.14, size * 0.14, size * 0.72, size * 0.72);
    ctx.beginPath();
    ctx.moveTo(size / 2, 0);
    ctx.lineTo(size / 2, size);
    ctx.moveTo(0, size / 2);
    ctx.lineTo(size, size / 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(226, 232, 240, 0.32)';
    for (let z = -3; z <= 3; z++) {
      ctx.fillRect(size * 0.44 + z * 20, size * 0.12, 11, 34);
      ctx.fillRect(size * 0.12, size * 0.44 + z * 20, 34, 11);
    }
  } else if (theme === 'town') {
    ctx.fillStyle = restoredRatio > 0.55 ? '#2f543c' : '#3f403f';
    ctx.fillRect(0, 0, size, size);
    rCtx.fillStyle = '#9e9e9e';
    rCtx.fillRect(0, 0, size, size);

    for (let i = 0; i < 11000; i++) {
      const rx = rng() * size;
      const ry = rng() * size;
      const rad = 1.4 + rng() * 3.8;
      ctx.fillStyle =
        restoredRatio > 0.55
          ? i % 3 === 0
            ? 'rgba(74, 222, 128, 0.18)'
            : 'rgba(22, 101, 52, 0.2)'
          : i % 3 === 0
          ? 'rgba(120, 113, 108, 0.22)'
          : 'rgba(68, 64, 60, 0.24)';
      ctx.beginPath();
      ctx.arc(rx, ry, rad, 0, Math.PI * 2);
      ctx.fill();
    }

    // Sidewalk flagstones bordering roads
    ctx.fillStyle = '#475569';
    ctx.fillRect(size * 0.39, 0, size * 0.22, size);
    ctx.fillRect(0, size * 0.39, size, size * 0.22);
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.45)';
    ctx.lineWidth = 2;
    for (let s = 0; s < size; s += 32) {
      ctx.strokeRect(size * 0.39, s, size * 0.04, 32);
      ctx.strokeRect(size * 0.57, s, size * 0.04, 32);
    }

    // Asphalt roadbed + curb shadows + crisp dashed yellow divider
    ctx.fillStyle = '#252a32';
    ctx.fillRect(size * 0.43, 0, size * 0.14, size);
    ctx.fillRect(0, size * 0.43, size, size * 0.14);
    rCtx.fillStyle = '#5a5a5a';
    rCtx.fillRect(size * 0.43, 0, size * 0.14, size);
    rCtx.fillRect(0, size * 0.43, size, size * 0.14);

    ctx.strokeStyle = 'rgba(250, 204, 21, 0.58)';
    ctx.lineWidth = 7;
    ctx.setLineDash([28, 24]);
    ctx.beginPath();
    ctx.moveTo(size * 0.5, 0);
    ctx.lineTo(size * 0.5, size);
    ctx.moveTo(0, size * 0.5);
    ctx.lineTo(size, size * 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    // Non-blocky Minecraft-style lush emerald meadows, mossy trails, sunlit clover & forest loam
    ctx.fillStyle = restoredRatio > 0.5 ? '#236e38' : '#3a4a30';
    ctx.fillRect(0, 0, size, size);
    rCtx.fillStyle = '#c4c4c4';
    rCtx.fillRect(0, 0, size, size);

    // Subtle winding pebble & earth trail ribbon
    ctx.strokeStyle = restoredRatio > 0.5 ? 'rgba(138, 108, 72, 0.36)' : 'rgba(104, 82, 58, 0.42)';
    ctx.lineWidth = 42;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, size * 0.48);
    ctx.bezierCurveTo(size * 0.32, size * 0.36, size * 0.68, size * 0.62, size, size * 0.48);
    ctx.stroke();

    for (let i = 0; i < 14000; i++) {
      const rx = rng() * size;
      const ry = rng() * size;
      const rad = 1.2 + rng() * 4.4;
      ctx.fillStyle =
        restoredRatio > 0.5
          ? i % 4 === 0
            ? 'rgba(134, 239, 172, 0.24)'
            : i % 2 === 0
            ? 'rgba(34, 150, 74, 0.26)'
            : 'rgba(21, 94, 46, 0.22)'
          : i % 3 === 0
          ? 'rgba(118, 134, 96, 0.20)'
          : 'rgba(84, 68, 50, 0.24)';
      ctx.beginPath();
      ctx.arc(rx, ry, rad, 0, Math.PI * 2);
      ctx.fill();
      if (i % 3 === 0) {
        rCtx.fillStyle = i % 6 === 0 ? '#909090' : '#d6d6d6';
        rCtx.fillRect(rx, ry, 5, 5);
      }
    }
  }

  // Tangent-space Normal Map + Crevice Ambient Occlusion Map derived from typed luminance array
  const srcImg = ctx.getImageData(0, 0, size, size).data;
  const nImg = nCtx.createImageData(size, size);
  const nData = nImg.data;
  const aoImg = aoCtx.createImageData(size, size);
  const aoData = aoImg.data;
  const lum = new Float32Array(size * size);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    lum[i] = (srcImg[p] * 0.299 + srcImg[p + 1] * 0.587 + srcImg[p + 2] * 0.114) / 255;
  }
  const bumpStrength = theme === 'space' ? 3.0 : 4.6;
  const mask = size - 1;
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1) & mask) * size;
    const yp = ((y + 1) & mask) * size;
    const row = y * size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1) & mask;
      const xp = (x + 1) & mask;
      const cLum = lum[row + x];
      const dx = (lum[row + xm] - lum[row + xp]) * bumpStrength;
      const dy = (lum[ym + x] - lum[yp + x]) * bumpStrength;
      const invLen = 1 / Math.hypot(dx, dy, 1);
      const idx = (row + x) * 4;
      nData[idx] = Math.round((dx * invLen * 0.5 + 0.5) * 255);
      nData[idx + 1] = Math.round((dy * invLen * 0.5 + 0.5) * 255);
      nData[idx + 2] = Math.round((invLen * 0.5 + 0.5) * 255);
      nData[idx + 3] = 255;

      const avgNeighbor = (lum[row + xm] + lum[row + xp] + lum[ym + x] + lum[yp + x]) * 0.25;
      const aoVal = Math.max(115, Math.min(255, Math.round((0.88 + (cLum - avgNeighbor) * 1.65) * 255)));
      aoData[idx] = aoVal;
      aoData[idx + 1] = aoVal;
      aoData[idx + 2] = aoVal;
      aoData[idx + 3] = 255;
    }
  }
  nCtx.putImageData(nImg, 0, 0);
  aoCtx.putImageData(aoImg, 0, 0);

  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(9, 9);

  const normalMap = new THREE.CanvasTexture(nCanvas);
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.repeat.set(9, 9);

  const roughnessMap = new THREE.CanvasTexture(rCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(9, 9);

  const aoMap = new THREE.CanvasTexture(aoCanvas);
  aoMap.wrapS = THREE.RepeatWrapping;
  aoMap.wrapT = THREE.RepeatWrapping;
  aoMap.repeat.set(9, 9);

  return { map, normalMap, roughnessMap, aoMap };
}

function buildEcoRangerMesh(suitColor: number, isPlayer: boolean) {
  const g = new THREE.Group();
  const bodyRig = new THREE.Group();
  g.add(bodyRig);

  const suitMat = new THREE.MeshStandardMaterial({ color: suitColor, roughness: 0.42, metalness: 0.25 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.65, metalness: 0.35 });
  const visorMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0284c7,
    emissiveIntensity: 1.1,
    roughness: 0.12,
    metalness: 0.85,
  });

  // Hip-pivoted legs so Minecraft-style swimming kicks & walking strides rotate cleanly from the hip
  const legL = new THREE.Group();
  legL.position.set(-0.2, 0.85, 0);
  const legLMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.52, 6, 8), darkMat);
  legLMesh.position.y = -0.38;
  legLMesh.castShadow = true;
  legL.add(legLMesh);

  const legR = new THREE.Group();
  legR.position.set(0.2, 0.85, 0);
  const legRMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.52, 6, 8), darkMat);
  legRMesh.position.y = -0.38;
  legRMesh.castShadow = true;
  legR.add(legRMesh);

  // Shoulder-pivoted arms for Minecraft-style swimming strokes & swinging walk
  const armL = new THREE.Group();
  armL.position.set(-0.46, 1.56, 0);
  const armLMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.46, 6, 8), suitMat);
  armLMesh.position.y = -0.3;
  armLMesh.castShadow = true;
  armL.add(armLMesh);

  const armR = new THREE.Group();
  armR.position.set(0.46, 1.56, 0);
  const armRMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.46, 6, 8), suitMat);
  armRMesh.position.y = -0.3;
  armRMesh.castShadow = true;
  armR.add(armRMesh);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.52, 8, 12), suitMat);
  torso.position.y = 1.25;
  torso.castShadow = true;

  const head = new THREE.Group();
  head.position.y = 1.96;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 16), suitMat);
  helmet.castShadow = true;
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10, 0, Math.PI, 0.3, Math.PI * 0.42), visorMat);
  visor.position.set(0, 0, 0.16);
  head.add(helmet, visor);

  const packShell = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 0.72, 12),
    new THREE.MeshPhysicalMaterial({
      color: 0x94a3b8,
      transparent: true,
      opacity: 0.45,
      roughness: 0.15,
      metalness: 0.2,
    })
  );
  packShell.position.set(0, 1.32, -0.34);

  const packFill = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.17, 0.62, 12),
    new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x059669,
      emissiveIntensity: 0.8,
      roughness: 0.3,
    })
  );
  packFill.position.set(0, 1.32, -0.34);
  packFill.scale.y = 0.05;

  bodyRig.add(legL, legR, armL, armR, torso, head, packShell);
  if (isPlayer) bodyRig.add(packFill);

  return { group: g, bodyRig, head, legL, legR, armL, armR, packFill, suitMat };
}

interface ArenaNodeAssetCache {
  treeTrunkGeo: THREE.BufferGeometry;
  treeTrunkMat: THREE.Material;
  treeCrown1Geo: THREE.BufferGeometry;
  treeCrown2Geo: THREE.BufferGeometry;
  treeCrown3Geo: THREE.BufferGeometry;
  treeFoliageMat1: THREE.Material;
  treeFoliageMat2: THREE.Material;
  coralBranchGeos: THREE.BufferGeometry[];
  coralLiveMats: THREE.Material[];
  coralDeadMats: THREE.Material[];
  trashGrimeGeo: THREE.BufferGeometry;
  trashCanGeo: THREE.BufferGeometry;
  trashBottleGeo: THREE.BufferGeometry;
  trashBoxGeo: THREE.BufferGeometry;
  trashTireGeo: THREE.BufferGeometry;
  trashMetalVisibleMat: THREE.Material;
  trashMetalHiddenMat: THREE.Material;
  trashPlasticMat: THREE.Material;
  trashRustMat: THREE.Material;
  trashTireMat: THREE.Material;
  trashGrimeVisibleMat: THREE.Material;
  trashGrimeHiddenMat: THREE.Material;
  contactShadowGeo: THREE.BufferGeometry;
  contactShadowMat: THREE.Material;
}

function createArenaNodeAssetCache(
  disposableGeometries: THREE.BufferGeometry[],
  disposableMaterials: THREE.Material[],
  pbr: MissionPbrTextureLibrary
): ArenaNodeAssetCache {
  const regGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    disposableGeometries.push(g);
    return g;
  };
  const regMat = <T extends THREE.Material>(m: T): T => {
    disposableMaterials.push(m);
    return m;
  };

  const liveColors = [0xf472b6, 0x2dd4bf, 0xfb923c, 0xc084fc];
  const deadColors = [0x78716c, 0x57534e, 0x94a3b8];

  const baseCanopy = createOrganicCanopyGeometry();
  const midCanopy = baseCanopy.clone().scale(0.76, 0.72, 0.76);
  const topCanopy = baseCanopy.clone().scale(0.62, 0.65, 0.62);

  return {
    treeTrunkGeo: regGeo(new THREE.CylinderGeometry(0.18, 0.34, 2.0, 12)),
    treeTrunkMat: regMat(
      new THREE.MeshStandardMaterial({
        map: pbr.barkMap,
        normalMap: pbr.barkNormal,
        normalScale: new THREE.Vector2(1.4, 1.4),
        roughness: 0.9,
      })
    ),
    treeCrown1Geo: regGeo(baseCanopy),
    treeCrown2Geo: regGeo(midCanopy),
    treeCrown3Geo: regGeo(topCanopy),
    treeFoliageMat1: regMat(
      new THREE.MeshStandardMaterial({
        map: pbr.leafMap,
        normalMap: pbr.leafNormal,
        normalScale: new THREE.Vector2(1.1, 1.1),
        color: 0xdcfce7,
        roughness: 0.74,
      })
    ),
    treeFoliageMat2: regMat(
      new THREE.MeshStandardMaterial({
        map: pbr.leafMap,
        normalMap: pbr.leafNormal,
        normalScale: new THREE.Vector2(1.0, 1.0),
        color: 0x86efac,
        roughness: 0.68,
      })
    ),

    coralBranchGeos: Array.from({ length: 5 }, (_, i) =>
      regGeo(new THREE.CapsuleGeometry(0.18 - i * 0.015, 0.95 + (i % 2) * 0.45, 5, 10))
    ),
    coralLiveMats: liveColors.map((col) =>
      regMat(
        new THREE.MeshPhysicalMaterial({
          color: col,
          emissive: col,
          emissiveIntensity: 0.42,
          roughness: 0.42,
          clearcoat: 0.55,
          clearcoatRoughness: 0.25,
        })
      )
    ),
    coralDeadMats: deadColors.map((col) =>
      regMat(
        new THREE.MeshStandardMaterial({
          map: pbr.rockMap,
          normalMap: pbr.rockNormal,
          color: col,
          roughness: 0.78,
        })
      )
    ),

    trashGrimeGeo: regGeo(new THREE.CircleGeometry(1.45, 18)),
    trashCanGeo: regGeo(new THREE.CylinderGeometry(0.36, 0.4, 0.84, 14)),
    trashBottleGeo: regGeo(new THREE.CylinderGeometry(0.1, 0.13, 0.46, 10)),
    trashBoxGeo: regGeo(new THREE.BoxGeometry(0.46, 0.28, 0.38)),
    trashTireGeo: regGeo(new THREE.TorusGeometry(0.28, 0.095, 10, 18)),

    trashMetalVisibleMat: regMat(
      new THREE.MeshStandardMaterial({
        map: pbr.rustMap,
        normalMap: pbr.rustNormal,
        normalScale: new THREE.Vector2(1.15, 1.15),
        roughnessMap: pbr.rustRoughness,
        color: 0xcbd5e1,
        roughness: 0.55,
        metalness: 0.65,
      })
    ),
    trashMetalHiddenMat: regMat(
      new THREE.MeshStandardMaterial({
        map: pbr.rustMap,
        normalMap: pbr.rustNormal,
        color: 0xf59e0b,
        emissive: 0xd97706,
        emissiveIntensity: 0.82,
        roughness: 0.55,
        metalness: 0.45,
      })
    ),
    trashPlasticMat: regMat(
      new THREE.MeshPhysicalMaterial({
        color: 0x38bdf8,
        roughness: 0.14,
        metalness: 0.06,
        clearcoat: 1.0,
        clearcoatRoughness: 0.08,
        transparent: true,
        opacity: 0.86,
      })
    ),
    trashRustMat: regMat(
      new THREE.MeshStandardMaterial({
        map: pbr.rustMap,
        normalMap: pbr.rustNormal,
        roughnessMap: pbr.rustRoughness,
        color: 0xd97706,
        roughness: 0.78,
        metalness: 0.52,
      })
    ),
    trashTireMat: regMat(new THREE.MeshStandardMaterial({ color: 0x171717, roughness: 0.92 })),
    trashGrimeVisibleMat: regMat(
      new THREE.MeshPhysicalMaterial({
        color: 0x1c1917,
        roughness: 0.22,
        clearcoat: 0.9,
        clearcoatRoughness: 0.12,
        transparent: true,
        opacity: 0.68,
      })
    ),
    trashGrimeHiddenMat: regMat(
      new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.58 })
    ),
    contactShadowGeo: regGeo(new THREE.PlaneGeometry(2.6, 2.6)),
    contactShadowMat: regMat(
      new THREE.MeshBasicMaterial({
        map: pbr.contactShadowTex,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      })
    ),
  };
}

function buildLushTreeMesh(cache: ArenaNodeAssetCache, allowShadows: boolean) {
  const g = new THREE.Group();
  const shadowDisc = new THREE.Mesh(cache.contactShadowGeo, cache.contactShadowMat);
  shadowDisc.rotation.x = -Math.PI / 2;
  shadowDisc.position.y = 0.04;

  const trunk = new THREE.Mesh(cache.treeTrunkGeo, cache.treeTrunkMat);
  trunk.position.y = 1.0;
  trunk.castShadow = allowShadows;
  trunk.receiveShadow = allowShadows;

  const c1 = new THREE.Mesh(cache.treeCrown1Geo, cache.treeFoliageMat1);
  c1.position.set(0, 2.45, 0);
  c1.castShadow = allowShadows;
  c1.receiveShadow = allowShadows;

  const c2 = new THREE.Mesh(cache.treeCrown2Geo, cache.treeFoliageMat2);
  c2.position.set(0.32, 3.25, 0.22);
  c2.castShadow = allowShadows;

  const c3 = new THREE.Mesh(cache.treeCrown3Geo, cache.treeFoliageMat1);
  c3.position.set(-0.32, 3.1, -0.18);

  g.add(shadowDisc, trunk, c1, c2, c3);
  return g;
}

function buildCoralReefMesh(living: boolean, cache: ArenaNodeAssetCache) {
  const g = new THREE.Group();
  const mats = living ? cache.coralLiveMats : cache.coralDeadMats;
  for (let i = 0; i < 5; i++) {
    const branch = new THREE.Mesh(cache.coralBranchGeos[i], mats[i % mats.length]);
    const angle = (i / 5) * Math.PI * 2;
    branch.position.set(Math.cos(angle) * 0.38, 0.58, Math.sin(angle) * 0.38);
    branch.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.26;
    g.add(branch);
  }
  return g;
}

function buildTrashClusterMesh(isHidden: boolean, cache: ArenaNodeAssetCache, allowShadows: boolean) {
  const g = new THREE.Group();

  const shadowDisc = new THREE.Mesh(cache.contactShadowGeo, cache.contactShadowMat);
  shadowDisc.rotation.x = -Math.PI / 2;
  shadowDisc.position.y = 0.025;
  shadowDisc.scale.setScalar(1.15);

  // Ground grime/oil spill stain that disappears when you clean the trash area
  const grime = new THREE.Mesh(
    cache.trashGrimeGeo,
    isHidden ? cache.trashGrimeHiddenMat : cache.trashGrimeVisibleMat
  );
  grime.rotation.x = -Math.PI / 2;
  grime.position.y = 0.04;

  // Main barrel/crate + surrounding local trash cluster
  const mainCan = new THREE.Mesh(
    cache.trashCanGeo,
    isHidden ? cache.trashMetalHiddenMat : cache.trashMetalVisibleMat
  );
  mainCan.position.y = 0.45;
  mainCan.castShadow = allowShadows;
  mainCan.receiveShadow = allowShadows;

  const bottle = new THREE.Mesh(cache.trashBottleGeo, cache.trashPlasticMat);
  bottle.position.set(0.68, 0.16, 0.42);
  bottle.rotation.set(1.2, 0.4, 0.5);

  const scrapBox = new THREE.Mesh(cache.trashBoxGeo, cache.trashRustMat);
  scrapBox.position.set(-0.62, 0.15, -0.35);
  scrapBox.rotation.y = 0.7;
  scrapBox.castShadow = allowShadows;

  const tire = new THREE.Mesh(cache.trashTireGeo, cache.trashTireMat);
  tire.position.set(0.45, 0.1, -0.6);
  tire.rotation.x = Math.PI / 2;
  tire.castShadow = allowShadows;

  g.add(shadowDisc, grime, mainCan, bottle, scrapBox, tire);
  return g;
}

function buildRecyclerMachineMesh(
  pbr: MissionPbrTextureLibrary,
  isSoftwareGl: boolean,
  disposableGeometries: THREE.BufferGeometry[],
  disposableMaterials: THREE.Material[]
) {
  const g = new THREE.Group();
  const baseMat = new THREE.MeshStandardMaterial({
    map: pbr.rustMap,
    normalMap: pbr.rustNormal,
    roughnessMap: pbr.rustRoughness,
    color: 0x334155,
    metalness: 0.78,
    roughness: 0.34,
  });
  const darkSteelMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.85, roughness: 0.32 });
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0x10b981,
    emissive: 0x10b981,
    emissiveIntensity: 1.35,
    roughness: 0.18,
  });
  const glassChamberMat = new THREE.MeshPhysicalMaterial({
    color: 0xa7f3d0,
    roughness: 0.08,
    metalness: 0.05,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    ior: 1.48,
    transmission: isSoftwareGl ? 0 : 0.48,
    transparent: true,
    opacity: isSoftwareGl ? 0.5 : 0.94,
  });
  const shadowMat = new THREE.MeshBasicMaterial({
    map: pbr.contactShadowTex,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  disposableMaterials.push(baseMat, darkSteelMat, accentMat, glassChamberMat, shadowMat);

  const shadowGeo = new THREE.PlaneGeometry(6.8, 6.8);
  const plinthGeo = new THREE.CylinderGeometry(2.35, 2.75, 0.5, 24);
  const collarGeo = new THREE.CylinderGeometry(1.45, 1.55, 0.9, 20);
  const chamberGeo = new THREE.CylinderGeometry(1.18, 1.18, 1.45, 24);
  const innerCoreGeo = new THREE.CylinderGeometry(0.55, 0.55, 1.32, 12);
  const drumGeo = new THREE.TorusGeometry(1.48, 0.14, 12, 32);
  const hopperGeo = new THREE.CylinderGeometry(1.65, 0.95, 0.72, 18);
  const finGeo = new THREE.BoxGeometry(0.18, 2.2, 0.48);
  const beaconGeo = new THREE.OctahedronGeometry(0.46, 0);
  disposableGeometries.push(
    shadowGeo,
    plinthGeo,
    collarGeo,
    chamberGeo,
    innerCoreGeo,
    drumGeo,
    hopperGeo,
    finGeo,
    beaconGeo
  );

  const shadowDisc = new THREE.Mesh(shadowGeo, shadowMat);
  shadowDisc.rotation.x = -Math.PI / 2;
  shadowDisc.position.y = 0.04;

  const plinth = new THREE.Mesh(plinthGeo, darkSteelMat);
  plinth.position.y = 0.25;
  plinth.receiveShadow = true;

  const lowerCollar = new THREE.Mesh(collarGeo, baseMat);
  lowerCollar.position.y = 0.95;
  lowerCollar.castShadow = !isSoftwareGl;

  const chamber = new THREE.Mesh(chamberGeo, glassChamberMat);
  chamber.position.y = 2.08;

  const innerCore = new THREE.Mesh(innerCoreGeo, accentMat);
  innerCore.position.y = 2.08;

  const drum = new THREE.Mesh(drumGeo, accentMat);
  drum.rotation.x = Math.PI / 2;
  drum.position.y = 2.08;

  const hopper = new THREE.Mesh(hopperGeo, baseMat);
  hopper.position.y = 3.12;
  hopper.castShadow = !isSoftwareGl;

  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(finGeo, darkSteelMat);
    const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
    fin.position.set(Math.cos(ang) * 1.48, 1.65, Math.sin(ang) * 1.48);
    fin.rotation.y = -ang;
    g.add(fin);
  }

  const beacon = new THREE.Mesh(beaconGeo, accentMat);
  beacon.position.y = 4.25;

  const stationLight = new THREE.PointLight(0x10b981, 6, 15);
  stationLight.position.y = 2.6;

  g.add(shadowDisc, plinth, lowerCollar, chamber, innerCore, drum, hopper, beacon, stationLight);
  return { group: g, drum, beacon, innerCore };
}

function buildRobotCompanionMesh(
  disposableGeometries: THREE.BufferGeometry[],
  disposableMaterials: THREE.Material[]
) {
  const g = new THREE.Group();
  const hullMat = new THREE.MeshPhysicalMaterial({
    color: 0xe2e8f0,
    metalness: 0.85,
    roughness: 0.18,
    clearcoat: 0.75,
    clearcoatRoughness: 0.1,
  });
  const collarMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.75, roughness: 0.35 });
  const visorMat = new THREE.MeshPhysicalMaterial({
    color: 0x38bdf8,
    emissive: 0x0ea5e9,
    emissiveIntensity: 1.7,
    roughness: 0.08,
    clearcoat: 1.0,
  });
  const haloMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 1.3 });
  disposableMaterials.push(hullMat, collarMat, visorMat, haloMat);

  const bodyGeo = new THREE.SphereGeometry(0.45, 22, 22);
  const collarGeo = new THREE.CylinderGeometry(0.47, 0.47, 0.12, 20);
  const eyeGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.16, 16);
  const wingGeo = new THREE.BoxGeometry(0.32, 0.08, 0.2);
  const thrusterGeo = new THREE.ConeGeometry(0.16, 0.32, 12);
  const haloGeo = new THREE.TorusGeometry(0.7, 0.048, 10, 32);
  disposableGeometries.push(bodyGeo, collarGeo, eyeGeo, wingGeo, thrusterGeo, haloGeo);

  const body = new THREE.Mesh(bodyGeo, hullMat);
  const collar = new THREE.Mesh(collarGeo, collarMat);
  const eye = new THREE.Mesh(eyeGeo, visorMat);
  eye.rotation.x = Math.PI / 2;
  eye.position.z = 0.39;

  const wingL = new THREE.Mesh(wingGeo, collarMat);
  wingL.position.set(-0.52, 0.04, 0);
  wingL.rotation.z = 0.25;
  const wingR = new THREE.Mesh(wingGeo, collarMat);
  wingR.position.set(0.52, 0.04, 0);
  wingR.rotation.z = -0.25;

  const thruster = new THREE.Mesh(thrusterGeo, visorMat);
  thruster.rotation.x = Math.PI;
  thruster.position.y = -0.52;

  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.rotation.x = Math.PI / 2;

  g.add(body, collar, eye, wingL, wingR, thruster, halo);
  return { group: g, halo };
}

function partColor(pct: number): string {
  if (pct >= 72) return '#22c55e'; // vibrant healthy green
  if (pct >= 45) return '#eab308'; // caution amber
  if (pct >= 22) return '#f97316'; // injured orange
  return '#ef4444'; // critical red
}

export const MissionPlayArena: React.FC<MissionPlayArenaProps> = ({
  mission,
  progress,
  initialSolarHour = 13.5,
  liveClockText,
  selfPlayerId = null,
  remotePlayers = [],
  coopSession = null,
  onSendPlayerArenaPos,
  onSendNodeAction,
  onSendDiscovery,
  onResetCoopArena,
  onUpdateProgress,
  onMissionComplete,
  onExitMission,
}) => {
  const theme = resolveBiomeTheme(mission);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const coopRef = useRef({
    selfPlayerId,
    remotePlayers,
    coopSession,
    onSendPlayerArenaPos,
    onSendNodeAction,
    onSendDiscovery,
    onResetCoopArena,
  });
  coopRef.current = {
    selfPlayerId,
    remotePlayers,
    coopSession,
    onSendPlayerArenaPos,
    onSendNodeAction,
    onSendDiscovery,
    onResetCoopArena,
  };

  const climateProfile = getMissionClimateProfile(mission, theme);
  const [weatherIndex, setWeatherIndex] = useState<number>(0);
  const weatherIndexRef = useRef<number>(0);
  weatherIndexRef.current = weatherIndex;
  const climateRef = useRef(climateProfile);
  climateRef.current = climateProfile;
  const activeWeather = climateProfile.cycle[weatherIndex % climateProfile.cycle.length];

  const [arenaSolarMode, setArenaSolarMode] = useState<'auto' | 'day' | 'sunset' | 'night'>(
    theme === 'tokyo-cyber' ? 'sunset' : 'auto'
  );
  const [arenaSolarHour, setArenaSolarHour] = useState<number>(
    theme === 'tokyo-cyber' ? 19.2 : initialSolarHour
  );
  const arenaSolarRef = useRef({ mode: arenaSolarMode, hour: arenaSolarHour });
  arenaSolarRef.current.mode = arenaSolarMode;

  const [firstPerson, setFirstPerson] = useState<boolean>(true);
  const firstPersonRef = useRef<boolean>(true);
  firstPersonRef.current = firstPerson;

  const [pointerLocked, setPointerLocked] = useState<boolean>(false);
  // Start sidebar closed so the 3D Mission Viewing Panel is full-screen & massive immediately
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);
  const [damageFlash, setDamageFlash] = useState<boolean>(false);

  const hasFastCollect = progress.unlockedTechIds.includes('bp-fast-collect');
  const hasScannerOptics = progress.unlockedTechIds.includes('robot-scanner');
  const hasRobotCollector = progress.unlockedTechIds.includes('robot-collector');
  const hasRobotOverdrive = progress.unlockedTechIds.includes('robot-overdrive');
  const hasPlasmaRecycler = progress.unlockedTechIds.includes('env-recycler');
  const hasForestTech = progress.unlockedTechIds.includes('env-forest');
  const hasWaterTech = progress.unlockedTechIds.includes('env-purifier');
  const hasOceanTech = progress.unlockedTechIds.includes('env-ocean');
  const hasRescueKit = progress.unlockedTechIds.includes('rescue-kit');

  const maxHealth = hasRescueKit ? 130 : 100;

  const [health, setHealth] = useState(maxHealth);
  const [oxygen, setOxygen] = useState(100);
  const [toxicity, setToxicity] = useState(0);
  const [isSwimmingHud, setIsSwimmingHud] = useState(theme === 'coral-reef');
  const [nearestRecyclerHint, setNearestRecyclerHint] = useState<{
    dist: number;
    angleDeg: number;
  } | null>(null);
  const [vitality, setVitality] = useState<VitalityState>({
    energy: 100,
    hunger: 100,
    thirst: 100,
    speed: 0,
    parts: {
      head: 100,
      body: 100,
      leftArm: 100,
      rightArm: 100,
      leftLeg: 100,
      rightLeg: 100,
    },
  });

  const [bunkerFound, setBunkerFound] = useState(false);
  const [bunkerCoords, setBunkerCoords] = useState<{ x: number; z: number }>({ x: 26, z: -24 });
  const [warningActive, setWarningActive] = useState(Boolean(mission.arenaConfig.isDisaster));
  const [warningCountdown, setWarningCountdown] = useState(6);
  const [teammatesWarned, setTeammatesWarned] = useState(false);
  const [recycleAnimPct, setRecycleAnimPct] = useState(0);
  const [isRecycling, setIsRecycling] = useState(false);
  const isRecyclingRef = useRef(false);
  isRecyclingRef.current = isRecycling;
  const callbacksRef = useRef({ onMissionComplete, onUpdateProgress });
  callbacksRef.current = { onMissionComplete, onUpdateProgress };
  const [robotHint, setRobotHint] = useState<string>(
    theme === 'coral-reef'
      ? 'Equipped: Rusty Grabber & Small Bag (20). Swim with WASD + Space (Up) / C (Down) to restore the Coral Reef.'
      : theme === 'tokyo-cyber'
      ? 'Equipped: Rusty Grabber & Small Bag (20). Clean trash for Scrap and stop Smog Stacks & Chemical Runoff!'
      : 'Equipped: Rusty Grabber & Small Bag (20). Collect trash, deposit at Auto Recycler for Scrap, and restore the biome!'
  );
  const [missionFailed, setMissionFailed] = useState<string | null>(null);
  const [missionWon, setMissionWon] = useState(false);
  const [squad, setSquad] = useState<SquadMember[]>([
    { id: 'sq-1', name: 'Nova', role: 'Eco-Engineer', status: 'active', x: -16, y: -12 },
    { id: 'sq-2', name: 'Kai', role: 'Rescue Specialist', status: 'active', x: -10, y: 18 },
    { id: 'sq-3', name: 'Lyra', role: 'Bio-Scout', status: 'active', x: 22, y: 8 },
  ]);

  const smogGoal = mission.arenaConfig.smogStacksToStop ?? 0;
  const runoffGoal = mission.arenaConfig.runoffPipesToSeal ?? 0;

  const [stats, setStats] = useState({
    rubbishRemaining: mission.arenaConfig.rubbishCount,
    treesPlanted: 0,
    coralsRestored: 0,
    equipmentRepaired: 0,
    smogStopped: 0,
    runoffSealed: 0,
    recycledInMission: 0,
    scrapEarnedInMission: 0,
    teammatesRescuedNow: 0,
    ecoEarnedInMission: 0,
    labDiscovered: false,
  });

  const simActionRef = useRef<{
    triggerScanner: () => void;
    triggerRecycle: () => void;
    restartMission: () => void;
    cycleWeather: () => void;
  } | null>(null);

  const warningActiveRef = useRef(warningActive);
  warningActiveRef.current = warningActive;

  useEffect(() => {
    if (!warningActive) return;
    soundEngine.warning();
    const timer = window.setInterval(() => {
      setWarningCountdown((prev) => {
        if (prev <= 1) {
          setWarningActive(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [warningActive]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      try {
        const probe = document.createElement('canvas').getContext('webgl2');
        if (!probe) return true;
        const ext = probe.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
        const gpu = String(probe.getParameter(param));
        probe.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    const pixelRatio = isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = theme === 'tokyo-cyber' ? 1.08 : 1.04;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const cfg = mission.arenaConfig;
    const isOcean = theme === 'coral-reef';
    const isSpace = theme === 'space';
    const isFlooded = Boolean(cfg.isDisaster && mission.id.includes('flood'));

    const scene = new THREE.Scene();
    const initBgHex = isOcean
      ? 0x052c40
      : isSpace
      ? 0x030712
      : theme === 'tokyo-cyber'
      ? 0x090b18
      : cfg.isDisaster
      ? 0x1a1c24
      : 0x6ba7d6;
    scene.background = new THREE.Color(initBgHex);
    scene.fog = new THREE.FogExp2(
      initBgHex,
      isOcean ? 0.0155 : isSpace ? 0.004 : theme === 'tokyo-cyber' || theme === 'town' ? 0.011 : 0.0068
    );

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = theme === 'tokyo-cyber' ? 1.08 : 0.88;
    pmrem.dispose();

    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const pbr = createMissionPbrTextureLibrary(maxAniso);
    const disposableTextures: THREE.Texture[] = [];
    const disposableMaterials: THREE.Material[] = [];
    const disposableGeometries: THREE.BufferGeometry[] = [];

    const camera = new THREE.PerspectiveCamera(70, w / h, 0.12, 320);
    scene.add(camera);

    // 1st-Person Viewmodel: Ultra-Detailed Rusty Grabber Tool (Right Hand) + Left Swimmer Arm
    const toolGroup = new THREE.Group();
    const rustyIronMat = new THREE.MeshPhysicalMaterial({
      map: pbr.rustMap,
      normalMap: pbr.rustNormal,
      normalScale: new THREE.Vector2(1.25, 1.25),
      roughnessMap: pbr.rustRoughness,
      color: 0xc27858,
      metalness: 0.78,
      roughness: 0.56,
      clearcoat: 0.28,
      clearcoatRoughness: 0.38,
    });
    const wornGripMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.35, roughness: 0.85 });
    const brassBoltMat = new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.9, roughness: 0.24 });
    const chromeRodMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.92, roughness: 0.18 });
    const grabGlowMat = new THREE.MeshStandardMaterial({
      color: 0x22c55e,
      emissive: 0x10b981,
      emissiveIntensity: 1.25,
      roughness: 0.15,
    });
    disposableMaterials.push(chromeRodMat);

    const gripHandleGeo = new THREE.CylinderGeometry(0.026, 0.03, 0.16, 12);
    const gripBandGeo = new THREE.TorusGeometry(0.028, 0.005, 6, 14);
    const shaftGeo = new THREE.CylinderGeometry(0.018, 0.022, 0.42, 12);
    const pistonRodGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.28, 8);
    const pivotCollarGeo = new THREE.CylinderGeometry(0.038, 0.038, 0.058, 14);
    const rivetGeo = new THREE.SphereGeometry(0.008, 8, 8);
    const indicatorLEDGeo = new THREE.SphereGeometry(0.016, 12, 12);
    const lockHaloGeo = new THREE.TorusGeometry(0.026, 0.003, 6, 18);
    const jawBarGeo = new THREE.BoxGeometry(0.018, 0.026, 0.14);
    disposableGeometries.push(
      gripHandleGeo,
      gripBandGeo,
      shaftGeo,
      pistonRodGeo,
      pivotCollarGeo,
      rivetGeo,
      indicatorLEDGeo,
      lockHaloGeo,
      jawBarGeo
    );

    const gripHandle = new THREE.Mesh(gripHandleGeo, wornGripMat);
    gripHandle.rotation.x = 0.42;
    for (let r = 0; r < 3; r++) {
      const band = new THREE.Mesh(gripBandGeo, brassBoltMat);
      band.position.y = -0.04 + r * 0.04;
      band.rotation.x = Math.PI / 2;
      gripHandle.add(band);
    }

    const shaft = new THREE.Mesh(shaftGeo, rustyIronMat);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.set(0, 0.055, -0.18);

    const pistonL = new THREE.Mesh(pistonRodGeo, chromeRodMat);
    pistonL.rotation.x = Math.PI / 2;
    pistonL.position.set(-0.024, 0.042, -0.22);
    const pistonR = new THREE.Mesh(pistonRodGeo, chromeRodMat);
    pistonR.rotation.x = Math.PI / 2;
    pistonR.position.set(0.024, 0.042, -0.22);

    const pivotCollar = new THREE.Mesh(pivotCollarGeo, brassBoltMat);
    pivotCollar.rotation.x = Math.PI / 2;
    pivotCollar.position.set(0, 0.055, -0.37);

    const rivetL = new THREE.Mesh(rivetGeo, brassBoltMat);
    rivetL.position.set(-0.036, 0.055, -0.37);
    const rivetR = new THREE.Mesh(rivetGeo, brassBoltMat);
    rivetR.position.set(0.036, 0.055, -0.37);

    const indicatorLED = new THREE.Mesh(indicatorLEDGeo, grabGlowMat);
    indicatorLED.position.set(0, 0.095, -0.36);
    const lockHalo = new THREE.Mesh(lockHaloGeo, grabGlowMat);
    lockHalo.position.set(0, 0.095, -0.36);

    const jawL = new THREE.Group();
    jawL.position.set(-0.022, 0.055, -0.39);
    const jawLBar = new THREE.Mesh(jawBarGeo, rustyIronMat);
    jawLBar.position.set(-0.025, 0, -0.06);
    jawLBar.rotation.y = -0.25;
    jawL.add(jawLBar);

    const jawR = new THREE.Group();
    jawR.position.set(0.022, 0.055, -0.39);
    const jawRBar = new THREE.Mesh(jawBarGeo, rustyIronMat);
    jawRBar.position.set(0.025, 0, -0.06);
    jawRBar.rotation.y = 0.25;
    jawR.add(jawRBar);

    toolGroup.add(gripHandle, shaft, pistonL, pistonR, pivotCollar, rivetL, rivetR, indicatorLED, lockHalo, jawL, jawR);
    toolGroup.position.set(0.32, -0.25, -0.45);
    camera.add(toolGroup);

    // 1st-Person Left Arm Sleeve (appears cleanly during Minecraft-style swimming strokes)
    const fpSwimArmL = new THREE.Group();
    const swimSleeveMat = new THREE.MeshStandardMaterial({ color: 0x10b981, roughness: 0.48, metalness: 0.2 });
    const swimArmSeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.34, 6, 10), swimSleeveMat);
    swimArmSeg.rotation.x = Math.PI / 2;
    swimArmSeg.position.set(0, 0, -0.2);
    fpSwimArmL.add(swimArmSeg);
    fpSwimArmL.position.set(-0.38, -0.32, -0.35);
    fpSwimArmL.visible = false;
    camera.add(fpSwimArmL);

    // Floating 3D Holographic Guiding Arrow (leads directly to nearest Automatic Recycling Station when bag is full)
    const guideArrowGroup = new THREE.Group();
    const guideArrowMat = new THREE.MeshStandardMaterial({
      color: 0x22c55e,
      emissive: 0x10b981,
      emissiveIntensity: 1.5,
      transparent: true,
      opacity: 0.92,
      roughness: 0.2,
    });
    const arrowShaft = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.48), guideArrowMat);
    arrowShaft.position.z = 0.12;
    const arrowHead = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.42, 4), guideArrowMat);
    arrowHead.rotation.x = -Math.PI / 2;
    arrowHead.position.z = -0.32;
    guideArrowGroup.add(arrowShaft, arrowHead);
    guideArrowGroup.visible = false;
    scene.add(guideArrowGroup);

    // GPU Post-Processing Pipeline (4x MSAA -> Bloom -> ACES Output -> Ultra HD Crisp Detail & Cinematic Grade)
    let composerTarget: THREE.WebGLRenderTarget | null = null;
    let composer: EffectComposer | null = null;
    let bloomPass: UnrealBloomPass | null = null;
    let ultraHdGradePass: ShaderPass | null = null;
    if (!isSoftwareGl) {
      const samples = progressRef.current.settings.graphicsQuality === 'high' ? 2 : 4;
      composerTarget = new THREE.WebGLRenderTarget(
        Math.max(1, Math.floor(w * pixelRatio)),
        Math.max(1, Math.floor(h * pixelRatio)),
        { samples, type: THREE.HalfFloatType }
      );
      composer = new EffectComposer(renderer, composerTarget);
      composer.setPixelRatio(pixelRatio);
      composer.setSize(w, h);
      composer.addPass(new RenderPass(scene, camera));
      bloomPass = new UnrealBloomPass(
        new THREE.Vector2(w, h),
        theme === 'tokyo-cyber' ? 0.36 : 0.25,
        0.44,
        0.8
      );
      composer.addPass(bloomPass);
      composer.addPass(new OutputPass());
      ultraHdGradePass = new ShaderPass({
        uniforms: {
          tDiffuse: { value: null },
          uTexel: { value: new THREE.Vector2(1 / Math.max(1, w * pixelRatio), 1 / Math.max(1, h * pixelRatio)) },
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform vec2 uTexel;
          varying vec2 vUv;
          void main() {
            vec3 c = texture2D(tDiffuse, vUv).rgb;
            vec3 n = texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb;
            vec3 s = texture2D(tDiffuse, vUv - vec2(0.0, uTexel.y)).rgb;
            vec3 e = texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb;
            vec3 w = texture2D(tDiffuse, vUv - vec2(uTexel.x, 0.0)).rgb;
            vec3 sharp = clamp(c * 1.18 - (n + s + e + w) * 0.045, 0.0, 1.0);
            vec3 graded = mix(sharp, sharp * sharp * (3.0 - 2.0 * sharp), 0.14);
            float dist = length(vUv - 0.5);
            float vignette = smoothstep(0.95, 0.36, dist);
            graded *= mix(0.88, 1.0, vignette);
            gl_FragColor = vec4(graded, 1.0);
          }
        `,
      });
      composer.addPass(ultraHdGradePass);
    }

    // Ultra HD Atmospheric Sky Dome (Rayleigh + Mie Sunset + 4-Octave FBM Clouds + Sun Disc + Cratered Moon + Stars)
    const skyDomeGeo = new THREE.SphereGeometry(220, 64, 40);
    const skyDomeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.4).normalize() },
        uDayWeight: { value: 1.0 },
        uTwilight: { value: 0.0 },
        uIsOcean: { value: isOcean ? 1.0 : 0.0 },
        uIsSpace: { value: isSpace ? 1.0 : 0.0 },
        uSmogLevel: { value: theme === 'tokyo-cyber' || theme === 'town' ? 0.55 : 0.0 },
        uStormDim: { value: 0.0 },
        uWeatherFlash: { value: 0.0 },
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec3 vWorldDir;
        void main() {
          vWorldDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uSunDir;
        uniform float uDayWeight;
        uniform float uTwilight;
        uniform float uIsOcean;
        uniform float uIsSpace;
        uniform float uSmogLevel;
        uniform float uStormDim;
        uniform float uWeatherFlash;
        uniform float uTime;
        varying vec3 vWorldDir;

        float hash31(vec3 p) {
          p = fract(p * 0.1031);
          p += dot(p, p.yzx + 33.33);
          return fract((p.x + p.y) * p.z);
        }

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        float vnoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash21(i);
          float b = hash21(i + vec2(1.0, 0.0));
          float c = hash21(i + vec2(0.0, 1.0));
          float d = hash21(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        float fbmCloud(vec2 p) {
          float v = 0.0;
          float amp = 0.5;
          for (int i = 0; i < 4; i++) {
            v += amp * vnoise(p);
            p = p * 2.08 + vec2(13.1, 7.7);
            amp *= 0.5;
          }
          return v;
        }

        void main() {
          vec3 d = normalize(vWorldDir);
          float y = clamp(d.y, -0.2, 1.0);
          vec3 sDir = normalize(uSunDir);
          vec3 mDir = normalize(-sDir + vec3(0.18, 0.25, 0.12));

          vec3 dayZenith = vec3(0.08, 0.30, 0.72);
          vec3 dayHorizon = vec3(0.52, 0.78, 0.96);
          vec3 sunsetZenith = vec3(0.14, 0.11, 0.30);
          vec3 sunsetHorizon = vec3(0.96, 0.45, 0.17);
          vec3 nightZenith = vec3(0.01, 0.02, 0.055);
          vec3 nightHorizon = vec3(0.032, 0.064, 0.13);

          if (uIsOcean > 0.5) {
            dayZenith = vec3(0.03, 0.36, 0.52);
            dayHorizon = vec3(0.02, 0.18, 0.32);
            nightZenith = vec3(0.008, 0.05, 0.11);
            nightHorizon = vec3(0.008, 0.035, 0.08);
          } else if (uIsSpace > 0.5) {
            dayZenith = vec3(0.006, 0.012, 0.034);
            dayHorizon = vec3(0.018, 0.038, 0.085);
            nightZenith = vec3(0.005, 0.009, 0.028);
            nightHorizon = vec3(0.014, 0.028, 0.068);
          }

          float hGrad = pow(1.0 - max(0.0, y), 2.35);
          vec3 dayCol = mix(dayZenith, dayHorizon, hGrad);
          vec3 setCol = mix(sunsetZenith, sunsetHorizon, hGrad);
          vec3 nightCol = mix(nightZenith, nightHorizon, hGrad);

          vec3 sky = mix(nightCol, dayCol, uDayWeight);
          sky = mix(sky, setCol, uTwilight * 0.85);

          // Overcast storm & snow cloud bank darkening
          if (uStormDim > 0.01 && uIsSpace < 0.5) {
            vec3 stormCol = mix(vec3(0.07, 0.10, 0.16), vec3(0.26, 0.33, 0.44), uDayWeight);
            sky = mix(sky, stormCol, clamp(uStormDim * 0.72, 0.0, 0.82));
          }

          // Urban smog tint near horizon that clears as Smog Stacks are stopped
          if (uSmogLevel > 0.01) {
            vec3 smogTint = mix(vec3(0.12, 0.09, 0.18), vec3(0.32, 0.28, 0.25), uDayWeight);
            sky = mix(sky, smogTint, uSmogLevel * hGrad * 0.65);
          }

          // Subnautica Snell's Window & underwater surface caustic shimmer
          if (uIsOcean > 0.5 && y > 0.05) {
            float snell = smoothstep(0.35, 0.94, y);
            float cA = fbmCloud(d.xz * 7.5 + vec2(uTime * 0.18, -uTime * 0.14));
            float caust = smoothstep(0.52, 0.88, cA);
            sky += vec3(0.08, 0.46, 0.56) * snell * (0.45 + uDayWeight * 0.55);
            sky += vec3(0.14, 0.48, 0.54) * caust * smoothstep(0.08, 0.65, y) * (0.35 + uDayWeight * 0.7);
          }

          // Multi-octave volumetric-look clouds with sun-edge rim lighting
          if (uIsOcean < 0.5 && uIsSpace < 0.5 && y > 0.015) {
            vec2 cuv = d.xz / (y + 0.16) * 0.95 + vec2(uTime * 0.009, uTime * 0.004);
            float cl = fbmCloud(cuv);
            float clLit = fbmCloud(cuv + normalize(sDir.xz + vec2(0.001)) * 0.16);
            float cMask = smoothstep(0.49 - uStormDim * 0.16, 0.82, cl) * smoothstep(0.015, 0.22, y);
            float rimLight = clamp((cl - clLit) * 3.2 + 0.55, 0.0, 1.0);
            vec3 cDark = mix(vec3(0.08, 0.12, 0.20), vec3(0.52, 0.60, 0.72), uDayWeight);
            vec3 cBright = mix(vec3(0.18, 0.24, 0.36), vec3(0.98, 0.99, 1.0), uDayWeight);
            cBright = mix(cBright, vec3(1.0, 0.64, 0.36), uTwilight * 0.8);
            vec3 cCol = mix(cDark, cBright, rimLight);
            sky = mix(sky, cCol, cMask * (0.52 + uStormDim * 0.25));
          }

          // Sun disc & Mie forward-scatter corona glow
          float sunAlign = max(0.0, dot(d, sDir));
          float sunDisc = smoothstep(0.9978, 0.9993, sunAlign);
          float sunGlow = pow(sunAlign, 22.0) * 0.58 + pow(sunAlign, 4.5) * 0.16;
          vec3 sunTint = mix(vec3(1.0, 0.52, 0.2), vec3(1.0, 0.96, 0.86), uDayWeight);
          sky += sunTint * (sunDisc * 1.65 + sunGlow) * smoothstep(-0.1, 0.15, sDir.y) * (1.0 - uStormDim * 0.65);

          // Cratered Moon disc & multi-magnitude starfield at night
          float nightVis = (1.0 - uDayWeight) * 0.95 + uIsSpace * 0.9;
          if (nightVis > 0.05 && uIsOcean < 0.5) {
            float moonAlign = max(0.0, dot(d, mDir));
            float moonDisc = smoothstep(0.9985, 0.9994, moonAlign);
            float moonCrater = 0.82 + 0.18 * vnoise(d.xy * 110.0);
            float moonGlow = pow(moonAlign, 38.0) * 0.28;
            sky += vec3(0.86, 0.92, 1.0) * (moonDisc * 1.15 * moonCrater + moonGlow) * nightVis * smoothstep(-0.08, 0.15, mDir.y) * (1.0 - uStormDim * 0.7);

            vec3 starCell = floor(d * 240.0);
            float h = hash31(starCell);
            if (h > 0.989 && y > 0.02) {
              float twinkle = 0.65 + 0.35 * sin(uTime * 3.0 + h * 120.0);
              sky += vec3(0.88, 0.94, 1.0) * twinkle * nightVis * (h - 0.989) * 145.0 * (1.0 - uStormDim * 0.85);
            }
          }

          if (uWeatherFlash > 0.005) {
            sky += vec3(0.58, 0.76, 1.0) * uWeatherFlash * 0.65;
          }

          gl_FragColor = vec4(sky, 1.0);
        }
      `,
    });
    const skyDome = new THREE.Mesh(skyDomeGeo, skyDomeMat);
    scene.add(skyDome);

    // Hyper-Realistic 3-Point + Hemisphere Lighting + Player Night Headlamp
    const hemi = new THREE.HemisphereLight(
      isOcean ? 0x38bdf8 : theme === 'tokyo-cyber' ? 0x818cf8 : 0xcce8ff,
      isOcean ? 0x062c43 : theme === 'tokyo-cyber' ? 0x161928 : 0x263022,
      0.78
    );
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff6e5, 2.2);
    sun.position.set(28, 42, 22);
    scene.add(sun.target);
    if (!isSoftwareGl) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.radius = 2.6;
      sun.shadow.camera.left = -44;
      sun.shadow.camera.right = 44;
      sun.shadow.camera.top = 44;
      sun.shadow.camera.bottom = -44;
      sun.shadow.camera.near = 2;
      sun.shadow.camera.far = 155;
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.022;
    }
    scene.add(sun);

    const rim = new THREE.DirectionalLight(theme === 'tokyo-cyber' ? 0xe879f9 : 0x60a5fa, 0.6);
    rim.position.set(-28, 18, -24);
    scene.add(rim);

    // Pre-allocated colors for dynamic 5-minute Day/Night fog & sun transitions
    const dayFogColor = new THREE.Color(
      isOcean ? 0x094260 : isSpace ? 0x040918 : theme === 'tokyo-cyber' ? 0x22253a : cfg.isDisaster ? 0x382820 : 0x7ab0d8
    );
    const sunsetFogColor = new THREE.Color(isOcean ? 0x0e243e : isSpace ? 0x040918 : theme === 'tokyo-cyber' ? 0x1b1534 : 0x5c2f24);
    const nightFogColor = new THREE.Color(isOcean ? 0x03111c : isSpace ? 0x02050e : theme === 'tokyo-cyber' ? 0x090d1e : 0x071022);
    const liveFogColor = new THREE.Color();
    const daySunColor = new THREE.Color(0xfff6e5);
    const sunsetSunColor = new THREE.Color(0xff9b52);
    const nightMoonColor = new THREE.Color(0x8bb6f8);

    // Smooth Non-Blocky Expanded 3D Terrain Heightfield (128x128 High-Res Mesh + uv2 for AO + Real-time GLSL micro-grain & caustics)
    const TERRAIN_SPAN = 260;
    const terrainGeo = new THREE.PlaneGeometry(TERRAIN_SPAN, TERRAIN_SPAN, 128, 128);
    terrainGeo.rotateX(-Math.PI / 2);
    terrainGeo.setAttribute('uv2', terrainGeo.attributes.uv);
    const posAttr = terrainGeo.attributes.position;
    const tColors = new Float32Array(posAttr.count * 3);
    const tmpCol = new THREE.Color();
    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i);
      const vz = posAttr.getZ(i);
      const vy = groundHeightAt(vx, vz, theme);
      posAttr.setY(i, vy);

      if (isSpace) {
        tmpCol.setRGB(0.88, 0.92, 0.98);
      } else if (isOcean) {
        const sandy = THREE.MathUtils.clamp((vy + 1.2) / 2.6, 0, 1);
        tmpCol.setRGB(0.62 + sandy * 0.25, 0.78 + sandy * 0.16, 0.85);
      } else if (theme === 'tokyo-cyber') {
        tmpCol.setRGB(0.86, 0.88, 0.95);
      } else {
        const slopeH = THREE.MathUtils.clamp((vy - 1.2) / 5.5, 0, 1);
        if (slopeH > 0.72) tmpCol.setRGB(0.92, 0.95, 0.98);
        else if (slopeH > 0.32) tmpCol.setRGB(0.65, 0.62, 0.58);
        else tmpCol.setRGB(0.88, 0.96, 0.86);
      }
      tColors[i * 3] = tmpCol.r;
      tColors[i * 3 + 1] = tmpCol.g;
      tColors[i * 3 + 2] = tmpCol.b;
    }
    terrainGeo.setAttribute('color', new THREE.BufferAttribute(tColors, 3));
    terrainGeo.computeVertexNormals();

    let terrainSet = createTerrainTextures(theme, 0);
    terrainSet.map.anisotropy = maxAniso;
    terrainSet.normalMap.anisotropy = maxAniso;
    terrainSet.roughnessMap.anisotropy = maxAniso;
    terrainSet.aoMap.anisotropy = maxAniso;
    const terrainShaderUniforms = {
      uTerrainTime: { value: 0 },
      uOceanCaustics: { value: isOcean ? 1.0 : 0.0 },
      uWetCity: { value: theme === 'tokyo-cyber' ? 1.0 : 0.0 },
      uWeatherWetness: { value: climateProfile.cycle[0].wetness },
      uWeatherSnow: { value: climateProfile.cycle[0].snowCover },
      uWeatherFlash: { value: 0 },
    };
    const terrainMat = new THREE.MeshStandardMaterial({
      map: terrainSet.map,
      normalMap: terrainSet.normalMap,
      normalScale: new THREE.Vector2(1.85, 1.85),
      roughnessMap: terrainSet.roughnessMap,
      aoMap: terrainSet.aoMap,
      aoMapIntensity: 0.78,
      vertexColors: true,
      roughness: isSpace ? 0.42 : theme === 'tokyo-cyber' ? 0.34 : 0.84,
      metalness: isSpace ? 0.58 : theme === 'tokyo-cyber' ? 0.24 : 0.04,
    });
    terrainMat.customProgramCacheKey = () => 'mission-terrain-ultrahd-v2';
    terrainMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTerrainTime = terrainShaderUniforms.uTerrainTime;
      shader.uniforms.uOceanCaustics = terrainShaderUniforms.uOceanCaustics;
      shader.uniforms.uWetCity = terrainShaderUniforms.uWetCity;
      shader.uniforms.uWeatherWetness = terrainShaderUniforms.uWeatherWetness;
      shader.uniforms.uWeatherSnow = terrainShaderUniforms.uWeatherSnow;
      shader.uniforms.uWeatherFlash = terrainShaderUniforms.uWeatherFlash;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vTerrainWorldPos;\nvarying float vTerrainNormalY;`)
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>\nvTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTerrainNormalY = normalize(mat3(modelMatrix) * objectNormal).y;`
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>\nuniform float uTerrainTime;\nuniform float uOceanCaustics;\nuniform float uWetCity;\nuniform float uWeatherWetness;\nuniform float uWeatherSnow;\nuniform float uWeatherFlash;\nvarying vec3 vTerrainWorldPos;\nvarying float vTerrainNormalY;`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float microGrain = sin(vTerrainWorldPos.x * 13.7 + cos(vTerrainWorldPos.z * 9.3)) * cos(vTerrainWorldPos.z * 14.1 - sin(vTerrainWorldPos.x * 7.9));
          float macroVar = sin(vTerrainWorldPos.x * 0.45) * cos(vTerrainWorldPos.z * 0.42);
          diffuseColor.rgb *= (1.0 + microGrain * 0.055 + macroVar * 0.045);
          if (uWeatherWetness > 0.02) {
            diffuseColor.rgb *= mix(1.0, 0.76, uWeatherWetness * 0.65);
          }
          if (uWeatherSnow > 0.02) {
            float snowPatch = smoothstep(0.60, 0.92, vTerrainNormalY + macroVar * 0.22);
            float snowMask = clamp(snowPatch * uWeatherSnow, 0.0, 0.92);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.96, 1.0), snowMask);
          }
          if (uOceanCaustics > 0.5) {
            float cA = abs(sin(vTerrainWorldPos.x * 0.65 + uTerrainTime * 1.35 + sin(vTerrainWorldPos.z * 0.55 - uTerrainTime * 0.8)));
            float cB = abs(cos(vTerrainWorldPos.z * 0.72 - uTerrainTime * 1.15 + cos(vTerrainWorldPos.x * 0.48 + uTerrainTime * 0.7)));
            float caustic = pow(1.0 - min(cA, cB), 5.0);
            diffuseColor.rgb += vec3(0.28, 0.68, 0.92) * caustic * 0.42;
          }
          if (uWeatherFlash > 0.005) {
            diffuseColor.rgb += vec3(0.45, 0.65, 0.95) * uWeatherFlash * 0.25;
          }`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          float wetAmt = max(uWetCity * 0.78, uWeatherWetness);
          if (wetAmt > 0.02) {
            float puddle = smoothstep(0.25, 0.72, sin(vTerrainWorldPos.x * 0.24) * cos(vTerrainWorldPos.z * 0.26) + 0.5 * sin((vTerrainWorldPos.x + vTerrainWorldPos.z) * 0.14));
            roughnessFactor = mix(roughnessFactor, 0.09, puddle * wetAmt);
          }
          if (uWeatherSnow > 0.02) {
            roughnessFactor = mix(roughnessFactor, 0.64, uWeatherSnow * 0.65);
          }`
        );
    };
    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);

    // Non-Blocky Open-World Natural Props (InstancedMesh: Detailed Rocks, Organic Trees, Crossed Grass Tufts)
    const decorRng = createSeededRng(`${mission.id}:landscape`);
    const dummy = new THREE.Object3D();

    const rockGeo = createDetailedRockGeometry();
    const rockMat = new THREE.MeshStandardMaterial({
      map: pbr.rockMap,
      normalMap: pbr.rockNormal,
      normalScale: new THREE.Vector2(1.45, 1.45),
      color: isSpace ? 0x64748b : isOcean ? 0x475569 : 0xa8a29e,
      roughness: 0.86,
      metalness: isSpace ? 0.35 : 0.06,
    });
    const ROCK_COUNT = theme === 'tokyo-cyber' ? 35 : 85;
    const instRocks = new THREE.InstancedMesh(rockGeo, rockMat, ROCK_COUNT);
    instRocks.castShadow = !isSoftwareGl;
    instRocks.receiveShadow = true;
    for (let i = 0; i < ROCK_COUNT; i++) {
      const rx = (decorRng() - 0.5) * 165;
      const rz = (decorRng() - 0.5) * 165;
      const ry = groundHeightAt(rx, rz, theme);
      const s = 0.6 + decorRng() * 1.9;
      dummy.position.set(rx, ry + s * 0.25, rz);
      dummy.rotation.set(decorRng() * 0.4, decorRng() * Math.PI * 2, decorRng() * 0.4);
      dummy.scale.set(s * (0.9 + decorRng() * 0.4), s * 0.8, s * (0.9 + decorRng() * 0.4));
      dummy.updateMatrix();
      instRocks.setMatrixAt(i, dummy.matrix);
    }
    instRocks.computeBoundingSphere();
    scene.add(instRocks);

    let instTrunks: THREE.InstancedMesh | null = null;
    let instCrowns: THREE.InstancedMesh | null = null;
    let instPines: THREE.InstancedMesh | null = null;
    let instGrass: THREE.InstancedMesh | null = null;
    let instFlowers: THREE.InstancedMesh | null = null;
    let trunkGeo: THREE.BufferGeometry | null = null;
    let trunkMat: THREE.Material | null = null;
    let crownGeo: THREE.BufferGeometry | null = null;
    let crownMat: THREE.Material | null = null;
    let pineGeo: THREE.BufferGeometry | null = null;
    let pineMat: THREE.Material | null = null;
    let grassGeo: THREE.BufferGeometry | null = null;
    let grassMat: THREE.Material | null = null;
    let flowerGeo: THREE.BufferGeometry | null = null;
    let flowerMat: THREE.Material | null = null;

    if (!isSpace) {
      const isMountainBiome = climateProfile.biomeTag === 'mountain';
      const WILD_COUNT = theme === 'forest' ? 120 : theme === 'tokyo-cyber' ? 22 : 70;
      trunkGeo = new THREE.CylinderGeometry(0.18, 0.34, 2.7, 12);
      trunkMat = new THREE.MeshStandardMaterial({
        map: pbr.barkMap,
        normalMap: pbr.barkNormal,
        normalScale: new THREE.Vector2(1.4, 1.4),
        color: isOcean ? 0x14b8a6 : 0xffffff,
        roughness: 0.9,
      });
      crownGeo = createOrganicCanopyGeometry();
      crownMat = new THREE.MeshStandardMaterial({
        map: pbr.leafMap,
        normalMap: pbr.leafNormal,
        normalScale: new THREE.Vector2(1.1, 1.1),
        color: isOcean ? 0x2dd4bf : cfg.isDisaster ? 0x84cc16 : 0xdcfce7,
        roughness: 0.72,
      });
      instTrunks = new THREE.InstancedMesh(trunkGeo, trunkMat, WILD_COUNT);
      instCrowns = new THREE.InstancedMesh(crownGeo, crownMat, WILD_COUNT);
      instTrunks.castShadow = !isSoftwareGl;
      instCrowns.castShadow = !isSoftwareGl;
      instCrowns.receiveShadow = true;

      const tintColor = new THREE.Color();
      for (let i = 0; i < WILD_COUNT; i++) {
        const angle = decorRng() * Math.PI * 2;
        const radius = i < Math.floor(WILD_COUNT * 0.65) ? 44 + decorRng() * 48 : 16 + decorRng() * 28;
        const tx = Math.cos(angle) * radius;
        const tz = Math.sin(angle) * radius;
        const ty = groundHeightAt(tx, tz, theme);
        const s = 0.85 + decorRng() * 0.85;

        dummy.position.set(tx, ty + 1.2 * s, tz);
        dummy.rotation.set(0, decorRng() * Math.PI * 2, 0);
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        instTrunks.setMatrixAt(i, dummy.matrix);

        dummy.position.set(tx, ty + 2.85 * s, tz);
        dummy.rotation.set(0, decorRng() * Math.PI * 2, 0);
        dummy.scale.set(s * 1.12, s * 1.0, s * 1.12);
        dummy.updateMatrix();
        instCrowns.setMatrixAt(i, dummy.matrix);

        tintColor.setHSL(isOcean ? 0.48 : 0.31 + (decorRng() - 0.5) * 0.06, 0.48, 0.66 + decorRng() * 0.24);
        instCrowns.setColorAt(i, tintColor);
      }
      instTrunks.computeBoundingSphere();
      instCrowns.computeBoundingSphere();
      scene.add(instTrunks, instCrowns);

      // Non-blocky Minecraft-style layered pine conifers on forest & mountain hills
      if (!isOcean && theme !== 'tokyo-cyber') {
        const PINE_COUNT = isMountainBiome ? 72 : 42;
        pineGeo = createLayeredPineCanopyGeometry();
        pineMat = new THREE.MeshStandardMaterial({
          map: pbr.leafMap,
          normalMap: pbr.leafNormal,
          normalScale: new THREE.Vector2(1.15, 1.15),
          color: isMountainBiome ? 0xa7f3d0 : 0x86efac,
          roughness: 0.78,
        });
        instPines = new THREE.InstancedMesh(pineGeo, pineMat, PINE_COUNT);
        instPines.castShadow = !isSoftwareGl;
        instPines.receiveShadow = true;
        for (let i = 0; i < PINE_COUNT; i++) {
          const angle = decorRng() * Math.PI * 2;
          const radius = 26 + decorRng() * 68;
          const px = Math.cos(angle) * radius;
          const pz = Math.sin(angle) * radius;
          const py = groundHeightAt(px, pz, theme);
          const s = 0.9 + decorRng() * 0.95;
          dummy.position.set(px, py + 0.15, pz);
          dummy.rotation.set(0, decorRng() * Math.PI * 2, 0);
          dummy.scale.set(s, s * 1.15, s);
          dummy.updateMatrix();
          instPines.setMatrixAt(i, dummy.matrix);
          tintColor.setHSL(isMountainBiome ? 0.39 : 0.34, 0.45, 0.52 + decorRng() * 0.22);
          instPines.setColorAt(i, tintColor);
        }
        instPines.computeBoundingSphere();
        scene.add(instPines);
      }

      const GRASS_COUNT = theme === 'tokyo-cyber' ? 60 : 280;
      grassGeo = createGrassTuftGeometry();
      grassMat = new THREE.MeshStandardMaterial({
        color: isOcean ? 0x0d9488 : 0x22c55e,
        roughness: 0.82,
        side: THREE.DoubleSide,
      });
      instGrass = new THREE.InstancedMesh(grassGeo, grassMat, GRASS_COUNT);
      for (let i = 0; i < GRASS_COUNT; i++) {
        const gx = (decorRng() - 0.5) * 130;
        const gz = (decorRng() - 0.5) * 130;
        const gy = groundHeightAt(gx, gz, theme);
        const s = 0.78 + decorRng() * 0.9;
        dummy.position.set(gx, gy + 0.02, gz);
        dummy.rotation.set((decorRng() - 0.5) * 0.16, decorRng() * Math.PI * 2, (decorRng() - 0.5) * 0.16);
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        instGrass.setMatrixAt(i, dummy.matrix);
      }
      instGrass.computeBoundingSphere();
      scene.add(instGrass);

      // Non-blocky Minecraft-style meadow wildflowers (poppies, dandelions, azure cornflowers)
      if (!isOcean && theme !== 'tokyo-cyber') {
        const FLOWER_COUNT = 165;
        flowerGeo = createWildflowerClusterGeometry();
        flowerMat = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.65,
          side: THREE.DoubleSide,
        });
        instFlowers = new THREE.InstancedMesh(flowerGeo, flowerMat, FLOWER_COUNT);
        const palette = [0xf43f5e, 0xfacc15, 0x38bdf8, 0xe879f9, 0xfb923c];
        for (let i = 0; i < FLOWER_COUNT; i++) {
          const fx = (decorRng() - 0.5) * 120;
          const fz = (decorRng() - 0.5) * 120;
          const fy = groundHeightAt(fx, fz, theme);
          const s = 0.75 + decorRng() * 0.65;
          dummy.position.set(fx, fy + 0.02, fz);
          dummy.rotation.set(0, decorRng() * Math.PI * 2, 0);
          dummy.scale.set(s, s, s);
          dummy.updateMatrix();
          instFlowers.setMatrixAt(i, dummy.matrix);
          tintColor.setHex(palette[i % palette.length]);
          instFlowers.setColorAt(i, tintColor);
        }
        instFlowers.computeBoundingSphere();
        scene.add(instFlowers);
      }
    }

    // Scenic Biome Architecture & Landmarks (Tokyo Cyber City, Subnautica Reef, Non-Blocky Town & Forest)
    const decorGroup = new THREE.Group();
    scene.add(decorGroup);
    const cyberSignObjects: THREE.Mesh[] = [];
    const creepvineStalks: THREE.Group[] = [];

    if (theme === 'tokyo-cyber') {
      const facadeMats = ['#22d3ee', '#f472b6', '#38bdf8', '#a855f7'].map((accentHex, fIdx) => {
        const tex = createSkyscraperFacadeTexture(accentHex, fIdx + 1);
        tex.anisotropy = maxAniso;
        tex.repeat.set(1, 2);
        disposableTextures.push(tex);
        const m = new THREE.MeshPhysicalMaterial({
          map: tex,
          emissiveMap: tex,
          emissive: 0xffffff,
          emissiveIntensity: 0.72,
          roughness: 0.16,
          metalness: 0.82,
          clearcoat: 0.75,
          clearcoatRoughness: 0.12,
        });
        disposableMaterials.push(m);
        return m;
      });
      const cyanNeonMat = new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x06b6d4, emissiveIntensity: 1.6 });
      const magentaNeonMat = new THREE.MeshStandardMaterial({ color: 0xf472b6, emissive: 0xec4899, emissiveIntensity: 1.5 });
      const spireMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.88, roughness: 0.25 });
      const bollardMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.75, roughness: 0.35 });
      disposableMaterials.push(cyanNeonMat, magentaNeonMat, spireMat, bollardMat);

      const signSpecs = [
        { text: '新東京 ECO-NET', sub: 'CLEAN TOKYO SECTOR', accent: '#22d3ee', bg: '#071326' },
        { text: '渋谷 CYBER-77', sub: 'ZERO SMOG INITIATIVE', accent: '#f472b6', bg: '#1e0b24' },
        { text: '環境再生 LABS', sub: 'SCRAP RECYCLING BAY', accent: '#34d399', bg: '#062019' },
        { text: '電脳都市 NEXUS', sub: 'STOP TOXIC RUNOFF', accent: '#fbbf24', bg: '#1f1506' },
      ];
      const signMats = signSpecs.map((sp) => {
        const tex = createCyberBillboardTexture(sp.text, sp.sub, sp.accent, sp.bg);
        tex.anisotropy = maxAniso;
        disposableTextures.push(tex);
        const m = new THREE.MeshStandardMaterial({
          map: tex,
          emissiveMap: tex,
          emissive: 0xffffff,
          emissiveIntensity: 1.2,
          roughness: 0.2,
        });
        disposableMaterials.push(m);
        return m;
      });

      const spireGeo = new THREE.CylinderGeometry(0.12, 0.35, 6.5, 8);
      const beaconGeo = new THREE.SphereGeometry(0.28, 8, 8);
      const bollardGeo = new THREE.CylinderGeometry(0.16, 0.2, 1.05, 10);
      disposableGeometries.push(spireGeo, beaconGeo, bollardGeo);

      const towerCoords: Array<[number, number, number, number]> = [
        [-42, -38, 10, 26], [42, -36, 11, 30], [-44, 34, 10, 24], [44, 36, 11, 32],
        [-14, -46, 9, 28], [16, -46, 10, 22], [-16, 46, 10, 25], [18, 46, 10, 29],
        [54, -8, 11, 34], [-54, 10, 10, 27], [0, -58, 14, 38], [0, 58, 12, 30],
      ];
      towerCoords.forEach(([bx, bz, bw, bh], idx) => {
        const by = groundHeightAt(bx, bz, theme);
        const towerGeo = new THREE.BoxGeometry(bw, bh, bw);
        disposableGeometries.push(towerGeo);
        const tower = new THREE.Mesh(towerGeo, facadeMats[idx % facadeMats.length]);
        tower.position.set(bx, by + bh / 2, bz);
        tower.castShadow = true;
        tower.receiveShadow = true;

        const stripMat = idx % 2 === 0 ? cyanNeonMat : magentaNeonMat;
        const stripGeo = new THREE.BoxGeometry(bw + 0.35, 0.45, bw + 0.35);
        disposableGeometries.push(stripGeo);
        const strip = new THREE.Mesh(stripGeo, stripMat);
        strip.position.y = bh / 2 - 1.2;
        tower.add(strip);

        const stripMid = new THREE.Mesh(stripGeo, stripMat);
        stripMid.position.y = 0;
        tower.add(stripMid);

        const spire = new THREE.Mesh(spireGeo, spireMat);
        spire.position.y = bh / 2 + 3.2;
        const avBeacon = new THREE.Mesh(beaconGeo, magentaNeonMat);
        avBeacon.position.y = bh / 2 + 6.5;
        tower.add(spire, avBeacon);

        const signGeo = new THREE.PlaneGeometry(bw * 0.85, 4.2);
        disposableGeometries.push(signGeo);
        const sign = new THREE.Mesh(signGeo, signMats[idx % signMats.length]);
        sign.position.set(0, bh * 0.12, bw / 2 + 0.14);
        tower.add(sign);
        cyberSignObjects.push(sign);

        decorGroup.add(tower);
      });

      // Glowing cyber street bollards lining the avenue
      for (let bx = -32; bx <= 32; bx += 16) {
        if (Math.abs(bx) < 4) continue;
        for (const bz of [-11, 11]) {
          const bol = new THREE.Mesh(bollardGeo, bollardMat);
          bol.position.set(bx, groundHeightAt(bx, bz, theme) + 0.52, bz);
          bol.castShadow = !isSoftwareGl;
          const cap = new THREE.Mesh(beaconGeo, bx < 0 ? cyanNeonMat : magentaNeonMat);
          cap.position.y = 0.55;
          cap.scale.set(0.7, 0.45, 0.7);
          bol.add(cap);
          decorGroup.add(bol);
        }
      }

      // Elevated Cyber Monorail Overpass
      const bridgeMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.78, roughness: 0.32 });
      disposableMaterials.push(bridgeMat);
      const railGeo = new THREE.BoxGeometry(130, 1.2, 4.5);
      const railStripGeo = new THREE.BoxGeometry(130, 0.25, 4.7);
      disposableGeometries.push(railGeo, railStripGeo);
      const railBeam = new THREE.Mesh(railGeo, bridgeMat);
      railBeam.position.set(0, 8.5, -24);
      decorGroup.add(railBeam);
      const railStrip = new THREE.Mesh(railStripGeo, cyanNeonMat);
      railStrip.position.set(0, 7.95, -24);
      decorGroup.add(railStrip);

      // Street Neon Point Lights
      const p1 = new THREE.PointLight(0x22d3ee, 16, 38);
      p1.position.set(-14, 7, -14);
      const p2 = new THREE.PointLight(0xec4899, 16, 38);
      p2.position.set(16, 7, 16);
      scene.add(p1, p2);
    } else if (theme === 'town') {
      const wallMat = new THREE.MeshStandardMaterial({
        map: pbr.brickMap,
        normalMap: pbr.brickNormal,
        normalScale: new THREE.Vector2(1.3, 1.3),
        color: 0xe2e8f0,
        roughness: 0.84,
      });
      const wallMatAlt = new THREE.MeshStandardMaterial({
        map: pbr.brickMap,
        normalMap: pbr.brickNormal,
        normalScale: new THREE.Vector2(1.3, 1.3),
        color: 0xfef3c7,
        roughness: 0.8,
      });
      const roofMat = new THREE.MeshStandardMaterial({
        map: pbr.roofMap,
        normalMap: pbr.roofNormal,
        normalScale: new THREE.Vector2(1.4, 1.4),
        color: 0xffffff,
        roughness: 0.72,
      });
      const trimHouseMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.58 });
      const doorMat = new THREE.MeshStandardMaterial({
        map: pbr.barkMap,
        normalMap: pbr.barkNormal,
        color: 0x7c2d12,
        roughness: 0.68,
      });
      const winMat = new THREE.MeshStandardMaterial({ color: 0xfef08a, emissive: 0xf59e0b, emissiveIntensity: 1.05, roughness: 0.15 });
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.78, roughness: 0.32 });
      disposableMaterials.push(wallMat, wallMatAlt, roofMat, trimHouseMat, doorMat, winMat, poleMat);

      const houseBodyGeo = new THREE.BoxGeometry(7.2, 4.4, 5.8);
      const houseBaseGeo = new THREE.BoxGeometry(7.6, 0.55, 6.2);
      const houseRoofGeo = new THREE.ConeGeometry(5.8, 2.9, 4);
      const chimneyGeo = new THREE.BoxGeometry(0.75, 1.8, 0.75);
      const doorGeo = new THREE.BoxGeometry(1.15, 2.2, 0.18);
      const winFrameGeo = new THREE.BoxGeometry(1.52, 1.52, 0.14);
      const winPaneGeo = new THREE.PlaneGeometry(1.24, 1.24);
      disposableGeometries.push(houseBodyGeo, houseBaseGeo, houseRoofGeo, chimneyGeo, doorGeo, winFrameGeo, winPaneGeo);

      const houseSpots: Array<[number, number, number]> = [
        [-38, -28, 0], [-18, -32, 0], [18, -32, 0], [38, -28, 0],
        [-38, 28, Math.PI], [-16, 34, Math.PI], [20, 32, Math.PI], [40, 28, Math.PI],
        [46, 0, -Math.PI / 2],
      ];
      houseSpots.forEach(([hx, hz, rotY], i) => {
        const hy = groundHeightAt(hx, hz, theme);
        const house = new THREE.Group();
        const plinth = new THREE.Mesh(houseBaseGeo, trimHouseMat);
        plinth.position.y = 0.27;
        const body = new THREE.Mesh(houseBodyGeo, i % 2 === 0 ? wallMat : wallMatAlt);
        body.position.y = 2.4;
        body.castShadow = true;
        body.receiveShadow = true;
        const roof = new THREE.Mesh(houseRoofGeo, roofMat);
        roof.rotation.y = Math.PI / 4;
        roof.position.y = 6.0;
        roof.castShadow = true;
        const chimney = new THREE.Mesh(chimneyGeo, wallMat);
        chimney.position.set(1.8, 6.3, -1.0);
        const door = new THREE.Mesh(doorGeo, doorMat);
        door.position.set(0, 1.35, 2.94);

        const winLFrame = new THREE.Mesh(winFrameGeo, trimHouseMat);
        winLFrame.position.set(-1.95, 2.6, 2.91);
        const winL = new THREE.Mesh(winPaneGeo, winMat);
        winL.position.set(-1.95, 2.6, 2.99);

        const winRFrame = new THREE.Mesh(winFrameGeo, trimHouseMat);
        winRFrame.position.set(1.95, 2.6, 2.91);
        const winR = new THREE.Mesh(winPaneGeo, winMat);
        winR.position.set(1.95, 2.6, 2.99);

        house.add(plinth, body, roof, chimney, door, winLFrame, winL, winRFrame, winR);
        house.position.set(hx, hy, hz);
        house.rotation.y = rotY;
        decorGroup.add(house);
      });

      // Town Streetlamps + Warm Light Pools
      const poleGeo = new THREE.CylinderGeometry(0.1, 0.15, 4.8, 10);
      const lampGeo = new THREE.SphereGeometry(0.3, 12, 12);
      disposableGeometries.push(poleGeo, lampGeo);
      for (let i = -30; i <= 30; i += 20) {
        if (i === 0) continue;
        const ly = groundHeightAt(i, 7, theme);
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.set(i, ly + 2.4, 7);
        pole.castShadow = !isSoftwareGl;
        const lampHead = new THREE.Mesh(lampGeo, winMat);
        lampHead.position.set(i, ly + 4.9, 7);
        decorGroup.add(pole, lampHead);
        if (i === -10 || i === 10) {
          const streetLight = new THREE.PointLight(0xfbbf24, 9, 24);
          streetLight.position.set(i, ly + 4.6, 7);
          scene.add(streetLight);
        }
      }
    } else if (theme === 'coral-reef') {
      // Subnautica-Inspired Underwater Reef: Snell's Window Ocean Surface + Sunbeam Shafts + Creepvine Kelp Forest + Bioluminescent Mushroom Corals + Hydrothermal Vents
      const rayGeo = new THREE.ConeGeometry(4.5, 28, 18, 1, true);
      const rayMat = new THREE.MeshBasicMaterial({
        color: 0x7dd3fc,
        transparent: true,
        opacity: 0.11,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      disposableGeometries.push(rayGeo);
      disposableMaterials.push(rayMat);
      for (let i = 0; i < 8; i++) {
        const shaft = new THREE.Mesh(rayGeo, rayMat);
        shaft.position.set((i - 3.5) * 15, 13.5, ((i % 2) - 0.5) * 26);
        shaft.rotation.z = 0.14;
        decorGroup.add(shaft);
      }

      // Translucent Sunlit Ocean Surface overhead (looking up from underwater like Subnautica)
      const oceanRoofGeo = new THREE.PlaneGeometry(TERRAIN_SPAN, TERRAIN_SPAN);
      const oceanRoofMat = new THREE.MeshPhysicalMaterial({
        color: 0x38bdf8,
        emissive: 0x0284c7,
        emissiveIntensity: 0.35,
        roughness: 0.12,
        clearcoat: 1.0,
        transparent: true,
        opacity: 0.34,
        side: THREE.DoubleSide,
      });
      disposableGeometries.push(oceanRoofGeo);
      disposableMaterials.push(oceanRoofMat);
      const oceanRoof = new THREE.Mesh(oceanRoofGeo, oceanRoofMat);
      oceanRoof.rotation.x = -Math.PI / 2;
      oceanRoof.position.y = 14.5;
      decorGroup.add(oceanRoof);

      // Glowing Subnautica Creepvine Kelp Forest with luminous amber seed clusters
      const vineSegGeo = new THREE.CylinderGeometry(0.11, 0.24, 9.5, 8);
      const vineLeafGeo = new THREE.ConeGeometry(0.65, 1.5, 5);
      const seedGeo = new THREE.SphereGeometry(0.24, 10, 8);
      const vineMat = new THREE.MeshStandardMaterial({
        color: 0x15803d,
        emissive: 0x064e3b,
        emissiveIntensity: 0.35,
        roughness: 0.45,
      });
      const seedMat = new THREE.MeshStandardMaterial({
        color: 0xfde047,
        emissive: 0xf59e0b,
        emissiveIntensity: 1.85,
        roughness: 0.15,
      });
      disposableGeometries.push(vineSegGeo, vineLeafGeo, seedGeo);
      disposableMaterials.push(vineMat, seedMat);

      for (let i = 0; i < 24; i++) {
        const ang = (i / 24) * Math.PI * 2 + (i % 3) * 0.22;
        const rad = 16 + (i % 5) * 11;
        const vx = Math.cos(ang) * rad;
        const vz = Math.sin(ang) * rad;
        const vy = groundHeightAt(vx, vz, theme);

        const vine = new THREE.Group();
        const stalk = new THREE.Mesh(vineSegGeo, vineMat);
        stalk.position.y = 4.7;
        vine.add(stalk);

        for (let b = 0; b < 4; b++) {
          const leaf = new THREE.Mesh(vineLeafGeo, vineMat);
          leaf.position.set(Math.sin(b * 1.9) * 0.42, 2.2 + b * 2.0, Math.cos(b * 1.9) * 0.42);
          leaf.rotation.z = Math.sin(b * 2.1) * 0.85;
          vine.add(leaf);
        }
        for (let sd = 0; sd < 3; sd++) {
          const seed = new THREE.Mesh(seedGeo, seedMat);
          seed.position.set(Math.cos(sd * 2.1) * 0.34, 3.6 + sd * 2.1, Math.sin(sd * 2.1) * 0.34);
          vine.add(seed);
        }

        vine.position.set(vx, vy - 0.1, vz);
        decorGroup.add(vine);
        creepvineStalks.push(vine);
      }

      // Bioluminescent Giant Mushroom / Table Corals (Subnautica Jellyshroom / Safe Shallows vibe)
      const mushStemGeo = new THREE.CylinderGeometry(0.32, 0.55, 3.2, 10);
      const mushCapGeo = new THREE.CylinderGeometry(2.3, 1.4, 0.75, 18);
      const mushColors = [0x06b6d4, 0xec4899, 0x8b5cf6, 0x10b981];
      const mushStemMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.72 });
      const mushCapMats = mushColors.map((hex) => {
        const m = new THREE.MeshStandardMaterial({
          color: hex,
          emissive: hex,
          emissiveIntensity: 0.95,
          roughness: 0.25,
        });
        disposableMaterials.push(m);
        return m;
      });
      disposableGeometries.push(mushStemGeo, mushCapGeo);
      disposableMaterials.push(mushStemMat);

      for (let i = 0; i < 12; i++) {
        const ang = i * 0.58 + 0.4;
        const rad = 14 + (i % 4) * 12;
        const mx = Math.cos(ang) * rad;
        const mz = Math.sin(ang) * rad;
        const my = groundHeightAt(mx, mz, theme);
        const mush = new THREE.Group();
        const stem = new THREE.Mesh(mushStemGeo, mushStemMat);
        stem.position.y = 1.5;
        const cap = new THREE.Mesh(mushCapGeo, mushCapMats[i % mushCapMats.length]);
        cap.position.y = 3.1;
        mush.add(stem, cap);
        mush.position.set(mx, my - 0.2, mz);
        mush.scale.setScalar(0.85 + (i % 3) * 0.32);
        decorGroup.add(mush);
      }

      // Hydrothermal Bubble Vents with glowing magma fissures
      const ventConeGeo = new THREE.CylinderGeometry(0.8, 1.85, 2.4, 12, 1, true);
      const ventGlowGeo = new THREE.SphereGeometry(0.65, 10, 8);
      const ventGlowMat = new THREE.MeshStandardMaterial({
        color: 0xfb923c,
        emissive: 0xea580c,
        emissiveIntensity: 2.0,
      });
      const archMat = new THREE.MeshStandardMaterial({
        map: pbr.rockMap,
        normalMap: pbr.rockNormal,
        normalScale: new THREE.Vector2(1.5, 1.5),
        color: 0x475569,
        roughness: 0.85,
      });
      disposableGeometries.push(ventConeGeo, ventGlowGeo);
      disposableMaterials.push(ventGlowMat, archMat);

      [
        [-28, -22],
        [24, 22],
        [-34, 28],
        [34, -26],
      ].forEach(([vx, vz]) => {
        const vy = groundHeightAt(vx, vz, theme);
        const vent = new THREE.Mesh(ventConeGeo, archMat);
        vent.position.set(vx, vy + 1.1, vz);
        const magma = new THREE.Mesh(ventGlowGeo, ventGlowMat);
        magma.position.set(vx, vy + 1.9, vz);
        decorGroup.add(vent, magma);
      });

      // Natural textured reef arch
      const archGeo = new THREE.TorusGeometry(9.5, 1.4, 14, 36, Math.PI);
      disposableGeometries.push(archGeo);
      const arch = new THREE.Mesh(archGeo, archMat);
      arch.position.set(12, groundHeightAt(12, -18, theme) - 0.5, -18);
      arch.rotation.y = 0.6;
      decorGroup.add(arch);
    } else if (theme === 'forest') {
      // Smooth non-blocky Minecraft-style clearcoat Meadow Ponds in forest basins
      const pondGeo = new THREE.CircleGeometry(7.5, 32);
      const pondMat = new THREE.MeshPhysicalMaterial({
        color: 0x0ea5e9,
        roughness: 0.06,
        metalness: 0.14,
        clearcoat: 1.0,
        clearcoatRoughness: 0.04,
        ior: 1.333,
        transparent: true,
        opacity: 0.76,
      });
      disposableGeometries.push(pondGeo);
      disposableMaterials.push(pondMat);
      [
        [-26, -24],
        [28, 26],
      ].forEach(([px, pz]) => {
        const pond = new THREE.Mesh(pondGeo, pondMat);
        pond.rotation.x = -Math.PI / 2;
        pond.position.set(px, groundHeightAt(px, pz, theme) + 0.16, pz);
        decorGroup.add(pond);
      });
    }

    let waterSurface: THREE.Mesh | null = null;
    if (isFlooded) {
      const waterGeo = new THREE.PlaneGeometry(TERRAIN_SPAN, TERRAIN_SPAN);
      const waterSurfaceMat = new THREE.MeshPhysicalMaterial({
        color: 0x0284c7,
        roughness: 0.08,
        metalness: 0.12,
        clearcoat: 1.0,
        clearcoatRoughness: 0.06,
        ior: 1.333,
        transparent: true,
        opacity: 0.54,
      });
      disposableGeometries.push(waterGeo);
      disposableMaterials.push(waterSurfaceMat);
      waterSurface = new THREE.Mesh(waterGeo, waterSurfaceMat);
      waterSurface.rotation.x = -Math.PI / 2;
      waterSurface.position.y = 0.65;
      scene.add(waterSurface);
    }

    // Ambient 3D Biome Particle System (Bubbles & Bioluminescent Spores underwater, Neon Mist, Pollen outdoors)
    const pCount = progressRef.current.settings.highDetailParticles ? 360 : 160;
    const pPos = new Float32Array(pCount * 3);
    const pVel = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount; i++) {
      pPos[i * 3] = (Math.random() - 0.5) * WORLD_SIZE;
      pPos[i * 3 + 1] = 0.6 + Math.random() * 11.0;
      pPos[i * 3 + 2] = (Math.random() - 0.5) * WORLD_SIZE;
      pVel[i * 3] = theme === 'tokyo-cyber' ? -1.4 : (Math.random() - 0.5) * 0.9;
      pVel[i * 3 + 1] =
        isOcean || isFlooded
          ? 1.1 + Math.random() * 1.5
          : theme === 'tokyo-cyber'
          ? -(16.0 + Math.random() * 8.0)
          : (Math.random() - 0.5) * 0.4;
      pVel[i * 3 + 2] = theme === 'tokyo-cyber' ? -0.8 : (Math.random() - 0.5) * 0.9;
    }
    const biomeParticleGeo = new THREE.BufferGeometry();
    biomeParticleGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    const biomeParticleColor = isOcean
      ? 0x67e8f9
      : theme === 'tokyo-cyber'
      ? 0x38bdf8
      : mission.id.includes('wildfire')
      ? 0xfb923c
      : cfg.isToxicBunker
      ? 0xfacc15
      : isSpace
      ? 0xbae6fd
      : 0x4ade80;
    const biomeParticleMat = new THREE.PointsMaterial({
      color: biomeParticleColor,
      size: isOcean ? 0.28 : 0.22,
      transparent: true,
      opacity: 0.68,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const biomeParticles = new THREE.Points(biomeParticleGeo, biomeParticleMat);
    scene.add(biomeParticles);

    // Location-Aware Dynamic Weather 3D Precipitation (Sliding-Window Rain Streaks & Snowflake Points around Player)
    const RAIN_COUNT = isSoftwareGl ? 180 : 480;
    const rainPos = new Float32Array(RAIN_COUNT * 6);
    const rainSeeds = new Float32Array(RAIN_COUNT * 3); // relX, relY, relZ
    for (let i = 0; i < RAIN_COUNT; i++) {
      const rx = (Math.random() - 0.5) * 76;
      const ry = 0.5 + Math.random() * 24;
      const rz = (Math.random() - 0.5) * 76;
      rainSeeds[i * 3] = rx;
      rainSeeds[i * 3 + 1] = ry;
      rainSeeds[i * 3 + 2] = rz;
      rainPos[i * 6] = rx;
      rainPos[i * 6 + 1] = ry;
      rainPos[i * 6 + 2] = rz;
      rainPos[i * 6 + 3] = rx;
      rainPos[i * 6 + 4] = ry + 1.05;
      rainPos[i * 6 + 5] = rz;
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
    const rainMat = new THREE.LineBasicMaterial({
      color: theme === 'tokyo-cyber' ? 0x7dd3fc : 0xcbd5e1,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const rainLines = new THREE.LineSegments(rainGeo, rainMat);
    rainLines.frustumCulled = false;
    rainLines.visible = false;
    scene.add(rainLines);

    const SNOW_COUNT = isSoftwareGl ? 160 : 420;
    const snowPos = new Float32Array(SNOW_COUNT * 3);
    const snowSeeds = new Float32Array(SNOW_COUNT * 4); // relX, relY, relZ, phase
    for (let i = 0; i < SNOW_COUNT; i++) {
      const sx = (Math.random() - 0.5) * 76;
      const sy = 0.5 + Math.random() * 22;
      const sz = (Math.random() - 0.5) * 76;
      snowSeeds[i * 4] = sx;
      snowSeeds[i * 4 + 1] = sy;
      snowSeeds[i * 4 + 2] = sz;
      snowSeeds[i * 4 + 3] = Math.random() * Math.PI * 2;
      snowPos[i * 3] = sx;
      snowPos[i * 3 + 1] = sy;
      snowPos[i * 3 + 2] = sz;
    }
    const snowGeo = new THREE.BufferGeometry();
    snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
    const snowTex = createSnowflakeSpriteTexture();
    const snowMat = new THREE.PointsMaterial({
      color: 0xf8fafc,
      map: snowTex,
      size: 0.44,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const snowPoints = new THREE.Points(snowGeo, snowMat);
    snowPoints.frustumCulled = false;
    snowPoints.visible = false;
    scene.add(snowPoints);

    // Pooled 3D Action Burst Shockwave Ring
    const burstRingGeo = new THREE.RingGeometry(0.45, 0.78, 28);
    const burstRingMat = new THREE.MeshBasicMaterial({
      color: 0x34d399,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const burstRingMesh = new THREE.Mesh(burstRingGeo, burstRingMat);
    burstRingMesh.rotation.x = -Math.PI / 2;
    burstRingMesh.visible = false;
    scene.add(burstRingMesh);
    let activeBurst: { age: number; maxAge: number } | null = null;
    const triggerBurst = (bx: number, bz: number, hexColor: number) => {
      const by = groundHeightAt(bx, bz, theme) + 0.42;
      burstRingMesh.position.set(bx, by, bz);
      burstRingMat.color.setHex(hexColor);
      burstRingMat.opacity = 0.92;
      burstRingMesh.scale.setScalar(0.5);
      burstRingMesh.visible = true;
      activeBurst = { age: 0, maxAge: 0.55 };
    };

    // Player Eco-Ranger & Composite 3D Vehicles + Night Suit Headlamp
    const playerActor = buildEcoRangerMesh(0x10b981, true);
    const suitLamp = new THREE.SpotLight(0xdbeafe, 0, 42, Math.PI / 4, 0.45, 1.2);
    suitLamp.position.set(0, 0, 0);
    suitLamp.target.position.set(0, -0.35, -8);
    camera.add(suitLamp);
    camera.add(suitLamp.target);
    scene.add(playerActor.group);

    // Composite Vehicles
    const vehicleMeshGroup = new THREE.Group();
    const hullMetalMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, metalness: 0.72, roughness: 0.26 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.5, roughness: 0.5 });
    const canopyMat = new THREE.MeshPhysicalMaterial({ color: 0x38bdf8, roughness: 0.1, metalness: 0.2, opacity: 0.85, transparent: true });
    const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.28, 14);
    wheelGeo.rotateZ(Math.PI / 2);

    const roverGroup = new THREE.Group();
    const roverChassis = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.46, 2.4), hullMetalMat);
    roverChassis.position.y = 0.45;
    roverChassis.castShadow = true;
    const roverCanopy = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.42, 1.15), canopyMat);
    roverCanopy.position.set(0, 0.84, 0.12);
    const wheelOffsets: Array<[number, number]> = [[-0.86, 0.8], [0.86, 0.8], [-0.86, -0.8], [0.86, -0.8]];
    const roverWheels: THREE.Mesh[] = [];
    wheelOffsets.forEach(([wx, wz]) => {
      const wMesh = new THREE.Mesh(wheelGeo, trimMat);
      wMesh.position.set(wx, 0.32, wz);
      wMesh.castShadow = true;
      roverWheels.push(wMesh);
      roverGroup.add(wMesh);
    });
    roverGroup.add(roverChassis, roverCanopy);

    const boatGroup = new THREE.Group();
    const boatHull = new THREE.Mesh(new THREE.ConeGeometry(1.15, 2.8, 6), hullMetalMat);
    boatHull.rotation.x = Math.PI / 2;
    boatHull.scale.set(1, 1, 0.45);
    boatHull.position.y = 0.38;
    const pontoonGeo = new THREE.CylinderGeometry(0.22, 0.22, 2.3, 10);
    pontoonGeo.rotateX(Math.PI / 2);
    const pLeft = new THREE.Mesh(pontoonGeo, trimMat);
    pLeft.position.set(-0.92, 0.26, -0.1);
    const pRight = new THREE.Mesh(pontoonGeo, trimMat);
    pRight.position.set(0.92, 0.26, -0.1);
    const boatCabin = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 1.1), canopyMat);
    boatCabin.position.set(0, 0.72, -0.15);
    boatGroup.add(boatHull, pLeft, pRight, boatCabin);

    const heliGroup = new THREE.Group();
    const heliBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.62, 1.4, 8, 12), hullMetalMat);
    heliBody.rotation.x = Math.PI / 2;
    heliBody.position.y = 1.15;
    heliBody.castShadow = true;
    const heliTail = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 1.85), trimMat);
    heliTail.position.set(0, 1.25, -1.55);
    const skidGeo = new THREE.CylinderGeometry(0.06, 0.06, 2.2, 8);
    skidGeo.rotateX(Math.PI / 2);
    const skidL = new THREE.Mesh(skidGeo, trimMat);
    skidL.position.set(-0.68, 0.14, 0);
    const skidR = new THREE.Mesh(skidGeo, trimMat);
    skidR.position.set(0.68, 0.14, 0);
    const rotorBlade = new THREE.Mesh(
      new THREE.BoxGeometry(3.8, 0.06, 0.22),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 0.85 })
    );
    rotorBlade.position.y = 2.65;
    const tailRotor = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.85, 0.14),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 0.75 })
    );
    tailRotor.position.set(0.18, 1.32, -2.4);
    heliGroup.add(heliBody, heliTail, skidL, skidR, rotorBlade, tailRotor);

    vehicleMeshGroup.add(roverGroup, boatGroup, heliGroup);
    vehicleMeshGroup.visible = false;
    playerActor.group.add(vehicleMeshGroup);

    // Robot Companion E.C.H.O.-7
    const robotActor = buildRobotCompanionMesh(disposableGeometries, disposableMaterials);
    scene.add(robotActor.group);

    const beamMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.5 });
    const beamGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const robotBeam = new THREE.Line(beamGeo, beamMat);
    scene.add(robotBeam);

    // Dual Automatic Recycling Stations across the open map so "nearest" guiding arrow works dynamically
    const recyclerPositions = [
      new THREE.Vector3(-24, 0, 0),
      new THREE.Vector3(28, 0, -14),
    ];
    const recyclerObjs = recyclerPositions.map((pos) => {
      pos.y = groundHeightAt(pos.x, pos.z, theme);
      const rObj = buildRecyclerMachineMesh(pbr, isSoftwareGl, disposableGeometries, disposableMaterials);
      rObj.group.position.copy(pos);
      rObj.group.visible = cfg.hasRecyclingMachine;
      scene.add(rObj.group);
      return rObj;
    });

    // Safe Zone / Bunker / Secret Lab markers
    const safeZonePos = new THREE.Vector3(44, 0, -40);
    safeZonePos.y = groundHeightAt(safeZonePos.x, safeZonePos.z, theme);
    const safeZonePad = new THREE.Mesh(
      new THREE.CylinderGeometry(4.5, 4.8, 0.3, 28),
      new THREE.MeshStandardMaterial({ color: 0x10b981, emissive: 0x059669, emissiveIntensity: 0.85, roughness: 0.3 })
    );
    safeZonePad.position.copy(safeZonePos);
    safeZonePad.visible = Boolean(cfg.isDisaster);
    scene.add(safeZonePad);

    const seededRand = createSeededRng(mission.id);
    const rng = (min: number, max: number) => min + seededRand() * (max - min);
    const bunkerPos = new THREE.Vector3(rng(18, 48), 0, rng(-44, 44));
    bunkerPos.y = groundHeightAt(bunkerPos.x, bunkerPos.z, theme);
    setBunkerCoords({ x: Math.round(bunkerPos.x), z: Math.round(bunkerPos.z) });

    const bunkerGroup = new THREE.Group();
    const bunkerDome = new THREE.Mesh(
      new THREE.SphereGeometry(3.2, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.85, roughness: 0.3 })
    );
    const bunkerRing = new THREE.Mesh(
      new THREE.TorusGeometry(3.6, 0.16, 10, 32),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x38bdf8, emissiveIntensity: 1.5 })
    );
    bunkerRing.rotation.x = Math.PI / 2;
    bunkerRing.position.y = 0.2;
    bunkerGroup.add(bunkerDome, bunkerRing);
    bunkerGroup.position.copy(bunkerPos);
    bunkerGroup.visible = false;
    scene.add(bunkerGroup);

    const labPos = new THREE.Vector3(rng(14, 46), 0, rng(-42, 42));
    labPos.y = groundHeightAt(labPos.x, labPos.z, theme);
    const labGroup = new THREE.Group();
    const labDome = new THREE.Mesh(
      new THREE.CylinderGeometry(2.6, 3.0, 2.4, 16),
      new THREE.MeshStandardMaterial({ color: 0xa855f7, emissive: 0x7e22ce, emissiveIntensity: 1.1, metalness: 0.7, roughness: 0.25 })
    );
    labDome.position.y = 1.2;
    labGroup.add(labDome);
    labGroup.position.copy(labPos);
    labGroup.visible = false;
    scene.add(labGroup);

    // Expanding 3D Pollution Scanner Wave
    const scanRingMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1.35, 56),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
    );
    scanRingMesh.rotation.x = -Math.PI / 2;
    scanRingMesh.visible = false;
    scene.add(scanRingMesh);

    if (isOcean) {
      const oxyRing = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.14, 10, 32), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
      oxyRing.rotation.x = Math.PI / 2;
      oxyRing.position.set(-24, groundHeightAt(-24, 0, theme) + 0.35, 0);
      scene.add(oxyRing);
    }

    const nodesGroup = new THREE.Group();
    scene.add(nodesGroup);
    const hazardsGroup = new THREE.Group();
    scene.add(hazardsGroup);
    const wildlifeGroup = new THREE.Group();
    scene.add(wildlifeGroup);

    const squadActors = [
      { id: 'sq-1', name: 'Nova', role: 'Eco-Engineer', actor: buildEcoRangerMesh(0x38bdf8, false) },
      { id: 'sq-2', name: 'Kai', role: 'Rescue Specialist', actor: buildEcoRangerMesh(0x60a5fa, false) },
      { id: 'sq-3', name: 'Lyra', role: 'Bio-Scout', actor: buildEcoRangerMesh(0x818cf8, false) },
    ];
    squadActors.forEach((sa) => scene.add(sa.actor.group));

    const remoteTeammateRingGeo = new THREE.RingGeometry(0.65, 0.86, 20);
    const remoteTeammates = new Map<
      string,
      {
        actor: ReturnType<typeof buildEcoRangerMesh>;
        ringMat: THREE.MeshBasicMaterial;
        x: number;
        z: number;
        walkPhase: number;
      }
    >();

    // Simulation state (1st-person look + jump/swim physics + Vitality stats)
    const sim = {
      playerX: -20,
      playerZ: 6,
      playerJumpY: isOcean ? 2.2 : 0,
      playerVelY: 0,
      isGrounded: !isOcean,
      isSwimming: isOcean,
      swimPhase: 0,
      grabSnapTimer: 0,
      yaw: -Math.PI * 0.45,
      pitch: -0.06,
      targetX: null as number | null,
      targetZ: null as number | null,
      walkPhase: 0,
      currentSpeed: 0,
      nodes: [] as WorldNode3D[],
      hazards: [] as HazardZone3D[],
      wildlife: [] as Wildlife3D[],
      keys: {} as Record<string, boolean>,
      scanActive: false,
      scanRadius: 1,
      scanMax: hasScannerOptics ? 48 : 34,
      autoCollectCooldown: 0,
      health: maxHealth,
      oxygen: 100,
      toxicity: 0,
      energy: 100,
      hunger: 100,
      thirst: 100,
      parts: {
        head: 100,
        body: 100,
        leftArm: 100,
        rightArm: 100,
        leftLeg: 100,
        rightLeg: 100,
      } as BodyPartHealth,
      bunkerFound: false,
      labDiscovered: false,
      localBackpack: progressRef.current.currentBackpackItems,
      squad: [
        { id: 'sq-1', name: 'Nova', role: 'Eco-Engineer', status: 'active' as SquadMember['status'], x: -12, y: -12 },
        { id: 'sq-2', name: 'Kai', role: 'Rescue Specialist', status: 'active' as SquadMember['status'], x: -8, y: 18 },
        { id: 'sq-3', name: 'Lyra', role: 'Bio-Scout', status: 'active' as SquadMember['status'], x: 20, y: 6 },
      ],
      squadAlertTimer: 8,
      missionEnded: false,
      causeOfDeath: 'Suit integrity failed in hazard sector.',
      recycledCount: 0,
      scrapEarned: 0,
      treesPlanted: 0,
      coralsRestored: 0,
      equipmentRepaired: 0,
      smogStopped: 0,
      runoffSealed: 0,
      teammatesRescuedNow: 0,
      ecoEarned: 0,
      lastTextureBucket: 0,
      lastSentX: -999,
      lastSentZ: -999,
      lastSentAt: 0,
      damageFlashTimer: 0,
      lastDamageBeepAt: 0,
    };

    const nodeAssets = createArenaNodeAssetCache(disposableGeometries, disposableMaterials, pbr);
    const stumpGeo = new THREE.CylinderGeometry(0.34, 0.45, 0.6, 10);
    const stumpMat = new THREE.MeshStandardMaterial({ color: 0x3f2e21, roughness: 0.95 });
    const stumpRingGeo = new THREE.RingGeometry(0.7, 0.95, 18);
    const stumpRingMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, side: THREE.DoubleSide });
    const smogStackGeo = new THREE.CylinderGeometry(0.95, 1.35, 5.2, 12);
    const smogStackMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.65, roughness: 0.45 });
    const smogCloudGeo = new THREE.SphereGeometry(1.75, 12, 10);
    const smogCloudMat = new THREE.MeshStandardMaterial({ color: 0x4b5563, emissive: 0xef4444, emissiveIntensity: 0.45, transparent: true, opacity: 0.72 });
    const valveRingGeo = new THREE.TorusGeometry(1.45, 0.14, 8, 22);
    const valveRingMat = new THREE.MeshBasicMaterial({ color: 0xf97316 });
    const cleanCapGeo = new THREE.SphereGeometry(0.75, 10, 8);
    const cleanStackMat = new THREE.MeshStandardMaterial({ color: 0x0f766e, metalness: 0.55, roughness: 0.3 });
    const cleanCapMat = new THREE.MeshStandardMaterial({ color: 0x34d399, emissive: 0x10b981, emissiveIntensity: 1.2 });
    const pipeGeo = new THREE.CylinderGeometry(0.55, 0.55, 2.2, 12);
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.75, roughness: 0.35 });
    const spillPoolGeo = new THREE.CircleGeometry(2.8, 20);
    const spillPoolMat = new THREE.MeshStandardMaterial({
      color: 0x84cc16,
      emissive: 0x65a30d,
      emissiveIntensity: 1.1,
      transparent: true,
      opacity: 0.78,
    });
    const sealedValveGeo = new THREE.CylinderGeometry(0.6, 0.6, 2.2, 12);
    const sealedValveMat = new THREE.MeshStandardMaterial({ color: 0x0ea5e9, metalness: 0.7, roughness: 0.25 });
    const cleanWaterMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.55, roughness: 0.1 });
    const equipGeo = new THREE.CylinderGeometry(0.55, 0.65, 1.4, 12);
    const equipPendingMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xb45309, emissiveIntensity: 0.65, metalness: 0.6, roughness: 0.3 });
    const equipDoneMat = new THREE.MeshStandardMaterial({ color: 0x10b981, emissive: 0x059669, emissiveIntensity: 0.85, metalness: 0.6, roughness: 0.3 });
    const toxicBarrelGeo = new THREE.CylinderGeometry(0.5, 0.5, 1.3, 12);
    const toxicBarrelMat = new THREE.MeshStandardMaterial({ color: 0xeab308, emissive: 0xca8a04, emissiveIntensity: 0.9 });
    const medPodGeo = new THREE.CapsuleGeometry(0.32, 0.55, 6, 10);
    const rationPodGeo = new THREE.BoxGeometry(0.55, 0.45, 0.45);
    const waterPodGeo = new THREE.CylinderGeometry(0.24, 0.28, 0.65, 10);
    const hazDiscGeo = new THREE.CylinderGeometry(4.4, 4.4, 0.3, 20);
    const hazPlumeGeo = new THREE.SphereGeometry(1.8, 12, 10);
    const hColKind = cfg.isToxicBunker
      ? 0xf59e0b
      : mission.id.includes('wildfire')
      ? 0xef4444
      : isOcean
      ? 0x0ea5e9
      : 0xf59e0b;
    const hazDiscMat = new THREE.MeshStandardMaterial({ color: hColKind, emissive: hColKind, emissiveIntensity: 0.95, transparent: true, opacity: 0.42 });
    const hazPlumeMat = new THREE.MeshStandardMaterial({ color: hColKind, emissive: hColKind, emissiveIntensity: 1.1, transparent: true, opacity: 0.25 });
    const medMat = new THREE.MeshStandardMaterial({ color: 0x10b981, emissive: 0x10b981, emissiveIntensity: 1.15, roughness: 0.25 });
    const rationMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xd97706, emissiveIntensity: 0.95, roughness: 0.35 });
    const waterMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 1.05, roughness: 0.2 });
    const wildlifeBodyGeo = new THREE.CapsuleGeometry(0.24, 0.72, 6, 8);
    const wildlifeBodyMat = new THREE.MeshStandardMaterial({ color: isOcean ? 0x38bdf8 : 0x4ade80, roughness: 0.4 });
    const wildlifeTailGeo = new THREE.ConeGeometry(0.24, 0.48, 4);
    const wildlifeTailMat = new THREE.MeshStandardMaterial({
      color: isOcean ? 0xf59e0b : 0x22c55e,
      emissive: isOcean ? 0xd97706 : 0x000000,
      emissiveIntensity: isOcean ? 0.85 : 0,
      roughness: 0.35,
    });

    disposableGeometries.push(
      stumpGeo, stumpRingGeo, smogStackGeo, smogCloudGeo, valveRingGeo, cleanCapGeo,
      pipeGeo, spillPoolGeo, sealedValveGeo, equipGeo, toxicBarrelGeo, medPodGeo,
      rationPodGeo, waterPodGeo, hazDiscGeo, hazPlumeGeo, wildlifeBodyGeo, wildlifeTailGeo
    );
    disposableMaterials.push(
      stumpMat, stumpRingMat, smogStackMat, smogCloudMat, valveRingMat, cleanStackMat,
      cleanCapMat, pipeMat, spillPoolMat, sealedValveMat, cleanWaterMat, equipPendingMat,
      equipDoneMat, toxicBarrelMat, hazDiscMat, hazPlumeMat, medMat, rationMat, waterMat, wildlifeBodyMat, wildlifeTailMat
    );

    const populateNodes = () => {
      while (nodesGroup.children.length) nodesGroup.remove(nodesGroup.children[0]);
      while (hazardsGroup.children.length) hazardsGroup.remove(hazardsGroup.children[0]);
      while (wildlifeGroup.children.length) wildlifeGroup.remove(wildlifeGroup.children[0]);
      sim.nodes = [];
      sim.hazards = [];
      sim.wildlife = [];

      const nodeRand = createSeededRng(`${mission.id}:nodes`);
      const nodeRng = (min: number, max: number) => min + nodeRand() * (max - min);

      // Rubbish clusters (cleaning removes surrounding trash props too)
      for (let i = 0; i < cfg.rubbishCount; i++) {
        const isHidden = i < cfg.hiddenItemsCount;
        const x = nodeRng(-16, 48);
        const z = nodeRng(-44, 44);
        const g = buildTrashClusterMesh(isHidden, nodeAssets, !isSoftwareGl);
        g.position.set(x, groundHeightAt(x, z, theme), z);
        g.visible = !isHidden;
        nodesGroup.add(g);
        sim.nodes.push({ id: `rub-${i}`, kind: 'rubbish', x, z, hidden: isHidden, revealed: !isHidden, completed: false, mesh: g });
      }

      // 2 Kinds of City Pollution: (1) Smog Exhaust Stacks & (2) Toxic Chemical Runoff Pipes
      const smogCount = cfg.smogStacksToStop ?? 0;
      for (let i = 0; i < smogCount; i++) {
        const x = i === 0 ? -6 : 34;
        const z = i === 0 ? -22 : 24;
        const y = groundHeightAt(x, z, theme);
        const g = new THREE.Group();
        const stack = new THREE.Mesh(smogStackGeo, smogStackMat);
        stack.position.y = 2.6;
        stack.castShadow = !isSoftwareGl;
        const smogCloud = new THREE.Mesh(smogCloudGeo, smogCloudMat);
        smogCloud.position.y = 5.8;
        const valveRing = new THREE.Mesh(valveRingGeo, valveRingMat);
        valveRing.rotation.x = Math.PI / 2;
        valveRing.position.y = 0.25;
        g.add(stack, smogCloud, valveRing);
        g.position.set(x, y, z);

        const cleanStack = new THREE.Group();
        const cleanCol = new THREE.Mesh(smogStackGeo, cleanStackMat);
        cleanCol.position.y = 2.6;
        const cleanCap = new THREE.Mesh(cleanCapGeo, cleanCapMat);
        cleanCap.position.y = 5.4;
        cleanStack.add(cleanCol, cleanCap);
        cleanStack.position.set(x, y, z);
        cleanStack.visible = false;

        nodesGroup.add(g, cleanStack);
        sim.nodes.push({ id: `smog-${i}`, kind: 'smog-stack', x, z, hidden: false, revealed: true, completed: false, mesh: g, restoredMesh: cleanStack });
      }

      const runoffCount = cfg.runoffPipesToSeal ?? 0;
      for (let i = 0; i < runoffCount; i++) {
        const x = i === 0 ? 8 : -10;
        const z = i === 0 ? -8 : 26;
        const y = groundHeightAt(x, z, theme);
        const g = new THREE.Group();
        const pipe = new THREE.Mesh(pipeGeo, pipeMat);
        pipe.rotation.z = Math.PI / 2;
        pipe.position.y = 0.75;
        const spillPool = new THREE.Mesh(spillPoolGeo, spillPoolMat);
        spillPool.rotation.x = -Math.PI / 2;
        spillPool.position.y = 0.06;
        g.add(pipe, spillPool);
        g.position.set(x, y, z);

        const cleanPipe = new THREE.Group();
        const sealedValve = new THREE.Mesh(sealedValveGeo, sealedValveMat);
        sealedValve.rotation.z = Math.PI / 2;
        sealedValve.position.y = 0.75;
        const cleanWater = new THREE.Mesh(spillPoolGeo, cleanWaterMat);
        cleanWater.rotation.x = -Math.PI / 2;
        cleanWater.position.y = 0.06;
        cleanPipe.add(sealedValve, cleanWater);
        cleanPipe.position.set(x, y, z);
        cleanPipe.visible = false;

        nodesGroup.add(g, cleanPipe);
        sim.nodes.push({ id: `runoff-${i}`, kind: 'runoff-pipe', x, z, hidden: false, revealed: true, completed: false, mesh: g, restoredMesh: cleanPipe });
      }

      for (let i = 0; i < cfg.treesToPlant; i++) {
        const x = nodeRng(-14, 50);
        const z = nodeRng(-44, 44);
        const g = new THREE.Group();
        const stump = new THREE.Mesh(stumpGeo, stumpMat);
        stump.position.y = 0.3;
        const ring = new THREE.Mesh(stumpRingGeo, stumpRingMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.1;
        g.add(stump, ring);
        const y = groundHeightAt(x, z, theme);
        g.position.set(x, y, z);

        const lush = buildLushTreeMesh(nodeAssets, !isSoftwareGl);
        lush.position.set(x, y, z);
        lush.visible = false;

        nodesGroup.add(g, lush);
        sim.nodes.push({ id: `tree-${i}`, kind: 'tree-plot', x, z, hidden: false, revealed: true, completed: false, mesh: g, restoredMesh: lush });
      }

      for (let i = 0; i < cfg.coralsToRestore; i++) {
        const x = nodeRng(-14, 48);
        const z = nodeRng(-44, 44);
        const y = groundHeightAt(x, z, theme);
        const bleached = buildCoralReefMesh(false, nodeAssets);
        bleached.position.set(x, y, z);
        const living = buildCoralReefMesh(true, nodeAssets);
        living.position.set(x, y, z);
        living.visible = false;
        nodesGroup.add(bleached, living);
        sim.nodes.push({ id: `coral-${i}`, kind: 'coral-plot', x, z, hidden: false, revealed: true, completed: false, mesh: bleached, restoredMesh: living });
      }

      for (let i = 0; i < cfg.equipmentToRepair; i++) {
        const x = nodeRng(-12, 46);
        const z = nodeRng(-42, 42);
        const y = groundHeightAt(x, z, theme);
        const g = new THREE.Group();
        const consoleBox = new THREE.Mesh(equipGeo, equipPendingMat);
        consoleBox.position.y = 0.7;
        consoleBox.castShadow = !isSoftwareGl;
        g.add(consoleBox);
        g.position.set(x, y, z);
        nodesGroup.add(g);
        sim.nodes.push({ id: `equip-${i}`, kind: 'equipment', x, z, hidden: false, revealed: true, completed: false, mesh: g });
      }

      if (cfg.isToxicBunker) {
        for (let i = 0; i < 5; i++) {
          const x = nodeRng(-12, 48);
          const z = nodeRng(-44, 44);
          const g = new THREE.Group();
          const barrel = new THREE.Mesh(toxicBarrelGeo, toxicBarrelMat);
          barrel.position.y = 0.65;
          g.add(barrel);
          g.position.set(x, groundHeightAt(x, z, theme), z);
          g.visible = false;
          nodesGroup.add(g);
          sim.nodes.push({ id: `tox-${i}`, kind: 'toxic-node', x, z, hidden: true, revealed: false, completed: false, mesh: g });
        }
      }

      if (cfg.isDisaster) {
        for (let i = 0; i < 3; i++) {
          const x = nodeRng(-10, 34);
          const z = nodeRng(-34, 34);
          const cit = buildEcoRangerMesh(0xf8fafc, false);
          cit.group.position.set(x, groundHeightAt(x, z, theme), z);
          nodesGroup.add(cit.group);
          sim.nodes.push({ id: `cit-${i}`, kind: 'citizen', x, z, hidden: false, revealed: true, completed: false, mesh: cit.group });
        }
      }

      // Eco-Med Pods, Ration Pods (Hunger), and Hydration Pods (Thirst)
      for (let i = 0; i < 3; i++) {
        const mx = nodeRng(-8, 42);
        const mz = nodeRng(-36, 36);
        const mg = new THREE.Group();
        const mc = new THREE.Mesh(medPodGeo, medMat);
        mc.position.y = 0.85;
        mg.add(mc);
        mg.position.set(mx, groundHeightAt(mx, mz, theme), mz);
        nodesGroup.add(mg);
        sim.nodes.push({ id: `med-${i}`, kind: 'med-pod', x: mx, z: mz, hidden: false, revealed: true, completed: false, mesh: mg });

        const rx = nodeRng(-16, 44);
        const rz = nodeRng(-36, 36);
        const rg = new THREE.Group();
        const rc = new THREE.Mesh(rationPodGeo, rationMat);
        rc.position.y = 0.75;
        rg.add(rc);
        rg.position.set(rx, groundHeightAt(rx, rz, theme), rz);
        nodesGroup.add(rg);
        sim.nodes.push({ id: `rat-${i}`, kind: 'ration-pod', x: rx, z: rz, hidden: false, revealed: true, completed: false, mesh: rg });

        const wx = nodeRng(-16, 44);
        const wz = nodeRng(-36, 36);
        const wg = new THREE.Group();
        const wc = new THREE.Mesh(waterPodGeo, waterMat);
        wc.position.y = 0.78;
        wg.add(wc);
        wg.position.set(wx, groundHeightAt(wx, wz, theme), wz);
        nodesGroup.add(wg);
        sim.nodes.push({ id: `wat-${i}`, kind: 'water-pod', x: wx, z: wz, hidden: false, revealed: true, completed: false, mesh: wg });
      }

      // Environmental Hazards
      const hazardCount = cfg.isDisaster || cfg.isToxicBunker ? 7 : mission.difficulty === 'High' || mission.difficulty === 'Critical' ? 4 : 2;
      const kind = cfg.isToxicBunker
        ? 'toxic-cloud'
        : mission.id.includes('wildfire')
        ? 'fire'
        : isOcean
        ? 'deep-current'
        : 'toxic-cloud';
      for (let i = 0; i < hazardCount; i++) {
        const x = nodeRng(-8, 46);
        const z = nodeRng(-40, 40);
        const g = new THREE.Group();
        const disc = new THREE.Mesh(hazDiscGeo, hazDiscMat);
        disc.position.y = 0.2;
        const plume = new THREE.Mesh(hazPlumeGeo, hazPlumeMat);
        plume.position.y = 1.4;
        g.add(disc, plume);
        g.position.set(x, groundHeightAt(x, z, theme), z);
        hazardsGroup.add(g);
        sim.hazards.push({ x, z, radius: 4.5, kind, mesh: g });
      }
    };

    populateNodes();

    // Actions exposed to React buttons
    const triggerScanner = () => {
      if (sim.missionEnded) return;
      sim.scanActive = true;
      sim.scanRadius = 1;
      sim.scanMax = hasScannerOptics ? 48 : 34;
      scanRingMesh.visible = true;
      soundEngine.scan();

      if (cfg.isToxicBunker && !sim.bunkerFound) {
        const dist = Math.hypot(sim.playerX - bunkerPos.x, sim.playerZ - bunkerPos.z);
        if (dist <= sim.scanMax) {
          sim.bunkerFound = true;
          bunkerGroup.visible = true;
          setBunkerFound(true);
          soundEngine.upgrade();
          coopRef.current.onSendDiscovery?.(mission.id, 'bunker');
          setRobotHint('HIDDEN BUNKER DETECTED! Lead your squad into the bunker dome!');
        } else {
          const dx = bunkerPos.x - sim.playerX;
          const dz = bunkerPos.z - sim.playerZ;
          const ns = dz < -4 ? 'North' : dz > 4 ? 'South' : '';
          const ew = dx < -4 ? 'West' : dx > 4 ? 'East' : '';
          setRobotHint(`Scanner Echo: Hidden Bunker ~${Math.round(dist)}m ${ns} ${ew}.`);
        }
      }
    };

    const findNearestRecycler = () => {
      let best = recyclerPositions[0];
      let bestD = Infinity;
      for (let i = 0; i < recyclerPositions.length; i++) {
        const d = Math.hypot(sim.playerX - recyclerPositions[i].x, sim.playerZ - recyclerPositions[i].z);
        if (d < bestD) {
          bestD = d;
          best = recyclerPositions[i];
        }
      }
      return { pos: best, dist: bestD };
    };

    const triggerRecycle = () => {
      if (sim.missionEnded || isRecyclingRef.current) return;
      if (sim.localBackpack <= 0) {
        setRobotHint('Small Bag is empty (0/20). Collect trash first using your Rusty Grabber.');
        return;
      }
      const { pos: nearestRec, dist } = findNearestRecycler();
      if (dist > 8.5) {
        sim.targetX = nearestRec.x + 2.8;
        sim.targetZ = nearestRec.z;
        setRobotHint('Following guidance arrow to the nearest Automatic Recycling Station...');
        return;
      }

      isRecyclingRef.current = true;
      setIsRecycling(true);
      setRecycleAnimPct(0);
      soundEngine.recycle();

      const items = sim.localBackpack;
      const scrapGained = items; // Exact 1:1 trash-to-Scrap conversion
      const pts = items * (hasPlasmaRecycler ? 14 : 10);
      let pct = 0;
      const iv = window.setInterval(() => {
        pct += 10;
        setRecycleAnimPct(pct);
        if (pct >= 100) {
          window.clearInterval(iv);
          sim.localBackpack = 0;
          sim.recycledCount += items;
          sim.scrapEarned += scrapGained;
          sim.ecoEarned += pts;
          callbacksRef.current.onUpdateProgress((p) => ({
            ...p,
            currentBackpackItems: 0,
            scrap: (p.scrap ?? 0) + scrapGained,
            ecoPoints: p.ecoPoints + pts,
            totalEcoPointsEarned: p.totalEcoPointsEarned + pts,
            totalWasteRecycled: p.totalWasteRecycled + items,
          }));
          isRecyclingRef.current = false;
          setIsRecycling(false);
          setRecycleAnimPct(0);
          setRobotHint(`Auto Recycler converted ${items} trash into +${scrapGained} Scrap & +${pts} EP!`);
        }
      }, 105);
    };

    const restartMission = () => {
      sim.playerX = -20;
      sim.playerZ = 6;
      sim.playerJumpY = isOcean ? 2.2 : 0;
      sim.playerVelY = 0;
      sim.isGrounded = !isOcean;
      sim.isSwimming = isOcean;
      sim.yaw = -Math.PI * 0.45;
      sim.pitch = -0.06;
      sim.targetX = null;
      sim.targetZ = null;
      sim.health = maxHealth;
      sim.oxygen = 100;
      sim.toxicity = 0;
      sim.energy = 100;
      sim.hunger = 100;
      sim.thirst = 100;
      sim.parts = { head: 100, body: 100, leftArm: 100, rightArm: 100, leftLeg: 100, rightLeg: 100 };
      sim.bunkerFound = false;
      bunkerGroup.visible = false;
      sim.labDiscovered = false;
      labGroup.visible = false;
      sim.missionEnded = false;
      sim.recycledCount = 0;
      sim.scrapEarned = 0;
      sim.treesPlanted = 0;
      sim.coralsRestored = 0;
      sim.equipmentRepaired = 0;
      sim.smogStopped = 0;
      sim.runoffSealed = 0;
      sim.teammatesRescuedNow = 0;
      sim.ecoEarned = 0;
      sim.squad.forEach((s, i) => {
        s.status = 'active';
        s.x = -12 + i * 12;
        s.y = i % 2 === 0 ? -12 : 16;
      });
      populateNodes();
      coopRef.current.onResetCoopArena?.(mission.id);
      setHealth(maxHealth);
      setOxygen(100);
      setToxicity(0);
      setBunkerFound(false);
      setMissionFailed(null);
      setMissionWon(false);
      setWarningActive(Boolean(cfg.isDisaster));
      setWarningCountdown(6);
    };

    const cycleWeather = () => {
      const next = (weatherIndexRef.current + 1) % climateRef.current.cycle.length;
      weatherIndexRef.current = next;
      setWeatherIndex(next);
      soundEngine.click();
    };

    simActionRef.current = { triggerScanner, triggerRecycle, restartMission, cycleWeather };

    // 1st-Person Mouse-Look (PointerLock + Fallback Drag-Look) & 3rd-Person Click
    let isDraggingLook = false;
    let lastPointerX = 0;
    let lastPointerY = 0;
    let downX = 0;
    let downY = 0;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const onPointerDown = (e: PointerEvent) => {
      if (sim.missionEnded || warningActiveRef.current) return;
      isDraggingLook = true;
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
      downX = e.clientX;
      downY = e.clientY;

      if (firstPersonRef.current && document.pointerLockElement !== renderer.domElement) {
        try {
          const req = renderer.domElement.requestPointerLock?.() as unknown as Promise<void> | undefined;
          if (req && typeof req.catch === 'function') {
            req.catch(() => {});
          }
        } catch {
          // Drag-look fallback active
        }
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (sim.missionEnded || warningActiveRef.current) return;
      if (document.pointerLockElement === renderer.domElement) {
        sim.yaw -= e.movementX * 0.0024;
        sim.pitch = THREE.MathUtils.clamp(sim.pitch - e.movementY * 0.0022, -1.15, 1.15);
      } else if (isDraggingLook) {
        const dx = e.clientX - lastPointerX;
        const dy = e.clientY - lastPointerY;
        lastPointerX = e.clientX;
        lastPointerY = e.clientY;
        sim.yaw -= dx * 0.0036;
        sim.pitch = THREE.MathUtils.clamp(sim.pitch - dy * 0.0032, -1.15, 1.15);
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      const dragDist = Math.hypot(e.clientX - downX, e.clientY - downY);
      isDraggingLook = false;
      if (!firstPersonRef.current && dragDist < 6 && !sim.missionEnded && !warningActiveRef.current) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObject(terrainMesh, false);
        if (hits.length > 0) {
          sim.targetX = THREE.MathUtils.clamp(hits[0].point.x, -PLAY_LIMIT, PLAY_LIMIT);
          sim.targetZ = THREE.MathUtils.clamp(hits[0].point.z, -PLAY_LIMIT, PLAY_LIMIT);
        }
      }
    };

    const onPointerLockChange = () => {
      setPointerLocked(document.pointerLockElement === renderer.domElement);
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointerlockchange', onPointerLockChange);

    const onKeyDown = (e: KeyboardEvent) => {
      sim.keys[e.code] = true;
      if (e.code === 'KeyQ') triggerScanner();
      if (e.code === 'KeyR') triggerRecycle();
      if (e.code === 'KeyV') {
        setFirstPerson((prev) => {
          const next = !prev;
          if (!next && document.pointerLockElement === renderer.domElement) {
            document.exitPointerLock?.();
          }
          return next;
        });
      }
      if (e.code === 'Space' && sim.isGrounded && !sim.isSwimming && !sim.missionEnded && !warningActiveRef.current) {
        sim.playerVelY = 8.6;
        sim.isGrounded = false;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      sim.keys[e.code] = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    const onResize = () => {
      if (!container) return;
      const nw = container.clientWidth || window.innerWidth;
      const nh = container.clientHeight || window.innerHeight;
      const pr = isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2);
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(pr);
      renderer.setSize(nw, nh);
      composer?.setPixelRatio(pr);
      composer?.setSize(nw, nh);
      bloomPass?.resolution.set(nw, nh);
      if (ultraHdGradePass) {
        ultraHdGradePass.uniforms.uTexel.value.set(1 / Math.max(1, nw * pr), 1 / Math.max(1, nh * pr));
      }
    };
    window.addEventListener('resize', onResize);

    const clock = new THREE.Clock();
    let frameId = 0;
    let disposed = false;
    let hudTimer = 0;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || !gl.fenceSync) {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    const triggerPlayerDeath = (reason: string) => {
      if (sim.missionEnded) return;
      sim.missionEnded = true;
      sim.causeOfDeath = reason;
      if (document.pointerLockElement === renderer.domElement) {
        document.exitPointerLock?.();
      }
      soundEngine.death();
      setMissionFailed(reason);
    };

    const applyLimbDamage = (amount: number, target: 'fire' | 'toxic' | 'water' | 'starve') => {
      sim.health = Math.max(0, sim.health - amount);
      if (target === 'fire') {
        sim.parts.leftLeg = Math.max(0, sim.parts.leftLeg - amount * 1.15);
        sim.parts.rightLeg = Math.max(0, sim.parts.rightLeg - amount * 1.15);
        sim.parts.body = Math.max(0, sim.parts.body - amount * 0.85);
      } else if (target === 'toxic') {
        sim.parts.head = Math.max(0, sim.parts.head - amount * 1.1);
        sim.parts.body = Math.max(0, sim.parts.body - amount * 0.95);
        sim.parts.leftArm = Math.max(0, sim.parts.leftArm - amount * 0.65);
        sim.parts.rightArm = Math.max(0, sim.parts.rightArm - amount * 0.65);
      } else if (target === 'water') {
        sim.parts.leftArm = Math.max(0, sim.parts.leftArm - amount * 1.0);
        sim.parts.rightArm = Math.max(0, sim.parts.rightArm - amount * 1.0);
        sim.parts.head = Math.max(0, sim.parts.head - amount * 0.9);
      } else {
        sim.parts.body = Math.max(0, sim.parts.body - amount * 1.1);
        sim.parts.head = Math.max(0, sim.parts.head - amount * 0.9);
      }
    };

    const healAllLimbs = (amount: number) => {
      sim.parts.head = Math.min(100, sim.parts.head + amount);
      sim.parts.body = Math.min(100, sim.parts.body + amount);
      sim.parts.leftArm = Math.min(100, sim.parts.leftArm + amount);
      sim.parts.rightArm = Math.min(100, sim.parts.rightArm + amount);
      sim.parts.leftLeg = Math.min(100, sim.parts.leftLeg + amount);
      sim.parts.rightLeg = Math.min(100, sim.parts.rightLeg + amount);
    };

    const checkVictory = () => {
      if (sim.missionEnded) return;
      const rubLeft = sim.nodes.filter((n) => n.kind === 'rubbish' && !n.completed).length;
      const treeLeft = sim.nodes.filter((n) => n.kind === 'tree-plot' && !n.completed).length;
      const coralLeft = sim.nodes.filter((n) => n.kind === 'coral-plot' && !n.completed).length;
      const equipLeft = sim.nodes.filter((n) => n.kind === 'equipment' && !n.completed).length;
      const smogLeft = sim.nodes.filter((n) => n.kind === 'smog-stack' && !n.completed).length;
      const runoffLeft = sim.nodes.filter((n) => n.kind === 'runoff-pipe' && !n.completed).length;
      const citLeft = sim.nodes.filter((n) => n.kind === 'citizen' && !n.completed).length;
      const downed = sim.squad.filter((s) => s.status === 'needs-rescue').length;

      if (cfg.isToxicBunker) {
        const inBunker = sim.bunkerFound && Math.hypot(sim.playerX - bunkerPos.x, sim.playerZ - bunkerPos.z) < 5.0;
        if (inBunker && downed === 0) {
          sim.missionEnded = true;
          if (document.pointerLockElement === renderer.domElement) document.exitPointerLock?.();
          soundEngine.missionComplete();
          setMissionWon(true);
          callbacksRef.current.onMissionComplete(mission, {
            ecoEarned: sim.ecoEarned + mission.rewardEcoPoints,
            recycledNow: sim.recycledCount,
            treesPlanted: sim.treesPlanted,
            coralsRestored: sim.coralsRestored,
            teammatesRescued: sim.teammatesRescuedNow,
            labDiscovered: sim.labDiscovered,
          });
        }
        return;
      }

      if (cfg.isDisaster) {
        const atSafe = Math.hypot(sim.playerX - safeZonePos.x, sim.playerZ - safeZonePos.z) < 5.5;
        if (equipLeft === 0 && citLeft === 0 && downed === 0 && atSafe) {
          sim.missionEnded = true;
          if (document.pointerLockElement === renderer.domElement) document.exitPointerLock?.();
          soundEngine.missionComplete();
          setMissionWon(true);
          callbacksRef.current.onMissionComplete(mission, {
            ecoEarned: sim.ecoEarned + mission.rewardEcoPoints,
            recycledNow: sim.recycledCount,
            treesPlanted: sim.treesPlanted,
            coralsRestored: sim.coralsRestored,
            teammatesRescued: sim.teammatesRescuedNow,
            labDiscovered: sim.labDiscovered,
          });
        }
        return;
      }

      const labOk = !cfg.hasSecretLab || sim.labDiscovered;
      if (
        rubLeft === 0 &&
        treeLeft === 0 &&
        coralLeft === 0 &&
        equipLeft === 0 &&
        smogLeft === 0 &&
        runoffLeft === 0 &&
        sim.localBackpack === 0 &&
        labOk
      ) {
        sim.missionEnded = true;
        if (document.pointerLockElement === renderer.domElement) document.exitPointerLock?.();
        soundEngine.missionComplete();
        setMissionWon(true);
        callbacksRef.current.onMissionComplete(mission, {
          ecoEarned: sim.ecoEarned + mission.rewardEcoPoints,
          recycledNow: sim.recycledCount,
          treesPlanted: sim.treesPlanted,
          coralsRestored: sim.coralsRestored,
          teammatesRescued: sim.teammatesRescuedNow,
          labDiscovered: sim.labDiscovered,
        });
      }
    };

    const _camEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    const _arrowDir = new THREE.Vector3();

    // Diff-snapshot so tick() never triggers React re-renders when HUD numbers are unchanged
    let lastHud = {
      solarStr: '',
      health: maxHealth,
      oxygen: 100,
      toxicity: 0,
      damageFlash: false,
      swimming: isOcean,
      recKey: '',
      energy: 100,
      hunger: 100,
      thirst: 100,
      speed: 0,
      head: 100,
      body: 100,
      leftArm: 100,
      rightArm: 100,
      leftLeg: 100,
      rightLeg: 100,
      squadKey: '',
      statsKey: '',
    };
    let weatherCycleTimer = 0;
    let lightningCooldown = 6.5;
    let lightningFlash = 0;
    let liveRain = climateProfile.cycle[0].rainIntensity;
    let liveSnow = climateProfile.cycle[0].snowIntensity;
    let liveWetness = climateProfile.cycle[0].wetness;
    let liveSnowCover = climateProfile.cycle[0].snowCover;
    let liveFogMult = climateProfile.cycle[0].fogMult;
    let liveSunDim = climateProfile.cycle[0].sunDim;

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    function tick() {
      if (disposed) return;
      const dt = Math.min(clock.getDelta(), 0.08);
      const elapsed = clock.getElapsedTime();
      const prog = progressRef.current;

      if (!sim.missionEnded && !warningActiveRef.current) {
        // Determine swimming state (always underwater in Coral Reef, or submerged in Floodwater!)
        const groundY = groundHeightAt(sim.playerX, sim.playerZ, theme);
        const submergedInFlood = isFlooded && groundY < 0.25 && sim.playerJumpY < 1.2;
        sim.isSwimming = isOcean || submergedInFlood;

        const isSprinting = Boolean(sim.keys['ShiftLeft'] || sim.keys['ShiftRight']) && sim.energy > 6;
        const legFactor = 0.65 + 0.35 * (Math.min(sim.parts.leftLeg, sim.parts.rightLeg) / 100);
        const staminaFactor = sim.energy < 15 ? 0.72 : 1.0;
        const baseSpeed = (
          prog.activeVehicleId === 'vehicle-heli'
            ? 22.0
            : prog.activeVehicleId
            ? 17.5
            : sim.isSwimming
            ? 9.6
            : 12.2
        ) * legFactor * staminaFactor;
        const speed = isSprinting ? baseSpeed * 1.42 : baseSpeed;

        if (sim.keys['ArrowLeft']) sim.yaw += dt * 2.1;
        if (sim.keys['ArrowRight']) sim.yaw -= dt * 2.1;

        let forwardInput = 0;
        let strafeInput = 0;
        if (sim.keys['KeyW'] || sim.keys['ArrowUp']) forwardInput += 1;
        if (sim.keys['KeyS'] || sim.keys['ArrowDown']) forwardInput -= 1;
        if (sim.keys['KeyD']) strafeInput += 1;
        if (sim.keys['KeyA']) strafeInput -= 1;

        let moving = false;
        let actualDisp = 0;
        if (forwardInput !== 0 || strafeInput !== 0) {
          sim.targetX = null;
          sim.targetZ = null;
          const sinY = Math.sin(sim.yaw);
          const cosY = Math.cos(sim.yaw);
          const rawX = -sinY * forwardInput + cosY * strafeInput;
          const rawZ = -cosY * forwardInput - sinY * strafeInput;
          const len = Math.hypot(rawX, rawZ) || 1;
          const stepDist = speed * dt;
          sim.playerX += (rawX / len) * stepDist;
          sim.playerZ += (rawZ / len) * stepDist;
          actualDisp = stepDist;
          playerActor.group.rotation.y = Math.atan2(rawX, rawZ);
          moving = true;

          // Pitch-assisted vertical swim when moving underwater
          if (sim.isSwimming && forwardInput > 0) {
            sim.playerJumpY = THREE.MathUtils.clamp(sim.playerJumpY + Math.sin(sim.pitch) * stepDist * 0.65, 0.35, 11.5);
          }
        } else if (sim.targetX !== null && sim.targetZ !== null) {
          const dx = sim.targetX - sim.playerX;
          const dz = sim.targetZ - sim.playerZ;
          const dist = Math.hypot(dx, dz);
          if (dist < 0.5) {
            sim.targetX = null;
            sim.targetZ = null;
          } else {
            const stepDist = speed * dt;
            sim.playerX += (dx / dist) * stepDist;
            sim.playerZ += (dz / dist) * stepDist;
            actualDisp = stepDist;
            playerActor.group.rotation.y = Math.atan2(dx, dz);
            moving = true;
          }
        }

        sim.currentSpeed = THREE.MathUtils.damp(sim.currentSpeed, moving ? actualDisp / Math.max(0.001, dt) : 0, 8, dt);
        sim.playerX = THREE.MathUtils.clamp(sim.playerX, -PLAY_LIMIT, PLAY_LIMIT);
        sim.playerZ = THREE.MathUtils.clamp(sim.playerZ, -PLAY_LIMIT, PLAY_LIMIT);

        // Swim Buoyancy Controls vs Land Jump & Gravity
        if (sim.isSwimming) {
          if (sim.keys['Space']) {
            sim.playerVelY = 5.4;
          } else if (sim.keys['KeyC'] || sim.keys['ControlLeft']) {
            sim.playerVelY = -5.2;
          } else {
            sim.playerVelY *= Math.exp(-5.0 * dt);
          }
          sim.playerJumpY = THREE.MathUtils.clamp(
            sim.playerJumpY + sim.playerVelY * dt + Math.sin(elapsed * 2.2) * 0.006,
            0.35,
            12.0
          );
          sim.isGrounded = false;
        } else if (!sim.isGrounded) {
          sim.playerVelY -= 21.5 * dt;
          sim.playerJumpY += sim.playerVelY * dt;
          if (sim.playerJumpY <= 0) {
            sim.playerJumpY = 0;
            sim.playerVelY = 0;
            sim.isGrounded = true;
          }
        }

        // Vitality Simulation (Energy, Hunger, Thirst)
        if (isSprinting && moving) {
          sim.energy = Math.max(0, sim.energy - 8.5 * dt);
        } else if (sim.isSwimming && moving) {
          sim.energy = Math.max(0, sim.energy - 2.6 * dt);
        } else {
          const regen = sim.hunger > 20 && sim.thirst > 20 ? 5.2 : 1.4;
          sim.energy = Math.min(100, sim.energy + regen * dt);
        }
        sim.hunger = Math.max(0, sim.hunger - (moving ? 0.38 : 0.16) * dt);
        sim.thirst = Math.max(0, sim.thirst - (isSprinting ? 0.62 : 0.25) * dt);

        if (sim.hunger <= 0 || sim.thirst <= 0) {
          applyLimbDamage(3.2 * dt, 'starve');
          if (sim.health <= 0) {
            triggerPlayerDeath(
              sim.thirst <= 0 ? 'Player collapsed from severe dehydration.' : 'Player collapsed from exhaustion & hunger.'
            );
          }
        }

        // 3rd-Person Minecraft-Style Swimming vs Walking Animation
        if (sim.isSwimming) {
          const strokeRate = moving ? (isSprinting ? 10.5 : 7.5) : 3.2;
          sim.swimPhase += dt * strokeRate;
          playerActor.bodyRig.rotation.x = THREE.MathUtils.damp(playerActor.bodyRig.rotation.x, Math.PI * 0.44, 7.5, dt);
          playerActor.bodyRig.position.y = THREE.MathUtils.damp(playerActor.bodyRig.position.y, 0.85, 7.5, dt);
          playerActor.head.rotation.x = THREE.MathUtils.damp(playerActor.head.rotation.x, -0.65, 7.5, dt);
          // Breaststroke / freestyle arm sweep & alternating flutter kick
          playerActor.armL.rotation.x = -Math.PI * 0.85 + Math.sin(sim.swimPhase) * 0.72;
          playerActor.armR.rotation.x = -Math.PI * 0.85 - Math.sin(sim.swimPhase) * 0.72;
          playerActor.armL.rotation.z = 0.35 + Math.cos(sim.swimPhase) * 0.38;
          playerActor.armR.rotation.z = -0.35 - Math.cos(sim.swimPhase) * 0.38;
          playerActor.legL.rotation.x = Math.sin(sim.swimPhase * 1.4) * 0.55;
          playerActor.legR.rotation.x = -Math.sin(sim.swimPhase * 1.4) * 0.55;
        } else {
          playerActor.bodyRig.rotation.x = THREE.MathUtils.damp(playerActor.bodyRig.rotation.x, 0, 10, dt);
          playerActor.bodyRig.position.y = THREE.MathUtils.damp(playerActor.bodyRig.position.y, 0, 10, dt);
          playerActor.head.rotation.x = THREE.MathUtils.damp(playerActor.head.rotation.x, 0, 10, dt);
          playerActor.armL.rotation.z = THREE.MathUtils.damp(playerActor.armL.rotation.z, 0, 10, dt);
          playerActor.armR.rotation.z = THREE.MathUtils.damp(playerActor.armR.rotation.z, 0, 10, dt);

          if (moving) {
            sim.walkPhase += dt * (isSprinting ? 13 : 9.5);
            playerActor.legL.rotation.x = Math.sin(sim.walkPhase) * 0.52;
            playerActor.legR.rotation.x = -Math.sin(sim.walkPhase) * 0.52;
            playerActor.armL.rotation.x = -Math.sin(sim.walkPhase) * 0.45;
            playerActor.armR.rotation.x = Math.sin(sim.walkPhase) * 0.45;
          } else {
            playerActor.legL.rotation.x *= 0.85;
            playerActor.legR.rotation.x *= 0.85;
            playerActor.armL.rotation.x *= 0.85;
            playerActor.armR.rotation.x *= 0.85;
          }
        }

        const fillRatio = Math.max(0.05, Math.min(1, sim.localBackpack / Math.max(1, prog.backpackMaxCapacity)));
        playerActor.packFill.scale.y = fillRatio;

        const vId = prog.activeVehicleId;
        vehicleMeshGroup.visible = Boolean(vId) && !firstPersonRef.current;
        roverGroup.visible = vId === 'vehicle-transport';
        boatGroup.visible = vId === 'vehicle-boat';
        heliGroup.visible = vId === 'vehicle-heli';
        if (roverGroup.visible && moving) {
          for (let wi = 0; wi < roverWheels.length; wi++) roverWheels[wi].rotation.x += dt * 10;
        }
        if (boatGroup.visible) boatGroup.position.y = Math.sin(elapsed * 3.2) * 0.08;
        if (heliGroup.visible) {
          rotorBlade.rotation.y += dt * 20;
          tailRotor.rotation.x += dt * 24;
          heliGroup.position.y = 0.35 + Math.sin(elapsed * 4.5) * 0.1;
        }

        // 1st-Person Handheld Rusty Grabber + Minecraft-style Swimming Arm Strokes
        if (sim.grabSnapTimer > 0) sim.grabSnapTimer = Math.max(0, sim.grabSnapTimer - dt);
        const snapAmt = sim.grabSnapTimer > 0 ? Math.sin((sim.grabSnapTimer / 0.28) * Math.PI) : 0;
        jawL.rotation.y = 0.35 * (1 - snapAmt);
        jawR.rotation.y = -0.35 * (1 - snapAmt);

        if (firstPersonRef.current) {
          toolGroup.visible = true;
          if (sim.isSwimming) {
            fpSwimArmL.visible = true;
            const sw = sim.swimPhase;
            // Breaststroke / freestyle arm sweep in 1st person
            fpSwimArmL.position.set(-0.36 + Math.sin(sw) * 0.11, -0.28 + Math.cos(sw) * 0.09, -0.35 - Math.cos(sw) * 0.12);
            fpSwimArmL.rotation.set(-0.2 + Math.cos(sw) * 0.45, 0.25 - Math.sin(sw) * 0.35, 0.2);

            toolGroup.position.set(0.32 - Math.sin(sw) * 0.1, -0.25 - Math.cos(sw) * 0.08, -0.45 + Math.cos(sw) * 0.1);
            toolGroup.rotation.set(-0.12 - Math.cos(sw) * 0.38, -0.15 + Math.sin(sw) * 0.32, snapAmt * 0.15);
          } else {
            fpSwimArmL.visible = false;
            const bobX = moving ? Math.cos(sim.walkPhase * 0.5) * 0.018 : Math.cos(elapsed * 1.4) * 0.004;
            const bobY = moving ? Math.abs(Math.sin(sim.walkPhase)) * 0.022 : Math.sin(elapsed * 1.8) * 0.004;
            toolGroup.position.set(0.32 + bobX, -0.25 - bobY, -0.45 - snapAmt * 0.08);
            toolGroup.rotation.set(snapAmt * 0.18, 0, 0);
          }
          grabGlowMat.emissiveIntensity = sim.scanActive ? 2.0 : 0.9;
        } else {
          toolGroup.visible = false;
          fpSwimArmL.visible = false;
        }

        // Robot Companion follow & laser target
        robotActor.group.visible = prog.robotUnlocked;
        robotBeam.visible = false;
        if (prog.robotUnlocked) {
          const rSpeed = hasRobotOverdrive ? 7 : 4;
          robotActor.group.position.x = THREE.MathUtils.damp(robotActor.group.position.x, sim.playerX - 2.2, rSpeed, dt);
          robotActor.group.position.z = THREE.MathUtils.damp(robotActor.group.position.z, sim.playerZ - 2.0, rSpeed, dt);
          const gy = groundHeightAt(robotActor.group.position.x, robotActor.group.position.z, theme);
          robotActor.group.position.y = gy + 2.3 + Math.sin(elapsed * 3.5) * 0.2;
          robotActor.halo.rotation.z = elapsed * 2.8;

          const nearest = sim.nodes.find((n) => n.kind === 'rubbish' && n.revealed && !n.completed);
          if (nearest) {
            robotBeam.visible = true;
            const posArr = beamGeo.attributes.position as THREE.BufferAttribute;
            posArr.setXYZ(0, robotActor.group.position.x, robotActor.group.position.y, robotActor.group.position.z);
            posArr.setXYZ(1, nearest.x, groundHeightAt(nearest.x, nearest.z, theme) + 0.6, nearest.z);
            posArr.needsUpdate = true;

            if (hasRobotCollector) {
              sim.autoCollectCooldown -= dt;
              if (sim.autoCollectCooldown <= 0 && sim.localBackpack < prog.backpackMaxCapacity) {
                const dRob = Math.hypot(nearest.x - robotActor.group.position.x, nearest.z - robotActor.group.position.z);
                if (dRob < 6.5) {
                  nearest.completed = true;
                  nearest.mesh.visible = false;
                  triggerBurst(nearest.x, nearest.z, 0x38bdf8);
                  sim.localBackpack += 1;
                  sim.ecoEarned += 6;
                  sim.autoCollectCooldown = hasRobotOverdrive ? 0.6 : 1.1;
                  soundEngine.pickup();
                  coopRef.current.onSendNodeAction?.(mission.id, nearest.id, nearest.kind);
                  callbacksRef.current.onUpdateProgress((p) => ({
                    ...p,
                    currentBackpackItems: Math.min(p.backpackMaxCapacity, p.currentBackpackItems + 1),
                    ecoPoints: p.ecoPoints + 6,
                    totalEcoPointsEarned: p.totalEcoPointsEarned + 6,
                  }));
                }
              }
            }
          }
        }

        // Scanner Ring Expansion
        if (sim.scanActive) {
          sim.scanRadius += 32 * dt;
          scanRingMesh.position.set(sim.playerX, groundHeightAt(sim.playerX, sim.playerZ, theme) + 0.35, sim.playerZ);
          scanRingMesh.scale.setScalar(sim.scanRadius);

          sim.nodes.forEach((n) => {
            if (!n.revealed && Math.hypot(n.x - sim.playerX, n.z - sim.playerZ) <= sim.scanRadius) {
              n.revealed = true;
              n.mesh.visible = true;
            }
          });

          if (cfg.hasSecretLab && !sim.labDiscovered && Math.hypot(labPos.x - sim.playerX, labPos.z - sim.playerZ) <= sim.scanRadius) {
            sim.labDiscovered = true;
            labGroup.visible = true;
            soundEngine.upgrade();
            coopRef.current.onSendDiscovery?.(mission.id, 'lab');
            setRobotHint('SECRET RESEARCH LAB DISCOVERED! Rare blueprints & clue acquired!');
            callbacksRef.current.onUpdateProgress((p) => ({
              ...p,
              discoveredLabIds: p.discoveredLabIds.includes(mission.id) ? p.discoveredLabIds : [...p.discoveredLabIds, mission.id],
              labCluesFound: p.labCluesFound + 1,
              ecoPoints: p.ecoPoints + 45,
              totalEcoPointsEarned: p.totalEcoPointsEarned + 45,
            }));
          }

          if (sim.scanRadius >= sim.scanMax) {
            sim.scanActive = false;
            scanRingMesh.visible = false;
          }
        }

        // Interact with nearby nodes using Rusty Grabber / Field Systems
        const pickupRange = hasFastCollect ? 4.2 : 3.2;
        sim.nodes.forEach((n) => {
          if (n.completed || !n.revealed) return;
          const d = Math.hypot(n.x - sim.playerX, n.z - sim.playerZ);
          if (d > pickupRange) return;

          if (n.kind === 'rubbish') {
            if (sim.localBackpack < prog.backpackMaxCapacity) {
              n.completed = true;
              n.mesh.visible = false; // Removes trash pile & local grime cluster
              sim.grabSnapTimer = 0.28;
              triggerBurst(n.x, n.z, 0x38bdf8);
              sim.localBackpack += 1;
              sim.ecoEarned += 5;
              soundEngine.pickup();
              coopRef.current.onSendNodeAction?.(mission.id, n.id, n.kind);
              callbacksRef.current.onUpdateProgress((p) => ({
                ...p,
                currentBackpackItems: Math.min(p.backpackMaxCapacity, p.currentBackpackItems + 1),
                ecoPoints: p.ecoPoints + 5,
                totalEcoPointsEarned: p.totalEcoPointsEarned + 5,
              }));
              if (sim.localBackpack >= prog.backpackMaxCapacity) {
                setRobotHint(`Small Bag FULL (${prog.backpackMaxCapacity}/${prog.backpackMaxCapacity})! Follow the green arrow to the nearest Auto Recycler!`);
              }
            } else {
              setRobotHint(`Small Bag FULL (${prog.backpackMaxCapacity}/${prog.backpackMaxCapacity})! Follow the green arrow to deposit for Scrap.`);
            }
          } else if (n.kind === 'smog-stack') {
            n.completed = true;
            n.mesh.visible = false;
            if (n.restoredMesh) n.restoredMesh.visible = true;
            sim.grabSnapTimer = 0.28;
            triggerBurst(n.x, n.z, 0x34d399);
            sim.smogStopped += 1;
            sim.ecoEarned += 30;
            soundEngine.upgrade();
            coopRef.current.onSendNodeAction?.(mission.id, n.id, n.kind);
            setRobotHint(`City Air Pollution Stopped! Smog Exhaust Stack filtered (${sim.smogStopped}/${smogGoal}).`);
          } else if (n.kind === 'runoff-pipe') {
            n.completed = true;
            n.mesh.visible = false;
            if (n.restoredMesh) n.restoredMesh.visible = true;
            sim.grabSnapTimer = 0.28;
            triggerBurst(n.x, n.z, 0x38bdf8);
            sim.runoffSealed += 1;
            sim.ecoEarned += 30;
            soundEngine.upgrade();
            coopRef.current.onSendNodeAction?.(mission.id, n.id, n.kind);
            setRobotHint(`City Water Pollution Stopped! Toxic Runoff Pipe sealed (${sim.runoffSealed}/${runoffGoal}).`);
          } else if (n.kind === 'tree-plot') {
            n.completed = true;
            n.mesh.visible = false;
            if (n.restoredMesh) n.restoredMesh.visible = true;
            triggerBurst(n.x, n.z, 0x22c55e);
            sim.treesPlanted += 1;
            const pts = hasForestTech ? 18 : 12;
            sim.ecoEarned += pts;
            soundEngine.plant();
            coopRef.current.onSendNodeAction?.(mission.id, n.id, n.kind);
            callbacksRef.current.onUpdateProgress((p) => ({
              ...p,
              totalTreesPlanted: p.totalTreesPlanted + 1,
              ecoPoints: p.ecoPoints + pts,
              totalEcoPointsEarned: p.totalEcoPointsEarned + pts,
            }));
          } else if (n.kind === 'coral-plot') {
            n.completed = true;
            n.mesh.visible = false;
            if (n.restoredMesh) n.restoredMesh.visible = true;
            triggerBurst(n.x, n.z, 0x2dd4bf);
            sim.coralsRestored += 1;
            const pts = hasForestTech ? 20 : 14;
            sim.ecoEarned += pts;
            soundEngine.plant();
            coopRef.current.onSendNodeAction?.(mission.id, n.id, n.kind);
            callbacksRef.current.onUpdateProgress((p) => ({
              ...p,
              totalCoralsRestored: p.totalCoralsRestored + 1,
              ecoPoints: p.ecoPoints + pts,
              totalEcoPointsEarned: p.totalEcoPointsEarned + pts,
            }));
          } else if (n.kind === 'equipment') {
            n.completed = true;
            const m = n.mesh.children[0] as THREE.Mesh;
            m.material = equipDoneMat;
            triggerBurst(n.x, n.z, 0x10b981);
            sim.equipmentRepaired += 1;
            const pts = hasWaterTech ? 24 : 16;
            sim.ecoEarned += pts;
            soundEngine.upgrade();
            coopRef.current.onSendNodeAction?.(mission.id, n.id, n.kind);
            callbacksRef.current.onUpdateProgress((p) => ({
              ...p,
              ecoPoints: p.ecoPoints + pts,
              totalEcoPointsEarned: p.totalEcoPointsEarned + pts,
            }));
          } else if (n.kind === 'toxic-node') {
            n.completed = true;
            n.mesh.visible = false;
            triggerBurst(n.x, n.z, 0xfacc15);
            sim.toxicity = Math.max(0, sim.toxicity - 12);
            sim.ecoEarned += 20;
            soundEngine.upgrade();
            coopRef.current.onSendNodeAction?.(mission.id, n.id, n.kind);
            setRobotHint('Toxic vent sealed! Toxicity reduced by 12%.');
          } else if (n.kind === 'citizen') {
            n.completed = true;
            n.mesh.visible = false;
            triggerBurst(n.x, n.z, 0x38bdf8);
            sim.ecoEarned += 25;
            soundEngine.revive();
            coopRef.current.onSendNodeAction?.(mission.id, n.id, n.kind);
            setRobotHint('Citizen escorted to safe evacuation transport!');
          } else if (n.kind === 'med-pod') {
            n.completed = true;
            n.mesh.visible = false;
            triggerBurst(n.x, n.z, 0x34d399);
            sim.health = Math.min(maxHealth, sim.health + 38);
            healAllLimbs(45);
            soundEngine.revive();
            setRobotHint('Eco-Med Field Pod absorbed! Limb vitality & +38 Health restored.');
          } else if (n.kind === 'ration-pod') {
            n.completed = true;
            n.mesh.visible = false;
            triggerBurst(n.x, n.z, 0xf59e0b);
            sim.hunger = Math.min(100, sim.hunger + 40);
            sim.energy = Math.min(100, sim.energy + 25);
            healAllLimbs(10);
            soundEngine.pickup();
            setRobotHint('Field Ration Pack consumed! +40% Hunger & +25% Energy.');
          } else if (n.kind === 'water-pod') {
            n.completed = true;
            n.mesh.visible = false;
            triggerBurst(n.x, n.z, 0x38bdf8);
            sim.thirst = Math.min(100, sim.thirst + 45);
            sim.energy = Math.min(100, sim.energy + 20);
            soundEngine.pickup();
            setRobotHint('Purified Hydration Flask consumed! +45% Thirst & +20% Energy.');
          }
        });

        // Squad AI & Rescue
        sim.squadAlertTimer -= dt;
        if (sim.squadAlertTimer <= 0) {
          sim.squadAlertTimer = 12;
          const activeSq = sim.squad.filter((s) => s.status === 'active');
          if (activeSq.length > 0 && (cfg.isDisaster || cfg.isToxicBunker || mission.difficulty === 'High' || mission.difficulty === 'Critical')) {
            const pick = activeSq[Math.floor(Math.random() * activeSq.length)];
            pick.status = 'needs-rescue';
            soundEngine.warning();
            setRobotHint(`SQUAD ALERT: ${pick.name} needs rescue! Walk close to revive them!`);
          }
        }

        sim.squad.forEach((sq, i) => {
          const sa = squadActors[i];
          if (sq.status === 'active') {
            sq.x += Math.cos(elapsed * 0.55 + i * 2) * 2.6 * dt;
            sq.y += Math.sin(elapsed * 0.65 + i * 2) * 2.6 * dt;
            sq.x = THREE.MathUtils.clamp(sq.x, -48, 48);
            sq.y = THREE.MathUtils.clamp(sq.y, -48, 48);
            sa.actor.suitMat.color.setHex(0x38bdf8);
          } else if (sq.status === 'needs-rescue') {
            sa.actor.suitMat.color.setHex(0xef4444);
            if (Math.hypot(sq.x - sim.playerX, sq.y - sim.playerZ) < 3.8) {
              sq.status = 'safe';
              sa.actor.suitMat.color.setHex(0x10b981);
              sim.teammatesRescuedNow += 1;
              sim.ecoEarned += 30;
              soundEngine.revive();
              setRobotHint(`${sq.name} revived & safe! (+30 Eco Points teamwork bonus)`);
              callbacksRef.current.onUpdateProgress((p) => ({
                ...p,
                teammatesRescued: p.teammatesRescued + 1,
                ecoPoints: p.ecoPoints + 30,
                totalEcoPointsEarned: p.totalEcoPointsEarned + 30,
              }));
            }
          }
          const sy = groundHeightAt(sq.x, sq.y, theme);
          sa.actor.group.position.set(sq.x, sy, sq.y);
        });

        // Hazards, Oxygen, Toxicity & Anatomical Limb Health System
        let activeHazard: HazardZone3D | null = null;
        for (let i = 0; i < sim.hazards.length; i++) {
          const hz = sim.hazards[i];
          if (Math.hypot(hz.x - sim.playerX, hz.z - sim.playerZ) < hz.radius) {
            activeHazard = hz;
            break;
          }
        }
        if (activeHazard) {
          const shield = prog.activeVehicleId ? 0.45 : 1;
          const dmg = 22 * shield * dt;
          applyLimbDamage(dmg, activeHazard.kind === 'fire' ? 'fire' : activeHazard.kind === 'deep-current' ? 'water' : 'toxic');
          sim.damageFlashTimer = 0.25;
          if (elapsed - sim.lastDamageBeepAt > 0.7) {
            sim.lastDamageBeepAt = elapsed;
            soundEngine.damage();
          }
          if (sim.health <= 0) {
            const reason =
              activeHazard.kind === 'fire'
                ? 'Player was consumed by wildfire thermal surge.'
                : activeHazard.kind === 'toxic-cloud'
                ? 'Player was overcome by concentrated toxic gas.'
                : 'Player lost stability in violent deep-water currents.';
            triggerPlayerDeath(reason);
          }
        } else if (sim.hunger > 15 && sim.thirst > 15) {
          sim.health = Math.min(maxHealth, sim.health + 2.2 * dt);
          healAllLimbs(1.4 * dt);
        }

        if (sim.damageFlashTimer > 0) sim.damageFlashTimer = Math.max(0, sim.damageFlashTimer - dt);

        if (isOcean) {
          const drain = hasOceanTech ? 2.4 : 4.2;
          if (Math.hypot(sim.playerX + 24, sim.playerZ) < 6.0 || sim.playerJumpY > 8.5) {
            sim.oxygen = Math.min(100, sim.oxygen + 30 * dt);
          } else {
            sim.oxygen = Math.max(0, sim.oxygen - drain * dt);
          }
          if (sim.oxygen <= 0) {
            applyLimbDamage(15 * dt, 'water');
            sim.damageFlashTimer = 0.2;
            if (sim.health <= 0) {
              triggerPlayerDeath('Player ran out of breathable oxygen underwater.');
            }
          }
        }

        if (cfg.isToxicBunker) {
          sim.toxicity = Math.min(100, sim.toxicity + 2.0 * dt);
          if (!sim.bunkerFound && Math.hypot(sim.playerX - bunkerPos.x, sim.playerZ - bunkerPos.z) < 5.0) {
            sim.bunkerFound = true;
            bunkerGroup.visible = true;
            setBunkerFound(true);
            soundEngine.upgrade();
            coopRef.current.onSendDiscovery?.(mission.id, 'bunker');
            setRobotHint('HIDDEN BUNKER DISCOVERED! Enter with your squad before 100% Toxicity!');
          }
          if (sim.toxicity >= 100) {
            triggerPlayerDeath('Atmospheric Toxicity reached 100% before reaching the Hidden Bunker.');
          }
        }

        // Dynamic Terrain Texture & Returning Wildlife
        const doneCount = sim.nodes.filter((n) => n.completed).length;
        const ratio = doneCount / Math.max(1, sim.nodes.length);
        const texBucket = ratio > 0.5 ? 1 : 0;
        if (texBucket !== sim.lastTextureBucket) {
          sim.lastTextureBucket = texBucket;
          const nextSet = createTerrainTextures(theme, ratio);
          nextSet.map.anisotropy = maxAniso;
          nextSet.normalMap.anisotropy = maxAniso;
          nextSet.roughnessMap.anisotropy = maxAniso;
          nextSet.aoMap.anisotropy = maxAniso;
          terrainSet.map.dispose();
          terrainSet.normalMap.dispose();
          terrainSet.roughnessMap.dispose();
          terrainSet.aoMap.dispose();
          terrainSet = nextSet;
          terrainMat.map = nextSet.map;
          terrainMat.normalMap = nextSet.normalMap;
          terrainMat.roughnessMap = nextSet.roughnessMap;
          terrainMat.aoMap = nextSet.aoMap;
          terrainMat.needsUpdate = true;
        }

        // Immediate living Subnautica Reef Fish schools & birds/wildlife as biome recovers
        const baseWildlife = isOcean ? 12 : theme === 'forest' ? 5 : 0;
        const wantWildlife = baseWildlife + Math.floor(ratio * 10);
        if (sim.wildlife.length < wantWildlife) {
          const wx = rng(-38, 46);
          const wz = rng(-42, 42);
          const wg = new THREE.Group();
          const body = new THREE.Mesh(wildlifeBodyGeo, wildlifeBodyMat);
          body.rotation.x = Math.PI / 2;
          const tail = new THREE.Mesh(wildlifeTailGeo, wildlifeTailMat);
          tail.rotation.x = -Math.PI / 2;
          tail.position.z = -0.58;
          wg.add(body, tail);
          wildlifeGroup.add(wg);
          sim.wildlife.push({
            x: wx,
            z: wz,
            vx: (Math.random() - 0.5) * (isOcean ? 3.8 : 4.5),
            vz: (Math.random() - 0.5) * (isOcean ? 3.8 : 4.5),
            yOffset: isOcean ? 1.5 + Math.random() * 4.8 : 4.5 + Math.random() * 2.5,
            mesh: wg,
          });
        }
        sim.wildlife.forEach((w, idx) => {
          w.x += w.vx * dt;
          w.z += w.vz * dt;
          if (Math.abs(w.x) > 54) w.vx *= -1;
          if (Math.abs(w.z) > 54) w.vz *= -1;
          const bob = isOcean ? Math.sin(elapsed * 2.0 + idx) * 0.32 : Math.sin(elapsed * 3.1 + idx) * 0.25;
          w.mesh.position.set(w.x, groundHeightAt(w.x, w.z, theme) + w.yOffset + bob, w.z);
          w.mesh.rotation.y = Math.atan2(w.vx, w.vz);
          const tailChild = w.mesh.children[1];
          if (tailChild) tailChild.rotation.y = Math.sin(elapsed * 11.0 + idx) * 0.42;
        });

        // Swaying Subnautica Creepvine kelp stalks
        for (let ci = 0; ci < creepvineStalks.length; ci++) {
          creepvineStalks[ci].rotation.z = Math.sin(elapsed * 1.15 + ci * 0.7) * 0.08;
          creepvineStalks[ci].rotation.x = Math.cos(elapsed * 0.95 + ci * 0.5) * 0.06;
        }

        // Co-Op Sync
        const { coopSession: cSession, remotePlayers: rPlayers, selfPlayerId: sId, onSendPlayerArenaPos: sendPos } = coopRef.current;
        if (cSession && cSession.missionId === mission.id) {
          if (cSession.completedNodeIds.length > 0) {
            const doneSet = new Set(cSession.completedNodeIds);
            for (let i = 0; i < sim.nodes.length; i++) {
              const n = sim.nodes[i];
              if (doneSet.has(n.id) && !n.completed) {
                n.completed = true;
                n.revealed = true;
                if (n.kind === 'equipment') {
                  const m = n.mesh.children[0] as THREE.Mesh;
                  m.material = equipDoneMat;
                  sim.equipmentRepaired += 1;
                } else {
                  n.mesh.visible = false;
                  if (n.restoredMesh) n.restoredMesh.visible = true;
                  if (n.kind === 'tree-plot') sim.treesPlanted += 1;
                  else if (n.kind === 'coral-plot') sim.coralsRestored += 1;
                  else if (n.kind === 'smog-stack') sim.smogStopped += 1;
                  else if (n.kind === 'runoff-pipe') sim.runoffSealed += 1;
                  else if (n.kind === 'toxic-node') sim.toxicity = Math.max(0, sim.toxicity - 12);
                }
              }
            }
          }
          if (cSession.bunkerFound && !sim.bunkerFound) {
            sim.bunkerFound = true;
            bunkerGroup.visible = true;
            setBunkerFound(true);
          }
          if (cSession.labDiscovered && !sim.labDiscovered) {
            sim.labDiscovered = true;
            labGroup.visible = true;
          }
        }

        const nowPerf = performance.now();
        if (
          sendPos &&
          nowPerf - sim.lastSentAt > 80 &&
          (Math.hypot(sim.playerX - sim.lastSentX, sim.playerZ - sim.lastSentZ) > 0.12 || sim.lastSentAt === 0)
        ) {
          sim.lastSentAt = nowPerf;
          sim.lastSentX = sim.playerX;
          sim.lastSentZ = sim.playerZ;
          sendPos(sim.playerX, sim.playerZ);
        }

        const activeTeammateIds = new Set<string>();
        for (let i = 0; i < rPlayers.length; i++) {
          const rp = rPlayers[i];
          if (rp.id === sId || rp.activeMissionId !== mission.id) continue;
          activeTeammateIds.add(rp.id);
          let entry = remoteTeammates.get(rp.id);
          if (!entry) {
            const colNum = new THREE.Color(rp.color).getHex();
            const actor = buildEcoRangerMesh(colNum, false);
            const ringMat = new THREE.MeshBasicMaterial({ color: rp.color, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
            const ringMesh = new THREE.Mesh(remoteTeammateRingGeo, ringMat);
            ringMesh.rotation.x = -Math.PI / 2;
            ringMesh.position.y = 0.08;
            actor.group.add(ringMesh);
            actor.group.position.set(rp.arenaX, groundHeightAt(rp.arenaX, rp.arenaZ, theme), rp.arenaZ);
            scene.add(actor.group);
            entry = { actor, ringMat, x: rp.arenaX, z: rp.arenaZ, walkPhase: 0 };
            remoteTeammates.set(rp.id, entry);
          }

          const prevX = entry.x;
          const prevZ = entry.z;
          entry.x = THREE.MathUtils.damp(entry.x, rp.arenaX, 9, dt);
          entry.z = THREE.MathUtils.damp(entry.z, rp.arenaZ, 9, dt);
          const dx = entry.x - prevX;
          const dz = entry.z - prevZ;
          if (Math.hypot(dx, dz) > 0.005) {
            entry.actor.group.rotation.y = Math.atan2(dx, dz);
            entry.walkPhase += dt * 10;
            entry.actor.legL.rotation.x = Math.sin(entry.walkPhase) * 0.5;
            entry.actor.legR.rotation.x = -Math.sin(entry.walkPhase) * 0.5;
          } else {
            entry.actor.legL.rotation.x *= 0.85;
            entry.actor.legR.rotation.x *= 0.85;
          }
          entry.actor.group.position.set(entry.x, groundHeightAt(entry.x, entry.z, theme), entry.z);
        }

        remoteTeammates.forEach((entry, pid) => {
          if (!activeTeammateIds.has(pid)) {
            scene.remove(entry.actor.group);
            entry.ringMat.dispose();
            remoteTeammates.delete(pid);
          }
        });

        checkVictory();
      }

      // Animate collectible bobbing, particles & shockwaves
      for (let i = 0; i < sim.nodes.length; i++) {
        const n = sim.nodes[i];
        if (!n.completed && n.revealed && (n.kind === 'med-pod' || n.kind === 'ration-pod' || n.kind === 'water-pod')) {
          n.mesh.rotation.y = elapsed * 1.6 + i;
          n.mesh.position.y = groundHeightAt(n.x, n.z, theme) + Math.sin(elapsed * 3.0 + i) * 0.16;
        }
      }

      const bPosAttr = biomeParticleGeo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pCount; i++) {
        let px = bPosAttr.getX(i) + pVel[i * 3] * dt;
        let py = bPosAttr.getY(i) + pVel[i * 3 + 1] * dt;
        let pz = bPosAttr.getZ(i) + pVel[i * 3 + 2] * dt;
        if (py > 12.0) py = 0.5;
        if (py < 0.3) py = 11.0;
        if (px > HALF_WORLD) px = -HALF_WORLD;
        if (px < -HALF_WORLD) px = HALF_WORLD;
        if (pz > HALF_WORLD) pz = -HALF_WORLD;
        if (pz < -HALF_WORLD) pz = HALF_WORLD;
        bPosAttr.setXYZ(i, px, py, pz);
      }
      bPosAttr.needsUpdate = true;

      if (activeBurst) {
        activeBurst.age += dt;
        const p = activeBurst.age / activeBurst.maxAge;
        if (p >= 1) {
          burstRingMesh.visible = false;
          activeBurst = null;
        } else {
          burstRingMesh.scale.setScalar(0.5 + p * 4.2);
          burstRingMat.opacity = (1 - p) * 0.85;
        }
      }

      // Player & Camera Placement
      const py = groundHeightAt(sim.playerX, sim.playerZ, theme) + sim.playerJumpY;
      playerActor.group.position.set(sim.playerX, py, sim.playerZ);
      playerActor.group.visible = !firstPersonRef.current;

      recyclerObjs.forEach((rObj) => {
        rObj.drum.rotation.z = elapsed * 1.8;
        rObj.innerCore.rotation.y = -elapsed * 2.4;
        rObj.beacon.rotation.y = elapsed * 2.0;
      });
      if (waterSurface) {
        waterSurface.position.y = 0.65 + Math.sin(elapsed * 2.2) * 0.08;
      }

      if (firstPersonRef.current) {
        const eyeHeight = prog.activeVehicleId === 'vehicle-heli' ? 2.85 : sim.isSwimming ? 1.1 : 1.75;
        camera.position.x = sim.playerX;
        camera.position.y = py + eyeHeight + (sim.isSwimming ? Math.sin(sim.swimPhase) * 0.05 : 0);
        camera.position.z = sim.playerZ;
        const swimRoll = sim.isSwimming ? Math.sin(sim.swimPhase) * 0.025 : 0;
        _camEuler.set(sim.pitch, sim.yaw, swimRoll, 'YXZ');
        camera.quaternion.setFromEuler(_camEuler);
      } else {
        camera.position.x = THREE.MathUtils.damp(camera.position.x, sim.playerX + Math.sin(sim.yaw) * 12.5, 5.2, dt);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, py + 11.5, 5.2, dt);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, sim.playerZ + Math.cos(sim.yaw) * 12.5, 5.2, dt);
        camera.lookAt(sim.playerX, py + 1.2, sim.playerZ);
      }

      // 3D Guiding Arrow pointing straight toward the Nearest Automatic Recycling Station when Bag is FULL!
      const isBagFull = cfg.hasRecyclingMachine && sim.localBackpack >= prog.backpackMaxCapacity;
      const { pos: nearestRecPos, dist: nearestRecDist } = findNearestRecycler();
      if (isBagFull && !sim.missionEnded) {
        guideArrowGroup.visible = true;
        const fwdX = -Math.sin(sim.yaw);
        const fwdZ = -Math.cos(sim.yaw);
        guideArrowGroup.position.set(
          sim.playerX + fwdX * 2.2,
          camera.position.y - 0.55 + Math.sin(elapsed * 4.2) * 0.06,
          sim.playerZ + fwdZ * 2.2
        );
        _arrowDir.set(nearestRecPos.x, guideArrowGroup.position.y, nearestRecPos.z);
        guideArrowGroup.lookAt(_arrowDir);
      } else {
        guideArrowGroup.visible = false;
      }

      skyDome.position.set(sim.playerX, 0, sim.playerZ);

      // Update Smog sky clearing dynamically as city pollution is stopped
      const totalCityPoll = smogGoal + runoffGoal;
      const doneCityPoll = sim.smogStopped + sim.runoffSealed;
      const remainingSmogRatio = totalCityPoll > 0 ? 1 - doneCityPoll / totalCityPoll : theme === 'tokyo-cyber' || theme === 'town' ? 0.55 : 0;
      skyDomeMat.uniforms.uSmogLevel.value = remainingSmogRatio * 0.72;

      // Exact 5-Minute Full 24h Day & Night Solar Cycle (0.08 solar hours per sec)
      if (arenaSolarRef.current.mode === 'auto') {
        arenaSolarRef.current.hour = (arenaSolarRef.current.hour + dt * 0.08) % 24;
      } else {
        const targetH = arenaSolarRef.current.mode === 'day' ? 13 : arenaSolarRef.current.mode === 'sunset' ? 18.2 : 0.5;
        let diff = targetH - arenaSolarRef.current.hour;
        if (diff > 12) diff -= 24;
        if (diff < -12) diff += 24;
        arenaSolarRef.current.hour = (arenaSolarRef.current.hour + diff * Math.min(1, dt * 4) + 24) % 24;
      }
      const sH = arenaSolarRef.current.hour;
      const sunAngle = ((sH - 6) / 24) * Math.PI * 2;
      const sunElev = Math.sin(sunAngle);
      const sunDirX = Math.cos(sunAngle);
      const sunDirY = sunElev;
      const sunDirZ = 0.42;

      skyDomeMat.uniforms.uSunDir.value.set(sunDirX, sunDirY, sunDirZ).normalize();
      skyDomeMat.uniforms.uTime.value = elapsed;
      terrainShaderUniforms.uTerrainTime.value = elapsed;

      const dayWeight = THREE.MathUtils.clamp((sunElev + 0.14) / 0.52, 0, 1);
      const twilightBand = Math.exp(-Math.pow(sunElev * 4.6, 2));
      skyDomeMat.uniforms.uDayWeight.value = dayWeight;
      skyDomeMat.uniforms.uTwilight.value = twilightBand;

      // Location-Based Dynamic Weather Transitions, Sliding 3D Rain/Snow & Lightning Flash
      weatherCycleTimer += dt;
      if (weatherCycleTimer >= 45 && !sim.missionEnded) {
        weatherCycleTimer = 0;
        const nextIdx = (weatherIndexRef.current + 1) % climateRef.current.cycle.length;
        weatherIndexRef.current = nextIdx;
        setWeatherIndex(nextIdx);
      }
      const curW = climateRef.current.cycle[weatherIndexRef.current % climateRef.current.cycle.length];
      const wLerp = Math.min(1, dt * 1.4);
      liveRain = THREE.MathUtils.lerp(liveRain, curW.rainIntensity, wLerp);
      liveSnow = THREE.MathUtils.lerp(liveSnow, curW.snowIntensity, wLerp);
      liveWetness = THREE.MathUtils.lerp(liveWetness, curW.wetness, wLerp);
      liveSnowCover = THREE.MathUtils.lerp(liveSnowCover, curW.snowCover, wLerp);
      liveFogMult = THREE.MathUtils.lerp(liveFogMult, curW.fogMult, wLerp);
      liveSunDim = THREE.MathUtils.lerp(liveSunDim, curW.sunDim, wLerp);

      if (curW.hasLightning && !isOcean && !isSpace && !sim.missionEnded) {
        lightningCooldown -= dt;
        if (lightningCooldown <= 0) {
          lightningCooldown = 7 + Math.random() * 9;
          lightningFlash = 1.0;
          soundEngine.thunder();
        }
      }
      lightningFlash = Math.max(0, lightningFlash - dt * 2.8);

      terrainShaderUniforms.uWeatherWetness.value = liveWetness;
      terrainShaderUniforms.uWeatherSnow.value = liveSnowCover;
      terrainShaderUniforms.uWeatherFlash.value = lightningFlash;
      skyDomeMat.uniforms.uStormDim.value = liveSunDim;
      skyDomeMat.uniforms.uWeatherFlash.value = lightningFlash;

      if (!isOcean && !isSpace && liveRain > 0.03) {
        rainLines.visible = true;
        rainMat.opacity = Math.min(0.68, liveRain * 0.62);
        const rAttr = rainGeo.getAttribute('position') as THREE.BufferAttribute;
        const rArr = rAttr.array as Float32Array;
        const fallSpeed = 24 + liveRain * 10;
        const windDriftX = -curW.windSpeed * 0.42;
        const windDriftZ = -curW.windSpeed * 0.18;
        for (let i = 0; i < RAIN_COUNT; i++) {
          let rx = rainSeeds[i * 3] + windDriftX * dt;
          let ry = rainSeeds[i * 3 + 1] - fallSpeed * dt;
          let rz = rainSeeds[i * 3 + 2] + windDriftZ * dt;
          if (ry < 0.2) ry += 23.5;
          if (rx < -38) rx += 76;
          else if (rx > 38) rx -= 76;
          if (rz < -38) rz += 76;
          else if (rz > 38) rz -= 76;
          rainSeeds[i * 3] = rx;
          rainSeeds[i * 3 + 1] = ry;
          rainSeeds[i * 3 + 2] = rz;
          const wx = sim.playerX + rx;
          const wy = py + ry;
          const wz = sim.playerZ + rz;
          rArr[i * 6] = wx;
          rArr[i * 6 + 1] = wy;
          rArr[i * 6 + 2] = wz;
          rArr[i * 6 + 3] = wx - windDriftX * 0.045;
          rArr[i * 6 + 4] = wy + 1.15;
          rArr[i * 6 + 5] = wz - windDriftZ * 0.045;
        }
        rAttr.needsUpdate = true;
      } else {
        rainLines.visible = false;
      }

      if (!isOcean && !isSpace && liveSnow > 0.03) {
        snowPoints.visible = true;
        snowMat.opacity = Math.min(0.92, liveSnow * 0.9);
        const sAttr = snowGeo.getAttribute('position') as THREE.BufferAttribute;
        const sArr = sAttr.array as Float32Array;
        const sFall = 2.1 + liveSnow * 1.4;
        const sWind = curW.windSpeed * 0.25;
        for (let i = 0; i < SNOW_COUNT; i++) {
          const ph = snowSeeds[i * 4 + 3];
          let sx = snowSeeds[i * 4] + (Math.sin(elapsed * 1.3 + ph) * 1.2 - sWind) * dt;
          let sy = snowSeeds[i * 4 + 1] - sFall * dt;
          let sz = snowSeeds[i * 4 + 2] + Math.cos(elapsed * 1.1 + ph) * 0.9 * dt;
          if (sy < 0.2) sy += 21.5;
          if (sx < -38) sx += 76;
          else if (sx > 38) sx -= 76;
          if (sz < -38) sz += 76;
          else if (sz > 38) sz -= 76;
          snowSeeds[i * 4] = sx;
          snowSeeds[i * 4 + 1] = sy;
          snowSeeds[i * 4 + 2] = sz;
          sArr[i * 3] = sim.playerX + sx;
          sArr[i * 3 + 1] = py + sy;
          sArr[i * 3 + 2] = sim.playerZ + sz;
        }
        sAttr.needsUpdate = true;
      } else {
        snowPoints.visible = false;
      }

      const lightDirY = Math.max(0.28, Math.abs(sunElev));
      sun.position.set(sim.playerX + sunDirX * 48, py + lightDirY * 56, sim.playerZ + sunDirZ * 42);
      sun.target.position.set(sim.playerX, py, sim.playerZ);
      sun.target.updateMatrixWorld();

      if (!isSpace) {
        liveFogColor.copy(nightFogColor).lerp(dayFogColor, dayWeight).lerp(sunsetFogColor, twilightBand * 0.72);
        if (scene.fog instanceof THREE.FogExp2) {
          scene.fog.color.copy(liveFogColor);
          const baseFog = isOcean ? 0.0155 : theme === 'tokyo-cyber' || theme === 'town' ? 0.011 : 0.0068;
          const smogBonus = totalCityPoll > 0 ? remainingSmogRatio * 0.0075 : 0;
          scene.fog.density = baseFog * liveFogMult + smogBonus;
        }
      }
      sun.color.copy(nightMoonColor).lerp(daySunColor, dayWeight).lerp(sunsetSunColor, twilightBand * 0.75);
      const weatherAtten = 1 - liveSunDim * 0.42;
      sun.intensity = (THREE.MathUtils.lerp(0.68, 2.2, dayWeight) + twilightBand * 0.3) * weatherAtten + lightningFlash * 2.1;
      hemi.intensity = THREE.MathUtils.lerp(0.42, 0.85, dayWeight) * (1 - liveSunDim * 0.25) + lightningFlash * 1.4;
      suitLamp.intensity = THREE.MathUtils.lerp(4.6, 0, dayWeight) + liveSunDim * 1.8;

      hudTimer += dt;
      if (hudTimer > 0.16) {
        hudTimer = 0;
        const solarMinuteStr = `${String(Math.floor(arenaSolarRef.current.hour)).padStart(2, '0')}:${String(
          Math.floor((arenaSolarRef.current.hour % 1) * 60)
        ).padStart(2, '0')}`;
        if (solarMinuteStr !== lastHud.solarStr) {
          lastHud.solarStr = solarMinuteStr;
          setArenaSolarHour(arenaSolarRef.current.hour);
        }

        const rHealth = Math.round(sim.health);
        if (rHealth !== lastHud.health) {
          lastHud.health = rHealth;
          setHealth(rHealth);
        }
        const rOxy = Math.round(sim.oxygen);
        if (rOxy !== lastHud.oxygen) {
          lastHud.oxygen = rOxy;
          setOxygen(rOxy);
        }
        const rTox = Math.round(sim.toxicity);
        if (rTox !== lastHud.toxicity) {
          lastHud.toxicity = rTox;
          setToxicity(rTox);
        }
        const dFlash = sim.damageFlashTimer > 0;
        if (dFlash !== lastHud.damageFlash) {
          lastHud.damageFlash = dFlash;
          setDamageFlash(dFlash);
        }
        if (sim.isSwimming !== lastHud.swimming) {
          lastHud.swimming = sim.isSwimming;
          setIsSwimmingHud(sim.isSwimming);
        }

        if (isBagFull) {
          const targetAngle = Math.atan2(-(nearestRecPos.x - sim.playerX), -(nearestRecPos.z - sim.playerZ));
          let relRad = targetAngle - sim.yaw;
          while (relRad > Math.PI) relRad -= Math.PI * 2;
          while (relRad < -Math.PI) relRad += Math.PI * 2;
          const rDist = Math.round(nearestRecDist);
          const rAng = Math.round((-relRad * 180) / Math.PI);
          const recKey = `${rDist}:${rAng}`;
          if (recKey !== lastHud.recKey) {
            lastHud.recKey = recKey;
            setNearestRecyclerHint({ dist: rDist, angleDeg: rAng });
          }
        } else if (lastHud.recKey !== '') {
          lastHud.recKey = '';
          setNearestRecyclerHint(null);
        }

        const vE = Math.round(sim.energy);
        const vH = Math.round(sim.hunger);
        const vT = Math.round(sim.thirst);
        const vSp = Number(sim.currentSpeed.toFixed(1));
        const pH = Math.round(sim.parts.head);
        const pB = Math.round(sim.parts.body);
        const pLA = Math.round(sim.parts.leftArm);
        const pRA = Math.round(sim.parts.rightArm);
        const pLL = Math.round(sim.parts.leftLeg);
        const pRL = Math.round(sim.parts.rightLeg);
        if (
          vE !== lastHud.energy ||
          vH !== lastHud.hunger ||
          vT !== lastHud.thirst ||
          vSp !== lastHud.speed ||
          pH !== lastHud.head ||
          pB !== lastHud.body ||
          pLA !== lastHud.leftArm ||
          pRA !== lastHud.rightArm ||
          pLL !== lastHud.leftLeg ||
          pRL !== lastHud.rightLeg
        ) {
          lastHud.energy = vE;
          lastHud.hunger = vH;
          lastHud.thirst = vT;
          lastHud.speed = vSp;
          lastHud.head = pH;
          lastHud.body = pB;
          lastHud.leftArm = pLA;
          lastHud.rightArm = pRA;
          lastHud.leftLeg = pLL;
          lastHud.rightLeg = pRL;
          setVitality({
            energy: vE,
            hunger: vH,
            thirst: vT,
            speed: vSp,
            parts: {
              head: pH,
              body: pB,
              leftArm: pLA,
              rightArm: pRA,
              leftLeg: pLL,
              rightLeg: pRL,
            },
          });
        }

        const squadKey = sim.squad.map((s) => s.status).join(',');
        if (squadKey !== lastHud.squadKey) {
          lastHud.squadKey = squadKey;
          setSquad(sim.squad.map((s) => ({ ...s })));
        }

        let rubLeft = 0;
        for (let i = 0; i < sim.nodes.length; i++) {
          if (sim.nodes[i].kind === 'rubbish' && !sim.nodes[i].completed) rubLeft++;
        }
        const statsKey = `${rubLeft}:${sim.treesPlanted}:${sim.coralsRestored}:${sim.equipmentRepaired}:${sim.smogStopped}:${sim.runoffSealed}:${sim.recycledCount}:${sim.scrapEarned}:${sim.teammatesRescuedNow}:${sim.ecoEarned}:${sim.labDiscovered ? 1 : 0}`;
        if (statsKey !== lastHud.statsKey) {
          lastHud.statsKey = statsKey;
          setStats({
            rubbishRemaining: rubLeft,
            treesPlanted: sim.treesPlanted,
            coralsRestored: sim.coralsRestored,
            equipmentRepaired: sim.equipmentRepaired,
            smogStopped: sim.smogStopped,
            runoffSealed: sim.runoffSealed,
            recycledInMission: sim.recycledCount,
            scrapEarnedInMission: sim.scrapEarned,
            teammatesRescuedNow: sim.teammatesRescuedNow,
            ecoEarnedInMission: sim.ecoEarned,
            labDiscovered: sim.labDiscovered,
          });
        }
      }

      if (composer && !isSoftwareGl) composer.render();
      else renderer.render(scene, camera);

      if (isSoftwareGl) afterDraw(tick);
      else frameId = requestAnimationFrame(tick);
    }

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      if (document.pointerLockElement === renderer.domElement) {
        document.exitPointerLock?.();
      }
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      ultraHdGradePass?.dispose();
      bloomPass?.dispose();
      composer?.dispose();
      composerTarget?.dispose();
      skyDomeGeo.dispose();
      skyDomeMat.dispose();
      terrainGeo.dispose();
      terrainMat.dispose();
      terrainSet.map.dispose();
      terrainSet.normalMap.dispose();
      terrainSet.roughnessMap.dispose();
      terrainSet.aoMap.dispose();
      rockGeo.dispose();
      rockMat.dispose();
      trunkGeo?.dispose();
      trunkMat?.dispose();
      crownGeo?.dispose();
      crownMat?.dispose();
      pineGeo?.dispose();
      pineMat?.dispose();
      grassGeo?.dispose();
      grassMat?.dispose();
      flowerGeo?.dispose();
      flowerMat?.dispose();
      biomeParticleGeo.dispose();
      biomeParticleMat.dispose();
      rainGeo.dispose();
      rainMat.dispose();
      snowGeo.dispose();
      snowMat.dispose();
      snowTex.dispose();
      burstRingGeo.dispose();
      burstRingMat.dispose();
      hullMetalMat.dispose();
      trimMat.dispose();
      canopyMat.dispose();
      wheelGeo.dispose();
      pontoonGeo.dispose();
      skidGeo.dispose();
      rustyIronMat.dispose();
      wornGripMat.dispose();
      brassBoltMat.dispose();
      grabGlowMat.dispose();
      swimSleeveMat.dispose();
      guideArrowMat.dispose();
      pbr.disposeAll();
      disposableTextures.forEach((t) => t.dispose());
      disposableMaterials.forEach((m) => m.dispose());
      disposableGeometries.forEach((g) => g.dispose());
      remoteTeammateRingGeo.dispose();
      remoteTeammates.forEach((entry) => {
        scene.remove(entry.actor.group);
        entry.ringMat.dispose();
      });
      remoteTeammates.clear();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [
    mission,
    theme,
    smogGoal,
    runoffGoal,
    hasFastCollect,
    hasForestTech,
    hasOceanTech,
    hasPlasmaRecycler,
    hasRobotCollector,
    hasRobotOverdrive,
    hasScannerOptics,
    hasWaterTech,
    maxHealth,
  ]);

  const safeCount = squad.filter((s) => s.status === 'safe').length + (missionWon ? 1 : 0);
  const rescuedCount = stats.teammatesRescuedNow;
  const activeCount = squad.filter((s) => s.status === 'active').length;
  const downedCount = squad.filter((s) => s.status === 'needs-rescue').length;

  const totalObj =
    mission.arenaConfig.rubbishCount +
    mission.arenaConfig.treesToPlant +
    mission.arenaConfig.coralsToRestore +
    mission.arenaConfig.equipmentToRepair +
    smogGoal +
    runoffGoal;
  const doneObj =
    (mission.arenaConfig.rubbishCount - stats.rubbishRemaining) +
    stats.treesPlanted +
    stats.coralsRestored +
    stats.equipmentRepaired +
    stats.smogStopped +
    stats.runoffSealed;
  const missionPct = totalObj > 0 ? Math.min(100, Math.round((doneObj / totalObj) * 100)) : 0;
  const healthPct = Math.max(0, Math.min(100, Math.round((health / maxHealth) * 100)));
  const fmtHour = `${String(Math.floor(arenaSolarHour)).padStart(2, '0')}:${String(
    Math.floor((arenaSolarHour % 1) * 60)
  ).padStart(2, '0')}`;
  const isArenaNight = arenaSolarHour < 6 || arenaSolarHour >= 19.5;
  const isArenaSunset = !isArenaNight && (arenaSolarHour < 7.8 || arenaSolarHour >= 17);

  const biomeLabel =
    theme === 'tokyo-cyber'
      ? 'Tokyo Cyber City'
      : theme === 'coral-reef'
      ? 'Subnautica Reef'
      : theme === 'forest'
      ? climateProfile.biomeTag === 'mountain'
        ? 'Alpine Highlands'
        : 'Emerald Forest'
      : theme === 'town'
      ? 'Highland Town'
      : 'Orbital Sector';

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-[#030712] text-slate-100">
      {/* Compact Top Horizontal Telemetry Bar (pushed cleanly upward so 3D viewport is huge) */}
      <header className="z-20 flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 pt-1.5 pb-1.5 bg-[#081020] border-b border-cyan-500/25">
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => {
              soundEngine.click();
              onExitMission();
            }}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-slate-200 bg-slate-800/90 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Earth Map
          </button>
          <div className="leading-tight">
            <h2 className="text-xs sm:text-sm font-bold tracking-wide text-white">
              {mission.title}
            </h2>
            <p className="text-[10px] text-cyan-300/90 font-mono-num">
              {biomeLabel} · {mission.locationName}
            </p>
          </div>
        </div>

        {/* Center Arranged Horizontal Bars: Progress · Health · 5m Day/Night */}
        <div className="flex flex-wrap items-center gap-3 px-3 py-1 bg-slate-900/95 border border-cyan-500/30 rounded-xl">
          <div className="w-24 sm:w-28 space-y-0.5">
            <div className="flex items-center justify-between text-[10px] font-mono-num">
              <span className="text-cyan-300 font-semibold">PROGRESS</span>
              <span className="text-white font-bold">{missionPct}%</span>
            </div>
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all duration-200"
                style={{ width: `${missionPct}%` }}
              />
            </div>
          </div>

          <div className="w-28 sm:w-32 space-y-0.5">
            <div className="flex items-center justify-between text-[10px] font-mono-num">
              <span className="flex items-center gap-1 text-rose-300 font-semibold">
                <Heart className="w-3 h-3 text-rose-400" />
                HP
              </span>
              <span className="text-white font-bold">{health}/{maxHealth}</span>
            </div>
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden border border-rose-500/20">
              <div
                className={`h-full transition-all duration-150 ${
                  healthPct > 60 ? 'bg-emerald-400' : healthPct > 30 ? 'bg-amber-400' : 'bg-rose-500'
                }`}
                style={{ width: `${healthPct}%` }}
              />
            </div>
          </div>

          <button
            onClick={() => {
              soundEngine.click();
              setArenaSolarMode((prev) =>
                prev === 'auto' ? 'day' : prev === 'day' ? 'sunset' : prev === 'sunset' ? 'night' : 'auto'
              );
            }}
            className="flex items-center gap-1.5 px-2 py-1 bg-slate-800/90 hover:bg-slate-700 border border-slate-700 rounded-lg text-[11px] transition-colors cursor-pointer"
            title="5-Minute Day/Night Cycle"
          >
            {isArenaNight ? (
              <Moon className="w-3 h-3 text-indigo-300" />
            ) : isArenaSunset ? (
              <Sunrise className="w-3 h-3 text-amber-400" />
            ) : (
              <Sun className="w-3 h-3 text-amber-300" />
            )}
            <span className="font-mono-num font-bold text-slate-100">{fmtHour}</span>
            <span className="text-[9px] uppercase text-cyan-300">
              {arenaSolarMode === 'auto' ? '5m' : arenaSolarMode}
            </span>
          </button>
        </div>

        {/* Right Arranged Resource & Tool Strip */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {liveClockText && (
            <div className="flex items-center gap-1 px-2 py-1 bg-slate-900 border border-cyan-500/30 rounded-lg font-mono-num font-bold text-cyan-100 tabular-nums">
              <Clock className="w-3 h-3 text-cyan-400" />
              <span>{liveClockText}</span>
            </div>
          )}

          {theme === 'coral-reef' && (
            <div className="flex items-center gap-1 px-2 py-1 bg-slate-900 border border-cyan-800/60 rounded-lg">
              <Activity className="w-3 h-3 text-cyan-400" />
              <span className="font-mono-num font-bold text-cyan-300">{oxygen}% O2</span>
            </div>
          )}

          <div
            className={`flex items-center gap-1 px-2 py-1 rounded-lg border font-mono-num font-bold ${
              progress.currentBackpackItems >= progress.backpackMaxCapacity
                ? 'bg-emerald-950/90 border-emerald-400 text-emerald-300'
                : 'bg-slate-900 border-slate-800 text-emerald-300'
            }`}
            title="Small Trash Bag Capacity"
          >
            <Package className="w-3 h-3 text-emerald-400" />
            <span>
              {progress.currentBackpackItems}/{progress.backpackMaxCapacity}
            </span>
          </div>

          <div className="flex items-center gap-1 px-2 py-1 bg-slate-900 border border-orange-500/30 rounded-lg font-mono-num font-bold text-orange-300" title="Scrap Currency">
            <Nut className="w-3 h-3 text-orange-400" />
            <span>{progress.scrap ?? 0}</span>
          </div>

          <div className="flex items-center gap-1 px-2 py-1 bg-slate-900 border border-slate-800 rounded-lg font-mono-num font-bold text-amber-300" title="Eco Points">
            <Sparkles className="w-3 h-3 text-amber-400" />
            <span>{progress.ecoPoints}</span>
          </div>

          <button
            onClick={() => {
              soundEngine.click();
              setFirstPerson((v) => !v);
            }}
            className="flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 border border-cyan-500/30 rounded-lg text-[11px] font-semibold text-cyan-200 cursor-pointer"
            title="Switch Camera View (V)"
          >
            <Eye className="w-3 h-3 text-cyan-400" />
            <span>{firstPerson ? '1st' : '3rd'}</span>
          </button>

          <button
            onClick={() => {
              soundEngine.click();
              setSidebarOpen((v) => !v);
            }}
            className="flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-[11px] font-semibold text-slate-200 cursor-pointer"
            title="Toggle Mission Objectives & Squad Drawer"
          >
            {sidebarOpen ? (
              <PanelRightClose className="w-3.5 h-3.5 text-cyan-400" />
            ) : (
              <PanelRightOpen className="w-3.5 h-3.5 text-cyan-400" />
            )}
            <span>Objectives</span>
          </button>
        </div>
      </header>

      {/* Full-Bleed Larger 3D Mission Viewing Panel */}
      <div className="relative flex-1 min-h-0 overflow-hidden bg-[#030712]">
        <div ref={mountRef} className="w-full h-full cursor-crosshair" />

        {/* Underwater Caustic Tint Overlay when Swimming */}
        {isSwimmingHud && !missionFailed && !missionWon && (
          <div className="pointer-events-none absolute inset-0 border-4 border-cyan-400/20 bg-cyan-900/10" />
        )}

        {/* Top-Left Compact Live Pollution & Dynamic Weather Strip */}
        <div className="absolute top-2.5 left-3 z-10 flex flex-wrap items-center gap-2 text-[11px] font-mono-num">
          <div className="pointer-events-none px-2.5 py-1 bg-[#070e1c]/90 border border-cyan-500/30 rounded-lg text-slate-200">
            Trash Left: <span className="font-bold text-cyan-300">{stats.rubbishRemaining}</span>
          </div>
          <button
            type="button"
            onClick={() => simActionRef.current?.cycleWeather()}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-[#070e1c]/92 hover:bg-slate-800 border border-sky-400/40 rounded-lg text-sky-100 cursor-pointer transition-colors"
            title="Location-based Dynamic Weather (auto-cycles every 45s — click to cycle now)"
          >
            {activeWeather.kind === 'thunderstorm' ? (
              <CloudLightning className="w-3.5 h-3.5 text-amber-300" />
            ) : activeWeather.kind === 'rain' ? (
              <CloudRain className="w-3.5 h-3.5 text-sky-300" />
            ) : activeWeather.kind === 'snow' || activeWeather.kind === 'blizzard' ? (
              <CloudSnow className="w-3.5 h-3.5 text-cyan-100" />
            ) : activeWeather.kind === 'windy' || activeWeather.kind === 'solar-wind' || activeWeather.kind === 'thermal-plume' ? (
              <Wind className="w-3.5 h-3.5 text-teal-300" />
            ) : (
              <CloudSun className="w-3.5 h-3.5 text-amber-300" />
            )}
            <span className="font-semibold">{activeWeather.label}</span>
            <span className="text-sky-300 flex items-center gap-0.5">
              <Thermometer className="w-3 h-3" />
              {activeWeather.tempC}°C
            </span>
          </button>
          {smogGoal > 0 && (
            <div className="pointer-events-none flex items-center gap-1 px-2.5 py-1 bg-[#070e1c]/90 border border-amber-500/35 rounded-lg text-amber-200">
              <Flame className="w-3 h-3 text-amber-400" />
              Smog Stacks: <span className="font-bold">{stats.smogStopped}/{smogGoal}</span>
            </div>
          )}
          {runoffGoal > 0 && (
            <div className="pointer-events-none flex items-center gap-1 px-2.5 py-1 bg-[#070e1c]/90 border border-lime-500/35 rounded-lg text-lime-200">
              <Droplets className="w-3 h-3 text-lime-400" />
              Toxic Runoff: <span className="font-bold">{stats.runoffSealed}/{runoffGoal}</span>
            </div>
          )}
          {isSwimmingHud && (
            <div className="pointer-events-none flex items-center gap-1 px-2.5 py-1 bg-cyan-950/90 border border-cyan-400/45 rounded-lg text-cyan-200">
              <Waves className="w-3 h-3 text-cyan-300" />
              Swimming · Space Up / C Down
            </div>
          )}
        </div>

        {/* Guiding HUD Arrow Banner when Bag (20/20) is FULL */}
        {nearestRecyclerHint && !missionFailed && !missionWon && (
          <div className="pointer-events-none absolute top-11 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 px-4 py-2 bg-[#06221b]/95 border border-emerald-400/70 rounded-xl shadow-2xl">
            <Navigation
              className="w-5 h-5 text-emerald-300 transition-transform duration-100"
              style={{ transform: `rotate(${nearestRecyclerHint.angleDeg}deg)` }}
            />
            <div className="text-xs">
              <div className="font-bold text-emerald-300 tracking-wide">
                BAG FULL ({progress.currentBackpackItems}/{progress.backpackMaxCapacity}) — FOLLOW ARROW TO NEAREST AUTO RECYCLING STATION
              </div>
              <div className="font-mono-num text-[11px] text-slate-200">
                Distance: {nearestRecyclerHint.dist}m · Deposit for +{progress.currentBackpackItems} Scrap
              </div>
            </div>
          </div>
        )}

        {/* Toxicity Banner for Toxic Bunker missions */}
        {mission.arenaConfig.isToxicBunker && (
          <div className="absolute top-12 right-3 z-20 flex items-center gap-3 px-3.5 py-1.5 bg-amber-950/90 border border-amber-500/45 rounded-lg text-xs">
            <ShieldAlert className="w-4 h-4 text-amber-400" />
            <span className="font-mono-num font-bold text-amber-200">TOXICITY: {toxicity}%</span>
            <span className="text-slate-200 font-mono-num">
              {bunkerFound ? `Bunker (${bunkerCoords.x}, ${bunkerCoords.z})` : 'Scan Q'}
            </span>
          </div>
        )}

        {/* 1st-Person Crosshair Reticle */}
        {firstPerson && !warningActive && !missionFailed && !missionWon && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-10">
            <div className="relative w-5 h-5 flex items-center justify-center">
              <span className="w-1 h-1 rounded-full bg-white/90 shadow" />
              <span className="absolute left-0 w-1.5 h-px bg-cyan-300/75" />
              <span className="absolute right-0 w-1.5 h-px bg-cyan-300/75" />
              <span className="absolute top-0 h-1.5 w-px bg-cyan-300/75" />
              <span className="absolute bottom-0 h-1.5 w-px bg-cyan-300/75" />
            </div>
          </div>
        )}

        {/* Damage Crimson Vignette */}
        {damageFlash && (
          <div className="pointer-events-none absolute inset-0 z-10 border-[10px] border-rose-600/65 bg-rose-700/20" />
        )}

        {/* BOTTOM-LEFT VITALITY PANEL: Green Anatomical Body (Separate Head / Body / Arms / Legs) + Energy / Hunger / Speed / Thirst */}
        <div className="z-20 absolute bottom-3 left-3 p-3 bg-[#070f1d]/94 border border-emerald-500/35 rounded-2xl shadow-2xl flex items-center gap-3.5 max-w-[330px]">
          {/* Anatomical Green Segmented Body Diagram */}
          <div className="flex flex-col items-center shrink-0">
            <svg viewBox="0 0 88 128" className="w-[74px] h-[108px]" aria-label="Anatomical Vitality Body">
              {/* Separate Head */}
              <g>
                <circle
                  cx="44"
                  cy="16"
                  r="11.5"
                  fill={partColor(vitality.parts.head)}
                  fillOpacity="0.88"
                  stroke="#052e16"
                  strokeWidth="1.5"
                />
                <text x="44" y="19" textAnchor="middle" fill="#041b0e" fontSize="7.5" fontWeight="800">
                  {vitality.parts.head}
                </text>
              </g>

              {/* Separate Torso / Body */}
              <g>
                <rect
                  x="30"
                  y="30"
                  width="28"
                  height="42"
                  rx="6"
                  fill={partColor(vitality.parts.body)}
                  fillOpacity="0.88"
                  stroke="#052e16"
                  strokeWidth="1.5"
                />
                <text x="44" y="54" textAnchor="middle" fill="#041b0e" fontSize="8" fontWeight="800">
                  {vitality.parts.body}
                </text>
              </g>

              {/* Separate Left Arm */}
              <g>
                <rect
                  x="13"
                  y="32"
                  width="13"
                  height="38"
                  rx="5"
                  fill={partColor(vitality.parts.leftArm)}
                  fillOpacity="0.88"
                  stroke="#052e16"
                  strokeWidth="1.5"
                />
                <text x="19.5" y="54" textAnchor="middle" fill="#041b0e" fontSize="6.5" fontWeight="800">
                  L
                </text>
              </g>

              {/* Separate Right Arm */}
              <g>
                <rect
                  x="62"
                  y="32"
                  width="13"
                  height="38"
                  rx="5"
                  fill={partColor(vitality.parts.rightArm)}
                  fillOpacity="0.88"
                  stroke="#052e16"
                  strokeWidth="1.5"
                />
                <text x="68.5" y="54" textAnchor="middle" fill="#041b0e" fontSize="6.5" fontWeight="800">
                  R
                </text>
              </g>

              {/* Separate Left Leg */}
              <g>
                <rect
                  x="29"
                  y="75"
                  width="13"
                  height="46"
                  rx="5"
                  fill={partColor(vitality.parts.leftLeg)}
                  fillOpacity="0.88"
                  stroke="#052e16"
                  strokeWidth="1.5"
                />
                <text x="35.5" y="101" textAnchor="middle" fill="#041b0e" fontSize="6.5" fontWeight="800">
                  {vitality.parts.leftLeg}
                </text>
              </g>

              {/* Separate Right Leg */}
              <g>
                <rect
                  x="46"
                  y="75"
                  width="13"
                  height="46"
                  rx="5"
                  fill={partColor(vitality.parts.rightLeg)}
                  fillOpacity="0.88"
                  stroke="#052e16"
                  strokeWidth="1.5"
                />
                <text x="52.5" y="101" textAnchor="middle" fill="#041b0e" fontSize="6.5" fontWeight="800">
                  {vitality.parts.rightLeg}
                </text>
              </g>
            </svg>
            <span className="text-[9px] font-mono-num uppercase tracking-wider text-emerald-300 font-bold">
              Vitality Body
            </span>
          </div>

          {/* 4 Tracked Survival Bars: Energy · Hunger · Speed · Thirst */}
          <div className="w-[186px] space-y-1.5 text-[10px] font-mono-num">
            <div className="space-y-0.5">
              <div className="flex items-center justify-between text-emerald-300">
                <span className="flex items-center gap-1"><Zap className="w-3 h-3" /> Energy</span>
                <span className="font-bold text-white">{vitality.energy}%</span>
              </div>
              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-400 transition-all duration-150" style={{ width: `${vitality.energy}%` }} />
              </div>
            </div>

            <div className="space-y-0.5">
              <div className="flex items-center justify-between text-amber-300">
                <span className="flex items-center gap-1"><Utensils className="w-3 h-3" /> Hunger</span>
                <span className="font-bold text-white">{vitality.hunger}%</span>
              </div>
              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-amber-400 transition-all duration-150" style={{ width: `${vitality.hunger}%` }} />
              </div>
            </div>

            <div className="space-y-0.5">
              <div className="flex items-center justify-between text-cyan-300">
                <span className="flex items-center gap-1"><Droplets className="w-3 h-3" /> Thirst</span>
                <span className="font-bold text-white">{vitality.thirst}%</span>
              </div>
              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-sky-400 transition-all duration-150" style={{ width: `${vitality.thirst}%` }} />
              </div>
            </div>

            <div className="space-y-0.5">
              <div className="flex items-center justify-between text-violet-300">
                <span className="flex items-center gap-1"><Gauge className="w-3 h-3" /> Speed</span>
                <span className="font-bold text-white">{vitality.speed} m/s</span>
              </div>
              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-violet-400 transition-all duration-150"
                  style={{ width: `${Math.min(100, Math.round((vitality.speed / 22) * 100))}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* BOTTOM-CENTER / RIGHT FLOATING HORIZONTAL ACTION BAR (Pushed neatly upward & cleanly arranged) */}
        <div className="z-20 absolute bottom-4 left-1/2 -translate-x-1/2 lg:left-[calc(50%+125px)] flex flex-wrap items-center justify-center gap-2 px-3.5 py-2 bg-[#070f1d]/94 border border-cyan-500/35 rounded-2xl shadow-2xl max-w-[92vw]">
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 bg-orange-950/60 border border-orange-500/40 rounded-lg text-[11px] font-semibold text-orange-200 whitespace-nowrap">
            <Wrench className="w-3.5 h-3.5 text-orange-400" />
            Rusty Grabber
          </div>

          <button
            onClick={() => simActionRef.current?.triggerScanner()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-400/40 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            <Radio className="w-3.5 h-3.5 text-cyan-400" />
            Scanner (Q)
          </button>

          {mission.arenaConfig.hasRecyclingMachine && (
            <button
              onClick={() => simActionRef.current?.triggerRecycle()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-400/40 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <Recycle className="w-3.5 h-3.5 text-emerald-400" />
              Recycle for Scrap (R)
            </button>
          )}

          {progress.unlockedVehicles.length > 0 && (
            <button
              onClick={() => {
                soundEngine.click();
                onUpdateProgress((p) => {
                  const nextIdx = p.activeVehicleId
                    ? (p.unlockedVehicles.indexOf(p.activeVehicleId) + 1) % (p.unlockedVehicles.length + 1)
                    : 0;
                  const nextId = nextIdx < p.unlockedVehicles.length ? p.unlockedVehicles[nextIdx] : null;
                  return { ...p, activeVehicleId: nextId };
                });
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <Compass className="w-3.5 h-3.5 text-amber-400" />
              {progress.activeVehicleId ? 'Vehicle On' : 'Vehicle'}
            </button>
          )}

          <span className="hidden xl:inline text-[11px] text-slate-400 pl-1 whitespace-nowrap">
            {pointerLocked ? 'Mouse Locked (ESC)' : 'Drag/Click Look'} · WASD · Shift Sprint · V View
          </span>
        </div>

        {/* Collapsible Right Tactical Objectives & Squad Drawer Overlay (does not shrink the 3D viewing panel) */}
        {sidebarOpen && (
          <aside className="z-25 absolute top-3 right-3 bottom-20 w-[290px] bg-[#070f1d]/96 border border-cyan-500/35 rounded-2xl p-4 overflow-y-auto space-y-4 shadow-2xl">
            <div className="p-3 bg-slate-900/90 border border-cyan-500/25 rounded-xl space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-bold tracking-wide text-cyan-300">
                  <Bot className="w-4 h-4" />
                  {progress.robotUnlocked ? 'E.C.H.O.-7' : 'Field Computer'}
                </span>
                <span className="text-[10px] font-mono-num text-emerald-300">
                  +{stats.scrapEarnedInMission} Scrap
                </span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">{robotHint}</p>
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Mission Objectives
              </h3>
              <div className="space-y-1.5 text-xs">
                {mission.arenaConfig.rubbishCount > 0 && (
                  <div className="flex items-center justify-between p-2 bg-slate-900/75 border border-slate-800 rounded-lg">
                    <span className="text-slate-200">Clean Trash Clusters</span>
                    <span className="font-mono-num font-bold text-cyan-300">
                      {mission.arenaConfig.rubbishCount - stats.rubbishRemaining}/{mission.arenaConfig.rubbishCount}
                    </span>
                  </div>
                )}
                {smogGoal > 0 && (
                  <div className="flex items-center justify-between p-2 bg-slate-900/75 border border-amber-500/30 rounded-lg">
                    <span className="text-amber-200">Stop Smog Stacks</span>
                    <span className="font-mono-num font-bold text-amber-300">
                      {stats.smogStopped}/{smogGoal}
                    </span>
                  </div>
                )}
                {runoffGoal > 0 && (
                  <div className="flex items-center justify-between p-2 bg-slate-900/75 border border-lime-500/30 rounded-lg">
                    <span className="text-lime-200">Seal Chemical Runoff</span>
                    <span className="font-mono-num font-bold text-lime-300">
                      {stats.runoffSealed}/{runoffGoal}
                    </span>
                  </div>
                )}
                {mission.arenaConfig.hasRecyclingMachine && (
                  <div className="flex items-center justify-between p-2 bg-slate-900/75 border border-slate-800 rounded-lg">
                    <span className="text-slate-200">Recycled into Scrap</span>
                    <span className="font-mono-num font-bold text-orange-300">
                      {stats.scrapEarnedInMission} Scrap
                    </span>
                  </div>
                )}
                {mission.arenaConfig.treesToPlant > 0 && (
                  <div className="flex items-center justify-between p-2 bg-slate-900/75 border border-slate-800 rounded-lg">
                    <span className="flex items-center gap-1.5 text-slate-200">
                      <Trees className="w-3.5 h-3.5 text-emerald-400" />
                      Plant Saplings
                    </span>
                    <span className="font-mono-num font-bold text-emerald-300">
                      {stats.treesPlanted}/{mission.arenaConfig.treesToPlant}
                    </span>
                  </div>
                )}
                {mission.arenaConfig.coralsToRestore > 0 && (
                  <div className="flex items-center justify-between p-2 bg-slate-900/75 border border-slate-800 rounded-lg">
                    <span className="text-slate-200">Restore Coral Reefs</span>
                    <span className="font-mono-num font-bold text-cyan-300">
                      {stats.coralsRestored}/{mission.arenaConfig.coralsToRestore}
                    </span>
                  </div>
                )}
                {mission.arenaConfig.equipmentToRepair > 0 && (
                  <div className="flex items-center justify-between p-2 bg-slate-900/75 border border-slate-800 rounded-lg">
                    <span className="flex items-center gap-1.5 text-slate-200">
                      <Wrench className="w-3.5 h-3.5 text-amber-400" />
                      {mission.arenaConfig.isDisaster ? 'Barriers & Citizens' : 'Repair Systems'}
                    </span>
                    <span className="font-mono-num font-bold text-amber-300">
                      {stats.equipmentRepaired}/{mission.arenaConfig.equipmentToRepair}
                    </span>
                  </div>
                )}
                {mission.arenaConfig.hasSecretLab && (
                  <div className="flex items-center justify-between p-2 bg-slate-900/75 border border-purple-500/30 rounded-lg">
                    <span className="text-purple-200">Scan Secret Lab</span>
                    <span className="font-mono-num font-bold text-purple-300">
                      {stats.labDiscovered ? 'FOUND' : 'HIDDEN'}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
                  <Users className="w-3.5 h-3.5 text-cyan-400" />
                  Squad ({safeCount + activeCount})
                </h3>
                <span className="text-[10px] font-mono-num text-slate-400">
                  Rescued {rescuedCount}
                </span>
              </div>

              {downedCount > 0 && (
                <div className="p-2 bg-rose-950/65 border border-rose-500/50 rounded-lg text-xs text-rose-200">
                  {downedCount} teammate needs revival! Walk near them to rescue.
                </div>
              )}

              <div className="space-y-1.5">
                {squad.map((m) => (
                  <div key={m.id} className="flex items-center justify-between px-2.5 py-1.5 bg-slate-900/75 border border-slate-800 rounded-lg text-xs">
                    <div>
                      <div className="font-semibold text-white">{m.name}</div>
                      <div className="text-[10px] text-slate-400">{m.role}</div>
                    </div>
                    <span
                      className={`font-mono-num font-semibold text-[11px] ${
                        m.status === 'needs-rescue' ? 'text-rose-400' : m.status === 'safe' ? 'text-emerald-400' : 'text-cyan-300'
                      }`}
                    >
                      {m.status === 'needs-rescue' ? 'RESCUE' : m.status === 'safe' ? 'SAFE' : 'ACTIVE'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        )}

        {/* Disaster Early Warning Overlay */}
        {warningActive && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/90 p-6">
            <div className="max-w-lg w-full p-6 bg-[#0d1526] border border-rose-500/60 rounded-xl space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold tracking-wider text-rose-400">EARLY WARNING SYSTEM</span>
                <span className="font-mono-num text-xl font-bold text-amber-300">{warningCountdown}s</span>
              </div>
              <h3 className="text-2xl font-bold text-white">
                Incoming Disaster: {mission.arenaConfig.disasterType}
              </h3>
              <p className="text-sm text-slate-300 leading-relaxed">
                Evacuate hazardous terrain immediately. Guide citizens, repair protective barriers or suppression hydrants, avoid hazard zones, and escort your squad to the Green Safe Zone.
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  onClick={() => {
                    soundEngine.upgrade();
                    setTeammatesWarned(true);
                  }}
                  className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors cursor-pointer ${
                    teammatesWarned ? 'bg-emerald-600 text-white' : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                  }`}
                >
                  {teammatesWarned ? 'Teammates Warned' : 'Warn Teammates'}
                </button>
                <button
                  onClick={() => {
                    soundEngine.click();
                    setWarningActive(false);
                  }}
                  className="px-4 py-2 text-sm font-semibold bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-lg transition-colors cursor-pointer"
                >
                  Deploy Now
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Auto-Recycler Active Progress Box */}
        {isRecycling && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 px-4 py-3 bg-slate-900/95 border border-emerald-400/50 rounded-xl w-72 space-y-2 shadow-2xl">
            <div className="flex items-center justify-between text-xs font-semibold text-emerald-300">
              <span className="flex items-center gap-1.5">
                <Recycle className="w-4 h-4 animate-spin" />
                Converting Trash to Scrap
              </span>
              <span className="font-mono-num">{recycleAnimPct}%</span>
            </div>
            <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-400 transition-all duration-100" style={{ width: `${recycleAnimPct}%` }} />
            </div>
          </div>
        )}

        {/* MINECRAFT-STYLE DEATH SCREEN ("YOU DIED!") */}
        {missionFailed && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#3a0707]/88 p-6 text-center">
            <h2 className="font-display text-5xl sm:text-7xl font-black tracking-wider text-rose-100 drop-shadow-[0_6px_0_rgba(69,10,10,0.95)] mb-3">
              YOU DIED!
            </h2>
            <p className="text-sm sm:text-base text-rose-200 max-w-md mb-2">{missionFailed}</p>
            <div className="font-mono-num text-base font-bold text-amber-300 mb-7">
              Score: {stats.ecoEarnedInMission} Eco Points · +{stats.scrapEarnedInMission} Scrap
            </div>
            <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm">
              <button
                onClick={() => simActionRef.current?.restartMission()}
                className="flex-1 flex items-center justify-center gap-2 py-3 px-5 font-bold text-sm bg-slate-200 hover:bg-white text-slate-950 border-2 border-slate-400 rounded-lg shadow-xl transition-colors cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                Respawn
              </button>
              <button
                onClick={onExitMission}
                className="flex-1 py-3 px-5 font-bold text-sm bg-slate-800 hover:bg-slate-700 text-slate-100 border-2 border-slate-600 rounded-lg shadow-xl transition-colors cursor-pointer"
              >
                World Map
              </button>
            </div>
          </div>
        )}

        {/* MISSION SUCCESSFUL WIN SCREEN */}
        {missionWon && !missionFailed && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/90 p-6">
            <div className="max-w-md w-full p-7 bg-[#091628] border border-emerald-400/50 rounded-2xl space-y-4 text-center shadow-2xl">
              <CheckCircle2 className="w-14 h-14 text-emerald-400 mx-auto" />
              <div className="text-[11px] font-mono-num tracking-[0.26em] text-emerald-300 uppercase">
                Sector Restoration Verified
              </div>
              <h3 className="font-display text-3xl font-black tracking-wide text-white">
                MISSION SUCCESSFUL
              </h3>
              <p className="text-sm text-slate-300">
                {mission.title} has stabilized into a recovering ecosystem. Its marker is now Green on Earth.
              </p>
              <div className="grid grid-cols-2 gap-2 text-xs bg-slate-900/90 p-3.5 rounded-xl border border-slate-800 font-mono-num">
                <div>Eco Earned: +{stats.ecoEarnedInMission + mission.rewardEcoPoints}</div>
                <div className="text-orange-300">Scrap Earned: +{stats.scrapEarnedInMission}</div>
                <div>Trees/Corals: {stats.treesPlanted + stats.coralsRestored}</div>
                <div>Pollutions Stopped: {stats.smogStopped + stats.runoffSealed}</div>
              </div>
              <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
                <button
                  onClick={onExitMission}
                  className="flex-1 py-3 px-4 font-bold text-sm bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl transition-colors cursor-pointer"
                >
                  Return to 3D Earth
                </button>
                <button
                  onClick={() => simActionRef.current?.restartMission()}
                  className="py-3 px-4 font-semibold text-sm bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition-colors cursor-pointer"
                >
                  Replay
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
