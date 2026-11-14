import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FilmPass } from 'three/addons/postprocessing/FilmPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  GameProgressState,
  MissionDefinition,
  RemotePlayerState,
  ScreenMode,
  SectorPingEvent,
} from '../types/game';
import { isMissionUnlocked } from '../data/gameData';

interface EarthCanvasProps {
  screenMode: ScreenMode;
  missions: MissionDefinition[];
  progress: GameProgressState;
  globalProgressPct: number;
  selectedMissionId: string | null;
  divingMission?: MissionDefinition | null;
  solarHour?: number;
  solarMode?: 'auto' | 'day' | 'sunset' | 'night';
  remotePlayers?: RemotePlayerState[];
  selfPlayerId?: string | null;
  sectorPings?: SectorPingEvent[];
  onSelectMission: (mission: MissionDefinition) => void;
  onQuickEnterMission?: (mission: MissionDefinition) => void;
  onHoverMission: (mission: MissionDefinition | null, screenPos?: { x: number; y: number }) => void;
  onWebGLUnavailable?: () => void;
  onLoadProgress?: (pct: number, stage: string) => void;
  onSceneReady?: () => void;
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _targetCamPos = new THREE.Vector3();
const _targetSunVec = new THREE.Vector3();
const _projVec = new THREE.Vector3();
const DEFAULT_SUN_DIR = new THREE.Vector3(0.56, 0.25, -0.79).normalize();

function latLngToVector3(lat: number, lng: number, radius: number, out = new THREE.Vector3()): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  out.x = -radius * Math.sin(phi) * Math.cos(theta);
  out.z = radius * Math.sin(phi) * Math.sin(theta);
  out.y = radius * Math.cos(phi);
  return out;
}

// High-speed integer lattice 3D value noise (avoids expensive Math.sin per octave)
function hash3Fast(ix: number, iy: number, iz: number): number {
  let h = Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263) + Math.imul(iz | 0, 2147483647);
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise3D(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);

  const n000 = hash3Fast(ix, iy, iz);
  const n100 = hash3Fast(ix + 1, iy, iz);
  const n010 = hash3Fast(ix, iy + 1, iz);
  const n110 = hash3Fast(ix + 1, iy + 1, iz);
  const n001 = hash3Fast(ix, iy, iz + 1);
  const n101 = hash3Fast(ix + 1, iy, iz + 1);
  const n011 = hash3Fast(ix, iy + 1, iz + 1);
  const n111 = hash3Fast(ix + 1, iy + 1, iz + 1);

  const nx00 = n000 + (n100 - n000) * ux;
  const nx10 = n010 + (n110 - n010) * ux;
  const nx01 = n001 + (n101 - n001) * ux;
  const nx11 = n011 + (n111 - n011) * ux;

  const nxy0 = nx00 + (nx10 - nx00) * uy;
  const nxy1 = nx01 + (nx11 - nx01) * uy;

  return nxy0 + (nxy1 - nxy0) * uz;
}

function fbm3D(x: number, y: number, z: number, octaves = 4): number {
  let v = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    v += amp * noise3D(x * freq, y * freq, z * freq);
    freq *= 2.08;
    amp *= 0.5;
  }
  return v;
}

const CONTINENT_BLOBS: Array<[number, number, number, number, number]> = [
  // North America
  [61, -114, 10.5, 22, 1.06], [48, -104, 10.5, 18, 1.1], [39, -86, 8.5, 13, 0.98],
  [39, -113, 9.5, 9, 1.04], [28, -81.5, 4.2, 2.2, 0.72], [46, -65, 4.5, 6.5, 0.84],
  [63.5, -151, 5.5, 13, 0.96], [23, -102, 7.5, 5.5, 0.9], [26, -111.5, 4.2, 1.4, 0.62],
  [20, -88.5, 2.8, 2.4, 0.68], [13.5, -86, 3.8, 5.5, 0.72], [21.5, -78, 1.8, 4.5, 0.66],
  [72.5, -42, 9.5, 13, 1.04], [75, -86, 5.5, 16, 0.8],
  // South America
  [4, -67, 7.5, 9, 1.02], [-4, -60, 10.5, 14, 1.14], [-9, -40, 8, 7.5, 1.02],
  [-19, -48, 8.5, 6.5, 0.98], [-15, -70, 13, 4.2, 1.18], [-33, -64, 12.5, 5.5, 0.94],
  [-46, -70, 9.5, 3.2, 0.86],
  // Europe
  [40.5, -4, 4.2, 5.2, 0.9], [47.5, 3, 4.8, 6.5, 0.92], [51, 13, 5.2, 8.5, 0.96],
  [54, -2.5, 3.8, 2.6, 0.78], [53.2, -8, 1.9, 1.8, 0.65], [42.2, 12.8, 4.2, 2.0, 0.8],
  [42, 22, 4.2, 5.5, 0.84], [62, 16, 8.2, 6.8, 0.94], [53, 30, 8.5, 14, 1.0],
  [64.8, -18.5, 1.8, 3.2, 0.7],
  // Africa
  [32, -3, 4.5, 7, 0.9], [24, 3, 10, 15, 1.1], [21, 24, 10, 12.5, 1.08],
  [11, -7, 5.5, 10, 0.94], [6, 21, 9, 13, 1.08], [8.5, 39, 6.5, 6.5, 1.04],
  [6, 46, 4.8, 4.2, 0.86], [-9, 25, 11.5, 10.5, 1.06], [-23, 24, 9.5, 7.5, 0.98],
  [-19, 46.5, 5.8, 2.2, 0.84],
  // Asia
  [39, 35, 3.6, 7.5, 0.88], [24, 45, 8.5, 8.8, 0.98], [33, 53, 6.2, 8.5, 0.96],
  [59, 64, 12, 24, 1.08], [63, 115, 11.5, 33, 1.12], [56, 160, 5.5, 3.2, 0.76],
  [47, 88, 9.5, 22, 1.06], [33, 86, 6.5, 13, 1.24], [35, 108, 10, 15, 1.08],
  [37, 127.5, 3.0, 1.8, 0.74], [36.5, 138.5, 5.0, 2.6, 0.82], [21, 78, 10.5, 7.8, 1.02],
  [7.8, 80.7, 1.8, 1.4, 0.66], [16.5, 101.5, 7.5, 4.6, 0.88], [4, 102, 4.0, 2.0, 0.72],
  [-1, 102, 4.2, 3.6, 0.72], [-7.2, 110, 1.8, 5.2, 0.68], [1, 114.5, 4.5, 4.2, 0.82],
  [-2, 121, 3.2, 2.5, 0.68], [12.5, 122, 4.2, 2.2, 0.72],
  // Australia & Oceania
  [-24, 133, 9.5, 14.5, 1.06], [-42, 146.5, 2.0, 2.2, 0.68], [-42, 172, 4.6, 2.2, 0.78],
  [-5.5, 142, 3.8, 6.2, 0.8],
  // Antarctica
  [-83, 0, 10.5, 180, 1.12], [-69, -61, 4.5, 4.0, 0.82],
  // Negative sea carves
  [35.8, 17, 4.2, 18, -0.84], [24.5, -90, 5.2, 7.8, -0.82], [16, -74, 4.5, 10, -0.68],
  [59.5, -83, 5.2, 7.5, -0.78], [20.5, 38.5, 6.2, 1.9, -0.74], [26.8, 51.5, 2.6, 3.4, -0.65],
  [43.3, 34, 2.8, 5.0, -0.72], [42.2, 50.5, 4.2, 2.1, -0.64], [14.5, 87, 5.2, 4.5, -0.58],
  [16, 65, 5.8, 6.5, -0.52], [45.5, -84, 2.6, 4.5, -0.46],
];

const EARTH_WORKER_SOURCE = `
const BLOBS = ${JSON.stringify(CONTINENT_BLOBS)};
function hash3Fast(ix, iy, iz) {
  let h = Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263) + Math.imul(iz | 0, 2147483647);
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise3D(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const n000 = hash3Fast(ix, iy, iz), n100 = hash3Fast(ix + 1, iy, iz);
  const n010 = hash3Fast(ix, iy + 1, iz), n110 = hash3Fast(ix + 1, iy + 1, iz);
  const n001 = hash3Fast(ix, iy, iz + 1), n101 = hash3Fast(ix + 1, iy, iz + 1);
  const n011 = hash3Fast(ix, iy + 1, iz + 1), n111 = hash3Fast(ix + 1, iy + 1, iz + 1);
  const nx00 = n000 + (n100 - n000) * ux, nx10 = n010 + (n110 - n010) * ux;
  const nx01 = n001 + (n101 - n001) * ux, nx11 = n011 + (n111 - n011) * ux;
  return (nx00 + (nx10 - nx00) * uy) + ((nx01 + (nx11 - nx01) * uy) - (nx00 + (nx10 - nx00) * uy)) * uz;
}
function fbm3D(x, y, z, octaves) {
  let v = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    v += amp * noise3D(x * freq, y * freq, z * freq);
    freq *= 2.08;
    amp *= 0.5;
  }
  return v;
}
self.onmessage = function(ev) {
  const { jobId, width, height, restorationFactor } = ev.data;
  const total = width * height * 4;
  const data = new Uint8Array(total);
  const roughData = new Uint8Array(total);
  const normalData = new Uint8Array(total);
  const nightData = new Uint8Array(total);
  const cloudData = new Uint8Array(total);
  const elevGrid = new Float32Array(width * height);
  const trigU = new Float32Array(width * 2);
  for (let x = 0; x < width; x++) {
    const theta = (x / width) * Math.PI * 2;
    trigU[x * 2] = Math.cos(theta);
    trigU[x * 2 + 1] = Math.sin(theta);
  }
  const reportStep = Math.max(32, Math.floor(height / 8));
  for (let y = 0; y < height; y++) {
    const v = y / height;
    const lat = -90 + v * 180;
    const absLat = Math.abs(lat);
    const phi = (1 - v) * Math.PI;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const rowBlobs = [];
    for (let bi = 0; bi < BLOBS.length; bi++) {
      const b = BLOBS[bi];
      if (Math.abs(lat - b[0]) <= b[2] * 1.7 + 4.0) rowBlobs.push(b);
    }
    for (let x = 0; x < width; x++) {
      const lng = (x / width) * 360 - 180;
      const nx = sinPhi * trigU[x * 2];
      const ny = cosPhi;
      const nz = sinPhi * trigU[x * 2 + 1];
      const warpX = fbm3D(nx * 5.8 + 2.3, ny * 5.8 + 0.8, nz * 5.8 + 6.1, 3) - 0.5;
      const warpZ = fbm3D(nx * 5.8 + 7.9, ny * 5.8 + 4.4, nz * 5.8 + 1.5, 3) - 0.5;
      const n1 = fbm3D((nx + warpX * 0.14) * 3.8 + 1.4, ny * 3.8 + 2.1, (nz + warpZ * 0.14) * 3.8 + 0.7, 4);
      const n2 = fbm3D(nx * 12.5 + 4.2, ny * 12.5 + 1.3, nz * 12.5 + 5.1, 3);
      const micro = noise3D(nx * 32.0 + 1.1, ny * 32.0 + 3.7, nz * 32.0 + 8.3);
      const ridgeRaw = 1.0 - Math.abs(n2 * 2 - 1);
      const ridge = ridgeRaw * ridgeRaw;
      const latW = lat + warpX * 5.0;
      const lngW = lng + warpZ * 6.2;
      let mask = 0;
      for (let bi = 0; bi < rowBlobs.length; bi++) {
        const b = rowBlobs[bi];
        const dLat = (latW - b[0]) / b[2];
        let dLng = lngW - b[1];
        if (dLng > 180) dLng -= 360;
        if (dLng < -180) dLng += 360;
        dLng /= b[3];
        const d2 = dLat * dLat + dLng * dLng;
        if (d2 < 2.6) mask += b[4] * Math.exp(-d2 * 1.42);
      }
      const elevation = mask + (n1 - 0.48) * 0.54 + (n2 - 0.5) * 0.21 + ridge * 0.17 + (micro - 0.5) * 0.08;
      elevGrid[y * width + x] = elevation;
      const idx = (y * width + x) * 4;
      const iceThreshold = 71.5 + (1 - restorationFactor) * 4.2 + (n1 - 0.5) * 8 + (n2 - 0.5) * 6.5 + (micro - 0.5) * 4.5;
      let r = 0, g = 0, b = 0, rough = 180, cityGlow = 0;
      if (absLat > iceThreshold) {
        const crevasse = Math.max(0, Math.min(1, ridge * 0.8 + micro * 0.4));
        r = 220 + crevasse * 30; g = 234 + crevasse * 18; b = 248 + crevasse * 7; rough = 115 + micro * 36;
      } else if (elevation > 0.43) {
        const heightNorm = Math.min(1, (elevation - 0.43) / 0.76);
        const isAus = lat < -16 && lat > -32 && lng > 116 && lng < 144;
        const isSahara = lat > 14 && lat < 32 && lng > -16 && lng < 58;
        const desertBoost = isSahara ? 0.34 : isAus ? 0.28 : 0;
        const aridity = Math.max(0, (1 - Math.abs(absLat - 24) / 17) + desertBoost) * (1 - restorationFactor * 0.32);
        const eqRain = Math.max(0, 1 - absLat / 17) * (0.55 + n1 * 0.45);
        const boreal = Math.max(0, 1 - Math.abs(absLat - 59) / 13);
        const moisture = n2 * 0.55 + micro * 0.15 + restorationFactor * 0.36;
        if (heightNorm > 0.72) {
          const snow = Math.min(1, (heightNorm - 0.72) / 0.18);
          r = 122 + snow * 126; g = 126 + snow * 124; b = 134 + snow * 118; rough = 184 + (1 - snow) * 35;
        } else if (heightNorm > 0.49) {
          const strata = micro * 26;
          r = 92 + heightNorm * 44 + strata; g = 88 + heightNorm * 38 + strata * 0.9; b = 80 + heightNorm * 32 + strata * 0.8; rough = 238;
        } else if (aridity > 0.48 && moisture < 0.58) {
          const dune = Math.sin(nx * 40 + nz * 28 + n2 * 6) * 0.5 + 0.5;
          const redIron = isAus ? 24 : 0;
          r = 186 + redIron - restorationFactor * 18 + n2 * 20 + dune * 12;
          g = 146 - redIron * 0.6 - restorationFactor * 4 + n1 * 16 + dune * 8;
          b = 92 - redIron * 0.5 + n2 * 14; rough = 236;
        } else if (eqRain > 0.52 && moisture > 0.44) {
          const lush = Math.min(1, 0.52 + restorationFactor * 0.48);
          r = 24 * (1 - lush) + 14 * lush + micro * 15; g = 68 * (1 - lush) + 104 * lush + n1 * 22; b = 38 * (1 - lush) + 42 * lush + n2 * 10; rough = 212;
        } else if (boreal > 0.44) {
          r = 34 + micro * 18; g = 68 + restorationFactor * 34 + n1 * 18; b = 48 + n2 * 14; rough = 218;
        } else {
          const lush = Math.min(1, 0.42 + restorationFactor * 0.58);
          r = 68 * (1 - lush) + 22 * lush + n2 * 16 + micro * 10; g = 84 * (1 - lush) + 118 * lush + n1 * 22; b = 52 * (1 - lush) + 56 * lush + n2 * 12; rough = 214;
        }
        if (heightNorm < 0.25 && absLat < 60) {
          const coastalFactor = 1 - heightNorm / 0.25;
          const urbanCluster = fbm3D(nx * 22 + 8.1, ny * 22 + 3.4, nz * 22 + 9.2, 2);
          const urbanFine = noise3D(nx * 54 + 2.7, ny * 54 + 6.1, nz * 54 + 1.4);
          const cityScore = urbanCluster * 0.72 + urbanFine * 0.28 + coastalFactor * 0.09;
          if (cityScore > 0.65) cityGlow = Math.min(1, (cityScore - 0.65) * 6.0);
        }
      } else {
        const depth = Math.min(1, (0.43 - elevation) / 0.52);
        const shelf = Math.max(0, 1 - depth * 4.6);
        const shoal = Math.max(0, 1 - depth * 11.2);
        r = 3 + shelf * (12 + restorationFactor * 15) + shoal * 22 + (1 - restorationFactor) * 6;
        g = 20 + shelf * (76 + restorationFactor * 46) + shoal * 52 + (1 - depth) * 22;
        b = 62 + shelf * (88 + restorationFactor * 50) + shoal * 36 + restorationFactor * 38;
        rough = 24 + shoal * 20;
      }
      data[idx] = r < 0 ? 0 : r > 255 ? 255 : r;
      data[idx + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      data[idx + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
      data[idx + 3] = 255;
      roughData[idx] = rough; roughData[idx + 1] = rough; roughData[idx + 2] = rough; roughData[idx + 3] = 255;
      nightData[idx] = cityGlow * (255 - micro * 28);
      nightData[idx + 1] = cityGlow * (178 + micro * 42);
      nightData[idx + 2] = cityGlow * (82 + micro * 65);
      nightData[idx + 3] = 255;
      const tradeWave = Math.sin(ny * 8.5 + n1 * 4.5) * 0.14;
      const cn = fbm3D(nx * 4.8 + tradeWave + 11.2, ny * 6.0 + 3.1, nz * 4.8 - tradeWave + 6.8, 3);
      const wisp = noise3D(nx * 16.0 + 3.4, ny * 16.0 + 7.2, nz * 16.0 + 1.9);
      const cloudVal = cn * 0.78 + wisp * 0.22;
      const cloudAlpha = Math.max(0, Math.min(255, (cloudVal - 0.485) * 680));
      cloudData[idx] = 240; cloudData[idx + 1] = 247; cloudData[idx + 2] = 255; cloudData[idx + 3] = cloudAlpha * 0.86;
    }
    if (y % reportStep === 0 && y > 0) {
      self.postMessage({ type: 'progress', jobId, pct: Math.round(12 + (y / height) * 68), stage: 'Synthesizing Planetary Biome & Cloud Maps' });
    }
  }
  const strength = 7.2;
  for (let y = 0; y < height; y++) {
    const ys = y > 0 ? y - 1 : 0;
    const yn = y < height - 1 ? y + 1 : height - 1;
    for (let x = 0; x < width; x++) {
      const xm = (x - 1 + width) % width;
      const xp = (x + 1) % width;
      const hL = Math.max(0.45, elevGrid[y * width + xm]);
      const hR = Math.max(0.45, elevGrid[y * width + xp]);
      const hN = Math.max(0.45, elevGrid[yn * width + x]);
      const hS = Math.max(0.45, elevGrid[ys * width + x]);
      let dx = (hL - hR) * strength;
      let dy = (hN - hS) * strength;
      let dz = 1.0;
      const invLen = 1 / Math.hypot(dx, dy, dz);
      dx *= invLen; dy *= invLen; dz *= invLen;
      const idx = (y * width + x) * 4;
      normalData[idx] = (dx * 0.5 + 0.5) * 255;
      normalData[idx + 1] = (dy * 0.5 + 0.5) * 255;
      normalData[idx + 2] = (dz * 0.5 + 0.5) * 255;
      normalData[idx + 3] = 255;
    }
  }
  self.postMessage(
    {
      type: 'done',
      jobId,
      width,
      height,
      albedo: data.buffer,
      rough: roughData.buffer,
      normal: normalData.buffer,
      night: nightData.buffer,
      cloud: cloudData.buffer,
    },
    [data.buffer, roughData.buffer, normalData.buffer, nightData.buffer, cloudData.buffer]
  );
};
`;

function buildDataTexture(buf: Uint8Array, width: number, height: number, isSRGB: boolean): THREE.DataTexture {
  const tex = new THREE.DataTexture(buf, width, height, THREE.RGBAFormat);
  tex.colorSpace = isSRGB ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

let earthWorkerJobCounter = 0;

async function createProceduralEarthTexturesAsync(
  restorationFactor: number,
  resolutionTier: 'standard' | 'high' | 'ultra',
  onProgress?: (pct: number, stage: string) => void,
  shouldAbort?: () => boolean
) {
  const width = resolutionTier === 'ultra' ? 2048 : resolutionTier === 'high' ? 1536 : 1024;
  const height = resolutionTier === 'ultra' ? 1024 : resolutionTier === 'high' ? 768 : 512;

  // Offload synthesis off the main thread via Web Worker for zero startup frame drops
  if (typeof Worker !== 'undefined') {
    const workerRes = await new Promise<{
      albedoTex: THREE.DataTexture;
      roughTex: THREE.DataTexture;
      normalTex: THREE.DataTexture;
      nightTex: THREE.DataTexture;
      cloudTex: THREE.DataTexture;
    } | null>((resolve) => {
      let blobUrl: string | null = null;
      let worker: Worker | null = null;
      const cleanup = () => {
        if (worker) {
          worker.terminate();
          worker = null;
        }
        if (blobUrl) {
          URL.revokeObjectURL(blobUrl);
          blobUrl = null;
        }
      };
      try {
        blobUrl = URL.createObjectURL(new Blob([EARTH_WORKER_SOURCE], { type: 'application/javascript' }));
        worker = new Worker(blobUrl);
        const jobId = ++earthWorkerJobCounter;
        const pollAbort = window.setInterval(() => {
          if (shouldAbort?.()) {
            window.clearInterval(pollAbort);
            cleanup();
            resolve(null);
          }
        }, 50);

        worker.onmessage = (ev) => {
          const msg = ev.data;
          if (!msg || msg.jobId !== jobId) return;
          if (msg.type === 'progress') {
            onProgress?.(msg.pct, msg.stage);
            return;
          }
          if (msg.type === 'done') {
            window.clearInterval(pollAbort);
            cleanup();
            if (shouldAbort?.()) {
              resolve(null);
              return;
            }
            onProgress?.(92, 'Uploading Planetary Surface Textures');
            resolve({
              albedoTex: buildDataTexture(new Uint8Array(msg.albedo), msg.width, msg.height, true),
              roughTex: buildDataTexture(new Uint8Array(msg.rough), msg.width, msg.height, false),
              normalTex: buildDataTexture(new Uint8Array(msg.normal), msg.width, msg.height, false),
              nightTex: buildDataTexture(new Uint8Array(msg.night), msg.width, msg.height, true),
              cloudTex: buildDataTexture(new Uint8Array(msg.cloud), msg.width, msg.height, true),
            });
          }
        };
        worker.onerror = () => {
          window.clearInterval(pollAbort);
          cleanup();
          resolve(null);
        };
        worker.postMessage({ jobId, width, height, restorationFactor });
      } catch {
        cleanup();
        resolve(null);
      }
    });

    if (workerRes || shouldAbort?.()) return workerRes;
  }

  // Time-budgeted main-thread fallback (<= 5ms per frame so UI never freezes)
  const total = width * height * 4;
  const data = new Uint8Array(total);
  const roughData = new Uint8Array(total);
  const normalData = new Uint8Array(total);
  const nightData = new Uint8Array(total);
  const cloudData = new Uint8Array(total);
  const elevGrid = new Float32Array(width * height);
  const yieldFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  let sliceStart = performance.now();

  for (let y = 0; y < height; y++) {
    const v = y / height;
    const lat = -90 + v * 180;
    const absLat = Math.abs(lat);
    const phi = (1 - v) * Math.PI;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const rowBlobs = CONTINENT_BLOBS.filter((b) => Math.abs(lat - b[0]) <= b[2] * 1.7 + 4.0);

    for (let x = 0; x < width; x++) {
      const u = x / width;
      const lng = u * 360 - 180;
      const theta = u * Math.PI * 2;
      const nx = sinPhi * Math.cos(theta);
      const ny = cosPhi;
      const nz = sinPhi * Math.sin(theta);

      const warpX = fbm3D(nx * 5.8 + 2.3, ny * 5.8 + 0.8, nz * 5.8 + 6.1, 3) - 0.5;
      const warpZ = fbm3D(nx * 5.8 + 7.9, ny * 5.8 + 4.4, nz * 5.8 + 1.5, 3) - 0.5;
      const n1 = fbm3D((nx + warpX * 0.14) * 3.8 + 1.4, ny * 3.8 + 2.1, (nz + warpZ * 0.14) * 3.8 + 0.7, 4);
      const n2 = fbm3D(nx * 12.5 + 4.2, ny * 12.5 + 1.3, nz * 12.5 + 5.1, 3);
      const micro = noise3D(nx * 32.0 + 1.1, ny * 32.0 + 3.7, nz * 32.0 + 8.3);
      const ridgeRaw = 1.0 - Math.abs(n2 * 2 - 1);
      const ridge = ridgeRaw * ridgeRaw;
      const latW = lat + warpX * 5.0;
      const lngW = lng + warpZ * 6.2;
      let mask = 0;
      for (let bi = 0; bi < rowBlobs.length; bi++) {
        const b = rowBlobs[bi];
        const dLat = (latW - b[0]) / b[2];
        let dLng = lngW - b[1];
        if (dLng > 180) dLng -= 360;
        if (dLng < -180) dLng += 360;
        dLng /= b[3];
        const d2 = dLat * dLat + dLng * dLng;
        if (d2 < 2.6) mask += b[4] * Math.exp(-d2 * 1.42);
      }
      const elevation = mask + (n1 - 0.48) * 0.54 + (n2 - 0.5) * 0.21 + ridge * 0.17 + (micro - 0.5) * 0.08;
      elevGrid[y * width + x] = elevation;

      const idx = (y * width + x) * 4;
      const iceThreshold = 71.5 + (1 - restorationFactor) * 4.2 + (n1 - 0.5) * 8 + (n2 - 0.5) * 6.5 + (micro - 0.5) * 4.5;
      let r = 0, g = 0, b = 0, rough = 180, cityGlow = 0;
      if (absLat > iceThreshold) {
        const crevasse = Math.max(0, Math.min(1, ridge * 0.8 + micro * 0.4));
        r = 220 + crevasse * 30; g = 234 + crevasse * 18; b = 248 + crevasse * 7; rough = 115 + micro * 36;
      } else if (elevation > 0.43) {
        const heightNorm = Math.min(1, (elevation - 0.43) / 0.76);
        const isAus = lat < -16 && lat > -32 && lng > 116 && lng < 144;
        const isSahara = lat > 14 && lat < 32 && lng > -16 && lng < 58;
        const desertBoost = isSahara ? 0.34 : isAus ? 0.28 : 0;
        const aridity = Math.max(0, (1 - Math.abs(absLat - 24) / 17) + desertBoost) * (1 - restorationFactor * 0.32);
        const eqRain = Math.max(0, 1 - absLat / 17) * (0.55 + n1 * 0.45);
        const boreal = Math.max(0, 1 - Math.abs(absLat - 59) / 13);
        const moisture = n2 * 0.55 + micro * 0.15 + restorationFactor * 0.36;
        if (heightNorm > 0.72) {
          const snow = Math.min(1, (heightNorm - 0.72) / 0.18);
          r = 122 + snow * 126; g = 126 + snow * 124; b = 134 + snow * 118; rough = 184 + (1 - snow) * 35;
        } else if (heightNorm > 0.49) {
          const strata = micro * 26;
          r = 92 + heightNorm * 44 + strata; g = 88 + heightNorm * 38 + strata * 0.9; b = 80 + heightNorm * 32 + strata * 0.8; rough = 238;
        } else if (aridity > 0.48 && moisture < 0.58) {
          const dune = Math.sin(nx * 40 + nz * 28 + n2 * 6) * 0.5 + 0.5;
          const redIron = isAus ? 24 : 0;
          r = 186 + redIron - restorationFactor * 18 + n2 * 20 + dune * 12;
          g = 146 - redIron * 0.6 - restorationFactor * 4 + n1 * 16 + dune * 8;
          b = 92 - redIron * 0.5 + n2 * 14; rough = 236;
        } else if (eqRain > 0.52 && moisture > 0.44) {
          const lush = Math.min(1, 0.52 + restorationFactor * 0.48);
          r = 24 * (1 - lush) + 14 * lush + micro * 15; g = 68 * (1 - lush) + 104 * lush + n1 * 22; b = 38 * (1 - lush) + 42 * lush + n2 * 10; rough = 212;
        } else if (boreal > 0.44) {
          r = 34 + micro * 18; g = 68 + restorationFactor * 34 + n1 * 18; b = 48 + n2 * 14; rough = 218;
        } else {
          const lush = Math.min(1, 0.42 + restorationFactor * 0.58);
          r = 68 * (1 - lush) + 22 * lush + n2 * 16 + micro * 10; g = 84 * (1 - lush) + 118 * lush + n1 * 22; b = 52 * (1 - lush) + 56 * lush + n2 * 12; rough = 214;
        }
        if (heightNorm < 0.25 && absLat < 60) {
          const coastalFactor = 1 - heightNorm / 0.25;
          const urbanCluster = fbm3D(nx * 22 + 8.1, ny * 22 + 3.4, nz * 22 + 9.2, 2);
          const urbanFine = noise3D(nx * 54 + 2.7, ny * 54 + 6.1, nz * 54 + 1.4);
          const cityScore = urbanCluster * 0.72 + urbanFine * 0.28 + coastalFactor * 0.09;
          if (cityScore > 0.65) cityGlow = Math.min(1, (cityScore - 0.65) * 6.0);
        }
      } else {
        const depth = Math.min(1, (0.43 - elevation) / 0.52);
        const shelf = Math.max(0, 1 - depth * 4.6);
        const shoal = Math.max(0, 1 - depth * 11.2);
        r = 3 + shelf * (12 + restorationFactor * 15) + shoal * 22 + (1 - restorationFactor) * 6;
        g = 20 + shelf * (76 + restorationFactor * 46) + shoal * 52 + (1 - depth) * 22;
        b = 62 + shelf * (88 + restorationFactor * 50) + shoal * 36 + restorationFactor * 38;
        rough = 24 + shoal * 20;
      }
      data[idx] = Math.min(255, Math.max(0, r));
      data[idx + 1] = Math.min(255, Math.max(0, g));
      data[idx + 2] = Math.min(255, Math.max(0, b));
      data[idx + 3] = 255;
      roughData[idx] = rough; roughData[idx + 1] = rough; roughData[idx + 2] = rough; roughData[idx + 3] = 255;
      nightData[idx] = cityGlow * (255 - micro * 28);
      nightData[idx + 1] = cityGlow * (178 + micro * 42);
      nightData[idx + 2] = cityGlow * (82 + micro * 65);
      nightData[idx + 3] = 255;
      const tradeWave = Math.sin(ny * 8.5 + n1 * 4.5) * 0.14;
      const cn = fbm3D(nx * 4.8 + tradeWave + 11.2, ny * 6.0 + 3.1, nz * 4.8 - tradeWave + 6.8, 3);
      const wisp = noise3D(nx * 16.0 + 3.4, ny * 16.0 + 7.2, nz * 16.0 + 1.9);
      const cloudVal = cn * 0.78 + wisp * 0.22;
      const cloudAlpha = Math.max(0, Math.min(255, (cloudVal - 0.485) * 680));
      cloudData[idx] = 240; cloudData[idx + 1] = 247; cloudData[idx + 2] = 255; cloudData[idx + 3] = cloudAlpha * 0.86;
    }

    if (performance.now() - sliceStart > 5) {
      onProgress?.(Math.round(10 + (y / height) * 68), 'Synthesizing Planetary Biome & Cloud Maps');
      await yieldFrame();
      if (shouldAbort?.()) return null;
      sliceStart = performance.now();
    }
  }

  const strength = 7.2;
  for (let y = 0; y < height; y++) {
    const ys = y > 0 ? y - 1 : 0;
    const yn = y < height - 1 ? y + 1 : height - 1;
    for (let x = 0; x < width; x++) {
      const xm = (x - 1 + width) % width;
      const xp = (x + 1) % width;
      const hL = Math.max(0.45, elevGrid[y * width + xm]);
      const hR = Math.max(0.45, elevGrid[y * width + xp]);
      const hN = Math.max(0.45, elevGrid[yn * width + x]);
      const hS = Math.max(0.45, elevGrid[ys * width + x]);
      let dx = (hL - hR) * strength;
      let dy = (hN - hS) * strength;
      let dz = 1.0;
      const invLen = 1 / Math.hypot(dx, dy, dz);
      dx *= invLen; dy *= invLen; dz *= invLen;
      const idx = (y * width + x) * 4;
      normalData[idx] = (dx * 0.5 + 0.5) * 255;
      normalData[idx + 1] = (dy * 0.5 + 0.5) * 255;
      normalData[idx + 2] = (dz * 0.5 + 0.5) * 255;
      normalData[idx + 3] = 255;
    }
    if (performance.now() - sliceStart > 5) {
      onProgress?.(Math.round(78 + (y / height) * 14), 'Baking Normal & Specular Glint Maps');
      await yieldFrame();
      if (shouldAbort?.()) return null;
      sliceStart = performance.now();
    }
  }

  return {
    albedoTex: buildDataTexture(data, width, height, true),
    roughTex: buildDataTexture(roughData, width, height, false),
    normalTex: buildDataTexture(normalData, width, height, false),
    nightTex: buildDataTexture(nightData, width, height, true),
    cloudTex: buildDataTexture(cloudData, width, height, true),
  };
}

function createSoftGlowSpriteTexture(innerColor: string, midColor: string) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, innerColor);
  grad.addColorStop(0.28, midColor);
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createAnamorphicFlareTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const hGrad = ctx.createLinearGradient(0, 32, 256, 32);
  hGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  hGrad.addColorStop(0.25, 'rgba(56, 189, 248, 0.24)');
  hGrad.addColorStop(0.46, 'rgba(186, 230, 253, 0.72)');
  hGrad.addColorStop(0.5, 'rgba(255, 252, 240, 1)');
  hGrad.addColorStop(0.54, 'rgba(186, 230, 253, 0.72)');
  hGrad.addColorStop(0.75, 'rgba(56, 189, 248, 0.24)');
  hGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = hGrad;
  ctx.fillRect(0, 0, 256, 64);

  // Vertical falloff mask so flare forms a sharp horizontal optical streak
  ctx.globalCompositeOperation = 'destination-in';
  const vGrad = ctx.createRadialGradient(128, 32, 1, 128, 32, 32);
  vGrad.addColorStop(0, 'rgba(255,255,255,1)');
  vGrad.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  vGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = vGrad;
  ctx.fillRect(0, 0, 256, 64);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const EarthCanvas: React.FC<EarthCanvasProps> = ({
  screenMode,
  missions,
  progress,
  globalProgressPct,
  selectedMissionId,
  divingMission = null,
  solarMode = 'auto',
  solarHour = 14.2,
  remotePlayers = [],
  selfPlayerId = null,
  sectorPings = [],
  onSelectMission,
  onQuickEnterMission,
  onHoverMission,
  onWebGLUnavailable,
  onLoadProgress,
  onSceneReady,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);

  const propsRef = useRef({
    screenMode,
    missions,
    progress,
    globalProgressPct,
    selectedMissionId,
    divingMission,
    solarMode,
    solarHour,
    remotePlayers,
    selfPlayerId,
    sectorPings,
    onSelectMission,
    onQuickEnterMission,
    onHoverMission,
    onWebGLUnavailable,
    onLoadProgress,
    onSceneReady,
  });
  propsRef.current = {
    screenMode,
    missions,
    progress,
    globalProgressPct,
    selectedMissionId,
    divingMission,
    solarMode,
    solarHour,
    remotePlayers,
    selfPlayerId,
    sectorPings,
    onSelectMission,
    onQuickEnterMission,
    onHoverMission,
    onWebGLUnavailable,
    onLoadProgress,
    onSceneReady,
  };

  const earthMatRef = useRef<THREE.MeshPhysicalMaterial | null>(null);
  const cloudsMatRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const cirrusMatRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const atmosMatRef = useRef<THREE.ShaderMaterial | null>(null);
  const atmosHaloMatRef = useRef<THREE.ShaderMaterial | null>(null);
  const nightTexRef = useRef<THREE.Texture | null>(null);
  const cloudTexRef = useRef<THREE.Texture | null>(null);
  const pulseTriggerRef = useRef<{ lat: number; lng: number; startedAt: number } | null>(null);
  const isSoftwareRef = useRef(false);
  const isDisposedRef = useRef(false);
  const resumeTickRef = useRef<(() => void) | null>(null);
  const markerGroupsRef = useRef<
    Map<
      string,
      {
        group: THREE.Group;
        beacon: THREE.Mesh;
        ring: THREE.Mesh;
        hitbox: THREE.Mesh;
        mission: MissionDefinition;
      }
    >
  >(new Map());
  const cameraTargetGoalRef = useRef<THREE.Vector3 | null>(null);
  const lastTextureBucketRef = useRef<number>(-1);

  // Resume EarthCanvas loop immediately whenever returning from a full-screen mission or Space Academy
  useEffect(() => {
    if (screenMode !== 'mission-active' && screenMode !== 'space-academy') {
      resumeTickRef.current?.();
    }
  }, [screenMode]);

  // Dynamically update Earth textures & marker colors when restoration progress changes
  useEffect(() => {
    const bucket = Math.round(globalProgressPct / 15);
    let cancelled = false;
    if (earthMatRef.current && bucket !== lastTextureBucketRef.current) {
      lastTextureBucketRef.current = bucket;
      const factor = Math.min(1, globalProgressPct / 100);
      const tier = isSoftwareRef.current
        ? 'standard'
        : progress.settings.graphicsQuality === 'high'
        ? 'high'
        : 'ultra';

      createProceduralEarthTexturesAsync(
        factor,
        tier,
        undefined,
        () => cancelled || isDisposedRef.current
      ).then((res) => {
        if (!res || cancelled || isDisposedRef.current || !earthMatRef.current) {
          res?.albedoTex.dispose();
          res?.roughTex.dispose();
          res?.normalTex.dispose();
          res?.nightTex.dispose();
          res?.cloudTex.dispose();
          return;
        }
        const { albedoTex, roughTex, normalTex, nightTex, cloudTex } = res;
        const maxAniso = earthMatRef.current.userData.maxAniso || 4;
        albedoTex.anisotropy = maxAniso;
        normalTex.anisotropy = maxAniso;

        const oldMap = earthMatRef.current.map;
        const oldRough = earthMatRef.current.roughnessMap;
        const oldNormal = earthMatRef.current.normalMap;
        const oldNight = nightTexRef.current;

        earthMatRef.current.map = albedoTex;
        earthMatRef.current.roughnessMap = roughTex;
        earthMatRef.current.normalMap = normalTex;
        nightTexRef.current = nightTex;
        cloudTexRef.current = cloudTex;
        if (earthMatRef.current.userData.shader) {
          earthMatRef.current.userData.shader.uniforms.uNightMap.value = nightTex;
          earthMatRef.current.userData.shader.uniforms.uCloudMap.value = cloudTex;
          earthMatRef.current.userData.shader.uniforms.uRestoration.value = factor;
        }
        earthMatRef.current.needsUpdate = true;

        oldMap?.dispose();
        oldRough?.dispose();
        oldNormal?.dispose();
        oldNight?.dispose();

        if (cloudsMatRef.current) {
          const oldCloud = cloudsMatRef.current.map;
          cloudsMatRef.current.map = cloudTex;
          cloudsMatRef.current.bumpMap = cloudTex;
          cloudsMatRef.current.needsUpdate = true;
          if (cirrusMatRef.current) {
            cirrusMatRef.current.map = cloudTex;
            cirrusMatRef.current.needsUpdate = true;
          }
          oldCloud?.dispose();
        } else {
          cloudTex.dispose();
        }
      });
    }

    return () => {
      cancelled = true;
    };
  }, [globalProgressPct, progress.settings.graphicsQuality]);

  useEffect(() => {

    if (atmosMatRef.current) {
      const factor = Math.min(1, globalProgressPct / 100);
      atmosMatRef.current.uniforms.uRestoration.value = factor;
    }
    if (atmosHaloMatRef.current) {
      const factor = Math.min(1, globalProgressPct / 100);
      atmosHaloMatRef.current.uniforms.uRestoration.value = factor;
    }

    markerGroupsRef.current.forEach((entry) => {
      const { mission, beacon, ring } = entry;
      const completed = progress.completedMissionIds.includes(mission.id);
      const { unlocked } = isMissionUnlocked(mission, progress, globalProgressPct);
      const isSelected = selectedMissionId === mission.id;

      let hex = 0xef4444;
      if (completed) {
        hex = 0x10b981;
      } else if (!unlocked) {
        hex = 0xf59e0b;
      } else if (mission.category === 'space-academy' || mission.category === 'final-space') {
        hex = 0x38bdf8;
      } else if (mission.category === 'secret-global') {
        hex = 0xa855f7;
      }

      const bMat = beacon.material as THREE.MeshStandardMaterial;
      const rMat = ring.material as THREE.MeshBasicMaterial;
      bMat.color.setHex(hex);
      bMat.emissive.setHex(hex);
      bMat.emissiveIntensity = isSelected ? 2.2 : 1.35;
      rMat.color.setHex(hex);
    });
  }, [progress, globalProgressPct, selectedMissionId]);

  useEffect(() => {
    if (!selectedMissionId || screenMode === 'opening') return;
    const m = missions.find((item) => item.id === selectedMissionId);
    if (!m) return;
    cameraTargetGoalRef.current = latLngToVector3(m.lat, m.lng, 3.85);
    pulseTriggerRef.current = { lat: m.lat, lng: m.lng, startedAt: performance.now() };
  }, [selectedMissionId, missions, screenMode]);

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
    isSoftwareRef.current = isSoftwareGl;
    isDisposedRef.current = false;
    propsRef.current.onLoadProgress?.(4, 'Initializing WebGL2 Planetary Pipeline');

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
        alpha: false,
      });
    } catch {
      propsRef.current.onWebGLUnavailable?.();
      return;
    }

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    const pixelRatio = isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.78;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const onContextLost = (e: Event) => e.preventDefault();
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x01030a);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 260);
    if (propsRef.current.screenMode === 'opening') {
      // Start slightly wider & higher for a smooth cinematic fly-in on boot reveal
      camera.position.set(-2.1, 1.25, 9.6);
    } else {
      camera.position.set(0, 1.55, 5.6);
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.055;
    controls.enablePan = false;
    controls.minDistance = 1.95;
    controls.maxDistance = 12.5;
    controls.rotateSpeed = 0.65;
    controls.zoomSpeed = 0.8;
    controls.addEventListener('start', () => {
      cameraTargetGoalRef.current = null;
    });

    // Post-processing Pipeline: 4x MSAA HDR RenderTarget -> Optical Bloom -> ACES Output -> Cinematic Color Grading -> Film Grain
    let composerTarget: THREE.WebGLRenderTarget | null = null;
    let composer: EffectComposer | null = null;
    let bloomPass: UnrealBloomPass | null = null;
    let colorGradePass: ShaderPass | null = null;
    let filmPass: FilmPass | null = null;

    if (!isSoftwareGl) {
      const msaaSamples = propsRef.current.progress.settings.graphicsQuality === 'high' ? 0 : 2;
      composerTarget = new THREE.WebGLRenderTarget(
        Math.max(1, Math.floor(width * pixelRatio)),
        Math.max(1, Math.floor(height * pixelRatio)),
        {
          samples: msaaSamples,
          type: THREE.HalfFloatType,
        }
      );
      composer = new EffectComposer(renderer, composerTarget);
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);
      composer.addPass(new RenderPass(scene, camera));

      // 1. Optical Bloom for subtle solar corona, city lights & beacons
      bloomPass = new UnrealBloomPass(
        new THREE.Vector2(width, height),
        0.26,
        0.46,
        0.82
      );
      composer.addPass(bloomPass);

      // 2. ACES / SRGB Output before SDR color grading & film grain
      composer.addPass(new OutputPass());

      // 3. Cinematic Color Grading + Subtle Lens Vignette
      const CinematicGradeShader = {
        uniforms: {
          tDiffuse: { value: null },
          uContrast: { value: 1.1 },
          uSaturation: { value: 1.14 },
          uVignetteDarkness: { value: 0.48 },
          uVignetteOffset: { value: 1.05 },
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
          uniform float uContrast;
          uniform float uSaturation;
          uniform float uVignetteDarkness;
          uniform float uVignetteOffset;
          varying vec2 vUv;

          void main() {
            vec4 texel = texture2D(tDiffuse, vUv);
            vec3 col = texel.rgb;

            col = (col - 0.5) * uContrast + 0.5;
            col = clamp(col, 0.0, 1.0);

            float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
            col = mix(vec3(luma), col, uSaturation);

            vec3 shadowTint = vec3(0.015, 0.038, 0.085);
            vec3 highlightTint = vec3(1.03, 1.0, 0.96);
            col = mix(col + shadowTint * (1.0 - smoothstep(0.0, 0.35, luma)), col * highlightTint, smoothstep(0.45, 1.0, luma));

            vec2 uv = (vUv - 0.5) * vec2(uVignetteOffset);
            float vig = smoothstep(0.92, 0.25, dot(uv, uv));
            col *= mix(1.0 - uVignetteDarkness, 1.0, vig);

            gl_FragColor = vec4(clamp(col, 0.0, 1.0), texel.a);
          }
        `,
      };
      colorGradePass = new ShaderPass(CinematicGradeShader);
      composer.addPass(colorGradePass);

      // 4. Subtle Cinematic Film Grain
      filmPass = new FilmPass(0.14, false);
      composer.addPass(filmPass);
    }

    // Deep-Space Milky Way & Cosmic Dust Dome (procedural GLSL backdrop, low exposure)
    const skyDomeGeo = new THREE.SphereGeometry(165, 48, 32);
    const skyDomeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec3 vDir;

        float hash31(vec3 p) {
          p = fract(p * 0.1031);
          p += dot(p, p.yzx + 33.33);
          return fract((p.x + p.y) * p.z);
        }

        float noise3(vec3 p) {
          vec3 i = floor(p);
          vec3 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(hash31(i), hash31(i + vec3(1,0,0)), f.x),
                mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
            mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
                mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y),
            f.z
          );
        }

        float fbmSky(vec3 p) {
          float v = 0.0;
          float a = 0.55;
          for (int i = 0; i < 2; i++) {
            v += a * noise3(p);
            p *= 2.15;
            a *= 0.45;
          }
          return v;
        }

        void main() {
          vec3 d = normalize(vDir);
          // Tilted galactic plane normal
          vec3 galNormal = normalize(vec3(0.32, 0.82, -0.48));
          float planeDist = abs(dot(d, galNormal));
          float milkyBand = exp(-planeDist * planeDist * 14.0);

          float dust = fbmSky(d * 3.8 + vec3(0.0, uTime * 0.004, 0.0));
          float rift = fbmSky(d * 8.2 - vec3(1.4, 2.7, 0.5));
          float density = milkyBand * smoothstep(0.32, 0.78, dust) * (1.0 - smoothstep(0.48, 0.76, rift) * 0.65);

          vec3 baseVoid = vec3(0.005, 0.011, 0.026);
          vec3 nebCyan = vec3(0.03, 0.095, 0.19);
          vec3 nebIndigo = vec3(0.06, 0.04, 0.15);
          vec3 coreWarm = vec3(0.16, 0.10, 0.06);

          vec3 col = baseVoid;
          col += mix(nebIndigo, nebCyan, dust) * density * 0.85;
          float coreMask = max(0.0, dot(d, normalize(vec3(-0.62, 0.12, -0.77))));
          col += coreWarm * pow(coreMask, 6.0) * milkyBand * 0.55;

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const skyDome = new THREE.Mesh(skyDomeGeo, skyDomeMat);
    scene.add(skyDome);

    // Dynamic Solar Direction Vector for live Day/Night Terminator Cycle
    const liveSunDir = new THREE.Vector3(0.55, 0.22, -0.80).normalize();

    // Balanced Dimmed Planetary Lighting Rig (natural deep space contrast)
    const hemiLight = new THREE.HemisphereLight(0x60a5fa, 0x020611, 0.18);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xfff8ed, 2.05);
    sunLight.position.copy(liveSunDir).multiplyScalar(28);
    scene.add(sunLight);

    const earthshineLight = new THREE.DirectionalLight(0x3b82f6, 0.22);
    earthshineLight.position.copy(liveSunDir).multiplyScalar(-18);
    scene.add(earthshineLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.48);
    rimLight.position.set(-liveSunDir.z * 16, 10, liveSunDir.x * 16);
    scene.add(rimLight);

    // Background 3D Sun Sphere positioned close to Earth's orbital neighborhood
    const SUN_DISTANCE = 16.0;
    const sunGroup = new THREE.Group();
    sunGroup.position.copy(liveSunDir).multiplyScalar(SUN_DISTANCE);
    scene.add(sunGroup);

    const sunSphereGeo = new THREE.SphereGeometry(1.65, 48, 48);
    const sunSphereMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vObjPos;
        varying vec3 vViewPos;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vObjPos = normalize(position);
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vViewPos = -mvPos.xyz;
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec3 vNormal;
        varying vec3 vObjPos;
        varying vec3 vViewPos;

        float hash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }

        float noise(vec3 x) {
          vec3 i = floor(x);
          vec3 f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
            mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
            f.z
          );
        }

        void main() {
          vec3 p = vObjPos * 5.2 + vec3(uTime * 0.16, -uTime * 0.11, uTime * 0.09);
          float turb = noise(p) * 0.6 + noise(p * 2.3) * 0.28 + noise(p * 4.8) * 0.12;
          float ndotv = max(0.0, dot(normalize(vNormal), normalize(vViewPos)));
          float limb = pow(ndotv, 0.55);

          vec3 coreCol = vec3(1.12, 0.96, 0.72);
          vec3 midCol = vec3(1.02, 0.64, 0.22);
          vec3 edgeCol = vec3(0.88, 0.30, 0.08);
          vec3 col = mix(edgeCol, midCol, smoothstep(0.15, 0.65, limb));
          col = mix(col, coreCol, smoothstep(0.45, 0.95, limb * (0.72 + turb * 0.55)));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const sunMesh = new THREE.Mesh(sunSphereGeo, sunSphereMat);
    sunGroup.add(sunMesh);

    // Animated Volumetric Solar Corona Plasma Shell + Precessing Prominence Loops
    const sunCoronaGeo = new THREE.SphereGeometry(2.15, 48, 48);
    const sunCoronaMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vObjPos;
        varying vec3 vViewPos;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vObjPos = normalize(position);
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vViewPos = -mvPos.xyz;
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec3 vNormal;
        varying vec3 vObjPos;
        varying vec3 vViewPos;
        void main() {
          float ndotv = abs(dot(normalize(vNormal), normalize(vViewPos)));
          float rim = pow(clamp(1.0 - ndotv, 0.0, 1.0), 1.65);
          float streamerA = 0.5 + 0.5 * sin(vObjPos.x * 9.0 + vObjPos.y * 12.0 - uTime * 2.1);
          float streamerB = 0.5 + 0.5 * cos(vObjPos.z * 11.0 - vObjPos.x * 7.0 + uTime * 1.6);
          float flare = smoothstep(0.25, 0.95, streamerA * streamerB);
          vec3 col = mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.88, 0.55), flare);
          float alpha = rim * (0.24 + flare * 0.42);
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const sunCoronaMesh = new THREE.Mesh(sunCoronaGeo, sunCoronaMat);
    sunGroup.add(sunCoronaMesh);

    const sunProminenceGeo = new THREE.TorusGeometry(1.92, 0.032, 10, 64);
    const sunProminenceMat = new THREE.MeshBasicMaterial({
      color: 0xfb923c,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sunProm1 = new THREE.Mesh(sunProminenceGeo, sunProminenceMat);
    sunProm1.rotation.set(0.65, 0.4, 0.2);
    const sunProm2 = new THREE.Mesh(sunProminenceGeo, sunProminenceMat);
    sunProm2.rotation.set(-0.5, 1.1, 0.85);
    sunGroup.add(sunProm1, sunProm2);

    const sunTex = createSoftGlowSpriteTexture('rgba(255,236,190,0.85)', 'rgba(255,180,90,0.38)');
    const sunSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: sunTex,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        opacity: 0.78,
      })
    );
    sunSprite.scale.set(7.2, 7.2, 1);
    sunGroup.add(sunSprite);

    const sunHaloTex = createSoftGlowSpriteTexture('rgba(255,200,125,0.3)', 'rgba(56,189,248,0.08)');
    const sunHaloSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: sunHaloTex,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        opacity: 0.48,
      })
    );
    sunHaloSprite.scale.set(13.5, 13.5, 1);
    sunGroup.add(sunHaloSprite);

    const sunStreakTex = createAnamorphicFlareTexture();
    const sunStreakSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: sunStreakTex,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        opacity: 0.42,
      })
    );
    sunStreakSprite.scale.set(18.5, 1.55, 1);
    sunGroup.add(sunStreakSprite);

    // Crisp circular star sprites (diverse Planck colors)
    const starTex = createSoftGlowSpriteTexture('rgba(255,255,255,1)', 'rgba(180,220,255,0.4)');
    const starCount = propsRef.current.progress.settings.highDetailParticles ? 2600 : 1200;
    const starPos = new Float32Array(starCount * 3);
    const starCol = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 36 + Math.random() * 100;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      starPos[i * 3 + 2] = r * Math.cos(phi);

      const tint = Math.random();
      if (tint > 0.86) {
        starCol[i * 3] = 0.62;
        starCol[i * 3 + 1] = 0.85;
        starCol[i * 3 + 2] = 1.0;
      } else if (tint > 0.72) {
        starCol[i * 3] = 1.0;
        starCol[i * 3 + 1] = 0.88;
        starCol[i * 3 + 2] = 0.68;
      } else {
        starCol[i * 3] = 0.94;
        starCol[i * 3 + 1] = 0.97;
        starCol[i * 3 + 2] = 1.0;
      }
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(starCol, 3));
    const starMat = new THREE.PointsMaterial({
      size: 0.36,
      map: starTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    // Distant Spiral Galaxy Nebula
    const galCount = 1100;
    const galPos = new Float32Array(galCount * 3);
    const galCol = new Float32Array(galCount * 3);
    for (let i = 0; i < galCount; i++) {
      const arm = i % 2;
      const radius = 1.4 + Math.pow(Math.random(), 0.8) * 18;
      const angle = radius * 0.42 + arm * Math.PI + (Math.random() - 0.5) * 0.7;
      galPos[i * 3] = Math.cos(angle) * radius - 30;
      galPos[i * 3 + 1] = (Math.random() - 0.5) * 1.6 + 15;
      galPos[i * 3 + 2] = Math.sin(angle) * radius - 52;
      galCol[i * 3] = 0.25 + Math.random() * 0.25;
      galCol[i * 3 + 1] = 0.62 + Math.random() * 0.32;
      galCol[i * 3 + 2] = 1.0;
    }
    const galGeo = new THREE.BufferGeometry();
    galGeo.setAttribute('position', new THREE.BufferAttribute(galPos, 3));
    galGeo.setAttribute('color', new THREE.BufferAttribute(galCol, 3));
    const galMat = new THREE.PointsMaterial({
      size: 0.45,
      map: starTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const galaxy = new THREE.Points(galGeo, galMat);
    galaxy.rotation.x = 0.55;
    galaxy.rotation.z = -0.35;
    scene.add(galaxy);

    // Deep-Space Animated Shooting Star / Meteor Streaks
    interface MeteorStreak {
      line: THREE.Line;
      geo: THREE.BufferGeometry;
      mat: THREE.LineBasicMaterial;
      origin: THREE.Vector3;
      dir: THREE.Vector3;
      length: number;
      speed: number;
      cooldown: number;
      life: number;
      maxLife: number;
    }
    const meteors: MeteorStreak[] = [];
    for (let i = 0; i < 4; i++) {
      const mGeo = new THREE.BufferGeometry();
      const mPos = new Float32Array(6);
      mGeo.setAttribute('position', new THREE.BufferAttribute(mPos, 3));
      const mMat = new THREE.LineBasicMaterial({
        color: i % 2 === 0 ? 0xbae6fd : 0xe0f2fe,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mLine = new THREE.Line(mGeo, mMat);
      scene.add(mLine);
      const origin = new THREE.Vector3(
        (Math.random() - 0.5) * 44,
        (Math.random() - 0.5) * 26,
        -22 - Math.random() * 26
      );
      const dir = new THREE.Vector3(
        (Math.random() > 0.5 ? 1 : -1) * (0.6 + Math.random() * 0.6),
        -0.35 - Math.random() * 0.45,
        (Math.random() - 0.5) * 0.4
      ).normalize();
      meteors.push({
        line: mLine,
        geo: mGeo,
        mat: mMat,
        origin,
        dir,
        length: 2.2 + Math.random() * 1.8,
        speed: 22 + Math.random() * 12,
        cooldown: i * 2.4 + Math.random() * 2,
        life: 0,
        maxLife: 0.75 + Math.random() * 0.45,
      });
    }

    // Realistic 23.44° Earth Axial Tilt Pivot + Spinning Earth Root Group
    const axialTiltGroup = new THREE.Group();
    axialTiltGroup.rotation.z = THREE.MathUtils.degToRad(23.44);
    scene.add(axialTiltGroup);

    const earthRoot = new THREE.Group();
    axialTiltGroup.add(earthRoot);

    const EARTH_RADIUS = 1.22; // -25% smaller Earth scale for crisp orbital framing with Sun & Moon
    const initialFactor = Math.min(1, propsRef.current.globalProgressPct / 100);
    lastTextureBucketRef.current = Math.round(propsRef.current.globalProgressPct / 15);
    const maxAniso = renderer.capabilities.getMaxAnisotropy();

    // Instant lightweight 1x1 placeholders replaced smoothly as soon as async Ultra-HD textures finish
    const placeholderTex = new THREE.DataTexture(new Uint8Array([8, 22, 48, 255]), 1, 1);
    placeholderTex.needsUpdate = true;

    // Photorealistic Earth Surface with Day/Night City Lights, Parallax Cloud Shadows, Fresnel Ocean Sun Glint & Lightning
    const earthGeo = new THREE.SphereGeometry(EARTH_RADIUS, 80, 64);
    const earthMat = new THREE.MeshPhysicalMaterial({
      map: placeholderTex,
      roughnessMap: placeholderTex,
      normalMap: placeholderTex,
      normalScale: new THREE.Vector2(2.35, 2.35),
      roughness: 0.88,
      metalness: 0.04,
      clearcoat: 0.3,
      clearcoatRoughness: 0.16,
    });
    earthMat.userData.maxAniso = maxAniso;

    earthMat.onBeforeCompile = (shader) => {
      shader.uniforms.uSunDir = { value: liveSunDir };
      shader.uniforms.uNightMap = { value: nightTexRef.current ?? placeholderTex };
      shader.uniforms.uCloudMap = { value: cloudTexRef.current ?? placeholderTex };
      shader.uniforms.uRestoration = { value: initialFactor };
      shader.uniforms.uTime = { value: 0 };
      earthMat.userData.shader = shader;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vWorldNormalEarth;
          varying vec3 vWorldPosEarth;`
        )
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vWorldNormalEarth = normalize(mat3(modelMatrix) * objectNormal);
          vWorldPosEarth = (modelMatrix * vec4(transformed, 1.0)).xyz;`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform vec3 uSunDir;
          uniform sampler2D uNightMap;
          uniform sampler2D uCloudMap;
          uniform float uRestoration;
          uniform float uTime;
          varying vec3 vWorldNormalEarth;
          varying vec3 vWorldPosEarth;`
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          vec3 nEarth = normalize(vWorldNormalEarth);
          vec3 sDir = normalize(uSunDir);
          float sunLitFactor = smoothstep(-0.08, 0.25, dot(nEarth, sDir));
          vec2 cloudShadowUv = vMapUv + vec2(uTime * 0.0022, 0.0) - vec2(sDir.x, sDir.y) * 0.0045;
          float cloudCover = texture2D(uCloudMap, cloudShadowUv).a;
          diffuseColor.rgb *= (1.0 - cloudCover * 0.42 * sunLitFactor);`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          float isOceanSurface = step(roughnessFactor, 0.35);
          if (roughnessFactor < 0.35) {
            float oceanWave = sin(vMapUv.x * 260.0 + uTime * 2.2) * cos(vMapUv.y * 140.0 - uTime * 1.6);
            roughnessFactor = clamp(roughnessFactor + oceanWave * 0.042, 0.06, 0.4);
          }`
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          vec3 worldN = normalize(vWorldNormalEarth);
          vec3 sunV = normalize(uSunDir);
          float sunDot = dot(worldN, sunV);
          float nightMask = smoothstep(0.12, -0.22, sunDot);
          vec3 cityLights = texture2D(uNightMap, vMapUv).rgb;
          float cityPulse = 0.92 + 0.08 * sin(vMapUv.x * 380.0 + vMapUv.y * 210.0 + uTime * 2.4);
          totalEmissiveRadiance += cityLights * nightMask * cityPulse * (1.28 + uRestoration * 0.48);

          // Fresnel Ocean Specular Sun Glint on cloud-free sunlit water
          vec3 viewVecEarth = normalize(cameraPosition - vWorldPosEarth);
          vec3 halfVecEarth = normalize(sunV + viewVecEarth);
          float fresnelOcean = pow(1.0 - max(0.0, dot(worldN, viewVecEarth)), 3.0);
          float specGlint = pow(max(0.0, dot(worldN, halfVecEarth)), 96.0);
          vec2 glintCloudUv = vMapUv + vec2(uTime * 0.0022, 0.0);
          float glintCloudMask = 1.0 - texture2D(uCloudMap, glintCloudUv).a * 0.78;
          totalEmissiveRadiance += vec3(1.0, 0.89, 0.72) * specGlint * (0.28 + fresnelOcean * 0.72) * isOceanSurface * smoothstep(0.02, 0.35, sunDot) * glintCloudMask * 0.56;

          // High-altitude convective storm lightning micro-flashes on the night side
          vec2 stormUv = vMapUv + vec2(uTime * 0.0022, 0.0);
          float stormCloud = texture2D(uCloudMap, stormUv).a;
          float stormCell = sin(stormUv.x * 95.0 + uTime * 0.7) * cos(stormUv.y * 65.0 - uTime * 0.5);
          float flashGate = pow(max(0.0, sin(uTime * 7.3 + stormUv.x * 41.0 + stormUv.y * 29.0)), 18.0);
          float lightning = smoothstep(0.56, 0.82, stormCloud) * smoothstep(0.55, 0.95, stormCell) * flashGate * nightMask;
          totalEmissiveRadiance += vec3(0.55, 0.80, 1.0) * lightning * 2.1;

          // Warm atmospheric twilight scatter along the terminator
          float twilight = exp(-pow(sunDot * 5.8, 2.0)) * 0.2;
          totalEmissiveRadiance += vec3(0.95, 0.38, 0.12) * twilight;`
        );
    };

    earthMatRef.current = earthMat;
    const earthMesh = new THREE.Mesh(earthGeo, earthMat);
    earthRoot.add(earthMesh);

    // Volumetric-look Bump-Mapped Primary Cloud Layer + Upper Parallax Cirrus Jetstream Shell
    const cloudGeo = new THREE.SphereGeometry(EARTH_RADIUS * 1.013, 64, 48);
    const cloudMat = new THREE.MeshStandardMaterial({
      map: placeholderTex,
      bumpMap: placeholderTex,
      bumpScale: 0.016,
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
      roughness: 0.92,
      metalness: 0.0,
    });
    cloudsMatRef.current = cloudMat;
    const cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
    earthRoot.add(cloudMesh);

    const cirrusGeo = new THREE.SphereGeometry(EARTH_RADIUS * 1.021, 48, 36);
    const cirrusMat = new THREE.MeshStandardMaterial({
      map: placeholderTex,
      color: 0xe0f2fe,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      roughness: 0.95,
      metalness: 0.0,
    });
    cirrusMatRef.current = cirrusMat;
    const cirrusMesh = new THREE.Mesh(cirrusGeo, cirrusMat);
    cirrusMesh.rotation.y = 1.85;
    cirrusMesh.rotation.x = 0.09;
    earthRoot.add(cirrusMesh);

    // 1. Inner Rayleigh Limb Blue Haze Shader (aerial perspective over Earth's horizon)
    const atmosGeo = new THREE.SphereGeometry(EARTH_RADIUS * 1.028, 48, 36);
    const atmosMat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: liveSunDir },
        uRestoration: { value: initialFactor },
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vWorldNormal;
        varying vec3 vViewPos;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vViewPos = -mvPos.xyz;
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform vec3 uSunDir;
        uniform float uRestoration;
        uniform float uTime;
        varying vec3 vNormal;
        varying vec3 vWorldNormal;
        varying vec3 vViewPos;
        void main() {
          vec3 viewDir = normalize(vViewPos);
          vec3 n = normalize(vNormal);
          float rim = 1.0 - max(0.0, dot(viewDir, n));
          float limbHaze = pow(rim, 2.85);
          float coreMist = pow(rim, 1.6) * 0.08;

          float sunDot = dot(normalize(vWorldNormal), normalize(uSunDir));
          float daySide = smoothstep(-0.28, 0.55, sunDot);
          float nightSide = smoothstep(0.25, -0.45, sunDot);
          float sunsetBand = exp(-pow(sunDot * 4.4, 2.0));

          vec3 rayleighBlue = mix(vec3(0.24, 0.58, 1.0), vec3(0.18, 0.78, 1.0), uRestoration);
          vec3 deepAzure = vec3(0.10, 0.36, 0.88);
          vec3 sunsetCol = vec3(1.0, 0.48, 0.16);
          vec3 col = mix(deepAzure, rayleighBlue, smoothstep(0.2, 0.9, rim));
          col = mix(col, sunsetCol, sunsetBand * 0.46);

          // Multi-band flowing polar aurora curtains (emerald core + violet upper rim)
          float polar = smoothstep(0.64, 0.91, abs(vWorldNormal.y));
          float curtainA = 0.5 + 0.5 * sin(vWorldNormal.x * 14.0 + vWorldNormal.z * 9.0 + uTime * 2.1);
          float curtainB = 0.5 + 0.5 * cos(vWorldNormal.z * 16.0 - vWorldNormal.x * 7.0 - uTime * 1.45);
          float auroraEnergy = polar * curtainA * (0.45 + 0.55 * curtainB) * (0.35 + 0.65 * nightSide);
          vec3 aurora = mix(vec3(0.08, 0.96, 0.56), vec3(0.45, 0.35, 0.98), curtainB * 0.42) * auroraEnergy * (0.35 + uRestoration * 0.72);

          float alpha = (limbHaze * 0.68 + coreMist * 0.75) * (0.14 + daySide * 0.86) + auroraEnergy * limbHaze * 0.45;
          gl_FragColor = vec4(col + aurora, clamp(alpha, 0.0, 0.76));
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
      depthWrite: false,
    });
    atmosMatRef.current = atmosMat;
    const atmosMesh = new THREE.Mesh(atmosGeo, atmosMat);
    atmosMesh.renderOrder = 2;
    earthRoot.add(atmosMesh);

    // 2. Outer Exosphere Limb Glow Halo (BackSide Rayleigh scattering fading organically into space)
    const atmosHaloGeo = new THREE.SphereGeometry(EARTH_RADIUS * 1.145, 48, 36);
    const atmosHaloMat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: liveSunDir },
        uRestoration: { value: initialFactor },
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vWorldNormal;
        varying vec3 vViewPos;
        varying vec3 vWorldViewDir;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldViewDir = normalize(cameraPosition - worldPos.xyz);
          vec4 mvPos = viewMatrix * worldPos;
          vViewPos = -mvPos.xyz;
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform vec3 uSunDir;
        uniform float uRestoration;
        uniform float uTime;
        varying vec3 vNormal;
        varying vec3 vWorldNormal;
        varying vec3 vViewPos;
        varying vec3 vWorldViewDir;
        void main() {
          vec3 viewDir = normalize(vViewPos);
          // Back-face view angle: 0.0 at outer edge of halo sphere, ~0.488 right against Earth's limb
          float backDot = max(0.0, dot(viewDir, -normalize(vNormal)));
          float limbFalloff = pow(clamp(backDot / 0.488, 0.0, 1.0), 3.4);

          float sunDot = dot(normalize(vWorldNormal), normalize(uSunDir));
          float daySide = smoothstep(-0.32, 0.58, sunDot);
          float nightSide = smoothstep(0.22, -0.45, sunDot);
          float sunsetBand = exp(-pow(sunDot * 4.2, 2.0));

          // Mie forward scatter glow brightens the limb along the sunward horizon
          float mieGlare = pow(max(0.0, dot(-normalize(vWorldViewDir), normalize(uSunDir))), 4.0) * 0.24;

          vec3 hazeBlue = mix(vec3(0.20, 0.54, 0.98), vec3(0.16, 0.76, 1.0), uRestoration);
          vec3 sunsetCol = vec3(1.0, 0.46, 0.18);
          vec3 col = mix(hazeBlue, sunsetCol, sunsetBand * 0.42) + vec3(0.55, 0.80, 1.0) * mieGlare;

          float polar = smoothstep(0.66, 0.92, abs(vWorldNormal.y));
          float auroraWave = 0.5 + 0.5 * sin(vWorldNormal.x * 13.0 - uTime * 1.9);
          vec3 aurora = vec3(0.08, 0.94, 0.58) * polar * auroraWave * nightSide * (0.28 + uRestoration * 0.55);

          float alpha = limbFalloff * (0.08 + daySide * 0.64) + polar * limbFalloff * nightSide * 0.2;
          gl_FragColor = vec4(col + aurora, clamp(alpha, 0.0, 0.72));
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
    });
    atmosHaloMatRef.current = atmosHaloMat;
    const atmosHaloMesh = new THREE.Mesh(atmosHaloGeo, atmosHaloMat);
    atmosHaloMesh.renderOrder = 3;
    earthRoot.add(atmosHaloMesh);

    // Orbital Telemetry Ring + Detailed 6-Part Space Academy Zenith Station
    const orbitRingGeo = new THREE.TorusGeometry(EARTH_RADIUS * 1.42, 0.004, 8, 128);
    const orbitRingMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.22,
    });
    const orbitRing = new THREE.Mesh(orbitRingGeo, orbitRingMat);
    orbitRing.rotation.x = Math.PI * 0.42;
    orbitRing.rotation.y = 0.25;
    earthRoot.add(orbitRing);

    const stationGroup = new THREE.Group();
    const metalMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.9, roughness: 0.2 });
    const trussMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.85, roughness: 0.35 });
    const solarMat = new THREE.MeshStandardMaterial({
      color: 0x0369a1,
      metalness: 0.75,
      roughness: 0.18,
      emissive: 0x0284c7,
      emissiveIntensity: 0.25,
    });
    const coreHub = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.18, 14), metalMat);
    const truss = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.015, 0.015), trussMat);
    const wing1 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.006, 0.075), solarMat);
    wing1.position.set(-0.17, 0, 0.05);
    const wing2 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.006, 0.075), solarMat);
    wing2.position.set(0.17, 0, -0.05);
    const ringDock = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.01, 10, 24), metalMat);
    const navBeaconMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const navBeacon = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 8), navBeaconMat);
    navBeacon.position.y = 0.1;
    stationGroup.add(coreHub, truss, wing1, wing2, ringDock, navBeacon);
    stationGroup.scale.setScalar(0.82);
    stationGroup.position.set(EARTH_RADIUS * 1.42, 0, 0);
    orbitRing.add(stationGroup);

    // Twin LEO Eco-Telemetry Satellites with Active Downward Scan Cones
    const satOrbit1 = new THREE.Group();
    satOrbit1.rotation.set(0.95, 0.3, -0.4);
    const satOrbit2 = new THREE.Group();
    satOrbit2.rotation.set(-0.72, -1.1, 0.65);

    const satGoldMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.88, roughness: 0.24 });
    const satScanMat1 = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const satScanMat2 = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const satBodyGeo = new THREE.BoxGeometry(0.04, 0.032, 0.04);
    const satPanelGeo = new THREE.BoxGeometry(0.13, 0.004, 0.032);
    const satConeGeo = new THREE.ConeGeometry(0.11, 0.34, 16, 1, true);

    const buildSat = (scanMat: THREE.MeshBasicMaterial, dist: number) => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(satBodyGeo, satGoldMat);
      const panels = new THREE.Mesh(satPanelGeo, solarMat);
      const cone = new THREE.Mesh(satConeGeo, scanMat);
      // Point cone inward toward Earth center (local -X when placed at +X)
      cone.rotation.z = -Math.PI / 2;
      cone.position.x = -0.19;
      g.add(body, panels, cone);
      g.position.set(dist, 0, 0);
      return g;
    };
    const sat1 = buildSat(satScanMat1, EARTH_RADIUS * 1.19);
    const sat2 = buildSat(satScanMat2, EARTH_RADIUS * 1.24);
    satOrbit1.add(sat1);
    satOrbit2.add(sat2);
    axialTiltGroup.add(satOrbit1, satOrbit2);

    // Orbital Ice / Micrometeoroid Dust Belt for crisp foreground parallax
    const beltCount = propsRef.current.progress.settings.highDetailParticles ? 460 : 180;
    const beltPos = new Float32Array(beltCount * 3);
    for (let i = 0; i < beltCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const dist = EARTH_RADIUS * (1.42 + Math.random() * 0.95);
      beltPos[i * 3] = Math.cos(a) * dist;
      beltPos[i * 3 + 1] = (Math.random() - 0.5) * 0.34;
      beltPos[i * 3 + 2] = Math.sin(a) * dist;
    }
    const beltGeo = new THREE.BufferGeometry();
    beltGeo.setAttribute('position', new THREE.BufferAttribute(beltPos, 3));
    const beltMat = new THREE.PointsMaterial({
      color: 0x7dd3fc,
      size: 0.032,
      map: starTex,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const orbitalDustBelt = new THREE.Points(beltGeo, beltMat);
    orbitalDustBelt.rotation.x = 0.26;
    axialTiltGroup.add(orbitalDustBelt);

    // Orbiting Cratered Moon visibly circling Earth (fast DataTexture via bitwise hash)
    const moonW = 256;
    const moonH = 128;
    const moonData = new Uint8Array(moonW * moonH * 4);
    for (let y = 0; y < moonH; y++) {
      const v = y / moonH;
      const phi = v * Math.PI;
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);
      for (let x = 0; x < moonW; x++) {
        const u = x / moonW;
        const theta = u * Math.PI * 2;
        const nx = sinPhi * Math.cos(theta);
        const ny = cosPhi;
        const nz = sinPhi * Math.sin(theta);
        const mare = fbm3D(nx * 2.6 + 5.1, ny * 2.6 + 1.4, nz * 2.6 + 3.7, 3);
        const craters = fbm3D(nx * 14 + 2.2, ny * 14 + 8.1, nz * 14 + 1.9, 2);
        const shade = Math.max(0, Math.min(255, Math.round(108 + mare * 96 + (craters - 0.5) * 52)));
        const i = (y * moonW + x) * 4;
        moonData[i] = shade;
        moonData[i + 1] = shade;
        moonData[i + 2] = Math.min(255, shade + 6);
        moonData[i + 3] = 255;
      }
    }
    const moonTex = new THREE.DataTexture(moonData, moonW, moonH, THREE.RGBAFormat);
    moonTex.colorSpace = THREE.SRGBColorSpace;
    moonTex.wrapS = THREE.RepeatWrapping;
    moonTex.magFilter = THREE.LinearFilter;
    moonTex.minFilter = THREE.LinearMipmapLinearFilter;
    moonTex.generateMipmaps = true;
    moonTex.needsUpdate = true;
    const moonGeo = new THREE.SphereGeometry(0.25, 36, 36);
    const moonMat = new THREE.MeshStandardMaterial({
      map: moonTex,
      bumpMap: moonTex,
      bumpScale: 0.035,
      roughness: 0.88,
      metalness: 0.04,
      emissive: 0x1e293b,
      emissiveIntensity: 0.3,
    });
    const moonMesh = new THREE.Mesh(moonGeo, moonMat);
    const MOON_ORBIT_RADIUS = 2.65;
    const moonOrbitGroup = new THREE.Group();
    moonOrbitGroup.rotation.x = 0.22;
    moonOrbitGroup.rotation.z = 0.16;
    moonOrbitGroup.rotation.y = 2.35;
    moonMesh.position.set(MOON_ORBIT_RADIUS, 0, 0);

    const moonOrbitRingGeo = new THREE.TorusGeometry(MOON_ORBIT_RADIUS, 0.0045, 8, 128);
    const moonOrbitRingMat = new THREE.MeshBasicMaterial({
      color: 0x94a3b8,
      transparent: true,
      opacity: 0.16,
    });
    const moonOrbitRing = new THREE.Mesh(moonOrbitRingGeo, moonOrbitRingMat);
    moonOrbitRing.rotation.x = Math.PI / 2;

    moonOrbitGroup.add(moonOrbitRing, moonMesh);
    scene.add(moonOrbitGroup);

    // Expanding Sector Shockwave Pulse Ring (animates on mission selection)
    const sectorPulseGeo = new THREE.RingGeometry(0.068, 0.09, 36);
    const sectorPulseMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sectorPulseMesh = new THREE.Mesh(sectorPulseGeo, sectorPulseMat);
    sectorPulseMesh.visible = false;
    earthRoot.add(sectorPulseMesh);

    // Solar Smash-style Orbital Target Lock Reticle (follows selected marker)
    const reticleGroup = new THREE.Group();
    const retOuterGeo = new THREE.RingGeometry(0.09, 0.106, 32);
    const retOuterMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide, transparent: true, opacity: 0.95 });
    const retOuter = new THREE.Mesh(retOuterGeo, retOuterMat);
    const retInnerGeo = new THREE.RingGeometry(0.06, 0.068, 6);
    const retInnerMat = new THREE.MeshBasicMaterial({ color: 0x10b981, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
    const retInner = new THREE.Mesh(retInnerGeo, retInnerMat);
    reticleGroup.add(retOuter, retInner);
    reticleGroup.visible = false;
    earthRoot.add(reticleGroup);

    // Live Multiplayer Remote Player Orbital Beacons & Sector Ping Rings
    const remoteBeaconGeo = new THREE.OctahedronGeometry(0.036, 0);
    const remoteRingGeo = new THREE.RingGeometry(0.028, 0.046, 20);
    const pingWaveGeo = new THREE.RingGeometry(0.06, 0.088, 36);
    const remoteBeacons = new Map<
      string,
      {
        group: THREE.Group;
        beacon: THREE.Mesh;
        ring: THREE.Mesh;
        beaconMat: THREE.MeshStandardMaterial;
        ringMat: THREE.MeshBasicMaterial;
        currentPos: THREE.Vector3;
      }
    >();
    const activePingMeshes = new Map<
      string,
      {
        mesh: THREE.Mesh;
        mat: THREE.MeshBasicMaterial;
        createdAt: number;
      }
    >();

    // Interactive 3D Mission Markers
    const clickableMeshes: THREE.Mesh[] = [];
    markerGroupsRef.current.clear();

    const baseRingGeo = new THREE.RingGeometry(0.04, 0.068, 24);
    const beaconGeo = new THREE.OctahedronGeometry(0.044, 0);
    const hitboxGeo = new THREE.SphereGeometry(0.13, 10, 10);
    const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });

    propsRef.current.missions.forEach((mission) => {
      const mGroup = new THREE.Group();
      const surfacePos = latLngToVector3(mission.lat, mission.lng, EARTH_RADIUS * 1.016);
      mGroup.position.copy(surfacePos);
      mGroup.lookAt(surfacePos.clone().multiplyScalar(2));

      const completed = propsRef.current.progress.completedMissionIds.includes(mission.id);
      const { unlocked } = isMissionUnlocked(
        mission,
        propsRef.current.progress,
        propsRef.current.globalProgressPct
      );
      let hex = 0xef4444;
      if (completed) hex = 0x10b981;
      else if (!unlocked) hex = 0xf59e0b;
      else if (mission.category === 'space-academy' || mission.category === 'final-space') hex = 0x38bdf8;
      else if (mission.category === 'secret-global') hex = 0xa855f7;

      const ringMat = new THREE.MeshBasicMaterial({
        color: hex,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
      });
      const ringMesh = new THREE.Mesh(baseRingGeo, ringMat);
      mGroup.add(ringMesh);

      const beaconMat = new THREE.MeshStandardMaterial({
        color: hex,
        emissive: hex,
        emissiveIntensity: 1.7,
        roughness: 0.2,
        metalness: 0.4,
      });
      const beaconMesh = new THREE.Mesh(beaconGeo, beaconMat);
      beaconMesh.position.z = 0.085;
      mGroup.add(beaconMesh);

      const hitboxMesh = new THREE.Mesh(hitboxGeo, hitboxMat);
      hitboxMesh.position.z = 0.05;
      hitboxMesh.layers.set(1);
      hitboxMesh.userData.missionId = mission.id;
      mGroup.add(hitboxMesh);

      clickableMeshes.push(hitboxMesh);
      earthRoot.add(mGroup);
      markerGroupsRef.current.set(mission.id, {
        group: mGroup,
        beacon: beaconMesh,
        ring: ringMesh,
        hitbox: hitboxMesh,
        mission,
      });
    });

    // Raycasting for Markers
    const raycaster = new THREE.Raycaster();
    raycaster.layers.set(1);
    const pointer = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };
    let lastHoverCheck = 0;

    const updatePointer = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const isFrontFacing = (worldPos: THREE.Vector3) => {
      _v1.copy(worldPos).normalize();
      _v2.copy(camera.position).normalize();
      return _v1.dot(_v2) > 0.08;
    };

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e: PointerEvent) => {
      if (propsRef.current.screenMode !== 'world-map' || propsRef.current.divingMission) return;
      const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      if (dist > 8) return;

      updatePointer(e);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(clickableMeshes, false);
      if (hits.length > 0) {
        const hitWorld = hits[0].object.getWorldPosition(_v1);
        if (isFrontFacing(hitWorld)) {
          const mId = hits[0].object.userData.missionId as string;
          const m = propsRef.current.missions.find((item) => item.id === mId);
          if (m) {
            if (propsRef.current.selectedMissionId === m.id && propsRef.current.onQuickEnterMission) {
              propsRef.current.onQuickEnterMission(m);
            } else {
              propsRef.current.onSelectMission(m);
            }
          }
        }
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (propsRef.current.screenMode !== 'world-map') return;
      const now = performance.now();
      if (now - lastHoverCheck < 45) return;
      lastHoverCheck = now;

      updatePointer(e);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(clickableMeshes, false);
      if (hits.length > 0) {
        const hitWorld = hits[0].object.getWorldPosition(_v1);
        if (isFrontFacing(hitWorld)) {
          const mId = hits[0].object.userData.missionId as string;
          const m = propsRef.current.missions.find((item) => item.id === mId) ?? null;
          if (m) {
            _projVec.copy(hitWorld).project(camera);
            const rect = renderer.domElement.getBoundingClientRect();
            const sx = ((_projVec.x + 1) / 2) * rect.width + rect.left;
            const sy = ((-_projVec.y + 1) / 2) * rect.height + rect.top;
            renderer.domElement.style.cursor = 'pointer';
            propsRef.current.onHoverMission(m, { x: sx, y: sy });
            return;
          }
        }
      }
      renderer.domElement.style.cursor = 'grab';
      propsRef.current.onHoverMission(null);
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointermove', onPointerMove);

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      const pr = isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(pr);
      renderer.setSize(w, h);
      composer?.setPixelRatio(pr);
      composer?.setSize(w, h);
      bloomPass?.resolution.set(w, h);
    };
    window.addEventListener('resize', onResize);

    const clock = new THREE.Clock();
    let frameId = 0;
    let disposed = false;
    let pausedForHidden = false;
    let internalSolarHour = propsRef.current.solarHour;
    let prevSolarProp = propsRef.current.solarHour;

    let loadedTextures: {
      albedoTex: THREE.Texture;
      roughTex: THREE.Texture;
      normalTex: THREE.Texture;
      nightTex: THREE.Texture;
      cloudTex: THREE.Texture;
    } | null = null;

    const applyPlanetTextures = (
      res: {
        albedoTex: THREE.Texture;
        roughTex: THREE.Texture;
        normalTex: THREE.Texture;
        nightTex: THREE.Texture;
        cloudTex: THREE.Texture;
      },
      isInitialBoot: boolean
    ) => {
      const prev = loadedTextures;
      loadedTextures = res;
      res.albedoTex.anisotropy = maxAniso;
      res.normalTex.anisotropy = maxAniso;

      earthMat.map = res.albedoTex;
      earthMat.roughnessMap = res.roughTex;
      earthMat.normalMap = res.normalTex;
      earthMat.needsUpdate = true;

      nightTexRef.current = res.nightTex;
      cloudTexRef.current = res.cloudTex;
      if (earthMat.userData.shader) {
        earthMat.userData.shader.uniforms.uNightMap.value = res.nightTex;
        earthMat.userData.shader.uniforms.uCloudMap.value = res.cloudTex;
      }

      cloudMat.map = res.cloudTex;
      cloudMat.bumpMap = res.cloudTex;
      cloudMat.needsUpdate = true;
      cirrusMat.map = res.cloudTex;
      cirrusMat.needsUpdate = true;

      if (isInitialBoot) {
        placeholderTex.dispose();
        propsRef.current.onLoadProgress?.(96, 'Compiling Atmospheric & Solar Corona Shaders');
        if (!isSoftwareGl) {
          renderer.compile(scene, camera);
        }
        propsRef.current.onLoadProgress?.(100, 'Orbital Command Systems Online');
        propsRef.current.onSceneReady?.();
      }

      if (prev) {
        prev.albedoTex.dispose();
        prev.roughTex.dispose();
        prev.normalTex.dispose();
        prev.nightTex.dispose();
        prev.cloudTex.dispose();
      }
    };

    const resolutionTier = isSoftwareGl
      ? 'standard'
      : propsRef.current.progress.settings.graphicsQuality === 'high'
      ? 'high'
      : 'ultra';

    // Progressive Two-Stage Boot: generate crisp 1024x512 immediately on Worker, then upgrade to Ultra/High silently
    createProceduralEarthTexturesAsync(
      initialFactor,
      'standard',
      (pct, stage) => {
        if (!disposed) propsRef.current.onLoadProgress?.(pct, stage);
      },
      () => disposed
    ).then((bootRes) => {
      if (!bootRes || disposed) {
        bootRes?.albedoTex.dispose();
        bootRes?.roughTex.dispose();
        bootRes?.normalTex.dispose();
        bootRes?.nightTex.dispose();
        bootRes?.cloudTex.dispose();
        return;
      }

      applyPlanetTextures(bootRes, true);

      if (resolutionTier !== 'standard') {
        window.setTimeout(() => {
          if (disposed) return;
          createProceduralEarthTexturesAsync(
            initialFactor,
            resolutionTier,
            undefined,
            () => disposed
          ).then((hdRes) => {
            if (!hdRes || disposed) {
              hdRes?.albedoTex.dispose();
              hdRes?.roughTex.dispose();
              hdRes?.normalTex.dispose();
              hdRes?.nightTex.dispose();
              hdRes?.cloudTex.dispose();
              return;
            }
            applyPlanetTextures(hdRes, false);
          });
        }, 450);
      }
    });

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

    resumeTickRef.current = () => {
      if (disposed || !pausedForHidden) return;
      pausedForHidden = false;
      clock.getDelta();
      frameId = requestAnimationFrame(tick);
    };

    function tick() {
      if (disposed) return;
      const {
        screenMode: mode,
        progress: prog,
        selectedMissionId: selId,
        solarMode: sMode,
        solarHour: sHour,
        divingMission: diveTarget,
      } = propsRef.current;

      // Pause 3D globe & post-processing completely while inside a 3D Mission Arena or Space Academy
      if (mode === 'mission-active' || mode === 'space-academy') {
        pausedForHidden = true;
        return;
      }

      const delta = Math.min(clock.getDelta(), 0.1);
      const elapsed = clock.getElapsedTime();

      if (Math.abs(sHour - prevSolarProp) > 0.35) {
        internalSolarHour = sHour;
      }
      prevSolarProp = sHour;

      if (sMode === 'auto') {
        internalSolarHour = (internalSolarHour + delta * (24 / 300)) % 24;
      } else {
        const targetH = sMode === 'day' ? 13.5 : sMode === 'sunset' ? 18.1 : 23.8;
        internalSolarHour = THREE.MathUtils.damp(internalSolarHour, targetH, 4.0, delta);
      }

      // On the Opening Title / Main Menu screen, place the Sun visibly in open upper-right sky clear of Earth
      if (mode === 'opening') {
        _targetSunVec.set(0.55, 0.22, -0.80).normalize();
      } else {
        const sunAngle = ((internalSolarHour - 12) / 24) * Math.PI * 2;
        _targetSunVec.set(Math.sin(sunAngle) * 0.92, 0.28, Math.cos(sunAngle) * 0.92).normalize();
      }
      liveSunDir.lerp(_targetSunVec, 1 - Math.exp(-delta * 4.5)).normalize();
      sunLight.position.copy(liveSunDir).multiplyScalar(28);
      earthshineLight.position.copy(liveSunDir).multiplyScalar(-18);
      rimLight.position.set(-liveSunDir.z * 16, 10, liveSunDir.x * 16);
      sunGroup.position.copy(liveSunDir).multiplyScalar(SUN_DISTANCE);
      sunSphereMat.uniforms.uTime.value = elapsed;
      sunCoronaMat.uniforms.uTime.value = elapsed;
      skyDomeMat.uniforms.uTime.value = elapsed;
      sunProm1.rotation.z += delta * 0.22;
      sunProm1.rotation.y += delta * 0.14;
      sunProm2.rotation.x -= delta * 0.18;
      sunProm2.rotation.z -= delta * 0.15;

      atmosMat.uniforms.uTime.value = elapsed;
      atmosHaloMat.uniforms.uTime.value = elapsed;
      if (earthMat.userData.shader) {
        earthMat.userData.shader.uniforms.uTime.value = elapsed;
      }

      if (diveTarget) {
        // Dramatic Orbital Zoom-In Animation directly into the chosen Earth mission surface
        controls.enabled = false;
        earthRoot.updateMatrixWorld(true);
        latLngToVector3(diveTarget.lat, diveTarget.lng, EARTH_RADIUS * 1.075, _targetCamPos);
        earthRoot.localToWorld(_targetCamPos);
        latLngToVector3(diveTarget.lat, diveTarget.lng, EARTH_RADIUS * 0.85, _v3);
        earthRoot.localToWorld(_v3);

        camera.position.x = THREE.MathUtils.damp(camera.position.x, _targetCamPos.x, 6.2, delta);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, _targetCamPos.y, 6.2, delta);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, _targetCamPos.z, 6.2, delta);
        controls.target.set(
          THREE.MathUtils.damp(controls.target.x, _v3.x, 6.8, delta),
          THREE.MathUtils.damp(controls.target.y, _v3.y, 6.8, delta),
          THREE.MathUtils.damp(controls.target.z, _v3.z, 6.8, delta)
        );
        camera.lookAt(controls.target);
        const nextFov = THREE.MathUtils.damp(camera.fov, 72, 5.4, delta);
        if (Math.abs(nextFov - camera.fov) > 0.05) {
          camera.fov = nextFov;
          camera.updateProjectionMatrix();
        }
      } else {
        if (Math.abs(camera.fov - 42) > 0.05) {
          camera.fov = THREE.MathUtils.damp(camera.fov, 42, 6.0, delta);
          camera.updateProjectionMatrix();
        }
        if (mode === 'opening') {
          earthRoot.rotation.y += delta * 0.085;
          camera.position.x = THREE.MathUtils.damp(camera.position.x, -0.45, 1.35, delta);
          camera.position.y = THREE.MathUtils.damp(camera.position.y, 0.25, 1.35, delta);
          camera.position.z = THREE.MathUtils.damp(camera.position.z, 6.1, 1.25, delta);
          controls.target.set(
            THREE.MathUtils.damp(controls.target.x, -0.30, 2.2, delta),
            THREE.MathUtils.damp(controls.target.y, -0.05, 2.2, delta),
            0
          );
          camera.lookAt(controls.target);
          controls.enabled = false;
        } else if (mode === 'ending-cinematic') {
          earthRoot.rotation.y += delta * 0.16;
          camera.position.x = THREE.MathUtils.damp(camera.position.x, 0, 1.2, delta);
          camera.position.z = THREE.MathUtils.damp(camera.position.z, 4.9, 0.85, delta);
          camera.position.y = THREE.MathUtils.damp(camera.position.y, 0.72, 0.85, delta);
          controls.target.set(0, 0, 0);
          camera.lookAt(0, 0, 0);
          controls.enabled = false;
        } else {
          controls.enabled = mode === 'world-map';
          controls.target.x = THREE.MathUtils.damp(controls.target.x, 0, 4.0, delta);
          controls.target.y = THREE.MathUtils.damp(controls.target.y, 0, 4.0, delta);
          controls.target.z = THREE.MathUtils.damp(controls.target.z, 0, 4.0, delta);
          if (prog.settings.autoRotateGlobe && !selId && !cameraTargetGoalRef.current) {
            earthRoot.rotation.y += delta * 0.05;
          }

          if (cameraTargetGoalRef.current) {
            earthRoot.updateMatrixWorld(true);
            _targetCamPos.copy(cameraTargetGoalRef.current);
            earthRoot.localToWorld(_targetCamPos);
            const dist = camera.position.length();
            _targetCamPos.normalize().multiplyScalar(Math.max(2.9, Math.min(4.7, dist)));
            camera.position.x = THREE.MathUtils.damp(camera.position.x, _targetCamPos.x, 3.6, delta);
            camera.position.y = THREE.MathUtils.damp(camera.position.y, _targetCamPos.y, 3.6, delta);
            camera.position.z = THREE.MathUtils.damp(camera.position.z, _targetCamPos.z, 3.6, delta);
            if (camera.position.distanceTo(_targetCamPos) < 0.08) {
              cameraTargetGoalRef.current = null;
            }
          }
          controls.update();
        }
      }

      // Planetary weather, station, satellites & celestial motion
      cloudMesh.rotation.y += delta * 0.019;
      cirrusMesh.rotation.y += delta * 0.029;
      orbitalDustBelt.rotation.y += delta * 0.012;
      orbitRing.rotation.z += delta * 0.18;
      ringDock.rotation.y += delta * 0.9;
      navBeaconMat.color.setHex(Math.sin(elapsed * 5.2) > 0 ? 0x38bdf8 : 0x0ea5e9);

      satOrbit1.rotation.z += delta * 0.34;
      satOrbit2.rotation.z -= delta * 0.27;
      satScanMat1.opacity = 0.12 + 0.08 * Math.sin(elapsed * 4.2);
      satScanMat2.opacity = 0.12 + 0.08 * Math.cos(elapsed * 3.6);

      moonOrbitGroup.rotation.y += delta * 0.32;
      moonMesh.rotation.y += delta * 0.18;
      stars.rotation.y += delta * 0.003;
      galaxy.rotation.y += delta * 0.004;

      // Solar corona & anamorphic lens flare breathing
      const sunPulse = 1 + Math.sin(elapsed * 1.4) * 0.045;
      sunSprite.scale.set(7.2 * sunPulse, 7.2 * sunPulse, 1);
      sunHaloSprite.scale.set(13.5 * (1 + Math.cos(elapsed * 0.9) * 0.06), 13.5 * (1 + Math.cos(elapsed * 0.9) * 0.06), 1);
      sunStreakSprite.scale.set(18.5 * sunPulse, 1.55 * (1 + Math.sin(elapsed * 1.8) * 0.05), 1);

      // Animated Shooting Stars / Meteors
      for (let i = 0; i < meteors.length; i++) {
        const m = meteors[i];
        if (m.cooldown > 0) {
          m.cooldown -= delta;
          m.mat.opacity = 0;
        } else {
          m.life += delta;
          if (m.life >= m.maxLife) {
            m.life = 0;
            m.cooldown = 3.5 + Math.random() * 6.5;
            m.origin.set((Math.random() - 0.5) * 44, (Math.random() - 0.5) * 26, -22 - Math.random() * 26);
            m.mat.opacity = 0;
          } else {
            const p = m.life / m.maxLife;
            const travel = m.life * m.speed;
            const posAttr = m.geo.getAttribute('position') as THREE.BufferAttribute;
            const hx = m.origin.x + m.dir.x * travel;
            const hy = m.origin.y + m.dir.y * travel;
            const hz = m.origin.z + m.dir.z * travel;
            posAttr.setXYZ(0, hx, hy, hz);
            posAttr.setXYZ(1, hx - m.dir.x * m.length, hy - m.dir.y * m.length, hz - m.dir.z * m.length);
            posAttr.needsUpdate = true;
            m.mat.opacity = Math.sin(p * Math.PI) * 0.85;
          }
        }
      }

      // Expanding Sector Pulse Wave on Marker Selection
      if (pulseTriggerRef.current && mode !== 'opening') {
        const age = (performance.now() - pulseTriggerRef.current.startedAt) / 1000;
        if (age < 1.15) {
          sectorPulseMesh.visible = true;
          latLngToVector3(pulseTriggerRef.current.lat, pulseTriggerRef.current.lng, EARTH_RADIUS * 1.022, _v1);
          sectorPulseMesh.position.copy(_v1);
          _v2.copy(_v1).multiplyScalar(2);
          sectorPulseMesh.lookAt(_v2);
          const t = age / 1.15;
          sectorPulseMesh.scale.setScalar(1 + t * 3.8);
          sectorPulseMat.opacity = (1 - t) * 0.78;
        } else {
          sectorPulseMesh.visible = false;
          pulseTriggerRef.current = null;
        }
      } else {
        sectorPulseMesh.visible = false;
      }

      reticleGroup.visible = false;
      markerGroupsRef.current.forEach((entry, id) => {
        const isSel = id === selId;
        const wave = 1 + Math.sin(elapsed * 3.2 + id.length) * 0.14;
        entry.beacon.rotation.z = elapsed * 1.5;
        entry.beacon.scale.setScalar(isSel ? 1.48 : wave);
        entry.ring.scale.setScalar(isSel ? 1.55 : 1 + Math.sin(elapsed * 2.4 + id.length) * 0.1);
        entry.group.visible = mode !== 'opening';

        if (isSel && mode !== 'opening') {
          reticleGroup.visible = true;
          reticleGroup.position.copy(entry.group.position);
          reticleGroup.quaternion.copy(entry.group.quaternion);
          retOuter.rotation.z = elapsed * 1.6;
          retInner.rotation.z = -elapsed * 2.2;
        }
      });

      // Live Multiplayer Remote Player Beacons
      const { remotePlayers: rPlayers, selfPlayerId: selfId, sectorPings: sPings } = propsRef.current;
      const activeRemoteIds = new Set<string>();
      for (let i = 0; i < rPlayers.length; i++) {
        const rp = rPlayers[i];
        if (rp.id === selfId) continue;
        activeRemoteIds.add(rp.id);
        let entry = remoteBeacons.get(rp.id);
        if (!entry) {
          const bMat = new THREE.MeshStandardMaterial({
            color: rp.color,
            emissive: rp.color,
            emissiveIntensity: 1.5,
            roughness: 0.2,
            metalness: 0.35,
          });
          const rMat = new THREE.MeshBasicMaterial({
            color: rp.color,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.85,
          });
          const beacon = new THREE.Mesh(remoteBeaconGeo, bMat);
          beacon.position.z = 0.085;
          const ring = new THREE.Mesh(remoteRingGeo, rMat);
          const group = new THREE.Group();
          group.add(ring, beacon);
          const initPos = latLngToVector3(rp.lat, rp.lng, EARTH_RADIUS * 1.026);
          group.position.copy(initPos);
          earthRoot.add(group);
          entry = {
            group,
            beacon,
            ring,
            beaconMat: bMat,
            ringMat: rMat,
            currentPos: initPos.clone(),
          };
          remoteBeacons.set(rp.id, entry);
        }

        entry.group.visible = mode !== 'opening';
        entry.beaconMat.color.set(rp.color);
        entry.beaconMat.emissive.set(rp.color);
        entry.ringMat.color.set(rp.color);

        latLngToVector3(rp.lat, rp.lng, EARTH_RADIUS * 1.026, _v1);
        entry.currentPos.lerp(_v1, 1 - Math.exp(-delta * 6.0));
        entry.currentPos.normalize().multiplyScalar(EARTH_RADIUS * 1.026);
        entry.group.position.copy(entry.currentPos);
        _v2.copy(entry.currentPos).multiplyScalar(2);
        entry.group.lookAt(_v2);
        entry.beacon.rotation.z = elapsed * 2.2;
        const pulse = 1 + Math.sin(elapsed * 4.0 + i) * 0.16;
        entry.ring.scale.setScalar(pulse);
      }

      remoteBeacons.forEach((entry, pid) => {
        if (!activeRemoteIds.has(pid)) {
          earthRoot.remove(entry.group);
          entry.beaconMat.dispose();
          entry.ringMat.dispose();
          remoteBeacons.delete(pid);
        }
      });

      // Live Multiplayer Tactical Sector Ping Waves
      const nowMs = Date.now();
      const activePingIds = new Set<string>();
      for (let i = 0; i < sPings.length; i++) {
        const ping = sPings[i];
        const ageSec = (nowMs - ping.createdAt) / 1000;
        if (ageSec < 0 || ageSec > 2.6) continue;
        activePingIds.add(ping.id);
        let pEntry = activePingMeshes.get(ping.id);
        if (!pEntry) {
          const pMat = new THREE.MeshBasicMaterial({
            color: ping.color,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          const pMesh = new THREE.Mesh(pingWaveGeo, pMat);
          latLngToVector3(ping.lat, ping.lng, EARTH_RADIUS * 1.025, _v3);
          pMesh.position.copy(_v3);
          _v2.copy(_v3).multiplyScalar(2);
          pMesh.lookAt(_v2);
          earthRoot.add(pMesh);
          pEntry = { mesh: pMesh, mat: pMat, createdAt: ping.createdAt };
          activePingMeshes.set(ping.id, pEntry);
        }
        pEntry.mesh.visible = mode !== 'opening';
        const t = Math.min(1, ageSec / 2.6);
        pEntry.mesh.scale.setScalar(1 + t * 4.4);
        pEntry.mat.opacity = (1 - t) * 0.85;
      }

      activePingMeshes.forEach((pEntry, pingId) => {
        if (!activePingIds.has(pingId)) {
          earthRoot.remove(pEntry.mesh);
          pEntry.mat.dispose();
          activePingMeshes.delete(pingId);
        }
      });

      if (composer && !isSoftwareGl) {
        composer.render();
      } else {
        renderer.render(scene, camera);
      }

      if (isSoftwareGl) afterDraw(tick);
      else frameId = requestAnimationFrame(tick);
    }

    tick();

    return () => {
      disposed = true;
      isDisposedRef.current = true;
      resumeTickRef.current = null;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      controls.dispose();
      bloomPass?.dispose();
      colorGradePass?.dispose();
      filmPass?.dispose();
      composer?.dispose();
      composerTarget?.dispose();
      skyDomeGeo.dispose();
      skyDomeMat.dispose();
      earthGeo.dispose();
      earthMat.dispose();
      placeholderTex.dispose();
      loadedTextures?.albedoTex.dispose();
      loadedTextures?.roughTex.dispose();
      loadedTextures?.normalTex.dispose();
      nightTexRef.current?.dispose();
      cloudGeo.dispose();
      cloudMat.dispose();
      cirrusGeo.dispose();
      cirrusMat.dispose();
      cloudTexRef.current?.dispose();
      atmosGeo.dispose();
      atmosMat.dispose();
      atmosHaloGeo.dispose();
      atmosHaloMat.dispose();
      moonGeo.dispose();
      moonMat.dispose();
      moonTex.dispose();
      moonOrbitRingGeo.dispose();
      moonOrbitRingMat.dispose();
      sunSphereGeo.dispose();
      sunSphereMat.dispose();
      sunCoronaGeo.dispose();
      sunCoronaMat.dispose();
      sunProminenceGeo.dispose();
      sunProminenceMat.dispose();
      sunTex.dispose();
      sunHaloTex.dispose();
      sunStreakTex.dispose();
      starTex.dispose();
      starGeo.dispose();
      starMat.dispose();
      galGeo.dispose();
      galMat.dispose();
      beltGeo.dispose();
      beltMat.dispose();
      meteors.forEach((m) => {
        m.geo.dispose();
        m.mat.dispose();
      });
      orbitRingGeo.dispose();
      orbitRingMat.dispose();
      metalMat.dispose();
      trussMat.dispose();
      solarMat.dispose();
      navBeaconMat.dispose();
      satGoldMat.dispose();
      satScanMat1.dispose();
      satScanMat2.dispose();
      satBodyGeo.dispose();
      satPanelGeo.dispose();
      satConeGeo.dispose();
      sectorPulseGeo.dispose();
      sectorPulseMat.dispose();
      retOuterGeo.dispose();
      retOuterMat.dispose();
      retInnerGeo.dispose();
      retInnerMat.dispose();
      remoteBeaconGeo.dispose();
      remoteRingGeo.dispose();
      pingWaveGeo.dispose();
      remoteBeacons.forEach((entry) => {
        entry.beaconMat.dispose();
        entry.ringMat.dispose();
      });
      remoteBeacons.clear();
      activePingMeshes.forEach((entry) => {
        entry.mat.dispose();
      });
      activePingMeshes.clear();
      baseRingGeo.dispose();
      beaconGeo.dispose();
      hitboxGeo.dispose();
      hitboxMat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className="fixed inset-0 z-0 w-full h-full overflow-hidden bg-[#020611]"
      aria-label="Photorealistic 3D Earth in Space"
    />
  );
};
