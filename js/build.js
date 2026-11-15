import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { H, T, RECTS, POLYS, OPENINGS, BAY, LOGGIA } from './data.js';

export const solids = [];      // AABB препятствий для коллизий {x0,x1,z0,z1}
export const segments = [];    // отрезки стен для коллизий [x1,z1,x2,z2]
export const ceilings = [];    // объекты, скрываемые в режиме обзора
export const lights = [];

const D2R = Math.PI / 180;
let TX, META; // фото-текстуры (tex/*.jpg) и их физические размеры
const matCache = new Map();
export function M(color, o = {}) {
  const key = color + JSON.stringify(o, (k, v) => (v && v.isTexture ? v.uuid : v));
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0, ...o });
  matCache.set(key, m); return m;
}
// текстура для архитектуры: повтор по реальному размеру (UV в метрах)
const archCache = {};
function AT(key) {
  if (archCache[key]) return archCache[key];
  const t = TX[key].clone(); const [w, h] = META[key] || [1, 1]; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / w, 1 / h); t.needsUpdate = true;
  return (archCache[key] = t);
}
// текстура «на грань» (UV 0..1), с повтором n×m
function FT(key, rx = 1, ry = 1) { const t = TX[key].clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.needsUpdate = true; return t; }
const PM = (key, o = {}) => M('#ffffff', { map: AT(key), roughness: 0.85, ...o });       // материал с фото-текстурой (метры)
const FM = (key, rx = 1, ry = 1, o = {}) => M('#ffffff', { map: FT(key, rx, ry), roughness: 0.8, ...o }); // на грань
const chrome = () => M('#d8dadc', { roughness: 0.12, metalness: 1 });
const brass = () => M('#c8a05a', { metalness: 1, roughness: 0.3 });
let _glass; const glassM = () => _glass || (_glass = new THREE.MeshLambertMaterial({ color: '#d6e8ea', transparent: true, opacity: 0.08, depthWrite: false }));
const pvcWhite = () => M('#f4f3ef', { roughness: 0.35 });
export const mirrorM = () => { const m = new THREE.MeshStandardMaterial({ color: '#e8eef0', metalness: 1, roughness: 0.04 }); m.userData.mirror = true; return m; };

// ---------- общие помощники
function worldUV(geom) {
  const p = geom.attributes.position, n = geom.attributes.normal; const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i)), nz = Math.abs(n.getZ(i));
    let u, v; if (ny > 0.5) { u = p.getX(i); v = -p.getZ(i); } else if (nx > nz) { u = p.getZ(i); v = p.getY(i); } else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u; uv[i * 2 + 1] = v;
  }
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return geom;
}
const archBatches = new Map();
function addArch(matKey, mat, geom) { if (!archBatches.has(matKey)) archBatches.set(matKey, { mat, list: [] }); archBatches.get(matKey).list.push(geom); }
function boxW(cx, cy, cz, sx, sy, sz) { const g = new THREE.BoxGeometry(sx, sy, sz); g.translate(cx, cy, cz); return worldUV(g); }

export function B(w, h, d, mat, x = 0, y = 0, z = 0, r = 0, parent) {
  const g = r > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2)) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(g, mat); m.position.set(x, y + h / 2, z); m.castShadow = m.receiveShadow = true; if (parent) parent.add(m); return m;
}
function Cyl(rt, rb, h, mat, x, y, z, parent, seg = 20) { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); m.position.set(x, y + h / 2, z); m.castShadow = m.receiveShadow = true; if (parent) parent.add(m); return m; }
function Sph(r, mat, x, y, z, parent, sx = 1, sy = 1, sz = 1) { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; if (parent) parent.add(m); return m; }
function rodX(len, r, mat, x, y, z, parent) { const m = Cyl(r, r, len, mat, x, 0, z, parent, 10); m.rotation.z = Math.PI / 2; m.position.y = y; return m; }
// размещение: x,z — центр, dir — куда смотрит фасад (0 — север, 90 — восток, 180 — юг, 270 — запад)
function place(scene, g, x, z, dir = 180, solid = true, y = 0) {
  g.position.set(x, y, z); g.rotation.y = (180 - dir) * D2R; scene.add(g); g.updateMatrixWorld(true);
  if (solid) { const b = new THREE.Box3().setFromObject(g); solids.push({ x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z }); }
  return g;
}
export function inPoly(x, z, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; }
const inRect = (x, z, pred = () => true) => RECTS.find(r => pred(r) && x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) || POLYS.find(p => pred(p) && inPoly(x, z, p.poly));

// ---------- архитектура
export function buildArchitecture(scene, textures, meta) {
  TX = textures; META = meta;
  const facadeM = M('#d9d2c4', { roughness: 0.95, map: AT('concrete') });
  const loggiaWallM = PM('wall_loggia');
  const slabM = M('#8f8a82', { roughness: 0.95, map: AT('concrete') });
  const baseboardM = M('#c9b79a', { roughness: 0.5 });
  const ceilM = M('#f7f6f2', { roughness: 0.92 });

  for (const r of RECTS) {
    const fm = PM(r.floor, { roughness: r.floor === 'tile_wc' ? 0.3 : 0.55 });
    addArch('floor_' + r.floor, fm, boxW((r.x0 + r.x1) / 2, -0.01, (r.z0 + r.z1) / 2, r.x1 - r.x0, 0.02, r.z1 - r.z0));
    addArch('slab', slabM, boxW((r.x0 + r.x1) / 2, -0.17, (r.z0 + r.z1) / 2, r.x1 - r.x0 + (r.open ? 0 : 0.5), 0.3, r.z1 - r.z0 + (r.open ? 0 : 0.5)));
    const cg = new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0); cg.rotateX(Math.PI / 2); cg.translate((r.x0 + r.x1) / 2, r.open ? 2.75 : H, (r.z0 + r.z1) / 2);
    const cm = r.open ? M('#ffffff', { map: AT('wall_balcony'), side: THREE.DoubleSide, shadowSide: THREE.DoubleSide }) : r.wet ? M('#ffffff', { map: AT('pvc_bath'), roughness: 0.4, shadowSide: THREE.DoubleSide }) : M('#f7f6f2', { roughness: 0.92, shadowSide: THREE.DoubleSide });
    const ceil = new THREE.Mesh(worldUV(cg), cm); ceil.castShadow = true; ceil.receiveShadow = true; scene.add(ceil); ceilings.push(ceil);
    if (r.open) { buildBalcony(scene, r); continue; }
    const wm = PM(r.wall, { roughness: r.wall === 'pvc_bath' ? 0.3 : 0.9 });
    const edges = [
      { o: 'h', at: r.z0, a: r.x0, b: r.x1, inw: 1 }, { o: 'h', at: r.z1, a: r.x0, b: r.x1, inw: -1 },
      { o: 'v', at: r.x0, a: r.z0, b: r.z1, inw: 1 }, { o: 'v', at: r.x1, a: r.z0, b: r.z1, inw: -1 },
    ];
    for (const e of edges) {
      const ops = OPENINGS.filter(op => op.o === e.o && Math.abs(op.at - e.at) < 0.01 && Math.min(op.b, e.b) - Math.max(op.a, e.a) > 0.01)
        .map(op => ({ ...op, a: Math.max(op.a, e.a), b: Math.min(op.b, e.b) })).sort((p, q) => p.a - q.a);
      const pieces = []; let cur = e.a;
      for (const op of ops) { if (op.a > cur) pieces.push([cur, op.a, 0, H]); if (op.bot > 0) pieces.push([op.a, op.b, 0, op.bot]); if (op.top < H) pieces.push([op.a, op.b, op.top, H]); cur = op.b; }
      if (cur < e.b) pieces.push([cur, e.b, 0, H]);
      for (const [a, b, y0, y1] of pieces) {
        const len = b - a, mid = (a + b) / 2, off = e.at + e.inw * T / 2;
        const g = e.o === 'h' ? boxW(mid, (y0 + y1) / 2, off, len, y1 - y0, T) : boxW(off, (y0 + y1) / 2, mid, T, y1 - y0, len);
        addArch('wall_' + r.wall, wm, g);
        const fo = e.at + e.inw * (T + 0.01);
        if (y0 === 0) {
          segments.push(e.o === 'h' ? [a, e.at, b, e.at] : [e.at, a, e.at, b]);
          if (!r.wet && y1 > 0.3) addArch('baseboard', baseboardM, e.o === 'h' ? boxW(mid, 0.035, fo, len, 0.07, 0.02) : boxW(fo, 0.035, mid, 0.02, 0.07, len));
        }
        if (y1 === H && r.border) borderStrip(e.o === 'h' ? [a, fo + e.inw * 0.002, b, fo + e.inw * 0.002] : [fo + e.inw * 0.002, a, fo + e.inw * 0.002, b], e.o);
        // фасад / стена лоджии снаружи
        const step = 0.05; let runA = null, runMat = null;
        for (let s = a; s <= b + 1e-6; s += step) {
          const ss = Math.min(s + step / 2, b); const px = e.o === 'h' ? ss : e.at - e.inw * 0.12, pz = e.o === 'h' ? e.at - e.inw * 0.12 : ss;
          const other = inRect(px, pz, rr => !rr.open);
          const outside = (!other || other.id === 'loggia') && s < b - 1e-6;
          const mat = other && other.id === 'loggia' ? 'loggia' : 'facade';
          if (outside && runA !== null && mat !== runMat) { flush(runA, s); runA = null; }
          if (outside && runA === null) { runA = s; runMat = mat; }
          if ((!outside || s >= b - 1e-6) && runA !== null) { flush(runA, Math.min(s, b)); runA = null; }
        }
        function flush(ra, rb) {
          const l = rb - ra, m2 = (ra + rb) / 2, lg = runMat === 'loggia', th = lg ? 0.1 : 0.3, fo2 = e.at - e.inw * th / 2;
          const yy0 = lg ? y0 : (y0 === 0 ? -0.3 : y0), yy1 = lg ? y1 : (y1 === H ? H + 0.3 : y1);
          const g2 = e.o === 'h' ? boxW(m2, (yy0 + yy1) / 2, fo2, l, yy1 - yy0, th) : boxW(fo2, (yy0 + yy1) / 2, m2, th, yy1 - yy0, l);
          addArch(lg ? 'wall_loggia' : 'facade', lg ? loggiaWallM : facadeM, g2);
        }
      }
    }
  }
  buildBay(scene); buildLoggia(scene);
  for (const [k, { mat, list }] of archBatches) {
    const m = new THREE.Mesh(mergeGeometries(list), mat); m.castShadow = true; m.receiveShadow = true; m.name = k; scene.add(m);
  }
  for (const op of OPENINGS) buildOpening(scene, op);
}
// цветочный бордюр кухни под потолком
function borderStrip([ax, az, bx, bz], o) {
  const len = Math.hypot(bx - ax, bz - az); if (len < 0.05) return;
  const t = TX.border_kitchen.clone(); t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; const [bw] = META.border_kitchen; t.repeat.set(1 / bw, 1 / 0.1); t.offset.set(0, -2.58 / 0.1); t.needsUpdate = true;
  const g = o === 'h' ? boxW((ax + bx) / 2, 2.63, az, len, 0.1, 0.004) : boxW(ax, 2.63, (az + bz) / 2, 0.004, 0.1, len);
  addArch('border', M('#ffffff', { map: t, roughness: 0.85 }), g);
}
function polyFloorCeil(scene, poly, floorKey, ceilMat, y = H) {
  const sh = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
  const fg = new THREE.ShapeGeometry(sh); fg.rotateX(-Math.PI / 2); worldUV(fg);
  const f = new THREE.Mesh(fg, PM(floorKey, { roughness: 0.5 })); f.receiveShadow = true; f.position.y = 0.001; scene.add(f);
  const sl = new THREE.ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: false }); sl.rotateX(-Math.PI / 2); sl.translate(0, -0.3, 0);
  const s = new THREE.Mesh(sl, M('#8f8a82', { roughness: 0.95 })); scene.add(s);
  const cg = new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: false }); cg.rotateX(-Math.PI / 2); worldUV(cg); cg.translate(0, y, 0);
  const c = new THREE.Mesh(cg, ceilMat); c.receiveShadow = c.castShadow = true; scene.add(c); ceilings.push(c);
}
// остеклённая грань (эркер, лоджия): от p0 к p1, внутренняя сторона — слева по ходу (inside=+1) или справа
function glazedFace(scene, p0, p1, { inside = 1, bot = 0.85, top = 2.45, panes = 1, innerMat, transom = 0, sill = 0.22, radiator = false, borderTop = false }) {
  const dx = p1[0] - p0[0], dz = p1[1] - p0[1], len = Math.hypot(dx, dz);
  const g = new THREE.Group(); g.position.set(p0[0], 0, p0[1]); g.rotation.y = -Math.atan2(dz, dx); // локальная X — вдоль грани
  const sgn = inside; // локальная +Z * sgn — внутрь
  const facade = M('#d9d2c4', { roughness: 0.95, map: AT('concrete') });
  const wallBox = (y0, y1) => { const gm = new THREE.BoxGeometry(len, y1 - y0, 0.14); gm.translate(len / 2, (y0 + y1) / 2, -sgn * 0.07); worldUV(gm);
    const mats = [innerMat, innerMat, innerMat, innerMat, sgn > 0 ? innerMat : facade, sgn > 0 ? facade : innerMat];
    const m = new THREE.Mesh(gm, mats); m.castShadow = m.receiveShadow = true; g.add(m); };
  wallBox(0, bot); wallBox(top, H);
  if (borderTop) { const t = TX.border_kitchen.clone(); t.wrapS = THREE.RepeatWrapping; t.repeat.set(len / META.border_kitchen[0], 1); t.needsUpdate = true;
    const b = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.1), M('#ffffff', { map: t })); b.position.set(len / 2, 2.63, sgn * 0.003); if (sgn < 0) b.rotation.y = Math.PI; g.add(b); }
  const fm = pvcWhite(), fw = 0.06, dep = 0.07, n = -sgn * 0.05;
  const fb = (x0, x1, y0, y1) => B(x1 - x0, y1 - y0, dep, fm, (x0 + x1) / 2, y0, n, 0.004, g);
  fb(0, len, bot, bot + fw); fb(0, len, top - fw, top); fb(0, fw, bot, top); fb(len - fw, len, bot, top);
  const pw = len / panes; for (let i = 1; i < panes; i++) fb(i * pw - 0.035, i * pw + 0.035, bot, top);
  if (transom) fb(0, len, transom - 0.03, transom + 0.03);
  for (let i = 0; i < panes; i++) B(0.02, 0.12, 0.03, fm, i * pw + pw - 0.09, (bot + top) / 2 - 0.06, n + sgn * 0.05, 0.005, g);
  const gl = new THREE.Mesh(new THREE.PlaneGeometry(len, top - bot), glassM()); gl.position.set(len / 2, (bot + top) / 2, n); gl.renderOrder = 2; g.add(gl);
  if (sill) { const s = B(len + 0.02, 0.035, sill, M('#f3f2ee', { roughness: 0.3 }), len / 2, bot - 0.035, sgn * sill / 2 - sgn * 0.02, 0.008, g); }
  if (radiator) { const r = B(Math.min(1.0, len * 0.7), 0.35, 0.08, M('#f1f0ec', { roughness: 0.35 }), len / 2, 0.2, sgn * 0.12, 0.01, g); }
  scene.add(g); segments.push([p0[0], p0[1], p1[0], p1[1]]);
  return g;
}
// эркер кухни: три остеклённые грани (2 + 1 + 2 = 5 створок)
function buildBay(scene) {
  const { a, b, z, depth: d } = BAY; const P0 = [a, z], P1 = [a + d, z + d], P2 = [b - d, z + d], P3 = [b, z];
  polyFloorCeil(scene, [P0, P3, P2, P1], 'floor_kitchen', M('#f7f6f2', { roughness: 0.92, shadowSide: THREE.DoubleSide }));
  const wm = PM('wp_kitchen', { roughness: 0.9 });
  const opts = { inside: -1, bot: 0.86, top: 2.48, innerMat: wm, transom: 1.98, borderTop: true };
  glazedFace(scene, P0, P1, { ...opts, panes: 1 });
  glazedFace(scene, P1, P2, { ...opts, panes: 3, radiator: true });
  glazedFace(scene, P2, P3, { ...opts, panes: 1 });
}
function buildLoggia(scene) {
  const [A, Bp, C, D] = LOGGIA;
  polyFloorCeil(scene, LOGGIA, 'floor_loggia', M('#f4f2ec', { roughness: 0.9, shadowSide: THREE.DoubleSide }));
  const pm = PM('panel_loggia', { roughness: 0.6 });
  glazedFace(scene, C, D, { inside: 1, bot: 0.95, top: 2.5, panes: 2, innerMat: pm, sill: 0.2 });
  glazedFace(scene, D, A, { inside: 1, bot: 0.95, top: 2.5, panes: 2, innerMat: pm, sill: 0.2 });
}
function buildBalcony(scene, r) {
  const pm = PM('concrete', { roughness: 0.95 });
  const wm = PM('wall_balcony', { roughness: 0.95 });
  // западная глухая стена, северный и восточный парапеты
  const add = (m, g) => { const me = new THREE.Mesh(g, m); me.castShadow = me.receiveShadow = true; scene.add(me); };
  add(wm, boxW(r.x0 + 0.06, H / 2, (r.z0 + r.z1) / 2, 0.12, H, r.z1 - r.z0)); segments.push([r.x0 + 0.12, r.z0, r.x0 + 0.12, r.z1]);
  add(pm, boxW((r.x0 + r.x1) / 2, 0.5, r.z0 + 0.06, r.x1 - r.x0, 1.0, 0.12)); segments.push([r.x0, r.z0 + 0.12, r.x1, r.z0 + 0.12]);
  add(pm, boxW(r.x1 - 0.06, 0.5, (r.z0 + r.z1) / 2, 0.12, 1.0, r.z1 - r.z0)); segments.push([r.x1 - 0.12, r.z0, r.x1 - 0.12, r.z1]);
  add(wm, boxW(r.x1 + 0.06, H / 2, (r.z0 + r.z1) / 2 + 0.45, 0.12, H, r.z1 - r.z0 - 0.9));
}

// ---------- окна и двери в прямых стенах
function onEdge(op, s, y, n) { return op.o === 'h' ? new THREE.Vector3(s, y, op.at + n) : new THREE.Vector3(op.at + n, y, s); }
function insideSign(op) {
  const mid = (op.a + op.b) / 2;
  const test = sg => { const p = onEdge(op, mid, 0, sg * 0.3); return inRect(p.x, p.z, r => !r.open); };
  const p = test(1), m = test(-1);
  if (p && m) return p.id === 'loggia' ? -1 : 1;
  return p ? 1 : -1;
}
function edgeBox(scene, op, s0, s1, y0, y1, n0, n1, mat, shadow = true) {
  const a = onEdge(op, s0, y0, n0), b = onEdge(op, s1, y1, n1);
  const m = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(b.x - a.x) || 0.001, Math.abs(b.y - a.y), Math.abs(b.z - a.z) || 0.001), mat);
  m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); m.castShadow = shadow; m.receiveShadow = true; scene.add(m); return m;
}
function frameRect(scene, op, s0, s1, y0, y1, n, fw, depth, mat) {
  edgeBox(scene, op, s0, s1, y0, y0 + fw, n - depth / 2, n + depth / 2, mat);
  edgeBox(scene, op, s0, s1, y1 - fw, y1, n - depth / 2, n + depth / 2, mat);
  edgeBox(scene, op, s0, s0 + fw, y0, y1, n - depth / 2, n + depth / 2, mat);
  edgeBox(scene, op, s1 - fw, s1, y0, y1, n - depth / 2, n + depth / 2, mat);
}
function glassPane(scene, op, s0, s1, y0, y1, n) { const m = edgeBox(scene, op, s0, s1, y0, y1, n - 0.003, n + 0.003, glassM(), false); m.renderOrder = 2; return m; }
const roomOfOpening = (op, sg) => { const p = onEdge(op, (op.a + op.b) / 2, 0, sg * 0.5); return inRect(p.x, p.z); };

function buildOpening(scene, op) {
  const sg = insideSign(op);
  const casingM = M('#e8dcc6', { roughness: 0.45 });
  if (op.kind === 'window' || op.kind === 'balcdoor') {
    const fm = pvcWhite(); const n = 0, fw = 0.06, dep = 0.07;
    const { a, b, bot, top } = op;
    edgeBox(scene, op, a, b, top, top + 0.001, -0.25 * sg, sg * T, M('#efece4', { roughness: 0.8 }));
    frameRect(scene, op, a, b, bot, top, n, fw, dep, fm);
    const panes = op.panes || 1; const pw = (b - a) / panes;
    for (let i = 1; i < panes; i++) edgeBox(scene, op, a + i * pw - 0.035, a + i * pw + 0.035, bot, top, n - dep / 2, n + dep / 2, fm);
    const rm = roomOfOpening(op, sg);
    if (op.kind === 'balcdoor') {
      edgeBox(scene, op, a + fw, b - fw, bot, 0.8, n - 0.02, n + 0.02, fm);
      glassPane(scene, op, a, b, 0.8, top, n);
    } else {
      for (let i = 0; i < panes; i++) edgeBox(scene, op, a + i * pw + pw - 0.09, a + i * pw + pw - 0.07, (bot + top) / 2 - 0.08, (bot + top) / 2 + 0.05, sg * 0.04, sg * 0.06, fm);
      glassPane(scene, op, a, b, bot, top, n);
      edgeBox(scene, op, a - 0.06, b + 0.06, bot - 0.035, bot, n, sg * (T + 0.22), M('#f4f2ec', { roughness: 0.3 }));
      if (rm && rm.id !== 'loggia') radiator(scene, op, sg);
    }
    if (rm && ['r1', 'r2', 'r3'].includes(rm.id)) curtains(scene, op, sg, rm.id);
    return;
  }
  if (op.kind === 'void') return;
  const cw = 0.07, { a, b, top } = op;
  for (const side of [1, -1]) {
    const nn = side * (T + 0.008);
    edgeBox(scene, op, a - cw, a, 0, top + cw, nn - 0.008, nn + 0.008, casingM);
    edgeBox(scene, op, b, b + cw, 0, top + cw, nn - 0.008, nn + 0.008, casingM);
    edgeBox(scene, op, a - cw, b + cw, top, top + cw, nn - 0.008, nn + 0.008, casingM);
  }
  edgeBox(scene, op, a, b, top, top + 0.002, -T, T, M('#ece7dc', { roughness: 0.7 }));
  if (op.kind === 'entry') { // входная металлическая дверь (не сфотографирована)
    edgeBox(scene, op, a + 0.02, b - 0.02, 0.01, top - 0.01, -0.02, -0.06, M('#5a4636', { roughness: 0.5, metalness: 0.3 }));
    edgeBox(scene, op, b - 0.16, b - 0.08, 1.0, 1.02, -0.07, -0.11, chrome());
    return;
  }
  if (op.kind === 'glassdouble') { const w = (b - a) / 2; makeLeaf(scene, op, a, w, 1, 80, 'glass'); makeLeaf(scene, op, b, -w, 1, 80, 'glass'); return; }
  const defs = { r1: ['b', -1, 92, 'wood'], r2: ['a', -1, 92, 'wood'], bath: ['b', -1, 88, 'white'], wc: ['a', 1, 88, 'white'], kitchen: ['a', 1, 82, 'frosted'] };
  const d = defs[op.id]; if (!d) return;
  const [hinge, side, ang, style] = d; const w = b - a;
  makeLeaf(scene, op, hinge === 'a' ? a : b, hinge === 'a' ? w : -w, side, ang, style);
}
function makeLeaf(scene, op, hingeS, w, side, angDeg, style) {
  const g = new THREE.Group(); const L = Math.abs(w) - 0.02, Hh = op.top - 0.02;
  const wood = style === 'white' ? M('#ece5d6', { roughness: 0.45 }) : FM('door_wood', 1, 1, { roughness: 0.45 });
  if (style === 'glass' || style === 'frosted') {
    B(L, 0.14, 0.04, wood, L / 2, 0, 0, 0.005, g); B(L, 0.1, 0.04, wood, L / 2, Hh - 0.1, 0, 0.005, g);
    B(0.1, Hh, 0.04, wood, 0.05, 0, 0, 0.005, g); B(0.1, Hh, 0.04, wood, L - 0.05, 0, 0, 0.005, g);
    if (style === 'glass') B(L - 0.2, 0.09, 0.04, wood, L / 2, 0.55, 0, 0.005, g);
    const y0 = style === 'glass' ? 0.64 : 0.45;
    const gl = new THREE.Mesh(new THREE.BoxGeometry(L - 0.2, Hh - 0.1 - y0, 0.006), M('#dfe6e4', { roughness: 0.35, transparent: true, opacity: 0.7 })); gl.position.set(L / 2, y0 + (Hh - 0.1 - y0) / 2, 0); g.add(gl);
    if (style === 'glass') B(L - 0.2, 0.41, 0.03, wood, L / 2, 0.14, 0, 0.005, g); else B(L - 0.2, 0.31, 0.03, wood, L / 2, 0.14, 0, 0.005, g);
  } else {
    B(L, Hh, 0.04, wood, L / 2, 0, 0, 0.004, g);
  }
  for (const zz of [0.035, -0.035]) { const h = Cyl(0.018, 0.018, 0.02, style === 'white' ? chrome() : brass(), L - 0.07, 1.0, zz, g); h.rotation.x = Math.PI / 2; }
  const sgnW = Math.sign(w);
  g.position.copy(onEdge(op, hingeS, 0, 0));
  const base = op.o === 'h' ? (sgnW > 0 ? 0 : Math.PI) : (sgnW > 0 ? -Math.PI / 2 : Math.PI / 2);
  const cross = op.o === 'h' ? side * sgnW : -side * sgnW;
  g.rotation.y = base - cross * angDeg * D2R;
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(g);
}
function radiator(scene, op, sg) { // белый панельный радиатор, как на фото
  const w = Math.min(1.0, (op.b - op.a) * 0.6), mid = (op.a + op.b) / 2;
  const g = new THREE.Group(); const m = M('#f1f0ec', { roughness: 0.35 });
  B(w, 0.45, 0.07, m, 0, 0, 0, 0.01, g); for (let i = 0; i < Math.floor(w / 0.05); i++) B(0.012, 0.42, 0.01, M('#e4e3de'), -w / 2 + 0.03 + i * 0.05, 0.015, 0.038, 0, g);
  const p = onEdge(op, mid, 0, sg * (T + 0.07)); g.position.set(p.x, 0.25, p.z); if (op.o === 'v') g.rotation.y = Math.PI / 2; if (sg < 0 && op.o === 'h') g.rotation.y = Math.PI;
  scene.add(g);
}
function folds(width, height, nf, amp) {
  const g = new THREE.PlaneGeometry(width, height, Math.max(8, nf * 8), 1); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) / width * nf * Math.PI * 2) * amp);
  g.computeVertexNormals(); return g;
}
let TULLE;
export function setTulle(t) { TULLE = t; }
function curtains(scene, op, sg, room) {
  const key = { r1: 'curtain_living', r2: 'curtain_bedroom', r3: 'curtain_room3' }[room];
  const extra = room === 'r3' ? 0.15 : 0.35;
  let a = op.a - extra, b = op.b + extra;
  if (room === 'r3') { a = 4.0; b = 7.5; } // в комнате 11,1 шторы закрывают всю стену с окном и дверью
  if (room === 'r1') { a = 0.25; b = 3.3; }
  const span = b - a, mid = (a + b) / 2, n = sg * (T + 0.2);
  const top = H - 0.06, hgt = top - 0.04;
  edgeBox(scene, op, a - 0.05, b + 0.05, top - 0.02, top + 0.03, n - 0.03, n + 0.03, M('#e9e2d0', { roughness: 0.5 }));
  if (op.kind === 'balcdoor' && room !== 'r3') return;
  if (room === 'r3' && op.kind === 'window') return; // одна общая штора на стену
  const tm = new THREE.MeshStandardMaterial({ map: TULLE, transparent: true, opacity: 0.55, side: THREE.DoubleSide, roughness: 1, depthWrite: false });
  const tt = TULLE.clone(); tt.repeat.set(span / 0.2, hgt / 0.2); tt.needsUpdate = true; tm.map = tt;
  const tl = new THREE.Mesh(folds(span * 0.7, hgt - 0.3, Math.round(span * 5), 0.03), tm); tl.renderOrder = 3;
  tl.position.copy(onEdge(op, mid, top - (hgt - 0.3) / 2 - 0.3, n - sg * 0.03)); if (op.o === 'v') tl.rotation.y = Math.PI / 2; scene.add(tl);
  const cm = FM(key, 3, 1.6, { side: THREE.DoubleSide, roughness: 1 });
  for (const s of [-1, 1]) {
    const w = room === 'r1' ? 0.6 : 0.5; const c = new THREE.Mesh(folds(w, hgt, 4, 0.05), cm); c.castShadow = true; c.receiveShadow = true;
    c.position.copy(onEdge(op, mid + s * (span / 2 - w / 2), top - hgt / 2, n + sg * 0.02)); if (op.o === 'v') c.rotation.y = Math.PI / 2; scene.add(c);
  }
  // ламбрекен
  const lm = FM(key, span / 0.4, 0.5, { side: THREE.DoubleSide, roughness: 1 });
  const lam = new THREE.Mesh(folds(span, room === 'r3' ? 0.28 : 0.38, Math.round(span * 3), 0.05), lm);
  lam.position.copy(onEdge(op, mid, top - (room === 'r3' ? 0.16 : 0.2), n + sg * 0.05)); if (op.o === 'v') lam.rotation.y = Math.PI / 2; scene.add(lam);
}

// ---------- светильники (по фото)
function addLight(scene, x, y, z, intensity = 6, color = '#ffd9b0', dist = 8) {
  const l = new THREE.PointLight(color, intensity, dist, 2); l.position.set(x, y, z); scene.add(l); lights.push(l); return l;
}
const bulbM = () => M('#fff3dc', { emissive: '#ffe2b0', emissiveIntensity: 2.0, roughness: 0.3 });
// люстра: tulip — стеклянные «тюльпаны» (большая комната, холл), globe — шары-плафоны (комната 11,1)
function chandelier(scene, x, z, { arms = 5, drop = 0.42, style = 'tulip', r = 0.26, intensity = 8 } = {}) {
  const g = new THREE.Group(); const gold = brass();
  const shade = M('#f8f0e0', { roughness: 0.25, transparent: true, opacity: 0.9, emissive: '#ffdcae', emissiveIntensity: 0.8, side: THREE.DoubleSide });
  Cyl(0.05, 0.05, 0.02, gold, 0, -0.02, 0, g); Cyl(0.008, 0.008, drop - 0.04, gold, 0, -drop, 0, g); Sph(0.05, gold, 0, -drop, 0, g, 1, 1.4, 1);
  for (let i = 0; i < arms; i++) {
    const a = i / arms * Math.PI * 2, cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, -drop, 0), new THREE.Vector3(cx * 0.6, -drop - 0.12, cz * 0.6), new THREE.Vector3(cx, -drop + 0.03, cz));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.007, 6), gold));
    Cyl(0.02, 0.025, 0.03, gold, cx, -drop + 0.02, cz, g);
    if (style === 'globe') { Sph(0.085, shade, cx, -drop + 0.15, cz, g, 1, 1.15, 1); }
    else { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.04, 0.12, 18, 1, true), shade); s.position.set(cx, -drop + 0.11, cz); g.add(s); }
    Sph(0.025, bulbM(), cx, -drop + 0.1, cz, g);
  }
  g.position.set(x, H, z); scene.add(g); ceilings.push(g);
  addLight(scene, x, H - drop, z, intensity);
}
function bowlPendant(scene, x, z, intensity = 8) { // спальня: алебастровая чаша на цепочке
  const g = new THREE.Group(); Cyl(0.006, 0.006, 0.45, brass(), 0, -0.47, 0, g); Cyl(0.06, 0.05, 0.03, brass(), 0, -0.03, 0, g);
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.2, 28, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M('#fbf3e2', { emissive: '#ffe3b5', emissiveIntensity: 1.2, roughness: 0.4, side: THREE.DoubleSide }));
  bowl.scale.set(1, 0.6, 1); bowl.position.y = -0.48; g.add(bowl);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.012, 8, 40), brass()); ring.rotation.x = Math.PI / 2; ring.position.y = -0.48; g.add(ring);
  for (let i = 0; i < 3; i++) { const a = i * 2.094; const c = Cyl(0.003, 0.003, 0.4, brass(), Math.cos(a) * 0.1, -0.48, Math.sin(a) * 0.1, g); c.rotation.set(Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45); }
  Sph(0.025, brass(), 0, -0.64, 0, g);
  g.position.set(x, H, z); scene.add(g); ceilings.push(g); addLight(scene, x, H - 0.6, z, intensity);
}
function barPendant(scene, x, z, len = 1.0, intensity = 4) { // кухня: штанга с 4 плафонами-колокольчиками
  const g = new THREE.Group(); Cyl(0.006, 0.006, 0.6, chrome(), 0, -0.6, 0, g); Cyl(0.04, 0.04, 0.02, chrome(), 0, -0.02, 0, g);
  rodX(len, 0.012, chrome(), 0, -0.62, 0, g);
  const sh = M('#ffffff', { emissive: '#fff0d8', emissiveIntensity: 0.9, roughness: 0.2, side: THREE.DoubleSide });
  for (let i = 0; i < 4; i++) { const xx = -len / 2 + 0.08 + i * (len - 0.16) / 3; Cyl(0.006, 0.006, 0.1, chrome(), xx, -0.72, 0, g);
    const p = new THREE.Points(); const s = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(0.02, 0), new THREE.Vector2(0.045, -0.04), new THREE.Vector2(0.065, -0.12), new THREE.Vector2(0.075, -0.15)], 20), sh); s.position.set(xx, -0.72, 0); g.add(s); }
  g.position.set(x, H, z); scene.add(g); ceilings.push(g);
  addLight(scene, x - 0.25, H - 0.85, z, intensity); addLight(scene, x + 0.25, H - 0.85, z, intensity);
}
function plafond(scene, x, z, intensity = 4) { const p = Sph(0.15, M('#fff8ea', { emissive: '#ffe7c4', emissiveIntensity: 1.1, roughness: 0.2 }), x, H - 0.05, z, scene, 1, 0.35, 1); ceilings.push(p); addLight(scene, x, H - 0.25, z, intensity); }
function sconce(scene, x, y, z, dir, double = false, intensity = 1.5) {
  const g = new THREE.Group(); B(0.08, 0.12, 0.03, brass(), 0, -0.06, 0.015, 0.01, g);
  for (const s of (double ? [-1, 1] : [0])) { const sh = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), M('#fbf3e2', { emissive: '#ffe0b0', emissiveIntensity: 1, side: THREE.DoubleSide })); sh.rotation.x = Math.PI; sh.position.set(s * 0.1, 0.06, 0.12); g.add(sh); rodX(0.12, 0.006, brass(), s * 0.05, 0, 0.08, g); }
  g.position.set(x, y, z); g.rotation.y = (180 - dir) * D2R; scene.add(g);
  const p = new THREE.Vector3(0, 0, 0.2).applyAxisAngle(new THREE.Vector3(0, 1, 0), g.rotation.y).add(g.position); addLight(scene, p.x, p.y, p.z, intensity, '#ffd09a', 4);
}

// ---------- мебель (локальные координаты: фасад смотрит в +Z, центр основания в нуле)
function sofa(w, fabKey, { d = 0.9, cushKey = null, cushions = 3, legs = M('#3a2414'), arm = 0.2, round = 0.08 } = {}) {
  const g = new THREE.Group(); const f = FM(fabKey, w / 0.5, 1, { roughness: 0.95 });
  B(w, 0.3, d - 0.2, f, 0, 0.1, 0.08, round, g);
  B(w - arm * 2, 0.16, d - 0.28, f, 0, 0.38, 0.1, round, g);
  B(w - 0.1, 0.55, 0.25, f, 0, 0.38, -d / 2 + 0.14, round + 0.02, g);
  for (const s of [-1, 1]) B(arm, 0.58, d - 0.02, f, s * (w / 2 - arm / 2), 0.08, 0, round + 0.02, g);
  if (cushKey) { const cm = FM(cushKey, 1, 1, { roughness: 0.95 }); const cw = (w - arm * 2) / cushions;
    for (let i = 0; i < cushions; i++) { const c = B(cw - 0.03, 0.42, 0.16, cm, -w / 2 + arm + cw * (i + 0.5), 0.5, -d / 2 + 0.33, 0.07, g); c.rotation.x = -0.2; } }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) Cyl(0.025, 0.02, 0.1, legs, sx * (w / 2 - 0.08), 0, sz * (d / 2 - 0.1), g);
  return g;
}
function armchair(fabKey, { leather = false } = {}) {
  const g = new THREE.Group(); const f = FM(fabKey, 1, 1, { roughness: leather ? 0.45 : 0.9 });
  B(0.6, 0.2, 0.62, f, 0, 0.2, 0.04, 0.08, g); B(0.72, 0.62, 0.22, f, 0, 0.18, -0.32, 0.1, g);
  for (const s of [-1, 1]) B(0.16, 0.56, 0.8, f, s * 0.36, 0.1, 0, 0.08, g);
  B(0.6, 0.12, 0.6, f, 0, 0.08, 0.04, 0.04, g);
  return g;
}
function leatherSofa(w) { // холл: чёрный кожаный диван
  const g = new THREE.Group(); const f = FM('leather', w / 0.4, 1, { roughness: 0.4 });
  B(w, 0.3, 0.78, f, 0, 0.08, 0.05, 0.08, g); B(w - 0.4, 0.18, 0.6, f, 0, 0.36, 0.1, 0.09, g);
  B(w - 0.1, 0.5, 0.3, f, 0, 0.36, -0.3, 0.12, g); for (const s of [-1, 1]) B(0.22, 0.55, 0.9, f, s * (w / 2 - 0.11), 0.08, 0, 0.11, g);
  // накинутая куртка, как на фото
  B(0.6, 0.12, 0.5, M('#c8b5ae', { roughness: 1 }), -0.1, 0.5, 0.1, 0.06, g).rotation.y = 0.3;
  return g;
}
function bed(w = 1.6, l = 2.05) { // деревянная кровать с реечной спинкой, покрывало из фото
  const g = new THREE.Group(); const wd = M('#7a4a2c', { roughness: 0.45 });
  B(w + 0.08, 0.25, l, wd, 0, 0.15, 0, 0.015, g);
  for (const s of [-1, 1]) { B(0.06, 0.95, 0.06, wd, s * (w / 2 + 0.01), 0, -l / 2, 0.01, g); B(0.06, 0.55, 0.06, wd, s * (w / 2 + 0.01), 0, l / 2, 0.01, g); }
  B(w + 0.06, 0.06, 0.05, wd, 0, 0.88, -l / 2, 0.01, g); B(w + 0.06, 0.05, 0.05, wd, 0, 0.5, -l / 2, 0.01, g); B(w + 0.06, 0.05, 0.05, wd, 0, 0.48, l / 2, 0.01, g);
  for (let i = 0; i < 5; i++) B(0.05, 0.33, 0.03, wd, -w / 2 + 0.25 + i * (w - 0.5) / 4, 0.55, -l / 2, 0.005, g);
  B(w - 0.02, 0.2, l - 0.06, M('#f2ede4', { roughness: 0.9 }), 0, 0.4, 0, 0.07, g);
  const bs = FM('bedspread', 2, 2.6, { roughness: 0.95 });
  B(w + 0.05, 0.12, l - 0.3, bs, 0, 0.55, 0.14, 0.06, g); B(w + 0.06, 0.3, 0.02, bs, 0, 0.32, l / 2 + 0.01 - 0.01, 0, g);
  for (const s of [-1, 1]) B(0.04, 0.3, l - 0.3, bs, s * (w / 2 + 0.04), 0.32, 0.14, 0, g);
  for (const s of [-1, 1]) B(0.6, 0.15, 0.4, M('#9fb0cf', { roughness: 0.95 }), s * w / 4, 0.58, -l / 2 + 0.3, 0.07, g);
  return g;
}
function cabinet(w, h, d, mat, { doors = 1, drawers = 0, handle = brass(), legs = 0, glass = false } = {}) {
  const g = new THREE.Group(); B(w, h - legs, d, mat, 0, legs, 0, 0.008, g);
  if (legs) for (const sx of [-1, 1]) for (const sz of [-1, 1]) B(0.04, legs, 0.04, mat, sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.05), 0, g);
  const fh = h - legs - 0.04;
  if (drawers) for (let i = 0; i < drawers; i++) { const yy = legs + 0.02 + i * fh / drawers; B(w - 0.03, fh / drawers - 0.012, 0.015, mat, 0, yy, d / 2 + 0.005, 0.004, g); B(0.12, 0.015, 0.02, handle, 0, yy + fh / drawers / 2, d / 2 + 0.02, 0.004, g); }
  else for (let i = 0; i < doors; i++) { const dw = w / doors; B(dw - 0.012, fh, 0.015, glass ? glassM() : mat, -w / 2 + dw * (i + 0.5), legs + 0.02, d / 2 + 0.005, 0.004, g); B(0.015, 0.1, 0.02, handle, -w / 2 + dw * (i + 0.5) + (i % 2 ? -1 : 1) * (dw / 2 - 0.05), legs + fh * 0.55, d / 2 + 0.02, 0.004, g); }
  return g;
}
function lamp(parent, x, y, z, glow = true) {
  const g = new THREE.Group(); Cyl(0.06, 0.08, 0.04, brass(), 0, 0, 0, g); Cyl(0.012, 0.012, 0.25, brass(), 0, 0.04, 0, g);
  const s = new THREE.Mesh(new THREE.SphereGeometry(0.13, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), M('#f3ead2', { side: THREE.DoubleSide, emissive: '#ffd9a0', emissiveIntensity: glow ? 0.6 : 0 })); s.position.y = 0.33; g.add(s);
  g.position.set(x, y, z); parent.add(g); return g;
}
function booksRow(parent, w, y, z, h = 0.26, depth = 0.18) {
  const t = BOOKS.clone(); t.repeat.set(w / 3.2, 1); t.offset.x = Math.random(); t.needsUpdate = true;
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), [M('#6b3a2a'), M('#6b3a2a'), M('#e9dfc8'), M('#6b3a2a'), M('#ffffff', { map: t, roughness: 0.8 }), M('#6b3a2a')]);
  m.position.set(0, y + h / 2, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m;
}
let BOOKS; export function setBooks(t) { BOOKS = t; }
function wallUnitLiving() { // «стенка» из фото большой комнаты: витрина + книжная секция с ящиками и антресолями
  const g = new THREE.Group(); const wd = FM('wood_wallunit', 1, 1, { roughness: 0.4 }); const d = 0.45, h = 2.25;
  const handle = brass();
  // секция A — витрина (0.7 м)
  const A = new THREE.Group(); A.position.x = -0.8; g.add(A);
  B(0.7, h, d, wd, 0, 0, 0, 0.006, A); B(0.66, 0.7, 0.015, wd, 0, 0.04, d / 2, 0.004, A);
  B(0.66, 0.45, 0.015, wd, 0, 1.78, d / 2, 0.004, A); Sph(0.015, handle, 0.25, 0.55, d / 2 + 0.02, A); Sph(0.015, handle, 0.25, 1.95, d / 2 + 0.02, A);
  const gl = B(0.62, 1.0, 0.01, M('#3a2a20', { roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.55 }), 0, 0.76, d / 2 + 0.005, 0, A); gl.castShadow = false;
  // секция B — книжная (1.15 м): ящики, открытые полки с книгами, антресоль с двумя дверцами
  const Bg = new THREE.Group(); Bg.position.x = 0.15; g.add(Bg); const bw = 1.15;
  B(bw, 0.78, d, wd, 0, 0, 0, 0.006, Bg);
  for (let i = 0; i < 4; i++) { B(bw - 0.04, 0.17, 0.015, wd, 0, 0.04 + i * 0.185, d / 2, 0.004, Bg); B(0.16, 0.015, 0.02, handle, 0, 0.12 + i * 0.185, d / 2 + 0.015, 0.003, Bg); }
  B(bw, 0.6, d, wd, 0, 1.62, 0, 0.006, Bg); for (const s of [-1, 1]) { B(bw / 2 - 0.02, 0.56, 0.015, wd, s * bw / 4, 1.64, d / 2, 0.004, Bg); Sph(0.013, handle, s * 0.06, 1.9, d / 2 + 0.02, Bg); }
  for (const s of [-1, 1]) B(0.02, 0.84, d, wd, s * (bw / 2 - 0.01), 0.78, 0, 0, Bg);
  B(bw, 0.84, 0.01, M('#2e1d12'), 0, 0.78, -d / 2 + 0.01, 0, Bg);
  for (const yy of [1.06, 1.34]) B(bw - 0.04, 0.02, d - 0.02, wd, 0, yy, 0, 0, Bg);
  booksRow(Bg, bw - 0.06, 0.8, 0.0, 0.25, 0.25); booksRow(Bg, bw - 0.06, 1.08, 0.0, 0.25, 0.25); booksRow(Bg, bw - 0.06, 1.36, 0.0, 0.24, 0.25);
  // вешалка-плечики на антресоли
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.006, 6, 20, Math.PI), M('#333')); hook.position.set(0.15, 1.82, d / 2 + 0.05); Bg.add(hook);
  return g;
}
function wardrobe(w, h, d, matKey, { mirror = false, arched = false, doors = 2, shelves = false } = {}) {
  const g = new THREE.Group(); const wd = matKey.isMaterial ? matKey : FM(matKey, 1, 1, { roughness: 0.4 });
  B(w, h - 0.06, d, wd, 0, 0.06, 0, 0.01, g); B(w - 0.04, 0.06, d - 0.04, M('#2a1a10'), 0, 0, 0, 0, g);
  const dw = w / doors;
  for (let i = 0; i < doors; i++) {
    const cx = -w / 2 + dw * (i + 0.5);
    B(dw - 0.012, h - 0.12, 0.02, wd, cx, 0.08, d / 2 + 0.005, 0.005, g);
    if (mirror && i === Math.floor(doors / 2)) {
      const mw = dw - 0.14, mh = h - 0.5;
      const shape = new THREE.Shape(); shape.moveTo(-mw / 2, 0); shape.lineTo(mw / 2, 0); shape.lineTo(mw / 2, mh - (arched ? mw / 2 : 0));
      if (arched) shape.absarc(0, mh - mw / 2, mw / 2, 0, Math.PI, false); else shape.lineTo(-mw / 2, mh);
      shape.lineTo(-mw / 2, 0);
      const mm = new THREE.Mesh(new THREE.ShapeGeometry(shape, 24), mirrorM()); mm.position.set(cx, 0.25, d / 2 + 0.017); g.add(mm);
    }
    B(0.012, 0.12, 0.02, brass(), cx + (i % 2 ? -1 : 1) * (dw / 2 - 0.05), 1.0, d / 2 + 0.03, 0.004, g);
  }
  return g;
}
function bookshelf(w, h, d, shelves, matKey = 'wood_shelf') {
  const g = new THREE.Group(); const wd = FM(matKey, 1, 1, { roughness: 0.45 }); const sp = (h - 0.04) / shelves;
  B(0.025, h, d, wd, -w / 2 + 0.0125, 0, 0, 0, g); B(0.025, h, d, wd, w / 2 - 0.0125, 0, 0, 0, g); B(w, h, 0.01, M('#3d2420'), 0, 0, -d / 2 + 0.005, 0, g);
  const nv = Math.max(1, Math.round(w / 0.8)); for (let k = 1; k < nv; k++) B(0.02, h, d, wd, -w / 2 + k * w / nv, 0, 0, 0, g);
  for (let i = 0; i <= shelves; i++) { const y = i * sp; B(w, 0.022, d, wd, 0, y, 0, 0, g); if (i < shelves && i > 0) booksRow(g, w - 0.06, y + 0.022, 0.02, Math.min(0.3, sp - 0.05), d * 0.75); }
  return g;
}
function table(w, d, h, topM, legM, { glass = false, cloth = null } = {}) {
  const g = new THREE.Group();
  if (glass) { const t = B(w, 0.012, d, M('#bfe0dc', { roughness: 0.03, transparent: true, opacity: 0.35, envMapIntensity: 2 }), 0, h - 0.012, 0, 0.004, g); t.castShadow = true; }
  else B(w, 0.03, d, topM, 0, h - 0.03, 0, 0.006, g);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) Cyl(0.016, 0.016, h - 0.03, legM, sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.06), g, 12);
  if (cloth) { B(w + 0.1, 0.01, d + 0.1, cloth, 0, h, 0, 0.003, g); for (const s of [-1, 1]) { B(w + 0.1, 0.25, 0.008, cloth, 0, h - 0.24, s * (d / 2 + 0.05), 0, g); B(0.008, 0.25, d + 0.1, cloth, s * (w / 2 + 0.05), h - 0.24, 0, 0, g); } }
  return g;
}
function chair(seatM, frameM, { back = 'slats' } = {}) {
  const g = new THREE.Group(); B(0.42, 0.06, 0.42, seatM, 0, 0.42, 0, 0.02, g);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B(0.032, 0.42, 0.032, frameM, sx * 0.18, 0, sz * 0.18, 0.005, g);
  for (const sx of [-1, 1]) B(0.032, 0.5, 0.032, frameM, sx * 0.18, 0.47, -0.18, 0.005, g);
  if (back === 'slats') for (let i = 0; i < 3; i++) B(0.035, 0.38, 0.02, frameM, -0.08 + i * 0.08, 0.52, -0.19, 0.004, g);
  B(0.4, 0.06, 0.025, frameM, 0, 0.9, -0.19, 0.008, g);
  return g;
}
function foldingChair(m) { const g = new THREE.Group(); for (let i = 0; i < 6; i++) B(0.42, 0.02, 0.05, m, 0, 0.44, -0.16 + i * 0.065, 0.003, g); for (const s of [-1, 1]) { const a = B(0.03, 0.85, 0.03, m, s * 0.21, 0, 0.08, 0.003, g); a.rotation.x = 0.2; const b2 = B(0.03, 0.85, 0.03, m, s * 0.21, 0, -0.12, 0.003, g); b2.rotation.x = -0.25; } for (let i = 0; i < 3; i++) B(0.42, 0.06, 0.02, m, 0, 0.62 + i * 0.09, -0.24, 0.003, g); return g; }
function rug(scene, x, z, w, l, key, rot = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.01, l), M('#ffffff', { map: FT(key), roughness: 1 })); m.position.set(x, 0.006, z); m.rotation.y = rot; m.receiveShadow = true; scene.add(m);
}
function picture(scene, x, y, z, w, h, dir, srcKey, frame = '#6b4a2a') {
  const grp = new THREE.Group(); B(w + 0.06, h + 0.06, 0.025, M(frame, { roughness: 0.5 }), 0, -0.03, 0, 0.006, grp);
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), srcKey); p.position.set(0, h / 2, 0.014); grp.add(p);
  grp.position.set(x, y - h / 2, z); grp.rotation.y = (180 - dir) * D2R; scene.add(grp);
}
// картинка-вставка из фото (маленький фрагмент)
let PHOTO_IMGS = {};
export function setPhotoImgs(o) { PHOTO_IMGS = o; }
function photoCrop(file, x0, y0, x1, y1) {
  const img = PHOTO_IMGS[file]; if (!img) return M('#a08060');
  const c = document.createElement('canvas'); c.width = Math.max(8, (x1 - x0) * 2); c.height = Math.max(8, (y1 - y0) * 2);
  c.getContext('2d').drawImage(img, x0, y0, x1 - x0, y1 - y0, 0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return M('#ffffff', { map: t, roughness: 0.6 });
}
function plant(scene, x, y, z, s = 1, pot = '#a0522d') {
  const g = new THREE.Group(); Cyl(0.1 * s, 0.075 * s, 0.15 * s, M(pot, { roughness: 0.8 }), 0, 0, 0, g);
  const lm = M('#4d6b33', { roughness: 0.7 }); for (let i = 0; i < 9; i++) { const a = i * 2.4; Sph(0.08 * s, lm, Math.cos(a) * 0.07 * s, (0.2 + (i % 3) * 0.06) * s, Math.sin(a) * 0.07 * s, g, 1, 0.5, 1.6).rotation.y = a; }
  g.position.set(x, y, z); scene.add(g);
}

// ---------- кухня, ванная, туалет
function kitchenRun(len, { sinkAt, hobAt, uppers = [], microwaveAt, breadAt, kettleAt } = {}) {
  const g = new THREE.Group(); const front = FM('front_kitchen', 1, 1, { roughness: 0.4 }); const carcass = M('#e7d3ae', { roughness: 0.6 });
  const top = M('#ece0c6', { roughness: 0.35 }); const handle = chrome();
  B(len, 0.1, 0.52, M('#7a4a2c', { roughness: 0.5 }), 0, 0, -0.02, 0, g);
  B(len, 0.76, 0.56, carcass, 0, 0.1, 0, 0.005, g);
  B(len + 0.02, 0.035, 0.62, top, 0, 0.86, 0.02, 0.008, g);
  const nd = Math.max(1, Math.round(len / 0.45)); const dw = len / nd;
  for (let i = 0; i < nd; i++) {
    const cx = -len / 2 + dw * (i + 0.5); if (hobAt !== undefined && Math.abs(cx - hobAt) < dw / 2) continue;
    if (i % 3 === 1) { for (let k = 0; k < 3; k++) { B(dw - 0.008, 0.23, 0.02, front, cx, 0.12 + k * 0.24, 0.29, 0.005, g); B(0.12, 0.012, 0.015, handle, cx, 0.3 + k * 0.24, 0.31, 0.004, g); } }
    else { B(dw - 0.008, 0.72, 0.02, front, cx, 0.12, 0.29, 0.005, g); B(0.012, 0.14, 0.015, handle, cx + dw / 2 - 0.05, 0.65, 0.31, 0.004, g); }
  }
  // фартук: светлая стена
  const ap = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.6), M('#eee2cb', { roughness: 0.5 })); ap.position.set(0, 0.9 + 0.3, -0.275); g.add(ap);
  // навесные шкафы: [x0, x1, тип] — 'door' | 'glass' | 'open' | 'hood'
  for (const [x0, x1, type] of uppers) {
    const w = x1 - x0, cx = (x0 + x1) / 2;
    if (type === 'hood') { const hm = M('#cfd2d4', { metalness: 0.85, roughness: 0.3 }); const hd = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.32, 0.18, 4, 1), hm); hd.rotation.y = Math.PI / 4; hd.scale.set(1.3, 1, 0.8); hd.position.set(cx, 1.62, -0.07); g.add(hd); B(0.2, 0.55, 0.18, hm, cx, 1.7, -0.18, 0.004, g); continue; }
    B(w - 0.006, 0.72, 0.32, carcass, cx, 1.5, -0.12, 0.005, g);
    if (type === 'open') { B(w - 0.03, 0.7, 0.01, M('#a56b3c', { roughness: 0.5 }), cx, 1.51, -0.27, 0, g); B(w - 0.03, 0.018, 0.3, front, cx, 1.85, -0.12, 0, g); continue; }
    B(w - 0.012, 0.7, 0.02, type === 'glass' ? M('#6d5b48', { roughness: 0.1, transparent: true, opacity: 0.5 }) : front, cx, 1.51, 0.045, 0.005, g);
    if (type === 'glass') { for (const s of [-1, 1]) B(0.05, 0.7, 0.022, front, cx + s * (w / 2 - 0.03), 1.51, 0.046, 0.004, g); B(w - 0.012, 0.05, 0.022, front, cx, 1.51, 0.046, 0.004, g); B(w - 0.012, 0.05, 0.022, front, cx, 2.16, 0.046, 0.004, g); }
    B(0.012, 0.12, 0.015, handle, cx + w / 2 - 0.05, 1.58, 0.07, 0.004, g);
  }
  // подсветка-карниз
  if (uppers.length) { const x0 = Math.min(...uppers.map(u => u[0])), x1 = Math.max(...uppers.map(u => u[1])); B(x1 - x0, 0.06, 0.4, front, (x0 + x1) / 2, 2.22, -0.08, 0.005, g); }
  if (sinkAt !== undefined) { const st = M('#cfd3d6', { metalness: 0.9, roughness: 0.25 }); B(0.5, 0.012, 0.46, st, sinkAt, 0.885, 0.02, 0, g); B(0.38, 0.01, 0.34, M('#9ea3a6', { metalness: 0.9, roughness: 0.3 }), sinkAt - 0.03, 0.893, 0.02, 0, g); Cyl(0.012, 0.012, 0.28, chrome(), sinkAt + 0.12, 0.89, -0.2, g); }
  if (hobAt !== undefined) { // электроплита с четырьмя «блинами» и духовкой
    const wm = M('#e9e9e6', { roughness: 0.3 }); B(0.58, 0.86, 0.58, M('#c9ccce', { metalness: 0.8, roughness: 0.35 }), hobAt, 0, 0.01, 0.01, g);
    B(0.5, 0.36, 0.01, M('#1c1c1c', { roughness: 0.05 }), hobAt, 0.2, 0.3, 0.01, g); B(0.44, 0.012, 0.012, chrome(), hobAt, 0.62, 0.32, 0.004, g);
    for (const [dx, dz] of [[-0.13, -0.12], [0.13, -0.12], [-0.13, 0.12], [0.13, 0.12]]) { Cyl(0.08, 0.08, 0.012, M('#2a2a2a', { metalness: 0.5, roughness: 0.4 }), hobAt + dx, 0.86, dz, g); Cyl(0.03, 0.03, 0.004, M('#777', { metalness: 0.8 }), hobAt + dx, 0.872, dz, g); }
    for (let k = 0; k < 4; k++) Cyl(0.018, 0.018, 0.02, M('#333'), hobAt - 0.15 + k * 0.1, 0.75, 0.31, g).rotation.x = Math.PI / 2;
  }
  if (microwaveAt !== undefined) { const mw = new THREE.Group(); B(0.48, 0.28, 0.36, M('#f4f4f2', { roughness: 0.3 }), 0, 0, 0, 0.02, mw); B(0.3, 0.2, 0.005, M('#20262a', { roughness: 0.1 }), -0.06, 0.04, 0.18, 0, mw); B(0.1, 0.2, 0.005, M('#dcdcdc'), 0.17, 0.04, 0.18, 0, mw); mw.position.set(microwaveAt, 0.895, -0.05); g.add(mw); }
  if (breadAt !== undefined) { const bm = new THREE.Group(); B(0.28, 0.32, 0.38, M('#f2f2ef', { roughness: 0.3 }), 0, 0, 0, 0.05, bm); B(0.2, 0.08, 0.005, M('#c33'), 0, 0.1, 0.19, 0.01, bm); bm.position.set(breadAt, 0.895, -0.05); g.add(bm); }
  if (kettleAt !== undefined) { Cyl(0.08, 0.09, 0.24, M('#d8d8d8', { metalness: 0.8, roughness: 0.25 }), kettleAt, 0.895, -0.12, g); }
  return g;
}
function fridge() { const g = new THREE.Group(); const w = M('#f6f6f3', { roughness: 0.2 }); B(0.6, 1.85, 0.62, w, 0, 0, 0, 0.04, g); B(0.59, 0.005, 0.02, M('#aaa'), 0, 1.2, 0.31, 0, g); B(0.025, 0.3, 0.03, M('#d8d8d8', { roughness: 0.3 }), -0.25, 1.3, 0.32, 0.01, g); B(0.025, 0.25, 0.03, M('#d8d8d8', { roughness: 0.3 }), -0.25, 0.85, 0.32, 0.01, g); return g; }
function bathTub() {
  const g = new THREE.Group(); const en = M('#fbfbfa', { roughness: 0.12 });
  const len = 1.7, w = 0.7, h = 0.58;
  B(len, h - 0.05, w, en, 0, 0.05, 0, 0.04, g);
  const inner = new THREE.Mesh(new RoundedBoxGeometry(len - 0.12, 0.42, w - 0.12, 3, 0.12), M('#eef0f0', { roughness: 0.08 })); inner.position.set(0, h - 0.17, 0); g.add(inner);
  B(len, 0.5, 0.02, M('#ffffff', { map: FT('pvc_bath', 1.1, 0.6), roughness: 0.3 }), 0, 0.02, w / 2 + 0.01, 0, g); // экран ванны
  return g;
}
function washer() { const g = new THREE.Group(); const w = M('#f5f5f3', { roughness: 0.25 }); B(0.6, 0.85, 0.5, w, 0, 0, 0, 0.03, g); const r = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.03, 12, 32), M('#c9cdd0', { metalness: 0.8, roughness: 0.25 })); r.position.set(0, 0.42, 0.255); g.add(r); const d = new THREE.Mesh(new THREE.CircleGeometry(0.16, 32), M('#5b7380', { roughness: 0.05, transparent: true, opacity: 0.8 })); d.position.set(0, 0.42, 0.252); g.add(d); B(0.56, 0.1, 0.01, M('#e0e0e0'), 0, 0.72, 0.25, 0.005, g); B(0.6, 0.01, 0.5, M('#b9a47c', { roughness: 1 }), 0, 0.85, 0, 0, g); Cyl(0.04, 0.045, 0.22, M('#2f8a3a', { roughness: 0.3 }), 0.12, 0.86, 0.05, g); return g; }
function wallSink() { const g = new THREE.Group(); const c = M('#fbfbfa', { roughness: 0.12 });
  B(0.6, 0.18, 0.46, c, 0, 0.72, 0.02, 0.08, g); B(0.46, 0.03, 0.3, M('#eef0f0', { roughness: 0.05 }), 0, 0.875, 0.04, 0.02, g); Cyl(0.03, 0.03, 0.3, c, 0, 0.42, -0.1, g);
  Cyl(0.012, 0.012, 0.2, chrome(), 0, 0.9, -0.17, g); const sp = Cyl(0.01, 0.01, 0.15, chrome(), 0, 1.06, -0.12, g); sp.rotation.x = Math.PI / 2; sp.position.y = 1.08;
  Sph(0.05, M('#2a7fc0', { roughness: 0.3 }), 0.14, 0.92, 0.1, g, 1, 0.35, 0.8);
  return g; }
function toilet() { const g = new THREE.Group(); const c = M('#f6f3ea', { roughness: 0.15 }); Cyl(0.13, 0.1, 0.38, c, 0, 0, 0.08, g); Sph(0.19, c, 0, 0.38, 0.12, g, 1, 0.3, 1.25); B(0.38, 0.03, 0.46, M('#f0ede4', { roughness: 0.2 }), 0, 0.42, 0.12, 0.1, g); B(0.4, 0.38, 0.17, c, 0, 0.45, -0.2, 0.05, g); B(0.42, 0.03, 0.19, c, 0, 0.83, -0.2, 0.012, g); Cyl(0.015, 0.015, 0.02, chrome(), 0, 0.86, -0.2, g); return g; }
function crtTV() { const g = new THREE.Group(); B(0.62, 0.5, 0.5, M('#2b2b2d', { roughness: 0.4 }), 0, 0, -0.02, 0.04, g); B(0.5, 0.38, 0.01, M('#15181a', { roughness: 0.05, metalness: 0.3 }), -0.02, 0.07, 0.235, 0.03, g); return g; }
function daybed(l, w) { const g = new THREE.Group(); const wd = M('#5a3622', { roughness: 0.5 }); B(l, 0.3, w, wd, 0, 0.05, 0, 0.01, g); B(l - 0.04, 0.14, w - 0.04, M('#ece5d8', { roughness: 0.9 }), 0, 0.33, 0, 0.05, g); B(l - 0.25, 0.08, w + 0.02, M('#3d5f9c', { roughness: 0.95 }), 0.1, 0.44, 0, 0.04, g); B(0.5, 0.14, 0.4, M('#d9cdb8', { roughness: 0.95 }), -l / 2 + 0.3, 0.48, 0, 0.06, g); return g; }
function trolley() { const g = new THREE.Group(); const c = chrome(); for (const sx of [-1, 1]) for (const sz of [-1, 1]) Cyl(0.008, 0.008, 0.8, c, sx * 0.28, 0.04, sz * 0.18, g, 8); for (const y of [0.15, 0.48, 0.8]) B(0.58, 0.01, 0.38, M('#c8ced2', { metalness: 0.9, roughness: 0.3, transparent: true, opacity: 0.6 }), 0, y, 0, 0, g); B(0.25, 0.18, 0.2, M('#f1efe9'), 0.1, 0.81, 0, 0.03, g); Cyl(0.05, 0.05, 0.12, M('#d2691e', { roughness: 0.4 }), -0.15, 0.81, 0, g); return g; }
function skin(scene, key, x0, z0, x1, z1, y0, y1) { // облицовка плиткой на стене
  const g = boxW((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.max(0.01, x1 - x0), y1 - y0, Math.max(0.01, z1 - z0));
  const m = new THREE.Mesh(g, PM(key, { roughness: 0.25 })); m.receiveShadow = true; scene.add(m); return m;
}

// ---------- расстановка мебели по фотографиям
export function buildFurniture(scene) {
  const dark = M('#4a2a1a', { roughness: 0.45 }), darkWood = M('#5a3420', { roughness: 0.45 });
  // ===== Большая комната 18,9 м² (r1): x .1–3.586, z .1–5.929
  place(scene, wallUnitLiving(), 0.33, 4.25, 90);
  place(scene, cabinet(0.95, 0.72, 0.45, dark, { doors: 2 }), 0.33, 2.5, 90);
  place(scene, table(0.55, 0.55, 0.5, dark, dark), 1.15, 0.75, 180);
  place(scene, cabinet(0.62, 0.95, 0.44, dark, { drawers: 1 }), 3.36, 0.6, 270);
  place(scene, sofa(2.3, 'sofa_living', { cushKey: 'cushion_living', cushions: 3, d: 0.95 }), 3.1, 3.95, 270);
  rug(scene, 1.75, 3.35, 1.95, 2.9, 'rug_living');
  chandelier(scene, 1.85, 3.0, { arms: 5, style: 'tulip', intensity: 9 });
  // гладильная доска, прислонённая к стенке (видна на фото)
  { const ib = B(0.36, 1.25, 0.03, M('#2b2b2b', { roughness: 0.6 }), 0.62, 0, 3.22, 0.1, scene); ib.rotation.x = -0.18; ib.rotation.y = Math.PI / 2; }

  // ===== Спальня (r2): x .1–3.586, z 6.129–10.37
  place(scene, bed(1.6, 2.05), 1.16, 8.4, 90);
  place(scene, wardrobe(1.15, 2.2, 0.58, M('#4a2c1c', { roughness: 0.45 }), { doors: 2 }), 0.4, 6.72, 90);
  place(scene, armchair('sofa_room3'), 0.62, 9.85, 45);
  place(scene, table(1.0, 0.55, 0.75, M('#8a5a3a', { roughness: 0.5 }), M('#6b4228')), 3.3, 9.55, 270);
  lamp(scene, 3.35, 0.75, 9.95);
  place(scene, chair(M('#8a5a3a'), M('#6b4228')), 2.82, 9.55, 90, false);
  place(scene, cabinet(0.9, 0.85, 0.45, M('#8a3e2a', { roughness: 0.45 }), { drawers: 4 }), 3.36, 7.85, 270);
  B(0.8, 0.02, 0.22, M('#7a4a2c'), 3.47, 1.55, 9.55, 0, scene).rotation.y = Math.PI / 2; // навесная полка над столом
  rug(scene, 2.45, 8.4, 0.9, 2.0, 'rug_bedroom');
  bowlPendant(scene, 1.85, 8.25, 8);
  sconce(scene, 0.12, 1.45, 8.4, 90);
  picture(scene, 0.115, 1.75, 7.55, 0.2, 0.25, 90, M('#ffffff', { map: TX.pic_bed1 }), '#e8e0d0'); picture(scene, 0.115, 1.8, 9.3, 0.25, 0.3, 90, M('#ffffff', { map: TX.pic_bed2 }), '#e8e0d0');
  // ===== Комната 11,1 м² (r3): x 3.786–7.567, z 7.332–10.37
  place(scene, wardrobe(1.1, 2.2, 0.56, M('#4a2c1c', { roughness: 0.45 }), { doors: 2 }), 7.285, 7.95, 270);
  place(scene, daybed(1.85, 0.82), 7.15, 9.42, 270);
  place(scene, sofa(1.85, 'sofa_room3', { d: 0.85 }), 4.23, 9.3, 90);
  sconce(scene, 3.8, 1.55, 9.3, 90, true);
  picture(scene, 3.8, 2.05, 9.0, 0.45, 0.5, 90, M('#ffffff', { map: TX.poster_room3, roughness: 0.5 }), '#d8c9a8');
  rug(scene, 5.7, 8.85, 1.9, 2.5, 'rug_room3');
  place(scene, table(0.6, 0.5, 0.7, darkWood, darkWood), 5.05, 10.0, 180);
  chandelier(scene, 5.68, 8.85, { arms: 3, style: 'globe', r: 0.22, intensity: 7 });
  // ===== Холл: hall x 3.786–7.667, z 4.874–7.132; hall2 до x 9.206
  place(scene, bookshelf(2.2, 2.4, 0.35, 6), 8.1, 5.05, 180);
  place(scene, bookshelf(1.2, 2.1, 0.35, 5), 6.2, 5.05, 180);
  place(scene, cabinet(0.7, 0.5, 0.42, M('#3a2a20'), { doors: 2 }), 7.35, 5.45, 180);
  place(scene, crtTV(), 7.35, 5.45, 180, false, 0.5);
  place(scene, leatherSofa(1.2), 6.98, 6.68, 0);
  chandelier(scene, 6.0, 6.0, { arms: 3, style: 'globe', r: 0.2, drop: 0.3, intensity: 5 });
  plafond(scene, 8.5, 5.75, 4);
  // ===== Коридор: x 7.767–8.886
  place(scene, wardrobe(1.75, 2.4, 0.42, 'door_wood', { mirror: true, arched: true, doors: 3 }), 7.98, 8.475, 90);
  place(scene, bookshelf(0.42, 2.0, 0.3, 4, 'door_wood'), 7.92, 9.62, 90);
  plafond(scene, 8.33, 8.3, 3.5);
  // ===== Ванная: x 9.086–11.113, z 6.846–8.642
  place(scene, bathTub(), 10.76, 7.744, 270);
  skin(scene, 'tile_bath', 11.1, 6.846, 11.113, 8.642, 0, 1.5);
  skin(scene, 'tile_bath', 9.086, 8.63, 11.113, 8.642, 0, 1.5);
  { const c = new THREE.Mesh(folds(0.42, 1.75, 4, 0.05), FM('curtain_bath', 1, 1, { side: THREE.DoubleSide, roughness: 0.6 })); c.position.set(10.42, 1.08, 7.08); c.rotation.y = Math.PI / 2; c.castShadow = true; scene.add(c);
    const rod = Cyl(0.01, 0.01, 1.8, chrome(), 10.4, 1.95, 7.744, scene, 8); rod.rotation.x = Math.PI / 2; rod.position.y = 1.97;
    Cyl(0.01, 0.01, 0.7, chrome(), 11.06, 1.0, 7.0, scene, 8); }
  place(scene, washer(), 9.8, 7.1, 180);
  place(scene, wallSink(), 10.15, 8.41, 0, true);
  { const mm = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), mirrorM()); mm.position.set(10.15, 1.55, 8.625); mm.rotation.y = Math.PI; scene.add(mm);
    B(0.6, 0.008, 0.12, M('#cfe3e6', { roughness: 0.05, transparent: true, opacity: 0.5 }), 10.15, 1.2, 8.56, 0, scene);
    for (const dx of [-0.1, 0.05]) Cyl(0.03, 0.025, 0.1, M('#2f6fd0', { roughness: 0.3 }), 10.15 + dx, 1.21, 8.56, scene);
    B(0.4, 0.06, 0.08, M('#f2f2f2', { emissive: '#fff1da', emissiveIntensity: 1 }), 10.15, 1.92, 8.6, 0.02, scene); addLight(scene, 10.15, 1.9, 8.4, 1.5, '#fff0d8', 3); }
  { const r = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.008, 8, 24), chrome()); r.position.set(9.95, 1.3, 6.86); scene.add(r); }
  plafond(scene, 10.1, 7.75, 4);
  // ===== Туалет: x 9.086–11.113, z 8.842–9.846
  { const g = new THREE.Group(); B(0.3, H, 1.0, M('#d8c9a8'), 0, 0, 0, 0, g); const f = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 2.0), M('#ffffff', { map: FT('wc_cabinet'), roughness: 0.6 })); f.position.set(-0.151, 1.0, 0); f.rotation.y = -Math.PI / 2; g.add(f); g.position.set(10.96, 0, 9.344); scene.add(g); solids.push({ x0: 10.81, x1: 11.113, z0: 8.842, z1: 9.846 }); }
  place(scene, toilet(), 10.45, 9.344, 270);
  Cyl(0.05, 0.05, 0.1, M('#f7f7f7'), 9.6, 0.75, 8.88, scene).rotation.z = Math.PI / 2;
  Cyl(0.04, 0.05, 0.35, M('#e0e0e0'), 10.62, 0, 9.72, scene);
  plafond(scene, 10.0, 9.35, 2.5);
  // ===== Кухня 15,3 м²: x 7.767–11.113, z 10.046–12.802 + эркер
  place(scene, kitchenRun(2.3, { hobAt: -0.1, microwaveAt: 0.42, breadAt: 0.92, kettleAt: -0.7,
    uppers: [[-1.15, -0.65, 'door'], [-0.65, -0.37, 'glass'], [-0.35, 0.15, 'hood'], [0.15, 0.55, 'glass'], [0.55, 0.95, 'door'], [0.95, 1.15, 'open']] }), 10.81, 11.196, 270);
  place(scene, kitchenRun(1.55, { sinkAt: 0.45, uppers: [[-0.775, 0.15, 'open'], [0.15, 0.775, 'glass']] }), 9.73, 10.346, 180);
  place(scene, fridge(), 8.08, 10.45, 90);
  place(scene, crtTV(), 8.08, 10.45, 90, false, 1.9);
  place(scene, table(0.9, 0.6, 0.75, null, chrome(), { glass: true }), 9.6, 12.85, 180);
  const chairSeat = M('#3a2418', { roughness: 0.6 }), chairFrame = M('#3a2418', { roughness: 0.4 });
  place(scene, chair(chairSeat, chairFrame), 9.05, 12.85, 90);
  place(scene, chair(chairSeat, chairFrame), 9.65, 12.3, 180);
  const lc = place(scene, chair(M('#c99a68', { roughness: 0.5 }), M('#c99a68', { roughness: 0.5 })), 8.25, 12.35, 120);
  B(0.12, 0.85, 0.5, M('#c9a0a0', { roughness: 1 }), 8.22, 0.3, 12.5, 0.05, scene).rotation.y = 0.5; // розовая ткань на стуле
  place(scene, trolley(), 7.98, 11.75, 90);
  B(0.32, 0.32, 0.02, M('#6b4a2a'), 8.6, 2.0, 10.052, 0.004, scene); // картинка с петухом над дверью
  barPendant(scene, 9.6, 11.45, 1.0, 4);
  // ===== Лоджия
  const lw = M('#b5835a', { roughness: 0.6 });
  place(scene, foldingChair(lw), 7.25, 12.3, 270);
  place(scene, foldingChair(lw), 6.9, 12.6, 300);
  place(scene, table(0.8, 0.6, 0.72, lw, lw, { cloth: FM('tablecloth', 2, 2) }), 5.6, 11.0, 180);
  { const [, , , Dp] = LOGGIA, Ap = LOGGIA[0]; const dx = Ap[0] - Dp[0], dz = Ap[1] - Dp[1], len = Math.hypot(dx, dz);
    const g = new THREE.Group(); B(1.4, 0.75, 0.18, M('#b98a5c', { roughness: 0.6 }), 0, 0.05, 0, 0.01, g); for (let i = 0; i < 12; i++) B(0.03, 0.55, 0.01, M('#8a5f3c'), -0.6 + i * 0.11, 0.15, 0.092, 0, g);
    g.position.set((Ap[0] + Dp[0]) / 2 + 0.73 * 0.14, 0, (Ap[1] + Dp[1]) / 2 - 0.684 * 0.14); g.rotation.y = -Math.atan2(dz, dx) + Math.PI; scene.add(g); }
  plant(scene, 6.4, 0.95, 12.8); plant(scene, 7.15, 0.95, 12.8, 0.8); plant(scene, 4.6, 0.95, 11.5, 0.9);
  Cyl(0.07, 0.05, 0.3, M('#c7b08a', { roughness: 0.5 }), 5.6, 0.73, 11.0, scene);
  plafond(scene, 6.4, 11.3, 2.5);
}

// ---------- окружение: двор, деревья, соседние дома и панорама из фото
export function buildOutside(scene, pano) {
  // свой дом: фасад ниже/выше этажа
  const fac = M('#d9d2c4', { roughness: 0.95, map: AT('concrete') });
  // соседние этажи: тот же контур дома (с эркером и лоджией), чтобы из окон не было видно «потолка» над стеклом
  const { a: ba, b: bb, z: bz, depth: bd } = BAY;
  const outline = [[0, 0], [3.686, 0], [3.686, 4.774], [11.213, 4.774], [11.213, bz], [bb, bz], [bb - bd, bz + bd], [ba + bd, bz + bd], [ba, bz], [7.667, bz], [LOGGIA[3][0], LOGGIA[3][1]], [LOGGIA[0][0], LOGGIA[0][1]], [0, 10.47]];
  const shp = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
  const mk = (y0, h) => { const g = new THREE.ExtrudeGeometry(shp, { depth: h, bevelEnabled: false }); g.rotateX(-Math.PI / 2); g.translate(0, y0, 0); worldUV(g); const m = new THREE.Mesh(g, fac); scene.add(m); return m; };
  ceilings.push(mk(-12, 11.7));
  const above = mk(H + 0.3, 12); ceilings.push(above);
  // деревья
  const trunk = M('#5b4636'), leaf = M('#4f6b35', { roughness: 0.9 });
  const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  for (let i = 0; i < 0; i++) {
    const a = rnd() * Math.PI * 2, d = 14 + rnd() * 30, x = 5.6 + Math.cos(a) * d, z = 5.9 + Math.sin(a) * d;
    const h = 5 + rnd() * 5; const t = Cyl(0.25, 0.35, h, trunk, x, -12, z, scene, 6);
    Sph(2.4 + rnd() * 1.6, leaf, x, -12 + h, z, scene, 1, 1.3, 1);
  }
  // соседние дома: оранжево-белые башни (вид из кухни) и кирпичные (вид с балкона)
  const towers = [[-30, -45, 18, 14, 50, '#e0e0da'], [5, -55, 22, 14, 45, '#d9b48c'], [40, -40, 18, 14, 40, '#c98b5e'], [-25, 50, 20, 14, 48, '#e7e2d8'], [10, 60, 20, 14, 52, '#d08a52'], [45, 45, 16, 14, 38, '#b5654a']];
  if (false) for (const [x, z, w, d, h, c] of towers) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M(c, { roughness: 0.9 })); m.position.set(x, -12 + h / 2, z); scene.add(m); }
  // панорама-цилиндр из реальных фото вида
  if (pano) {
    pano.colorSpace = THREE.SRGBColorSpace; pano.wrapS = THREE.RepeatWrapping; pano.repeat.x = -1;
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(120, 120, 120, 96, 1, true), new THREE.MeshBasicMaterial({ map: pano, side: THREE.BackSide, toneMapped: false, fog: false }));
    cyl.position.set(5.6, 15, 5.9); scene.add(cyl);
  }
}
