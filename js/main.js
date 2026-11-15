import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { H, RECTS, POLYS, ROOMS, PHOTOS } from './data.js';
import { makeTextures, setAniso } from './textures.js';
import { buildArchitecture, buildFurniture, buildOutside, solids, segments, ceilings, lights, setTulle, setBooks, inPoly } from './build.js';

const $ = s => document.querySelector(s);
const params = new URLSearchParams(location.search + location.hash.replace('#', '&'));
const isTouch = matchMedia('(pointer: coarse)').matches;
const EYE = 1.6, RADIUS = 0.2;

// ---------- рендер
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('shot') });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('#app').appendChild(renderer.domElement);
setAniso(renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene(); scene.background = new THREE.Color('#cfe0ee');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.35;
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 400); camera.rotation.order = 'YXZ';

// ---------- свет: дневной свет из окон + тёплые люстры
const hemi = new THREE.HemisphereLight('#dfeaff', '#b59a78', isTouch ? 0.9 : 0.55); scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff1dc', 3.2); sun.position.set(-2, 14, 24); sun.target.position.set(5.6, 0, 6.5); scene.add(sun, sun.target);
sun.castShadow = true; sun.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048); Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 60 }); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 4;
// мягкий «дневной» свет, проникающий через окна (имитация отражённого света неба)
const windowFill = [[1.2, 0.7], [2.6, 0.7], [1.6, 9.8], [5.2, 9.8], [9.75, 12.5], [5.8, 11.9], [2.0, -0.7], [8.6, 6.0]];
if (!isTouch) for (const [x, z] of windowFill) { const l = new THREE.PointLight('#e6efff', 3.2, 6, 2); l.position.set(x, 1.7, z); scene.add(l); }

// ---------- загрузка
const loadImg = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
const progress = p => { $('#loadbar i').style.width = (p * 100) + '%'; };

let panoCyl;
async function init() {
  progress(0.05);
  const PT = makeTextures(); setTulle(PT.tulle);
  // фото-текстуры, вырезанные из присланных фотографий (tex/*.jpg)
  const META = await (await fetch('tex/meta.json')).json();
  const loader = new THREE.TextureLoader(); const TX = {}; const keys = [...Object.keys(META), 'books']; let done = 0;
  await Promise.all(keys.map(k => new Promise(res => loader.load('tex/' + k + '.jpg', t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); TX[k] = t; progress(0.05 + 0.55 * (++done) / keys.length); res(); }, undefined, () => res()))));
  if (TX.books) { TX.books.wrapS = THREE.RepeatWrapping; setBooks(TX.books); } else setBooks(PT.books);
  buildArchitecture(scene, TX, META); progress(0.7);
  buildFurniture(scene); progress(0.8);
  const pano = await new Promise(res => loader.load('tex/panorama.jpg', res, undefined, () => res(null)));
  buildOutside(scene, pano); progress(0.9);
  await buildPhotoLayer();
  scene.traverse(o => { if (o.isMesh && o.material && o.material.map) o.material.map.anisotropy = renderer.capabilities.getMaxAnisotropy(); });
  // зеркала: один раз снимаем кубическую карту окружения из точки зеркала
  const mirrorsList = []; scene.traverse(o => { if (o.isMesh && o.material && o.material.userData && o.material.userData.mirror) mirrorsList.push(o); });
  for (const m of mirrorsList) {
    const rt = new THREE.WebGLCubeRenderTarget(isTouch ? 128 : 256, { type: THREE.HalfFloatType }); const cc = new THREE.CubeCamera(0.05, 60, rt);
    const p = new THREE.Vector3(); m.getWorldPosition(p); const n = new THREE.Vector3(0, 0, 1).applyQuaternion(m.getWorldQuaternion(new THREE.Quaternion()));
    cc.position.copy(p).addScaledVector(n, 0.05); scene.add(cc); m.visible = false; cc.update(renderer, scene); m.visible = true; scene.remove(cc);
    m.material.envMap = rt.texture; m.material.envMapIntensity = 1.0; m.material.needsUpdate = true;
  }
  setupComposer();
  buildUI();
  const v = params.get('view'); // ?view=x,z,направление
  if (v) { const [x, z, d] = v.split(',').map(Number); teleport(x, z, d, true); }
  else { const r = ROOMS.hall; teleport(r.spawn[0], r.spawn[1], r.spawn[2], true); }
  if (params.get('mode') === 'overview') setMode('overview');
  progress(1); setTimeout(() => $('#loader').classList.add('hidden'), 200);
  renderer.compile(scene, camera);
  animate();
}

// ---------- постобработка: окклюзия окружения (GTAO)
let composer, gtao, hq = !isTouch && params.get('hq') !== '0';
function setupComposer() {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
  gtao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.5, thickness: 1.2, scale: 1.25, samples: 16 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
  gtao.blendIntensity = 0.85;
  // стёкла и прозрачные элементы не должны давать AO-«тени» (иначе на потолке появляются клинья)
  const transparent = []; scene.traverse(o => { if (o.isMesh && o.material && !Array.isArray(o.material) && o.material.transparent) transparent.push(o); });
  const gr = gtao.render.bind(gtao); gtao.render = (...a) => { const vis = transparent.map(o => o.visible); transparent.forEach(o => (o.visible = false)); gr(...a); transparent.forEach((o, i) => (o.visible = vis[i])); };
  composer.addPass(gtao); composer.addPass(new OutputPass());
}

// ---------- управление от первого лица
const player = { x: 5.45, z: 2.1, yaw: Math.PI, pitch: -0.05, vx: 0, vz: 0, bob: 0 };
const keys = new Set(); let mode = 'walk'; let tween = null;
function teleport(x, z, dir, instant) {
  const yaw = dir !== undefined ? -dir * Math.PI / 180 : player.yaw;
  if (mode !== 'walk') setMode('walk');
  if (instant) { Object.assign(player, { x, z, yaw, vx: 0, vz: 0 }); return; }
  let dy = ((yaw - player.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  tween = { fx: player.x, fz: player.z, fy: player.yaw, tx: x, tz: z, ty: player.yaw + dy, t: 0, d: Math.min(1.6, 0.4 + Math.hypot(x - player.x, z - player.z) * 0.15) };
}
addEventListener('keydown', e => { if (e.target.tagName === 'INPUT') return; keys.add(e.code); if (e.code === 'Escape') closeGallery(); });
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

// мышь/тач: перетаскивание — поворот головы; двойной клик/тап по полу — переход
const el = renderer.domElement; let drag = null;
el.addEventListener('pointerdown', e => { if (mode !== 'walk') return; drag = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: 0, t: performance.now() }; el.setPointerCapture(e.pointerId); });
el.addEventListener('pointermove', e => {
  if (!drag || drag.id !== e.pointerId || mode !== 'walk') return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
  const k = e.pointerType === 'touch' ? 0.006 : 0.004; tween = null;
  player.yaw += dx * k; player.pitch = THREE.MathUtils.clamp(player.pitch + dy * k, -1.2, 1.2);
});
el.addEventListener('pointerup', e => { if (drag && drag.moved < 6 && performance.now() - drag.t < 300) tapAt(e); drag = null; });
let lastTap = 0;
function tapAt(e) {
  const now = performance.now(); const dbl = now - lastTap < 350; lastTap = now;
  if (!dbl && !isTouch) return; if (!dbl) return;
  const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -e.clientY / innerHeight * 2 + 1), camera);
  const t = -camera.position.y / ray.ray.direction.y; if (!(t > 0)) return;
  const p = ray.ray.origin.clone().addScaledVector(ray.ray.direction, t);
  if (!roomAt(p.x, p.z)) return;
  // не уходим сквозь стены: ограничиваем точку первым препятствием
  const s = { x: player.x, z: player.z }; const L = Math.hypot(p.x - s.x, p.z - s.z); let ok = L;
  for (let d = 0.1; d < L; d += 0.05) { const x = s.x + (p.x - s.x) * d / L, z = s.z + (p.z - s.z) * d / L; if (blocked(x, z)) { ok = d - 0.25; break; } }
  if (ok > 0.2) teleport(s.x + (p.x - s.x) * ok / L, s.z + (p.z - s.z) * ok / L);
}
el.addEventListener('dblclick', e => { if (isTouch) return; lastTap = performance.now() - 100; tapAt(e); });
el.addEventListener('wheel', e => { if (mode === 'walk') { wheelZoom = true; camera.fov = THREE.MathUtils.clamp(camera.fov + e.deltaY * 0.03, 40, 85); camera.updateProjectionMatrix(); } }, { passive: true });

// виртуальный джойстик (мобильные)
const joy = { x: 0, y: 0, active: false };
function setupJoystick() {
  const pad = $('#joy'), knob = $('#joy i'); let id = null, cx = 0, cy = 0;
  pad.addEventListener('pointerdown', e => { id = e.pointerId; pad.setPointerCapture(id); const r = pad.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; joy.active = true; move(e); e.stopPropagation(); });
  const move = e => { if (e.pointerId !== id) return; let dx = e.clientX - cx, dy = e.clientY - cy; const l = Math.hypot(dx, dy), m = 45; if (l > m) { dx *= m / l; dy *= m / l; } joy.x = dx / m; joy.y = dy / m; knob.style.transform = `translate(${dx}px,${dy}px)`; };
  pad.addEventListener('pointermove', move);
  const end = e => { if (e.pointerId !== id) return; id = null; joy.active = false; joy.x = joy.y = 0; knob.style.transform = ''; };
  pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
}

function roomAt(x, z) { const r = RECTS.find(r => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) || POLYS.find(p => inPoly(x, z, p.poly)); return r ? r.group : null; }
function blocked(x, z) {
  for (const [ax, az, bx, bz] of segments) { const d = distSeg(x, z, ax, az, bx, bz); if (d < RADIUS) return true; }
  for (const b of solids) if (x > b.x0 - RADIUS && x < b.x1 + RADIUS && z > b.z0 - RADIUS && z < b.z1 + RADIUS) return true;
  return false;
}
function distSeg(px, pz, ax, az, bx, bz) { const dx = bx - ax, dz = bz - az; const l2 = dx * dx + dz * dz; let t = l2 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - ax - t * dx, pz - az - t * dz); }
function collide(p) {
  for (let it = 0; it < 3; it++) {
    for (const [ax, az, bx, bz] of segments) {
      const dx = bx - ax, dz = bz - az; const l2 = dx * dx + dz * dz; let t = l2 ? ((p.x - ax) * dx + (p.z - az) * dz) / l2 : 0; t = Math.max(0, Math.min(1, t));
      const cx = ax + t * dx, cz = az + t * dz; let ox = p.x - cx, oz = p.z - cz; const d = Math.hypot(ox, oz);
      if (d < RADIUS) { if (d < 1e-6) { ox = -dz; oz = dx; } const L = Math.hypot(ox, oz); p.x = cx + ox / L * RADIUS; p.z = cz + oz / L * RADIUS; }
    }
    for (const b of solids) {
      const cx = Math.max(b.x0, Math.min(p.x, b.x1)), cz = Math.max(b.z0, Math.min(p.z, b.z1)); const ox = p.x - cx, oz = p.z - cz; const d = Math.hypot(ox, oz);
      if (d < RADIUS) {
        if (d > 1e-6) { p.x = cx + ox / d * RADIUS; p.z = cz + oz / d * RADIUS; }
        else { const opts = [[b.x0 - RADIUS - p.x, 0], [b.x1 + RADIUS - p.x, 0], [0, b.z0 - RADIUS - p.z], [0, b.z1 + RADIUS - p.z]].sort((a, c) => Math.hypot(...a) - Math.hypot(...c)); p.x += opts[0][0]; p.z += opts[0][1]; }
      }
    }
  }
}

function updateWalk(dt) {
  if (tween) {
    tween.t += dt / tween.d; const k = Math.min(1, tween.t), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    player.x = tween.fx + (tween.tx - tween.fx) * e; player.z = tween.fz + (tween.tz - tween.fz) * e; player.yaw = tween.fy + (tween.ty - tween.fy) * e; player.pitch *= 0.9;
    if (k >= 1) tween = null;
  } else {
    let f = 0, s = 0, turn = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1; if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
    if (keys.has('KeyA')) s -= 1; if (keys.has('KeyD')) s += 1;
    if (keys.has('ArrowLeft')) turn += 1; if (keys.has('ArrowRight')) turn -= 1;
    if (joy.active) { f -= joy.y; s += joy.x; }
    player.yaw += turn * dt * 1.8;
    const speed = keys.has('ShiftLeft') ? 2.4 : 1.4;
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw), rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
    let tx = (fx * f + rx * s), tz = (fz * f + rz * s); const l = Math.hypot(tx, tz); if (l > 1) { tx /= l; tz /= l; }
    const a = 1 - Math.exp(-dt * 9); player.vx += (tx * speed - player.vx) * a; player.vz += (tz * speed - player.vz) * a;
    const p = { x: player.x + player.vx * dt, z: player.z + player.vz * dt }; collide(p);
    player.vx = (p.x - player.x) / Math.max(dt, 1e-4); player.vz = (p.z - player.z) / Math.max(dt, 1e-4);
    player.x = p.x; player.z = p.z;
    const sp = Math.hypot(player.vx, player.vz); player.bob += sp * dt * 5.5;
    if (tween === null && (f || s) && isFinite(sp)) {}
  }
  const bobY = Math.sin(player.bob) * 0.018;
  camera.position.set(player.x, (camY ?? EYE) + bobY, player.z); camera.rotation.set(-player.pitch, player.yaw, 0);
}

// ---------- режим обзора («кукольный домик»)
const orbit = new OrbitControls(camera, el); orbit.enabled = false; orbit.enableDamping = true; orbit.target.set(5, 0, 4.6);
orbit.maxPolarAngle = Math.PI * 0.47; orbit.minDistance = 5; orbit.maxDistance = 30;
function setMode(m) {
  mode = m; document.body.dataset.mode = m;
  const ov = m === 'overview';
  ceilings.forEach(c => (c.visible = !ov));
  orbit.enabled = ov;
  if (ov) { camera.fov = 45; camera.position.set(player.x - 6, 14, player.z + 12); orbit.target.set(5, 0, 4.6); orbit.update(); }
  else camera.fov = BASE_FOV;
  camera.updateProjectionMatrix();
  $('#btnMode').textContent = ov ? '🚶 Прогулка' : '🏠 Обзор сверху';
  updateLabels();
}

// ---------- интерфейс
let currentRoom = null;
function buildUI() {
  // подписи комнат (видны в режиме обзора)
  const labels = $('#labels');
  for (const [id, r] of Object.entries(ROOMS)) {
    const d = document.createElement('button'); d.className = 'label'; d.dataset.room = id;
    d.innerHTML = `<b>${r.name}</b><span>${r.area.toFixed(1).replace('.', ',')} м²</span>`;
    d.onclick = () => { const s = r.spawn; setMode('walk'); teleport(s[0], s[1], s[2], true); };
    labels.appendChild(d);
  }
  // мини-карта
  const svg = $('#minimap svg'); const ns = 'http://www.w3.org/2000/svg';
  const minX = -0.3, minZ = -1.8, W = 11.8, Hh = 15.5; svg.setAttribute('viewBox', `${minX} ${minZ} ${W} ${Hh}`);
  for (const r of RECTS) {
    const rc = document.createElementNS(ns, 'rect'); Object.entries({ x: r.x0, y: r.z0, width: r.x1 - r.x0, height: r.z1 - r.z0, 'data-room': r.group }).forEach(([k, v]) => rc.setAttribute(k, v));
    rc.addEventListener('click', ev => { ev.stopPropagation(); const s = ROOMS[r.group].spawn; teleport(s[0], s[1], s[2], mode !== 'walk'); });
    svg.appendChild(rc);
  }
  for (const p of POLYS) {
    const pg = document.createElementNS(ns, 'polygon'); pg.setAttribute('points', p.poly.map(q => q.join(',')).join(' ')); pg.setAttribute('data-room', p.group);
    pg.addEventListener('click', ev => { ev.stopPropagation(); const s = ROOMS[p.group].spawn; teleport(s[0], s[1], s[2], mode !== 'walk'); });
    svg.appendChild(pg);
  }
  for (const [id, r] of Object.entries(ROOMS)) { if (r.area < 2) continue; const t = document.createElementNS(ns, 'text'); t.setAttribute('x', r.label[0]); t.setAttribute('y', r.label[1] + 0.15); t.textContent = r.area.toFixed(1).replace('.', ','); svg.appendChild(t); }
  const me = document.createElementNS(ns, 'g'); me.id = 'me'; me.innerHTML = '<path d="M0,0 L-0.9,-1.6 A1.85,1.85 0 0 1 0.9,-1.6 Z" fill="rgba(255,170,60,.35)"/><circle r="0.22" fill="#ff7a1a" stroke="#fff" stroke-width="0.07"/>'; svg.appendChild(me);
  $('#btnMode').onclick = () => setMode(mode === 'walk' ? 'overview' : 'walk');
  $('#btnPhotos').onclick = () => openGallery(currentRoom);
  $('#btnAllPhotos').onclick = () => openGallery(null);
  $('#btnHelp').onclick = () => $('#help').classList.toggle('show');
  $('#help').onclick = () => $('#help').classList.remove('show');
  $('#btnFull').onclick = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
  $('#btnHQ').onclick = () => { hq = !hq; $('#btnHQ').classList.toggle('on', hq); }; $('#btnHQ').classList.toggle('on', hq);
  $('#gClose').onclick = closeGallery; $('#gPrev').onclick = () => galStep(-1); $('#gNext').onclick = () => galStep(1);
  $('#gallery').addEventListener('click', e => { if (e.target.id === 'gallery') closeGallery(); });
  $('#gGo').onclick = () => { const p = gal.list[gal.i]; closeGallery(); standAt(p); };
  $('#btnLayer').onclick = () => { photoLayerOn = !photoLayerOn; $('#btnLayer').classList.toggle('on', photoLayerOn); }; $('#btnLayer').classList.toggle('on', photoLayerOn);
  if (isTouch) { document.body.classList.add('touch'); setupJoystick(); }
  setTimeout(() => $('#help').classList.add('show'), 300); setTimeout(() => $('#help').classList.remove('show'), 7000);
}
function updateLabels() {
  const ov = mode === 'overview'; const v = new THREE.Vector3();
  document.querySelectorAll('.label').forEach(d => {
    const r = ROOMS[d.dataset.room]; if (!ov) { d.style.display = 'none'; return; }
    v.set(r.label[0], 0.4, r.label[1]).project(camera);
    if (v.z > 1) { d.style.display = 'none'; return; }
    d.style.display = ''; d.style.transform = `translate(-50%,-50%) translate(${(v.x + 1) / 2 * innerWidth}px,${(1 - v.y) / 2 * innerHeight}px)`;
  });
}
function updateHud() {
  const g = mode === 'walk' ? roomAt(player.x, player.z) : null;
  if (g !== currentRoom) {
    currentRoom = g; const r = ROOMS[g];
    $('#roomName').innerHTML = r ? `${r.name} <span>${r.area.toFixed(1).replace('.', ',')} м²</span>` : 'Квартира 75,2 м²';
    const n = PHOTOS.filter(p => p.room === g).length;
    $('#btnPhotos').style.display = n ? '' : 'none'; $('#btnPhotos').textContent = `📷 Фото комнаты (${n})`;
    document.querySelectorAll('#minimap rect, #minimap polygon').forEach(rc => rc.classList.toggle('cur', rc.dataset.room === g));
  }
  const me = $('#me'); if (me) { const yawDeg = -player.yaw * 180 / Math.PI; me.setAttribute('transform', `translate(${player.x},${player.z}) rotate(${yawDeg})`); me.style.display = mode === 'walk' ? '' : 'none'; }
}

// ---------- галерея реальных фото
const gal = { list: [], i: 0 };
function openGallery(room) { gal.list = room ? PHOTOS.filter(p => p.room === room) : PHOTOS.slice(); gal.i = 0; if (!gal.list.length) return; $('#gallery').classList.add('show'); showPhoto(); }
function closeGallery() { $('#gallery').classList.remove('show'); }
function galStep(d) { gal.i = (gal.i + d + gal.list.length) % gal.list.length; showPhoto(); }
function showPhoto() {
  const p = gal.list[gal.i]; const img = $('#gImg'); const ph = $('#gPh');
  img.style.display = 'none'; ph.style.display = 'none';
  img.onload = () => { img.style.display = ''; }; img.onerror = () => { ph.style.display = ''; ph.innerHTML = `Фото «${p.caption}»<br><small>файл photos/${p.file} не найден</small>`; };
  img.src = 'photos/' + p.file;
  $('#gCap').textContent = `${p.caption} · ${gal.i + 1} / ${gal.list.length}`;
}

// ---------- слой реальных фото: фото проецируется из точки съёмки (1:1, когда стоите на этой точке)
const BASE_FOV = 70; let photoLayerOn = params.get('photos') !== '0'; const bubbles = [];
function featherMask() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
  g.filter = 'blur(10px)'; g.fillStyle = '#fff'; g.fillRect(16, 16, 224, 224); const t = new THREE.CanvasTexture(c); return t;
}
async function buildPhotoLayer() {
  const loader = new THREE.TextureLoader(); const mask = featherMask();
  await Promise.all(PHOTOS.map(p => new Promise(res => loader.load('photos/' + p.file, t => {
    t.colorSpace = THREE.SRGBColorSpace; const a = t.image.width / t.image.height, D = 3, h = 2 * D * Math.tan(p.vfov * Math.PI / 360), w = h * a;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, alphaMap: mask, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
    m.position.set(0, 0, -D); const g = new THREE.Group(); g.add(m); g.rotation.order = 'YXZ'; g.rotation.set(p.pitch, -p.dir * Math.PI / 180, 0); g.position.set(p.x, p.y || EYE, p.z);
    m.renderOrder = 999; g.visible = false; g.userData = { p, m }; scene.add(g); bubbles.push(g); res();
  }, undefined, () => res()))));
}
function standAt(p) { teleport(p.x, p.z, p.dir, true); player.pitch = -p.pitch; }
function hidePhotoLayer() { for (const b of bubbles) b.visible = false; }
const _fwd = new THREE.Vector3(), _pf = new THREE.Vector3();
function updatePhotoLayer() {
  let best = 0, bestB = null; camera.getWorldDirection(_fwd);
  if (photoLayerOn) for (const b of bubbles) {
    const { p } = b.userData; const d = Math.hypot(player.x - p.x, player.z - p.z); if (d > 0.7) { b.visible = false; continue; }
    _pf.set(0, 0, -1).applyEuler(b.rotation); const ang = Math.acos(THREE.MathUtils.clamp(_fwd.dot(_pf), -1, 1)) * 180 / Math.PI;
    const op = THREE.MathUtils.smoothstep(0.7 - d, 0, 0.45) * (1 - THREE.MathUtils.smoothstep(ang, 25, 70));
    b.userData.op = op; if (op > best) { best = op; bestB = b; }
  }
  for (const b of bubbles) { b.visible = b === bestB && best > 0.01; if (b.visible) b.userData.m.material.opacity = best; }
  const tf = bestB ? THREE.MathUtils.lerp(BASE_FOV, bestB.userData.p.vfov, Math.min(1, best * 1.5)) : BASE_FOV;
  camY = compareY ?? (bestB ? THREE.MathUtils.lerp(EYE, bestB.userData.p.y || EYE, Math.min(1, best * 1.5)) : null);
  if (Math.abs(camera.fov - tf) > 0.05 && !wheelZoom) { camera.fov = tf; camera.updateProjectionMatrix(); }
  return best;
}
let wheelZoom = false, camY = null, compareY = null;

// ---------- цикл
const clock = new THREE.Clock(); let frames = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (mode === 'walk') updateWalk(dt); else { orbit.update(); updateLabels(); }
  updateHud();
  const bub = mode === 'walk' ? updatePhotoLayer() : (hidePhotoLayer(), 0);
  if (hq && composer && bub < 0.01) composer.render(); else renderer.render(scene, camera);
  if (++frames === 3) window.__ready = true;
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
  if (composer) { composer.setSize(innerWidth, innerHeight); }
});
window.__app = { scene, THREE, standAt: i => standAt(PHOTOS[i]), compare: i => { photoLayerOn = false; compareY = PHOTOS[i].y; standAt(PHOTOS[i]); wheelZoom = true; camera.fov = PHOTOS[i].vfov; camera.aspect = 716 / (PHOTOS[i].file === 'wc.jpg' ? 953 : 537); camera.updateProjectionMatrix(); }, layer: v => (photoLayerOn = v), sim: (code, sec) => { keys.add(code); for (let i = 0; i < sec * 60; i++) updateWalk(1 / 60); keys.delete(code); for (let i = 0; i < 30; i++) updateWalk(1 / 60); return [+player.x.toFixed(2), +player.z.toFixed(2)]; }, teleport: (x, z, d) => teleport(x, z, d, true), setMode, player, camera, orbit, setHQ: v => (hq = v) };
init();
