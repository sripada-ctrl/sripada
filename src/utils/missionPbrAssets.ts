import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildNormalFromCanvas(srcCanvas: HTMLCanvasElement, strength: number): THREE.CanvasTexture {
  const size = srcCanvas.width;
  const ctx = srcCanvas.getContext('2d')!;
  const src = ctx.getImageData(0, 0, size, size).data;

  const nCanvas = document.createElement('canvas');
  nCanvas.width = size;
  nCanvas.height = size;
  const nCtx = nCanvas.getContext('2d')!;
  const nImg = nCtx.createImageData(size, size);
  const nData = nImg.data;

  const lum = new Float32Array(size * size);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    lum[i] = (src[p] * 0.299 + src[p + 1] * 0.587 + src[p + 2] * 0.114) / 255;
  }

  const mask = size - 1;
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1) & mask) * size;
    const yp = ((y + 1) & mask) * size;
    const row = y * size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1) & mask;
      const xp = (x + 1) & mask;
      const dx = (lum[row + xm] - lum[row + xp]) * strength;
      const dy = (lum[ym + x] - lum[yp + x]) * strength;
      const invLen = 1 / Math.hypot(dx, dy, 1);
      const idx = (row + x) * 4;
      nData[idx] = Math.round((dx * invLen * 0.5 + 0.5) * 255);
      nData[idx + 1] = Math.round((dy * invLen * 0.5 + 0.5) * 255);
      nData[idx + 2] = Math.round((invLen * 0.5 + 0.5) * 255);
      nData[idx + 3] = 255;
    }
  }
  nCtx.putImageData(nImg, 0, 0);

  const tex = new THREE.CanvasTexture(nCanvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export interface MissionPbrTextureLibrary {
  barkMap: THREE.CanvasTexture;
  barkNormal: THREE.CanvasTexture;
  leafMap: THREE.CanvasTexture;
  leafNormal: THREE.CanvasTexture;
  rockMap: THREE.CanvasTexture;
  rockNormal: THREE.CanvasTexture;
  rustMap: THREE.CanvasTexture;
  rustNormal: THREE.CanvasTexture;
  rustRoughness: THREE.CanvasTexture;
  brickMap: THREE.CanvasTexture;
  brickNormal: THREE.CanvasTexture;
  roofMap: THREE.CanvasTexture;
  roofNormal: THREE.CanvasTexture;
  contactShadowTex: THREE.CanvasTexture;
  disposeAll: () => void;
}

export function createMissionPbrTextureLibrary(maxAniso: number): MissionPbrTextureLibrary {
  const textures: THREE.Texture[] = [];
  const register = <T extends THREE.Texture>(t: T, isSrgb: boolean, rx = 1, ry = 1): T => {
    if (isSrgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.anisotropy = maxAniso;
    textures.push(t);
    return t;
  };

  // 1. Furrowed Tree Bark (512x512)
  const barkC = document.createElement('canvas');
  barkC.width = 512;
  barkC.height = 512;
  const barkCtx = barkC.getContext('2d')!;
  const barkRng = createRng(101);
  barkCtx.fillStyle = '#4a3525';
  barkCtx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 650; i++) {
    const x = barkRng() * 512;
    const y = barkRng() * 512;
    const w = 2 + barkRng() * 6;
    const h = 30 + barkRng() * 90;
    barkCtx.fillStyle = i % 3 === 0 ? 'rgba(28, 19, 12, 0.55)' : i % 3 === 1 ? 'rgba(104, 77, 54, 0.42)' : 'rgba(65, 82, 52, 0.18)';
    barkCtx.fillRect(x, y, w, h);
    barkCtx.fillRect(x, y - 512, w, h);
  }
  const barkMap = register(new THREE.CanvasTexture(barkC), true, 2, 2);
  const barkNormal = register(buildNormalFromCanvas(barkC, 4.2), false, 2, 2);

  // 2. Dappled Botanical Leaf Canopy (512x512)
  const leafC = document.createElement('canvas');
  leafC.width = 512;
  leafC.height = 512;
  const leafCtx = leafC.getContext('2d')!;
  const leafRng = createRng(202);
  leafCtx.fillStyle = '#1b5e2e';
  leafCtx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2400; i++) {
    const lx = leafRng() * 512;
    const ly = leafRng() * 512;
    const r = 5 + leafRng() * 11;
    const ang = leafRng() * Math.PI * 2;
    const tone = leafRng();
    leafCtx.fillStyle =
      tone > 0.72
        ? 'rgba(134, 239, 172, 0.45)'
        : tone > 0.35
        ? 'rgba(34, 197, 94, 0.42)'
        : 'rgba(15, 72, 34, 0.55)';
    leafCtx.save();
    leafCtx.translate(lx, ly);
    leafCtx.rotate(ang);
    leafCtx.beginPath();
    leafCtx.ellipse(0, 0, r * 1.35, r * 0.62, 0, 0, Math.PI * 2);
    leafCtx.fill();
    leafCtx.restore();
  }
  const leafMap = register(new THREE.CanvasTexture(leafC), true, 2, 2);
  const leafNormal = register(buildNormalFromCanvas(leafC, 3.4), false, 2, 2);

  // 3. Granite & Slate Natural Rock (512x512)
  const rockC = document.createElement('canvas');
  rockC.width = 512;
  rockC.height = 512;
  const rockCtx = rockC.getContext('2d')!;
  const rockRng = createRng(303);
  rockCtx.fillStyle = '#626360';
  rockCtx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 4200; i++) {
    const rx = rockRng() * 512;
    const ry = rockRng() * 512;
    const sz = 2 + rockRng() * 8;
    rockCtx.fillStyle =
      i % 4 === 0
        ? 'rgba(203, 213, 225, 0.2)'
        : i % 3 === 0
        ? 'rgba(30, 41, 59, 0.3)'
        : 'rgba(120, 113, 108, 0.25)';
    rockCtx.beginPath();
    rockCtx.arc(rx, ry, sz, 0, Math.PI * 2);
    rockCtx.fill();
  }
  // Mineral fracture veins
  rockCtx.strokeStyle = 'rgba(24, 24, 27, 0.45)';
  rockCtx.lineWidth = 2;
  for (let c = 0; c < 18; c++) {
    let cx = rockRng() * 512;
    let cy = rockRng() * 512;
    rockCtx.beginPath();
    rockCtx.moveTo(cx, cy);
    for (let seg = 0; seg < 6; seg++) {
      cx += (rockRng() - 0.5) * 90;
      cy += (rockRng() - 0.5) * 90;
      rockCtx.lineTo(cx, cy);
    }
    rockCtx.stroke();
  }
  const rockMap = register(new THREE.CanvasTexture(rockC), true, 2, 2);
  const rockNormal = register(buildNormalFromCanvas(rockC, 4.5), false, 2, 2);

  // 4. Weathered Brushed & Rusted Metal (512x512)
  const rustC = document.createElement('canvas');
  rustC.width = 512;
  rustC.height = 512;
  const rustCtx = rustC.getContext('2d')!;
  const rustRC = document.createElement('canvas');
  rustRC.width = 512;
  rustRC.height = 512;
  const rustRCtx = rustRC.getContext('2d')!;
  const rustRng = createRng(404);

  rustCtx.fillStyle = '#5a5f66';
  rustCtx.fillRect(0, 0, 512, 512);
  rustRCtx.fillStyle = '#525252';
  rustRCtx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 1600; i++) {
    const x = rustRng() * 512;
    const y = rustRng() * 512;
    rustCtx.fillStyle = i % 2 === 0 ? 'rgba(226, 232, 240, 0.14)' : 'rgba(15, 23, 42, 0.18)';
    rustCtx.fillRect(x, y, 22 + rustRng() * 42, 1.5);
  }
  for (let i = 0; i < 240; i++) {
    const px = rustRng() * 512;
    const py = rustRng() * 512;
    const rad = 8 + rustRng() * 28;
    const grad = rustCtx.createRadialGradient(px, py, 2, px, py, rad);
    grad.addColorStop(0, 'rgba(146, 64, 14, 0.68)');
    grad.addColorStop(0.6, 'rgba(124, 45, 18, 0.35)');
    grad.addColorStop(1, 'rgba(124, 45, 18, 0)');
    rustCtx.fillStyle = grad;
    rustCtx.beginPath();
    rustCtx.arc(px, py, rad, 0, Math.PI * 2);
    rustCtx.fill();

    rustRCtx.fillStyle = 'rgba(220, 220, 220, 0.6)';
    rustRCtx.beginPath();
    rustRCtx.arc(px, py, rad * 0.75, 0, Math.PI * 2);
    rustRCtx.fill();
  }
  const rustMap = register(new THREE.CanvasTexture(rustC), true, 1, 1);
  const rustNormal = register(buildNormalFromCanvas(rustC, 3.6), false, 1, 1);
  const rustRoughness = register(new THREE.CanvasTexture(rustRC), false, 1, 1);

  // 5. Architectural Brick & Mortar Masonry (512x512)
  const brickC = document.createElement('canvas');
  brickC.width = 512;
  brickC.height = 512;
  const brickCtx = brickC.getContext('2d')!;
  const brickRng = createRng(505);
  brickCtx.fillStyle = '#9ca3af'; // mortar
  brickCtx.fillRect(0, 0, 512, 512);
  const rowH = 32;
  const colW = 64;
  for (let row = 0; row < 512 / rowH; row++) {
    const offset = (row % 2) * (colW * 0.5);
    for (let col = -1; col < 512 / colW + 1; col++) {
      const shade = 132 + Math.floor(brickRng() * 44);
      const warm = Math.floor(brickRng() * 20);
      brickCtx.fillStyle = `rgb(${shade + warm}, ${shade}, ${Math.max(90, shade - 8)})`;
      brickCtx.fillRect(col * colW + offset + 3, row * rowH + 3, colW - 6, rowH - 6);
    }
  }
  const brickMap = register(new THREE.CanvasTexture(brickC), true, 2, 1.5);
  const brickNormal = register(buildNormalFromCanvas(brickC, 3.8), false, 2, 1.5);

  // 6. Terracotta Roof Shingles (512x512)
  const roofC = document.createElement('canvas');
  roofC.width = 512;
  roofC.height = 512;
  const roofCtx = roofC.getContext('2d')!;
  const roofRng = createRng(606);
  roofCtx.fillStyle = '#5c2110';
  roofCtx.fillRect(0, 0, 512, 512);
  for (let r = 0; r < 16; r++) {
    for (let c = 0; c < 12; c++) {
      const x = c * 44 + (r % 2) * 22 - 10;
      const y = r * 32;
      const v = roofRng();
      roofCtx.fillStyle = v > 0.6 ? '#8c3518' : v > 0.25 ? '#752912' : '#63220f';
      roofCtx.fillRect(x, y, 40, 29);
      roofCtx.fillStyle = 'rgba(0,0,0,0.28)';
      roofCtx.fillRect(x, y + 27, 40, 3);
    }
  }
  const roofMap = register(new THREE.CanvasTexture(roofC), true, 3, 2);
  const roofNormal = register(buildNormalFromCanvas(roofC, 4.0), false, 3, 2);

  // 7. Soft Radial Contact Shadow Decal
  const shC = document.createElement('canvas');
  shC.width = 256;
  shC.height = 256;
  const shCtx = shC.getContext('2d')!;
  const shGrad = shCtx.createRadialGradient(128, 128, 12, 128, 128, 126);
  shGrad.addColorStop(0, 'rgba(0, 0, 0, 0.58)');
  shGrad.addColorStop(0.5, 'rgba(0, 0, 0, 0.28)');
  shGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  shCtx.fillStyle = shGrad;
  shCtx.fillRect(0, 0, 256, 256);
  const contactShadowTex = new THREE.CanvasTexture(shC);
  contactShadowTex.colorSpace = THREE.SRGBColorSpace;
  textures.push(contactShadowTex);

  return {
    barkMap,
    barkNormal,
    leafMap,
    leafNormal,
    rockMap,
    rockNormal,
    rustMap,
    rustNormal,
    rustRoughness,
    brickMap,
    brickNormal,
    roofMap,
    roofNormal,
    contactShadowTex,
    disposeAll: () => {
      textures.forEach((t) => t.dispose());
    },
  };
}

function displaceIco(geo: THREE.BufferGeometry, seed: number, amp = 0.22): THREE.BufferGeometry {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n =
      Math.sin(x * 2.7 + seed) * Math.cos(y * 3.1 - seed * 0.5) * amp +
      Math.cos(z * 4.3 + x * 2.1) * (amp * 0.55);
    pos.setXYZ(i, x * (1 + n), y * (1 + n * 0.8), z * (1 + n));
  }
  geo.computeVertexNormals();
  return geo;
}

export function createOrganicCanopyGeometry(): THREE.BufferGeometry {
  const lobes: Array<[number, number, number, number, number]> = [
    [1.35, 0, 0.15, 0, 1.1],
    [1.05, 0.78, -0.25, 0.45, 2.7],
    [1.0, -0.72, -0.2, -0.4, 4.3],
    [0.92, 0.12, 0.85, 0.15, 5.9],
  ];
  const parts = lobes.map(([rad, ox, oy, oz, seed]) => {
    const g = displaceIco(new THREE.IcosahedronGeometry(rad, 2), seed, 0.24);
    g.translate(ox, oy, oz);
    return g;
  });
  const merged = mergeGeometries(parts, false) ?? new THREE.IcosahedronGeometry(1.35, 2);
  parts.forEach((p) => p.dispose());
  merged.computeVertexNormals();
  return merged;
}

export function createGrassTuftGeometry(): THREE.BufferGeometry {
  const blades: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.ConeGeometry(0.11, 0.72, 4);
    blade.scale(1.0, 1.0, 0.22);
    blade.translate(0, 0.36, 0);
    blade.rotateX((i % 2 === 0 ? 1 : -1) * 0.22);
    blade.rotateY((i / 4) * Math.PI);
    blades.push(blade);
  }
  const merged = mergeGeometries(blades, false) ?? new THREE.ConeGeometry(0.14, 0.72, 4);
  blades.forEach((b) => b.dispose());
  merged.computeVertexNormals();
  return merged;
}

export function createDetailedRockGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.95, 3);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const rx = pos.getX(i);
    const ry = pos.getY(i);
    const rz = pos.getZ(i);
    const ridge =
      1 +
      Math.sin(rx * 3.4 + ry * 2.9) * 0.16 +
      Math.cos(rz * 3.8 - ry * 2.3) * 0.12 +
      Math.sin((rx + rz) * 6.5) * 0.05;
    const flatBottom = ry < -0.35 ? 0.58 : 0.76;
    pos.setXYZ(i, rx * ridge, ry * ridge * flatBottom, rz * ridge);
  }
  g.computeVertexNormals();
  return g;
}

export function createLayeredPineCanopyGeometry(): THREE.BufferGeometry {
  const tiers: Array<[number, number, number]> = [
    [1.45, 1.55, -0.35],
    [1.15, 1.45, 0.55],
    [0.82, 1.35, 1.35],
  ];
  const parts = tiers.map(([r, h, oy]) => {
    const c = new THREE.ConeGeometry(r, h, 9, 2);
    const pos = c.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const jitter = 1 + Math.sin(x * 4.1 + z * 3.7 + oy) * 0.12;
      pos.setXYZ(i, x * jitter, y, z * jitter);
    }
    c.translate(0, oy, 0);
    return c;
  });
  const merged = mergeGeometries(parts, false) ?? new THREE.ConeGeometry(1.3, 2.5, 9);
  parts.forEach((p) => p.dispose());
  merged.computeVertexNormals();
  return merged;
}

export function createWildflowerClusterGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * Math.PI * 2;
    const ox = Math.cos(ang) * 0.12;
    const oz = Math.sin(ang) * 0.12;
    const bloom = new THREE.OctahedronGeometry(0.11, 1);
    bloom.scale(1.1, 0.55, 1.1);
    bloom.translate(ox, 0.36 + (i % 2) * 0.06, oz);
    parts.push(bloom);
  }
  const merged = mergeGeometries(parts, false) ?? new THREE.OctahedronGeometry(0.14, 1);
  parts.forEach((p) => p.dispose());
  merged.computeVertexNormals();
  return merged;
}

export function createSnowflakeSpriteTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(0.45, 'rgba(224, 242, 254, 0.78)');
  grad.addColorStop(1, 'rgba(224, 242, 254, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
