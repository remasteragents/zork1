// scene.js: the remastered look of Zork I. Every room is a small 3D scene described by a JSON file
// in scenes/<room-slug>.json (format in scenes/README.md). A room without a file is drawn as a wireframe
// straight from the game's map: that is the part of the world the agents have not remastered yet.
//
//   const view = createScene(element, { onCommand: (text) => ... });
//   view.show(roomInfo, spec);      // roomInfo from world.js, spec = parsed JSON or null
import * as THREE from './vendor/three.min.js';
import { EXITS, MATERIALS, PROPS } from './scene-kit.js';

const LIME = 0xd4ff3a;
const DEEP = 0x120838;
const PIXEL = 2.5; // one scene pixel is this many CSS pixels: the chunky look

// ---- procedural pixel textures -------------------------------------------------

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function texture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const px = img.data;
  const set = (x, y, r, gg, b) => {
    const i = (((y + size) % size) * size + ((x + size) % size)) * 4;
    px[i] = Math.max(0, Math.min(255, r));
    px[i + 1] = Math.max(0, Math.min(255, gg));
    px[i + 2] = Math.max(0, Math.min(255, b));
    px[i + 3] = 255;
  };
  draw(set, size);
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// stone blocks in courses, each block its own shade, lit from the top left
function blocks(base, spread, mortar, seed, rows = 4, minW = 12, maxW = 24) {
  return texture(64, (set, S) => {
    const r = rng(seed);
    const h = S / rows;
    for (let row = 0; row < rows; row++) {
      let x = Math.floor(r() * maxW) - maxW;
      while (x < S) {
        const w = Math.floor(minW + r() * (maxW - minW));
        const tint = (r() - 0.5) * spread;
        for (let yy = 0; yy < h; yy++)
          for (let xx = 0; xx < w; xx++) {
            const X = x + xx;
            const Y = row * h + yy;
            const edge = yy === 0 || xx === 0;
            const far = yy === h - 1 || xx === w - 1;
            if (yy === h - 1 || xx === w - 1) set(X, Y, ...mortar);
            else {
              const n = (r() - 0.5) * 18 + tint + (edge ? 16 : 0) + (yy === h - 2 || xx === w - 2 ? -14 : 0) + (far ? -10 : 0);
              set(X, Y, base[0] + n, base[1] + n, base[2] + n);
            }
          }
        x += w;
      }
    }
  });
}

function noise(base, spread, seed, speckle = null) {
  return texture(64, (set, S) => {
    const r = rng(seed);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const n = (r() - 0.5) * spread;
        set(x, y, base[0] + n, base[1] + n * 0.9, base[2] + n * 0.8);
      }
    if (speckle)
      for (let i = 0; i < speckle.count; i++) {
        const x = Math.floor(r() * S);
        const y = Math.floor(r() * S);
        const c = speckle.colors[Math.floor(r() * speckle.colors.length)];
        set(x, y, ...c);
        if (speckle.tall) set(x, y - 1, ...c);
      }
  });
}

function planks(base, seed, vertical = true, width = 10) {
  return texture(64, (set, S) => {
    const r = rng(seed);
    let p = 0;
    while (p < S) {
      const w = width + Math.floor(r() * 4) - 2;
      const tint = (r() - 0.5) * 30;
      for (let a = 0; a < w; a++)
        for (let b = 0; b < S; b++) {
          const grain = Math.sin((b + a * 3) * 0.4 + p) * 6 + (r() - 0.5) * 10;
          const gap = a === w - 1;
          const v = gap ? -55 : tint + grain + (a === 0 ? 12 : 0);
          const [x, y] = vertical ? [p + a, b] : [b, p + a];
          set(x, y, base[0] + v, base[1] + v * 0.8, base[2] + v * 0.6);
        }
      // nails
      const nx = p + Math.floor(w / 2);
      for (const ny of [6, 38]) {
        const [x, y] = vertical ? [nx, ny] : [ny, nx];
        set(x, y, 40, 36, 30);
      }
      p += w;
    }
  });
}

function siding() {
  return texture(64, (set, S) => {
    const r = rng(7);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const band = y % 8;
        const v = band === 0 ? 18 : band === 7 ? -40 : band === 6 ? -18 : 0;
        const n = (r() - 0.5) * 8 + v;
        set(x, y, 226 + n, 222 + n, 210 + n);
      }
  });
}

const TEXTURES = {};
function tex(name) {
  if (TEXTURES[name]) return TEXTURES[name];
  const t = {
    stone: () => blocks([104, 102, 98], 34, [52, 50, 48], 11),
    brick: () => blocks([136, 72, 56], 26, [70, 58, 52], 12, 8, 14, 18),
    flagstone: () => blocks([92, 90, 86], 30, [44, 42, 40], 13, 2, 26, 36),
    rock: () => noise([84, 78, 70], 40, 14, { count: 220, colors: [[60, 56, 50], [110, 104, 96]] }),
    planks: () => planks([128, 90, 56], 15, false, 9),
    wood: () => planks([104, 70, 42], 16, true, 12),
    siding: () => siding(),
    plaster: () => noise([196, 186, 168], 16, 17, { count: 90, colors: [[176, 166, 150]] }),
    grass: () => noise([74, 116, 52], 26, 18, { count: 380, colors: [[52, 92, 38], [96, 140, 64], [118, 150, 70]], tall: true }),
    dirt: () => noise([118, 90, 62], 30, 19, { count: 160, colors: [[90, 70, 50], [150, 128, 96]] }),
    sand: () => noise([196, 174, 128], 22, 20, { count: 120, colors: [[170, 150, 108]] }),
    leaves: () => noise([46, 92, 40], 46, 21, { count: 420, colors: [[30, 64, 30], [86, 132, 58]] }),
    bark: () => planks([86, 62, 44], 22, true, 5),
    metal: () => noise([120, 124, 130], 18, 23, { count: 60, colors: [[80, 84, 90], [170, 174, 180]] }),
    water: () => noise([40, 82, 128], 30, 24, { count: 140, colors: [[90, 140, 190], [28, 60, 100]] }),
    marble: () => noise([214, 210, 204], 14, 25, { count: 120, colors: [[170, 168, 176]] }),
    carpet: () => noise([128, 40, 48], 24, 26, { count: 300, colors: [[176, 128, 60], [90, 26, 34]] }),
    darkness: () => noise([14, 12, 18], 6, 27),
  }[name] ?? (() => noise([128, 128, 128], 20, 28));
  return (TEXTURES[name] = t());
}

const MATS = {};
function mat(name, repeat = 1) {
  const key = `${name}:${repeat}`;
  if (MATS[key]) return MATS[key];
  const map = tex(name).clone();
  map.needsUpdate = true;
  map.repeat.set(repeat, repeat);
  return (MATS[key] = new THREE.MeshLambertMaterial({ map, side: THREE.FrontSide }));
}
const flat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });

// ---- geometry helpers -------------------------------------------------------------

/** A wall as a flat shape with holes cut in it. UVs are in meters, so textures tile at real scale. */
function wallMesh(width, height, holes, material, tile = 1.6) {
  const s = new THREE.Shape();
  s.moveTo(-width / 2, 0);
  s.lineTo(width / 2, 0);
  s.lineTo(width / 2, height);
  s.lineTo(-width / 2, height);
  s.lineTo(-width / 2, 0);
  for (const h of holes) {
    const p = new THREE.Path();
    const x0 = h.x - h.w / 2;
    const x1 = h.x + h.w / 2;
    if (h.arch) {
      const r = h.w / 2;
      p.moveTo(x0, h.y);
      p.lineTo(x1, h.y);
      p.lineTo(x1, h.y + h.h - r);
      p.absarc(h.x, h.y + h.h - r, r, 0, Math.PI, false);
      p.lineTo(x0, h.y);
    } else {
      p.moveTo(x0, h.y);
      p.lineTo(x1, h.y);
      p.lineTo(x1, h.y + h.h);
      p.lineTo(x0, h.y + h.h);
      p.lineTo(x0, h.y);
    }
    s.holes.push(p);
  }
  const g = new THREE.ShapeGeometry(s, 12);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / tile, uv.getY(i) / tile);
  return new THREE.Mesh(g, material);
}

function box(w, h, d, material, x = 0, y = 0, z = 0, tile = 1.2) {
  const g = new THREE.BoxGeometry(w, h, d);
  // texture tiles per meter on every face
  const uv = g.attributes.uv;
  const n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(n.getX(i));
    const ny = Math.abs(n.getY(i));
    const sx = nx > 0.5 ? d : w;
    const sy = ny > 0.5 ? d : h;
    uv.setXY(i, (uv.getX(i) * sx) / tile, (uv.getY(i) * sy) / tile);
  }
  const m = new THREE.Mesh(g, material);
  m.position.set(x, y + h / 2, z);
  return m;
}

function cyl(rTop, rBot, h, material, seg = 8) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), material);
  m.position.y = h / 2;
  return m;
}

function flameTexture() {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 32;
  const g = c.getContext('2d');
  const rows = ['......11......', '.....1221.....', '....123321....', '...12344321...', '...12344321...', '..1234554321..', '..1234554321..', '...12344321...', '....123321....', '.....1221.....'];
  const col = { 1: '#ff5a1f', 2: '#ff9a2e', 3: '#ffcf4a', 4: '#fff09a', 5: '#ffffff' };
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (col[ch]) {
        g.fillStyle = col[ch];
        g.fillRect(x + 1, y * 3, 1, 3);
      }
    }),
  );
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let FLAME = null;

// ---- props ----------------------------------------------------------------------

/** Each prop is a group standing on its origin. The renderer places it. */
const PROP = {
  torch(ctx) {
    const g = new THREE.Group();
    const iron = flat(0x2b2724);
    const bracket = box(0.08, 0.28, 0.18, iron, 0, -0.32, 0.09);
    const cup = cyl(0.09, 0.05, 0.14, iron);
    cup.position.set(0, -0.06, 0.2);
    FLAME ??= flameTexture();
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: FLAME, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    flame.scale.set(0.22, 0.42, 1);
    flame.position.set(0, 0.22, 0.2);
    const light = new THREE.PointLight(0xffa24a, 9, 9, 1.6);
    light.position.set(0, 0.3, 0.45);
    ctx.flickers.push({ light, flame, base: 9, phase: Math.random() * 10 });
    g.add(bracket, cup, flame, light);
    return g;
  },
  crate() {
    const g = new THREE.Group();
    g.add(box(0.9, 0.8, 0.9, mat('wood')));
    const dark = flat(0x3c2a18);
    for (const s of [-1, 1]) g.add(box(0.94, 0.08, 0.94, dark, 0, s > 0 ? 0.72 : 0, 0));
    return g;
  },
  chest() {
    const g = new THREE.Group();
    g.add(box(1, 0.55, 0.6, mat('wood')));
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1, 10, 1, false, 0, Math.PI), mat('wood'));
    lid.rotation.z = Math.PI / 2;
    lid.position.y = 0.55;
    g.add(lid, box(1.02, 0.06, 0.62, flat(0x8a6a2a), 0, 0.5, 0));
    return g;
  },
  barrel() {
    const g = new THREE.Group();
    g.add(cyl(0.34, 0.3, 0.95, mat('wood'), 10));
    for (const y of [0.15, 0.78]) {
      const hoop = cyl(0.36, 0.36, 0.05, flat(0x3a3530), 10);
      hoop.position.y = y;
      g.add(hoop);
    }
    return g;
  },
  table() {
    const g = new THREE.Group();
    g.add(box(1.6, 0.08, 0.9, mat('wood'), 0, 0.74, 0));
    for (const [x, z] of [[-0.7, -0.38], [0.7, -0.38], [-0.7, 0.38], [0.7, 0.38]]) g.add(box(0.08, 0.74, 0.08, mat('wood'), x, 0, z));
    return g;
  },
  chair() {
    const g = new THREE.Group();
    g.add(box(0.5, 0.06, 0.5, mat('wood'), 0, 0.45, 0), box(0.5, 0.6, 0.06, mat('wood'), 0, 0.45, -0.22));
    for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) g.add(box(0.05, 0.45, 0.05, mat('wood'), x, 0, z));
    return g;
  },
  rug() {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.8), mat('carpet', 2));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.01;
    const g = new THREE.Group();
    g.add(m);
    return g;
  },
  'trophy-case'() {
    const g = new THREE.Group();
    g.add(box(1.6, 0.7, 0.5, mat('wood')));
    const glass = box(1.5, 0.9, 0.42, new THREE.MeshLambertMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.25 }), 0, 0.7, 0);
    g.add(glass, box(1.6, 0.06, 0.5, mat('wood'), 0, 1.6, 0));
    return g;
  },
  lantern() {
    const g = new THREE.Group();
    g.add(cyl(0.09, 0.11, 0.06, flat(0x9a7a2a)));
    const glass = cyl(0.08, 0.08, 0.2, new THREE.MeshLambertMaterial({ color: 0xffe28a, emissive: 0x6a4a00 }));
    glass.position.y = 0.16;
    const cap = cyl(0.05, 0.09, 0.06, flat(0x9a7a2a));
    cap.position.y = 0.29;
    g.add(glass, cap);
    return g;
  },
  sword() {
    const g = new THREE.Group();
    g.add(box(0.06, 0.9, 0.02, flat(0xc8d2e0), 0, 0.2, 0), box(0.3, 0.05, 0.04, flat(0x8a6a2a), 0, 0.18, 0), box(0.05, 0.18, 0.05, flat(0x4a3420), 0, 0, 0));
    return g;
  },
  mailbox() {
    const g = new THREE.Group();
    g.add(box(0.1, 1.05, 0.1, mat('wood')));
    const b = box(0.32, 0.3, 0.55, flat(0x7a7f86), 0, 1.0, 0);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.55, 10, 1, false, 0, Math.PI), flat(0x7a7f86));
    top.rotation.x = Math.PI / 2;
    top.rotation.z = Math.PI / 2;
    top.position.y = 1.3;
    g.add(b, top, box(0.03, 0.18, 0.08, flat(0xc8352a), 0.18, 1.25, 0.1));
    return g;
  },
  tree(ctx, p) {
    const g = new THREE.Group();
    const h = 2.6 * (p.scale ?? 1);
    g.add(cyl(0.16, 0.24, h, mat('bark'), 7));
    const leaf = mat('leaves', 1);
    for (let i = 0; i < 4; i++) {
      const s = 1.6 - i * 0.3;
      const c = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), leaf);
      c.position.set((i % 2 ? 0.3 : -0.25) * (i ? 1 : 0), h + i * 0.55 - 0.2, (i % 3 ? 0.2 : -0.2) * (i ? 1 : 0));
      g.add(c);
    }
    return g;
  },
  bush() {
    const g = new THREE.Group();
    const c = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 0), mat('leaves'));
    c.position.y = 0.4;
    c.scale.y = 0.7;
    g.add(c);
    return g;
  },
  boulder() {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7, 0), mat('rock'));
    m.position.y = 0.45;
    m.scale.set(1.2, 0.8, 1);
    g.add(m);
    return g;
  },
  house(ctx, p) {
    // the white house of Zork: clapboard walls, a boarded door, boarded windows, a dark roof
    const g = new THREE.Group();
    const w = p.width ?? 9;
    const h = 3.6;
    // big clapboards: thin stripes shimmer at the chunky resolution
    g.add(box(w, h, 6, mat('siding'), 0, 0, 0, 3.2));
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 4.6, 2.4, 4, 1), flat(0x3a2f3a));
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(w / 6.2, 1, 1.05);
    roof.position.y = h + 1.15;
    g.add(roof);
    const board = mat('planks');
    // "door": false draws a side of the house with no door, only boarded windows
    const hasDoor = p.door !== false;
    if (hasDoor) {
      const door = box(1.1, 2.1, 0.08, mat('wood'), 0, 0, 3.02);
      g.add(door);
      for (const [y, r] of [[0.8, 0.5], [1.5, -0.45]]) {
        const b = box(1.5, 0.18, 0.05, board, 0, y, 3.08);
        b.rotation.z = r;
        g.add(b);
      }
      ctx.clickable(door, p.label ?? 'the boarded front door', p.cmd ?? 'open door');
    }
    // "windows": false draws a bare side (behind the house the text names only one small window)
    for (const x of p.windows === false ? [] : hasDoor ? [-w / 3, w / 3] : [-w / 3, 0, w / 3]) {
      const pane = box(1.0, 1.1, 0.06, flat(0x1d1a24), x, 1.3, 3.02);
      g.add(pane);
      for (const y of [1.45, 1.75]) g.add(box(1.2, 0.14, 0.05, board, x, y, 3.07));
      if (!hasDoor) ctx.clickable(pane, p.label ?? 'a boarded window', p.cmd ?? 'open window');
    }
    return g;
  },
  window(ctx, p) {
    const g = new THREE.Group();
    const frame = flat(0x5a4632);
    g.add(box(1.1, 0.08, 0.1, frame, 0, 0, 0), box(1.1, 0.08, 0.1, frame, 0, 1.0, 0), box(0.08, 1.08, 0.1, frame, -0.55, 0, 0), box(0.08, 1.08, 0.1, frame, 0.55, 0, 0));
    const glass = new THREE.MeshLambertMaterial({ color: p.open ? 0x0d0b12 : 0x89b6d8, transparent: !p.open, opacity: 0.5 });
    if (p.ajar && !p.open) {
      // "slightly ajar": the sash is pushed up a hand's width, a dark gap below it
      g.add(box(1.0, 0.14, 0.02, flat(0x0d0b12), 0, 0.04, 0));
      g.add(box(1.0, 0.86, 0.02, glass, 0, 0.18, 0.03), box(1.04, 0.05, 0.06, frame, 0, 0.16, 0.03));
    } else g.add(box(1.0, 1.0, 0.02, glass, 0, 0.04, 0));
    return g;
  },
  pillar() {
    const g = new THREE.Group();
    g.add(cyl(0.3, 0.34, 3.2, mat('marble'), 10), box(0.8, 0.2, 0.8, mat('marble')));
    return g;
  },
  stalagmite() {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.4, 6), mat('rock'));
    m.position.y = 0.7;
    g.add(m);
    return g;
  },
  altar() {
    const g = new THREE.Group();
    g.add(box(1.8, 0.9, 0.9, mat('marble')), box(2, 0.1, 1, mat('marble'), 0, 0.9, 0));
    return g;
  },
  coffin() {
    const g = new THREE.Group();
    g.add(box(0.8, 0.5, 2, mat('wood')), box(0.86, 0.08, 2.06, flat(0xb8902a), 0, 0.5, 0));
    return g;
  },
  skeleton() {
    const g = new THREE.Group();
    const bone = flat(0xe8e2cc);
    g.add(box(0.22, 0.2, 0.22, bone, 0, 0, -0.7), box(0.35, 0.08, 0.7, bone, 0, 0, -0.2), box(0.06, 0.06, 0.8, bone, -0.12, 0, 0.45), box(0.06, 0.06, 0.8, bone, 0.12, 0, 0.45));
    return g;
  },
  bones() {
    const g = new THREE.Group();
    const bone = flat(0xe8e2cc);
    for (let i = 0; i < 6; i++) {
      const b = box(0.5, 0.05, 0.06, bone, (i - 3) * 0.12, 0, (i % 2) * 0.2);
      b.rotation.y = i * 0.9;
      g.add(b);
    }
    return g;
  },
  sign() {
    const g = new THREE.Group();
    g.add(box(0.08, 1.2, 0.08, mat('wood')), box(0.8, 0.45, 0.05, mat('planks'), 0, 1.0, 0.05));
    return g;
  },
  fireplace() {
    const g = new THREE.Group();
    g.add(box(1.8, 1.6, 0.6, mat('brick')), box(1.0, 0.9, 0.62, flat(0x0d0b0b), 0, 0, 0.01), box(2.0, 0.12, 0.7, mat('stone'), 0, 1.6, 0));
    return g;
  },
  painting() {
    const g = new THREE.Group();
    g.add(box(1.0, 0.75, 0.05, flat(0x8a6a2a)), box(0.86, 0.6, 0.06, flat(0x31556e), 0, 0.075, 0));
    return g;
  },
  bars() {
    const g = new THREE.Group();
    for (let i = 0; i < 7; i++) g.add(box(0.05, 2.2, 0.05, flat(0x3a3a40), -0.6 + i * 0.2, 0, 0));
    g.add(box(1.4, 0.06, 0.06, flat(0x3a3a40), 0, 2.15, 0));
    return g;
  },
  rope() {
    const g = new THREE.Group();
    const r = cyl(0.03, 0.03, 3, flat(0xb59a5a), 5);
    g.add(r);
    return g;
  },
  puddle() {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.8, 10), new THREE.MeshLambertMaterial({ map: tex('water'), transparent: true, opacity: 0.8 }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.01;
    m.scale.set(1.4, 1, 1);
    const g = new THREE.Group();
    g.add(m);
    return g;
  },
  pile() {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.45, 7), new THREE.MeshLambertMaterial({ color: 0xe0b23a, emissive: 0x3a2800 }));
    m.position.y = 0.22;
    g.add(m);
    return g;
  },
  nest() {
    const g = new THREE.Group();
    const n = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.08, 4, 8), flat(0x6a4a2a));
    n.rotation.x = Math.PI / 2;
    n.position.y = 0.08;
    const egg = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), new THREE.MeshLambertMaterial({ color: 0xd8c070, emissive: 0x302000 }));
    egg.position.y = 0.14;
    egg.scale.y = 1.3;
    g.add(n, egg);
    return g;
  },
  sack() {
    const g = new THREE.Group();
    const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.25, 0), flat(0x8a6a3a));
    s.position.y = 0.2;
    s.scale.set(1.4, 0.8, 0.8);
    g.add(s);
    return g;
  },
  bottle() {
    const g = new THREE.Group();
    g.add(cyl(0.06, 0.07, 0.24, new THREE.MeshLambertMaterial({ color: 0x9ad0b0, transparent: true, opacity: 0.7 })));
    const neck = cyl(0.025, 0.03, 0.1, new THREE.MeshLambertMaterial({ color: 0x9ad0b0, transparent: true, opacity: 0.7 }));
    neck.position.y = 0.29;
    g.add(neck);
    return g;
  },
  boards() {
    const g = new THREE.Group();
    for (const [y, r] of [[0.6, 0.3], [1.2, -0.25], [1.7, 0.1]]) {
      const b = box(1.4, 0.16, 0.05, mat('planks'), 0, y, 0);
      b.rotation.z = r;
      g.add(b);
    }
    return g;
  },
  stairs(ctx, p) {
    const g = new THREE.Group();
    const n = p.steps ?? 8;
    for (let i = 0; i < n; i++) g.add(box(1.2, 0.2 * (i + 1), 0.3, mat(p.material ?? 'wood'), 0, 0, -i * 0.3));
    return g;
  },
};

// ---- exits ----------------------------------------------------------------------

const DIR_WALL = { north: 'north', south: 'south', east: 'east', west: 'west', ne: 'north', nw: 'north', se: 'south', sw: 'south', in: 'north', out: 'south', land: 'south' };
const DIR_SHIFT = { ne: 0.32, nw: -0.32, se: -0.32, sw: 0.32 };
const DEFAULT_EXIT = { up: 'stairs', down: 'trapdoor', in: 'door', out: 'door' };
// tooltips speak in full words: "Go southeast to South of House", never "se"
const DIR_WORD = { ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest', land: 'ashore' };
const goLabel = (dir, to) => `Go ${DIR_WORD[dir] ?? dir}${to ? ` to ${to}` : ''}`;

// ---- the scene -----------------------------------------------------------------------

export function createScene(root, { onCommand = () => {}, rooms = [], remastered = new Set() } = {}) {
  root.classList.add('sc');
  root.innerHTML = `
    <div class="sc-bar">
      <span class="sc-view">VIEW: PERSPECTIVE</span>
      <span class="sc-right">
        <span class="sc-count"></span>
        <button type="button" class="sc-light">LIGHTING: ON</button>
        <button type="button" class="sc-wire">WIREFRAME: PARTIAL</button>
      </span>
    </div>
    <div class="sc-stage">
      <canvas></canvas>
      <div class="sc-split" title="Drag to compare the remaster with its wireframe"></div>
      <div class="sc-tip"></div>
      <div class="sc-cap"><b></b><span></span></div>
      <div class="sc-tag sc-tag-remaster" hidden>REMASTER</div>
      <div class="sc-tag sc-tag-map" hidden>MAP</div>
      <div class="sc-tag sc-tag-todo" hidden>NOT REMASTERED YET</div>
      <div class="sc-hint"></div>
    </div>
    <div class="sc-ruler"></div>`;
  const canvas = root.querySelector('canvas');
  const stage = root.querySelector('.sc-stage');
  const tip = root.querySelector('.sc-tip');
  const splitEl = root.querySelector('.sc-split');
  const tags = { remaster: root.querySelector('.sc-tag-remaster'), map: root.querySelector('.sc-tag-map'), todo: root.querySelector('.sc-tag-todo') };
  const ruler = root.querySelector('.sc-ruler');
  // places, not room objects: the 15 maze rooms are one place with one scene; numbered in game order
  const places = [...new Set(rooms.map((r) => r.slug))];

  // the hint fades by itself 6 seconds after the view comes into sight, or at the first touch
  const hint = root.querySelector('.sc-hint');
  hint.textContent = `drag to look around · ${matchMedia('(pointer: coarse)').matches ? 'tap' : 'click'} a doorway or an object`;
  const hideHint = () => hint.classList.add('gone');
  root.addEventListener('pointerdown', hideHint, { capture: true, once: true });
  if ('IntersectionObserver' in window) {
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      seen.disconnect();
      setTimeout(hideHint, 6000);
    }, { threshold: 0.5 });
    seen.observe(stage);
  } else setTimeout(hideHint, 6000);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const camera = new THREE.PerspectiveCamera(64, 16 / 9, 0.05, 200);
  let solid = new THREE.Scene();
  let wire = new THREE.Scene();
  let ctx = null;
  let room = null;
  let lighting = true;
  let wireMode = 'partial';
  let split = 0.72;
  let yaw = 0;
  let pitch = -0.06;
  let base = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hover = null;
  let interacted = false;
  let meters = 0;

  function resize() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(Math.max(1, Math.round(w / PIXEL)), Math.max(1, Math.round(h / PIXEL)), false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    drawRuler();
    syncWireButton();
  }

  // a label every 1, 2, 4, 5 or 10 meters, whatever leaves each label room to breathe at this width
  function drawRuler() {
    if (!meters) return;
    const perMeter = (ruler.clientWidth - 110) / meters;
    const step = [1, 2, 4, 5, 10].find((s) => perMeter * s >= 36) ?? 10;
    ruler.innerHTML = `<span class="sc-ticks">${Array.from({ length: meters + 1 }, (_, i) => (i % step === 0 ? `<i class="n" style="left:${(i / meters) * 100}%">${i}</i>` : `<i style="left:${(i / meters) * 100}%"></i>`)).join('')}</span><em>METERS</em>`;
  }
  new ResizeObserver(resize).observe(stage);

  function build(info, spec) {
    const built = !!spec;
    const S = spec ?? {};
    const outdoor = S.kind === 'outdoor';
    const exitsGame = info?.exits ?? {};
    const sceneExits = {};
    for (const [dir, e] of Object.entries(exitsGame)) {
      if (e.kind === 'blocked') continue;
      sceneExits[dir] = { type: DEFAULT_EXIT[dir] ?? (outdoor ? 'path' : 'passage'), to: e.toName };
    }
    for (const [dir, e] of Object.entries(S.exits ?? {})) sceneExits[dir] = { ...(sceneExits[dir] ?? {}), ...e };

    const [W, H, D] = S.size ?? (outdoor ? [16, 6, 16] : [6 + Object.keys(sceneExits).length * 0.4, 3.2, 7]);
    camera.clear();
    solid = new THREE.Scene();
    wire = new THREE.Scene();
    ctx = { flickers: [], clickables: [], clickable: (obj, label, cmd) => {
      obj.userData.click = { label, cmd };
      ctx.clickables.push(obj);
    } };

    // light
    const ambient = S.ambient ?? (outdoor ? 0.9 : 0.35);
    if (outdoor) {
      const sky = document.createElement('canvas');
      sky.width = 2;
      sky.height = 64;
      const sg = sky.getContext('2d');
      const grad = sg.createLinearGradient(0, 0, 0, 64);
      grad.addColorStop(0, S.sky ?? '#6f8fd8');
      grad.addColorStop(1, '#d9e4f2');
      sg.fillStyle = grad;
      sg.fillRect(0, 0, 2, 64);
      const st = new THREE.CanvasTexture(sky);
      st.colorSpace = THREE.SRGBColorSpace;
      solid.background = st;
      solid.fog = new THREE.Fog(0xc8d6ea, 18, 46);
      solid.add(new THREE.HemisphereLight(0xdbe8ff, 0x4a6a30, ambient * 2.2));
      const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
      sun.position.set(-6, 10, 4);
      solid.add(sun);
    } else {
      solid.background = new THREE.Color(0x07060a);
      solid.fog = new THREE.Fog(0x07060a, Math.max(W, D) * 0.9, Math.max(W, D) * 2.4);
      // lit rooms get warm daylight from above, dark rooms only a cold trace of ambient
      solid.add(new THREE.AmbientLight(ambient > 0.4 ? 0xfff0dc : 0x9a90c0, ambient * (ambient > 0.4 ? 0.7 : 1)));
      if (ambient > 0.4) {
        const sky = new THREE.PointLight(0xffe6c4, 14 * ambient, Math.max(W, D) * 1.6, 1.2);
        sky.position.set(0, H - 0.3, 0);
        solid.add(sky);
        const fill = new THREE.HemisphereLight(0xfff4e6, 0x6a5040, 0.6 * ambient);
        solid.add(fill);
      }
      if (S.lantern) ctx.lantern = new THREE.PointLight(0xffe2b0, 7, 10, 1.4);
    }
    solid.add(camera);
    if (ctx.lantern) camera.add(ctx.lantern);

    const wallMat = mat(S.walls ?? (outdoor ? 'grass' : 'stone'));
    const floorMat = mat(S.floor ?? (outdoor ? 'grass' : 'flagstone'));
    const ceilMat = mat(S.ceiling ?? S.walls ?? 'stone');

    if (outdoor) {
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), mat(S.floor ?? 'grass', 30));
      ground.rotation.x = -Math.PI / 2;
      solid.add(ground);
      if (S.path) {
        const path = new THREE.Mesh(new THREE.PlaneGeometry(S.path.width ?? 2.2, S.path.length ?? 40), mat('dirt', 8));
        path.rotation.x = -Math.PI / 2;
        path.rotation.z = ((S.path.angle ?? 0) * Math.PI) / 180;
        path.position.set(S.path.x ?? 0, 0.01, S.path.z ?? 0);
        solid.add(path);
      }
      // exits outdoors: a glowing marker at the edge of the clearing, toward the direction
      for (const [dir, e] of Object.entries(sceneExits)) {
        if (e.type === 'none') continue;
        const v = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0], ne: [0.7, -0.7], nw: [-0.7, -0.7], se: [0.7, 0.7], sw: [-0.7, 0.7] }[dir];
        if (!v) continue;
        const r = W * 0.42;
        const marker = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.8, 4), new THREE.MeshBasicMaterial({ color: LIME }));
        marker.rotation.x = Math.PI;
        marker.position.set(v[0] * r, 0.9, v[1] * r);
        ctx.flickers.push({ bob: marker, phase: Math.random() * 6 });
        solid.add(marker);
        ctx.clickable(marker, goLabel(dir, e.to), dir);
      }
    } else {
      // floor and ceiling
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat.clone());
      floor.material.map = floorMat.map.clone();
      floor.material.map.repeat.set(W / 2.4, D / 2.4);
      floor.material.map.needsUpdate = true;
      floor.rotation.x = -Math.PI / 2;
      const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), ceilMat.clone());
      ceil.material.map = ceilMat.map.clone();
      ceil.material.map.repeat.set(W / 1.8, D / 1.8);
      ceil.material.map.needsUpdate = true;
      ceil.rotation.x = Math.PI / 2;
      ceil.position.y = H;
      solid.add(floor, ceil);

      // walls with openings
      const walls = { north: [], south: [], east: [], west: [] };
      for (const [dir, e] of Object.entries(sceneExits)) {
        if (e.type === 'none') continue;
        if (dir === 'up' || dir === 'down') continue;
        const wall = e.wall ?? DIR_WALL[dir];
        if (!wall) continue;
        walls[wall].push({ dir, e });
      }
      const span = { north: W, south: W, east: D, west: D };
      for (const [wall, list] of Object.entries(walls)) {
        const len = span[wall];
        const holesW = [];
        list.forEach((x, i) => {
          const t = x.e.type;
          const shift = x.e.at ?? (DIR_SHIFT[x.dir] !== undefined ? DIR_SHIFT[x.dir] * len : (i - (list.length - 1) / 2) * Math.min(2.6, len / (list.length + 1)));
          const dims = { passage: [1.6, 2.4], arch: [1.7, 2.6], door: [1.1, 2.15], crawl: [1.0, 0.95], window: [1.1, 1.0], chimney: [0.9, 1.2], hole: [1.3, 1.3], ramp: [1.6, 2.4], stairs: [1.4, 2.5], path: [2, 2.6], trapdoor: [1.4, 2.4] }[t] ?? [1.5, 2.3];
          const y = t === 'window' ? 1.0 : 0;
          holesW.push({ x: shift, y, w: dims[0], h: Math.min(dims[1], H - 0.25), arch: t === 'arch', ...x });
        });
        const mesh = wallMesh(len, H, holesW, wallMat, 1.6);
        const place = {
          north: (m) => m.position.set(0, 0, -D / 2),
          south: (m) => {
            m.position.set(0, 0, D / 2);
            m.rotation.y = Math.PI;
          },
          east: (m) => {
            m.position.set(W / 2, 0, 0);
            m.rotation.y = -Math.PI / 2;
          },
          west: (m) => {
            m.position.set(-W / 2, 0, 0);
            m.rotation.y = Math.PI / 2;
          },
        }[wall];
        place(mesh);
        solid.add(mesh);
        // what lies beyond each opening: a short dark passage, and a target to click
        for (const h of holesW) {
          const g = new THREE.Group();
          place(g);
          const depth = h.e.type === 'window' ? 0.3 : 2.2;
          const tun = new THREE.Group();
          const tw = h.w;
          const th = h.h;
          const tmat = wallMat;
          tun.add(box(0.1, th, depth, tmat, h.x - tw / 2 - 0.05, h.y, -depth / 2));
          tun.add(box(0.1, th, depth, tmat, h.x + tw / 2 + 0.05, h.y, -depth / 2));
          tun.add(box(tw + 0.2, 0.1, depth, tmat, h.x, h.y + th, -depth / 2));
          tun.add(box(tw, 0.05, depth, floorMat, h.x, h.y - 0.05, -depth / 2));
          const back = new THREE.Mesh(new THREE.PlaneGeometry(tw, th), new THREE.MeshBasicMaterial({ color: 0x050407 }));
          back.position.set(h.x, h.y + th / 2, -depth + 0.01);
          tun.add(back);
          g.add(tun);
          if (h.e.type === 'door') {
            const leaf = box(h.w - 0.08, h.h - 0.05, 0.07, mat('wood'), 0, 0, 0);
            const pivot = new THREE.Group();
            pivot.position.set(h.x - h.w / 2 + 0.04, h.y, -0.06);
            leaf.position.x = (h.w - 0.08) / 2;
            pivot.add(leaf);
            pivot.rotation.y = h.e.closed ? 0 : -0.9;
            g.add(pivot);
          }
          if (h.e.type === 'window') {
            const fr = PROP.window(ctx, { open: !h.e.closed });
            fr.position.set(h.x, h.y - 0.04, 0);
            g.add(fr);
          }
          if (h.e.type === 'ramp') {
            const ramp = box(h.w - 0.1, 0.06, depth, mat('metal'), h.x, h.y, -depth / 2);
            ramp.rotation.x = 0.35;
            ramp.position.y = 0.4;
            g.add(ramp);
          }
          const target = new THREE.Mesh(new THREE.PlaneGeometry(h.w, h.h), new THREE.MeshBasicMaterial({ visible: false }));
          target.position.set(h.x, h.y + h.h / 2, -0.02);
          g.add(target);
          ctx.clickable(target, h.e.label ?? goLabel(h.dir, h.e.to), h.e.cmd ?? h.dir);
          solid.add(g);
        }
      }

      // up and down: stairs, a trap door, a hole or a chimney
      for (const dir of ['up', 'down']) {
        const e = sceneExits[dir];
        if (!e || e.type === 'none') continue;
        const t = e.type;
        const label = e.label ?? goLabel(dir, e.to);
        if (t === 'stairs') {
          const st = PROP.stairs(ctx, { steps: 10, material: e.material });
          const wall = e.wall ?? 'east';
          const x = wall === 'east' ? W / 2 - 0.8 : wall === 'west' ? -W / 2 + 0.8 : 0;
          st.position.set(x, dir === 'down' ? -2 : 0, -D / 2 + 3.2);
          if (dir === 'down') st.rotation.y = Math.PI;
          solid.add(st);
          const target = box(1.2, 2, 3, new THREE.MeshBasicMaterial({ visible: false }), x, 0, -D / 2 + 1.8);
          solid.add(target);
          ctx.clickable(target, label, e.cmd ?? dir);
        } else {
          const y = dir === 'up' ? H - 0.01 : 0.02;
          const [x, z] = e.at ?? [0, -D / 4];
          const hatch = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), t === 'trapdoor' ? mat('wood') : new THREE.MeshBasicMaterial({ color: 0x050407 }));
          hatch.rotation.x = dir === 'up' ? Math.PI / 2 : -Math.PI / 2;
          hatch.position.set(x, y, z);
          solid.add(hatch);
          if (t === 'trapdoor') {
            const rim = new THREE.Mesh(new THREE.RingGeometry(0.66, 0.78, 4, 1), flat(0x3a2a1a));
            rim.rotation.x = hatch.rotation.x;
            rim.rotation.z = Math.PI / 4;
            rim.position.copy(hatch.position);
            rim.position.y += dir === 'up' ? -0.005 : 0.005;
            solid.add(rim);
          }
          ctx.clickable(hatch, label, e.cmd ?? dir);
        }
      }
    }

    // props
    for (const p of S.props ?? []) {
      const make = PROP[p.type];
      if (!make) continue;
      let g;
      try {
        g = make(ctx, p);
      } catch (e) {
        console.warn(`prop ${p.type} could not be drawn`, e);
        continue;
      }
      if (p.wall) {
        const [u, v] = p.at ?? [0, 1.5];
        const inset = 0.02;
        const pos = {
          north: [u, v, -D / 2 + inset, 0],
          south: [-u, v, D / 2 - inset, Math.PI],
          east: [W / 2 - inset, v, u, -Math.PI / 2],
          west: [-W / 2 + inset, v, -u, Math.PI / 2],
        }[p.wall];
        g.position.set(pos[0], pos[1], pos[2]);
        g.rotation.y = pos[3];
      } else {
        const [x, y, z] = p.at ?? [0, 0, 0];
        g.position.set(x, y, z);
        g.rotation.y = ((p.rot ?? 0) * Math.PI) / 180;
      }
      if (p.scale && p.type !== 'tree') g.scale.setScalar(p.scale);
      if (p.cmd || p.label) ctx.clickable(g, p.label ?? p.type, p.cmd ?? `examine ${p.type}`);
      solid.add(g);
    }

    // the wireframe twin: every mesh's edges in lime on deep violet
    wire.background = new THREE.Color(DEEP);
    solid.updateMatrixWorld(true);
    const lineMat = new THREE.LineBasicMaterial({ color: LIME, transparent: true, opacity: built ? 0.85 : 0.9 });
    solid.traverse((o) => {
      if (!o.isMesh || !o.material || o.material.visible === false) return;
      if (o.geometry.type === 'PlaneGeometry' && o.material.isMeshBasicMaterial) return;
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 25), lineMat);
      lines.matrixAutoUpdate = false;
      lines.matrix.copy(o.matrixWorld);
      wire.add(lines);
    });
    const grid = new THREE.GridHelper(outdoor ? 40 : Math.max(W, D) * 2, outdoor ? 40 : Math.round(Math.max(W, D) * 2), 0x6a3cff, 0x3a2a8a);
    grid.position.y = 0.005;
    wire.add(grid);

    // camera: near the south side, looking north into the room
    base.pos.set(S.camera?.[0] ?? 0, S.camera?.[1] ?? 1.6, S.camera?.[2] ?? (outdoor ? 8 : D / 2 - 0.5));
    base.look.set(S.look?.[0] ?? 0, S.look?.[1] ?? (outdoor ? 1.6 : 1.3), S.look?.[2] ?? (outdoor ? -4 : -D / 2));
    yaw = 0;
    pitch = 0;

    // HUD
    const place = places.indexOf(info?.slug);
    root.querySelector('.sc-cap b').textContent = `ZORK I / ${place >= 0 ? `ROOM ${place + 1} OF ${places.length} / ` : ''}${built ? 'REMASTERED' : 'WIREFRAME'}`;
    root.querySelector('.sc-cap span').textContent = info?.name ?? '';
    root.querySelector('.sc-count').textContent = places.length ? `ROOMS: ${places.filter((s) => remastered.has(s)).length}/${places.length} REMASTERED` : '';
    root.querySelector('.sc-wire').disabled = !built;
    meters = Math.max(4, Math.round(W));
    drawRuler();
    room = { built };
    syncWireButton();
  }

  function syncWireButton() {
    const b = root.querySelector('.sc-wire');
    const mode = room?.built ? wireMode : 'full';
    b.textContent = `WIREFRAME: ${mode.toUpperCase()}`;
    root.querySelector('.sc-light').textContent = `LIGHTING: ${lighting ? 'ON' : 'OFF'}`;
    splitEl.style.display = mode === 'partial' ? 'block' : 'none';
    splitEl.style.left = `${split * 100}%`;
    // the share of the frame that shows the remaster: the hint stays inside it, clear of the seam
    stage.style.setProperty('--solid', mode === 'partial' ? split : 1);
    // tags name the halves: REMASTER over the textured part, MAP over the wireframe part
    const width = stage.clientWidth;
    const seam = mode === 'partial' ? width * split : mode === 'off' ? width : 0;
    const tag = (el, on, space) => {
      el.hidden = !on;
      if (on) el.style.visibility = el.offsetWidth + 20 <= space ? '' : 'hidden';
    };
    tag(tags.remaster, !!room?.built && mode !== 'full', seam);
    tag(tags.map, !!room?.built && mode !== 'off', width - seam);
    tag(tags.todo, !!room && !room.built, width);
  }

  root.querySelector('.sc-light').addEventListener('click', () => {
    lighting = !lighting;
    syncWireButton();
  });
  root.querySelector('.sc-wire').addEventListener('click', () => {
    wireMode = { partial: 'off', off: 'full', full: 'partial' }[wireMode];
    syncWireButton();
  });

  // drag the split line
  splitEl.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    splitEl.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const b = stage.getBoundingClientRect();
      split = Math.min(0.97, Math.max(0.03, (ev.clientX - b.left) / b.width));
      syncWireButton();
    };
    const up = () => {
      splitEl.removeEventListener('pointermove', move);
      splitEl.removeEventListener('pointerup', up);
    };
    splitEl.addEventListener('pointermove', move);
    splitEl.addEventListener('pointerup', up);
  });

  // look around by dragging; a click without a drag acts on what is under the cursor.
  // On touch screens the canvas lets vertical swipes scroll the page (touch-action: pan-y): the browser then
  // cancels the pointer, and only horizontal drags turn the view.
  let drag = null;
  const aim = (e) => {
    const b = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
    pick(e.clientX - b.left, e.clientY - b.top);
  };
  const letGo = () => {
    hover = null;
    tip.style.opacity = '0';
    canvas.style.cursor = '';
  };
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, yaw, pitch, moved: false };
    canvas.setPointerCapture(e.pointerId);
    // a tap has no hover before it: find what is under the finger now
    aim(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (drag) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      yaw = Math.max(-0.9, Math.min(0.9, drag.yaw - dx * 0.004));
      pitch = Math.max(-0.45, Math.min(0.45, drag.pitch - dy * 0.003));
      if (drag.moved) markInteracted();
    }
    aim(e);
  });
  canvas.addEventListener('pointerup', (e) => {
    if (drag && !drag.moved && hover) {
      markInteracted();
      onCommand(hover.userData.click.cmd);
    }
    drag = null;
    if (e.pointerType !== 'mouse') letGo();
  });
  canvas.addEventListener('pointercancel', () => {
    drag = null;
    letGo();
  });
  canvas.addEventListener('pointerleave', letGo);

  function markInteracted() {
    if (interacted) return;
    interacted = true;
    hideHint();
  }

  function pick(x, y) {
    if (!ctx) return;
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(ctx.clickables, true);
    let found = null;
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.click) o = o.parent;
      if (o) {
        found = o;
        break;
      }
    }
    hover = found;
    canvas.style.cursor = found ? 'pointer' : drag ? 'grabbing' : 'grab';
    if (found) {
      tip.textContent = found.userData.click.label;
      tip.style.left = `${x + 14}px`;
      tip.style.top = `${y + 10}px`;
      tip.style.opacity = '1';
    } else tip.style.opacity = '0';
  }

  const t0 = performance.now();
  function frame() {
    requestAnimationFrame(frame);
    if (!ctx || !stage.clientWidth) return;
    const t = (performance.now() - t0) / 1000;
    for (const f of ctx.flickers) {
      if (f.light) {
        f.light.intensity = (lighting ? 1 : 0) * f.base * (0.82 + Math.sin(t * 13 + f.phase) * 0.08 + Math.sin(t * 7.3 + f.phase * 2) * 0.1);
        f.flame.scale.y = 0.42 + Math.sin(t * 17 + f.phase) * 0.04;
      }
      if (f.bob) f.bob.position.y = 0.9 + Math.sin(t * 2.2 + f.phase) * 0.12;
    }
    if (ctx.lantern) ctx.lantern.intensity = lighting ? 7 : 0;
    solid.traverse((o) => {
      if ((o.isAmbientLight || o.isHemisphereLight) && o.userData.base === undefined) o.userData.base = o.intensity;
      if (o.isAmbientLight || o.isHemisphereLight) o.intensity = lighting ? o.userData.base : 3;
    });
    // a slow breath of movement so the room never looks frozen
    const sway = interacted ? 0 : Math.sin(t * 0.35) * 0.06;
    camera.position.copy(base.pos);
    const dir = base.look.clone().sub(base.pos);
    const dist = dir.length();
    const ang = Math.atan2(dir.x, -dir.z) + yaw + sway;
    const el = Math.asin(dir.y / dist) + pitch;
    camera.lookAt(base.pos.x + Math.sin(ang) * Math.cos(el) * dist, base.pos.y + Math.sin(el) * dist, base.pos.z - Math.cos(ang) * Math.cos(el) * dist);

    const w = renderer.domElement.width;
    const h = renderer.domElement.height;
    const mode = room?.built ? wireMode : 'full';
    renderer.setScissorTest(true);
    if (mode !== 'full') {
      const sx = mode === 'off' ? w : Math.round(w * split);
      renderer.setScissor(0, 0, sx, h);
      renderer.render(solid, camera);
      if (sx < w) {
        renderer.setScissor(sx, 0, w - sx, h);
        renderer.render(wire, camera);
      }
    } else {
      renderer.setScissor(0, 0, w, h);
      renderer.render(wire, camera);
    }
    renderer.setScissorTest(false);
  }
  requestAnimationFrame(frame);

  return {
    show(info, spec) {
      try {
        build(info, spec);
      } catch (e) {
        // a broken scene file never leaves a black screen: draw the room from the map instead
        console.warn(`scene for ${info?.name} failed, showing the wireframe`, e);
        build(info, null);
      }
      resize();
    },
    setRemastered(set) {
      remastered = set;
    },
  };
}

/** Validates a scene spec against the kit. Returns a list of problems (empty when fine). */
export function checkSpec(spec) {
  const bad = [];
  for (const k of ['walls', 'floor', 'ceiling']) if (spec[k] && !MATERIALS.includes(spec[k])) bad.push(`unknown material ${spec[k]}`);
  for (const p of spec.props ?? []) if (!PROPS.includes(p.type)) bad.push(`unknown prop ${p.type}`);
  for (const [d, e] of Object.entries(spec.exits ?? {})) if (e.type && !EXITS.includes(e.type)) bad.push(`unknown exit type ${e.type} (${d})`);
  return bad;
}
