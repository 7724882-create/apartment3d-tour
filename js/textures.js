import * as THREE from 'three';

// Псевдослучайные числа с зерном — чтобы текстуры были одинаковыми при каждой загрузке
export function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

let ANISO = 8;
export function setAniso(a) { ANISO = a; }

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// worldW/worldH — физический размер одного повтора текстуры в метрах
export function tex(w, h, worldW, worldH, draw, { srgb = true } = {}) {
  const c = canvas(w, h); const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / worldW, 1 / worldH);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = ANISO; t.generateMipmaps = true;
  t.userData.canvas = c;
  return t;
}

function noise(g, w, h, amt, seed = 1, size = 1) {
  const r = rng(seed); const img = g.getImageData(0, 0, w, h); const d = img.data;
  for (let y = 0; y < h; y += size) for (let x = 0; x < w; x += size) {
    const n = (r() - 0.5) * amt;
    for (let yy = 0; yy < size && y + yy < h; yy++) for (let xx = 0; xx < size && x + xx < w; xx++) {
      const i = ((y + yy) * w + x + xx) * 4; d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
  }
  g.putImageData(img, 0, 0);
}
// лёгкое затемнение у пола и потолка — имитация запечённой окклюзии на обоях
function wallAO(g, w, h, H = 2.7) {
  let gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, 'rgba(60,40,20,0.16)'); gr.addColorStop(0.06, 'rgba(60,40,20,0.0)');
  gr.addColorStop(0.9, 'rgba(60,40,20,0.0)'); gr.addColorStop(1, 'rgba(60,40,20,0.14)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
}
function flower(g, x, y, r, petal, center, n = 5) {
  g.fillStyle = petal;
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; g.beginPath(); g.ellipse(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6, r * 0.55, r * 0.32, a, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = center; g.beginPath(); g.arc(x, y, r * 0.25, 0, 7); g.fill();
}

export function makeTextures() {
  const T = {};
  // ---- Обои кухни: бежевые с мелким рисунком и цветочным бордюром
  T.wpKitchen = tex(512, 2048, 0.53, 2.7, (g, w, h) => {
    g.fillStyle = '#e6d6b4'; g.fillRect(0, 0, w, h); noise(g, w, h, 10, 3, 2);
    const r = rng(5);
    for (let y = 0; y < h; y += 64) for (let x = (y / 64) % 2 * 32; x < w; x += 64) { g.fillStyle = 'rgba(170,140,90,0.35)'; g.beginPath(); g.arc(x + 16, y + 16, 5, 0, 7); g.fill(); }
    const by = h * (1 - 2.48 / 2.7), bh = h * (0.16 / 2.7);
    g.fillStyle = '#d9c39a'; g.fillRect(0, by, w, bh);
    g.fillStyle = '#b48d5a'; g.fillRect(0, by, w, 4); g.fillRect(0, by + bh - 4, w, 4);
    for (let x = 0; x < w; x += 85) {
      g.strokeStyle = '#6f8a4b'; g.lineWidth = 5; g.beginPath(); g.moveTo(x, by + bh * 0.7); g.quadraticCurveTo(x + 40, by + bh * 0.2, x + 85, by + bh * 0.7); g.stroke();
      flower(g, x + 42, by + bh * 0.48, 22, '#c96b52', '#e8c25a'); flower(g, x + 10, by + bh * 0.55, 13, '#d99a6c', '#f0d27a');
    }
    wallAO(g, w, h);
  });
  // ---- Спальня: полосатые обои
  T.wpR2 = tex(512, 2048, 0.53, 2.7, (g, w, h) => {
    g.fillStyle = '#efe2c6'; g.fillRect(0, 0, w, h);
    const stripes = [[0, 60, '#d9c294'], [60, 18, '#c9ad78'], [150, 8, '#cfb582'], [256, 60, '#d9c294'], [316, 18, '#c9ad78'], [406, 8, '#cfb582']];
    for (const [x, sw, c] of stripes) { g.fillStyle = c; g.fillRect(x, 0, sw, h); }
    for (let y = 0; y < h; y += 80) for (const x of [190, 446]) { g.fillStyle = 'rgba(180,140,80,0.4)'; g.beginPath(); g.ellipse(x, y + 40, 6, 14, 0, 0, 7); g.fill(); }
    noise(g, w, h, 8, 7, 2); wallAO(g, w, h);
  });
  // ---- Большая комната: светлые обои с дамаском
  T.wpR1 = tex(512, 1024, 0.53, 0.53 * 2, (g, w, h) => {
    g.fillStyle = '#e9dcc0'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(176,148,100,0.55)'; g.lineWidth = 3;
    for (let y = 0; y < h; y += 256) for (let x = 0; x < w; x += 256) {
      const ox = x + ((y / 256) % 2) * 128;
      g.beginPath(); g.moveTo(ox + 128, y + 20); g.bezierCurveTo(ox + 200, y + 80, ox + 200, y + 176, ox + 128, y + 236); g.bezierCurveTo(ox + 56, y + 176, ox + 56, y + 80, ox + 128, y + 20); g.stroke();
      g.beginPath(); g.arc(ox + 128, y + 128, 22, 0, 7); g.stroke();
      flower(g, ox + 128, y + 128, 14, 'rgba(190,160,110,0.5)', 'rgba(160,120,70,0.6)', 6);
    }
    noise(g, w, h, 8, 9, 2);
  });
  // ---- Комната 11,1: персиковые обои с мелкими цветами
  T.wpR3 = tex(512, 1024, 0.53, 1.06, (g, w, h) => {
    g.fillStyle = '#ecd6c0'; g.fillRect(0, 0, w, h); const r = rng(11);
    for (let i = 0; i < 70; i++) { const x = r() * w, y = r() * h; flower(g, x, y, 10 + r() * 6, 'rgba(200,120,100,0.45)', 'rgba(150,120,60,0.6)'); g.fillStyle = 'rgba(110,140,90,0.45)'; g.beginPath(); g.ellipse(x + 14, y + 10, 8, 3, 0.6, 0, 7); g.fill(); }
    noise(g, w, h, 8, 12, 2);
  });
  // ---- Холл и коридор: виниловые обои «под штукатурку»
  T.wpHall = tex(512, 512, 0.6, 0.6, (g, w, h) => {
    g.fillStyle = '#d8c3a0'; g.fillRect(0, 0, w, h); const r = rng(21);
    for (let i = 0; i < 2500; i++) { g.fillStyle = r() < 0.5 ? 'rgba(255,245,220,0.18)' : 'rgba(120,90,50,0.14)'; const s = 2 + r() * 10; g.fillRect(r() * w, r() * h, s, s * 0.6); }
    noise(g, w, h, 12, 22, 2);
  });
  // ---- Ванная: белые ПВХ-панели с вертикальными стыками
  T.pvc = tex(256, 256, 0.25, 0.25, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#f3f3f0'); gr.addColorStop(0.5, '#fbfbf8'); gr.addColorStop(1, '#eeeeea');
    g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = '#c9c9c4'; g.fillRect(0, 0, 3, h); g.fillStyle = '#ffffff'; g.fillRect(3, 0, 2, h);
  });
  // ---- Лоджия: вагонка
  T.clap = tex(512, 512, 0.6, 0.48, (g, w, h) => {
    const r = rng(31);
    for (let y = 0; y < h; y += 85) { g.fillStyle = `hsl(${32 + r() * 6},${45 + r() * 10}%,${66 + r() * 6}%)`; g.fillRect(0, y, w, 85);
      for (let i = 0; i < 18; i++) { g.strokeStyle = `rgba(150,100,50,${0.1 + r() * 0.15})`; g.lineWidth = 1 + r() * 2; g.beginPath(); const yy = y + r() * 85; g.moveTo(0, yy); g.bezierCurveTo(w / 3, yy + r() * 8 - 4, 2 * w / 3, yy + r() * 8 - 4, w, yy); g.stroke(); }
      g.fillStyle = 'rgba(90,60,30,0.45)'; g.fillRect(0, y, w, 3); }
  });
  // ---- Паркет «ёлочка»
  T.parquet = tex(1024, 1024, 1.2, 1.2, (g, w, h) => {
    g.fillStyle = '#7a4f2a'; g.fillRect(0, 0, w, h); const r = rng(41); const L = 256, Wd = 64;
    for (let row = -8; row < 24; row++) for (let col = -2; col < 10; col++) {
      const bx = col * 128, by = row * 64 + col * 64;
      for (const dir of [0, 1]) {
        g.save(); g.translate(bx + (dir ? 64 : 0), by); g.rotate(dir ? Math.PI / 4 : -Math.PI / 4);
        const l = 40 + r() * 14; g.fillStyle = `hsl(${26 + r() * 8},${45 + r() * 15}%,${l * 0.75}%)`; g.fillRect(0, 0, L * 0.7, Wd * 0.7);
        for (let i = 0; i < 6; i++) { g.strokeStyle = `rgba(50,25,10,${0.08 + r() * 0.12})`; g.lineWidth = 1; g.beginPath(); const yy = r() * Wd * 0.7; g.moveTo(0, yy); g.lineTo(L * 0.7, yy + r() * 4 - 2); g.stroke(); }
        g.strokeStyle = 'rgba(40,20,5,0.6)'; g.lineWidth = 2; g.strokeRect(0, 0, L * 0.7, Wd * 0.7); g.restore();
      }
    }
    noise(g, w, h, 8, 42, 2);
  });
  // ---- Линолеум бежевый «под паркет/плитку» (холл, коридор)
  T.lino = tex(512, 512, 0.8, 0.8, (g, w, h) => {
    g.fillStyle = '#c9ad84'; g.fillRect(0, 0, w, h); const r = rng(51);
    for (let y = 0; y < h; y += 64) { g.fillStyle = `rgba(${150 + r() * 30},${120 + r() * 20},${80 + r() * 20},0.35)`; g.fillRect(0, y, w, 64); g.fillStyle = 'rgba(90,60,30,0.35)'; g.fillRect(0, y, w, 2); for (let x = (y / 64 % 2) * 128; x < w; x += 256) g.fillRect(x, y, 2, 64); }
    noise(g, w, h, 14, 52, 1);
  });
  // ---- Кухонный линолеум: бежевый с мраморным рисунком
  T.linoK = tex(512, 512, 0.6, 0.6, (g, w, h) => {
    g.fillStyle = '#d8c3a0'; g.fillRect(0, 0, w, h); const r = rng(61);
    for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(150,115,75,${0.1 + r() * 0.2})`; g.lineWidth = 1 + r() * 3; g.beginPath(); let x = r() * w, y = r() * h; g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += r() * 120 - 60; y += r() * 120 - 60; g.lineTo(x, y); } g.stroke(); }
    g.fillStyle = 'rgba(120,90,50,0.35)'; g.fillRect(0, 0, w, 3); g.fillRect(0, 0, 3, h);
    noise(g, w, h, 10, 62, 1);
  });
  // ---- Плитка бежевая 30×30
  T.tile = tex(512, 512, 0.6, 0.6, (g, w, h) => {
    const r = rng(71); g.fillStyle = '#b8a88e'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { g.fillStyle = `hsl(36,${28 + r() * 6}%,${74 + r() * 4}%)`; g.fillRect(x * 256 + 3, y * 256 + 3, 250, 250);
      for (let i = 0; i < 25; i++) { g.fillStyle = `rgba(160,130,90,${r() * 0.2})`; g.beginPath(); g.arc(x * 256 + r() * 250, y * 256 + r() * 250, 4 + r() * 20, 0, 7); g.fill(); } }
    noise(g, w, h, 8, 72, 1);
  });
  T.tileWall = tex(256, 256, 0.25, 0.25, (g, w, h) => { g.fillStyle = '#bfb6a6'; g.fillRect(0, 0, w, h); g.fillStyle = '#e8dfcf'; g.fillRect(3, 3, w - 6, h - 6); noise(g, w, h, 6, 73, 1); });
  T.concrete = tex(512, 512, 1.5, 1.5, (g, w, h) => { g.fillStyle = '#9d9a93'; g.fillRect(0, 0, w, h); noise(g, w, h, 40, 81, 2); noise(g, w, h, 20, 82, 8); });
  T.boards = tex(512, 512, 1.0, 1.0, (g, w, h) => { const r = rng(91); for (let x = 0; x < w; x += 64) { g.fillStyle = `hsl(28,${30 + r() * 10}%,${42 + r() * 8}%)`; g.fillRect(x, 0, 64, h); g.fillStyle = 'rgba(40,20,10,0.5)'; g.fillRect(x, 0, 2, h); } noise(g, w, h, 12, 92, 1); });
  // ---- Древесина: тёмная полированная «стенка» и светлый кухонный гарнитур
  const wood = (base, seed, dark = 0.25) => tex(512, 512, 0.8, 0.8, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h); const r = rng(seed);
    for (let i = 0; i < 90; i++) { g.strokeStyle = `rgba(40,20,5,${r() * dark})`; g.lineWidth = 1 + r() * 3; g.beginPath(); let x = r() * w; g.moveTo(x, 0); for (let y = 0; y <= h; y += 32) g.lineTo(x + Math.sin(y / 60 + i) * 6 + r() * 2, y); g.stroke(); }
    noise(g, w, h, 6, seed + 1, 1);
  });
  T.woodDark = wood('#5a3119', 101, 0.35);
  T.woodLight = wood('#d6b07a', 111, 0.18);
  T.woodMid = wood('#9a6a3d', 121, 0.25);
  // ---- Ковёр (советский «восточный» узор)
  T.rug = (seed, c1 = '#7d1f22', c2 = '#d9b27a', c3 = '#1f3555') => {
    const t = tex(1024, 1024, 1, 1, (g, w, h) => {
      g.fillStyle = c1; g.fillRect(0, 0, w, h);
      g.strokeStyle = c2; g.lineWidth = 18; g.strokeRect(30, 30, w - 60, h - 60); g.lineWidth = 6; g.strokeRect(80, 80, w - 160, h - 160);
      g.fillStyle = c3; g.fillRect(90, 90, w - 180, 40); g.fillRect(90, h - 130, w - 180, 40); g.fillRect(90, 90, 40, h - 180); g.fillRect(w - 130, 90, 40, h - 180);
      const r = rng(seed);
      for (let i = 0; i < 14; i++) { g.fillStyle = c2; g.fillRect(100 + i * 60, 100, 20, 20); g.fillRect(100 + i * 60, h - 120, 20, 20); }
      g.save(); g.translate(w / 2, h / 2);
      for (let k = 5; k > 0; k--) { g.fillStyle = [c2, c3, c1, c2, '#a8432f'][k - 1]; g.beginPath(); g.moveTo(0, -k * 60); g.lineTo(k * 60, 0); g.lineTo(0, k * 60); g.lineTo(-k * 60, 0); g.closePath(); g.fill(); }
      g.restore();
      for (const [x, y] of [[230, 230], [w - 230, 230], [230, h - 230], [w - 230, h - 230]]) { g.save(); g.translate(x, y); for (let k = 3; k > 0; k--) { g.fillStyle = [c3, c2, '#a8432f'][k - 1]; g.beginPath(); g.moveTo(0, -k * 25); g.lineTo(k * 25, 0); g.lineTo(0, k * 25); g.lineTo(-k * 25, 0); g.fill(); } g.restore(); }
      for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '240,210,160' : '30,10,10'},${r() * 0.25})`; g.fillRect(150 + r() * (w - 300), 150 + r() * (h - 300), 6, 6); }
      noise(g, w, h, 26, seed + 3, 2);
    });
    t.repeat.set(1, 1); return t;
  };
  T.fabricBeige = tex(256, 256, 0.3, 0.3, (g, w, h) => { g.fillStyle = '#cdb994'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 4) { g.fillStyle = `rgba(255,255,255,${0.04 + (y % 8) * 0.01})`; g.fillRect(0, y, w, 2); } noise(g, w, h, 18, 131, 1); });
  T.fabricGreen = tex(256, 256, 0.3, 0.3, (g, w, h) => { g.fillStyle = '#7e8a6a'; g.fillRect(0, 0, w, h); for (let i = 0; i < 12; i++) flower(g, (i * 53) % w, (i * 97) % h, 14, 'rgba(210,190,140,0.35)', 'rgba(140,90,60,0.4)'); noise(g, w, h, 18, 141, 1); });
  T.bedspread = tex(512, 512, 1.0, 1.0, (g, w, h) => { g.fillStyle = '#8c3b3a'; g.fillRect(0, 0, w, h); const r = rng(151); for (let i = 0; i < 30; i++) flower(g, r() * w, r() * h, 18 + r() * 14, 'rgba(230,190,140,0.45)', 'rgba(90,40,30,0.6)', 6); noise(g, w, h, 16, 152, 1); });
  T.curtain = tex(256, 512, 0.4, 0.8, (g, w, h) => { g.fillStyle = '#e6d3a6'; g.fillRect(0, 0, w, h); for (let i = 0; i < 10; i++) flower(g, (i * 71) % w, (i * 131) % h, 16, 'rgba(180,140,80,0.35)', 'rgba(150,110,60,0.4)'); noise(g, w, h, 10, 161, 1); });
  T.tulle = tex(256, 256, 0.2, 0.2, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 2; for (let i = 0; i < w; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); } flower(g, 128, 128, 40, 'rgba(255,255,255,0.8)', 'rgba(255,255,255,0.9)', 6); });
  T.leather = tex(256, 256, 0.3, 0.3, (g, w, h) => { g.fillStyle = '#4a2716'; g.fillRect(0, 0, w, h); noise(g, w, h, 22, 171, 1); noise(g, w, h, 14, 172, 6); });
  T.padded = tex(256, 256, 0.3, 0.3, (g, w, h) => { g.fillStyle = '#5a2e1a'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 64) for (let x = (y / 64 % 2) * 32; x < w; x += 64) { const gr = g.createRadialGradient(x + 32, y + 32, 4, x + 32, y + 32, 36); gr.addColorStop(0, 'rgba(255,220,180,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0.25)'); g.fillStyle = gr; g.fillRect(x, y, 64, 64); g.fillStyle = '#c9a050'; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); } });
  T.ceiling = tex(256, 256, 1, 1, (g, w, h) => { g.fillStyle = '#f6f4ee'; g.fillRect(0, 0, w, h); noise(g, w, h, 5, 181, 2); });
  T.books = tex(1024, 256, 0.9, 0.3, (g, w, h) => { const r = rng(191); let x = 0; while (x < w) { const bw = 14 + r() * 26, bh = h * (0.7 + r() * 0.3); g.fillStyle = `hsl(${[0,10,25,40,120,200,220,30][Math.floor(r()*8)]},${15 + r() * 30}%,${15 + r() * 30}%)`; g.fillRect(x, h - bh, bw - 2, bh); g.fillStyle = 'rgba(230,200,120,0.7)'; g.fillRect(x + 3, h - bh + 16, bw - 8, 3); g.fillRect(x + 3, h - bh + bh * 0.7, bw - 8, 2); x += bw; } });
  return T;
}

// Панорама за окнами: если есть фото вида (photos/view.jpg) — используем его, иначе рисуем город.
export function makePanorama(viewImg, extraImgs = []) {
  const W = 8192, Hh = 2048; const c = canvas(W, Hh); const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, Hh * 0.62); sky.addColorStop(0, '#7fa9d8'); sky.addColorStop(1, '#dfe8f0');
  g.fillStyle = sky; g.fillRect(0, 0, W, Hh);
  const r = rng(777);
  for (let i = 0; i < 25; i++) { g.fillStyle = 'rgba(255,255,255,0.5)'; const x = r() * W, y = 100 + r() * 500; for (let k = 0; k < 7; k++) { g.beginPath(); g.ellipse(x + k * 40, y + r() * 30, 80 + r() * 80, 30 + r() * 20, 0, 0, 7); g.fill(); } }
  const horizon = Hh * 0.6;
  // дальние высотки: бело-оранжевые панельные и кирпичные башни
  for (let i = 0; i < 70; i++) {
    const x = r() * W, bw = 60 + r() * 130, bh = 150 + r() * 520; const type = r();
    const base = type < 0.35 ? '#e9e4dc' : type < 0.6 ? '#e08a4a' : type < 0.8 ? '#a85a3c' : '#c9c1b2';
    g.fillStyle = base; g.fillRect(x, horizon - bh, bw, bh + 40);
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x + bw * 0.7, horizon - bh, bw * 0.3, bh + 40);
    if (type < 0.35) { g.fillStyle = '#e07a3a'; for (let y = horizon - bh; y < horizon; y += 36) g.fillRect(x, y, bw, 6); }
    g.fillStyle = 'rgba(60,80,100,0.55)';
    for (let y = horizon - bh + 12; y < horizon - 10; y += 18) for (let xx = x + 6; xx < x + bw - 8; xx += 14) g.fillRect(xx, y, 7, 9);
  }
  // гаражи
  g.fillStyle = '#7e7a72'; g.fillRect(0, horizon + 60, W, 140);
  for (let x = 0; x < W; x += 90) { g.fillStyle = `hsl(${r() * 40 + 10},${10 + r() * 20}%,${40 + r() * 20}%)`; g.fillRect(x + 5, horizon + 90, 80, 110); g.fillStyle = '#5c5850'; g.fillRect(x, horizon + 60, 90, 18); }
  // деревья
  for (let i = 0; i < 900; i++) { const x = r() * W, y = horizon - 40 + r() * 260, rr = 30 + r() * 70; g.fillStyle = `hsl(${85 + r() * 40},${30 + r() * 25}%,${20 + r() * 20}%)`; g.beginPath(); g.arc(x, y, rr, 0, 7); g.fill(); }
  g.fillStyle = '#5d6b3f'; g.fillRect(0, horizon + 260, W, Hh); noise(g, W, Hh, 10, 778, 4);
  // фото вида из окна (при наличии) — вклеиваем с зеркальными повторами по кругу
  const imgs = [viewImg, ...extraImgs].filter(Boolean);
  if (imgs.length) {
    const segW = W / 6;
    for (let k = 0; k < 6; k++) {
      const img = imgs[k % imgs.length]; const ar = img.width / img.height; const hh = segW / ar;
      g.save(); g.translate(k * segW + (k % 2 ? segW : 0), Hh * 0.55 - hh / 2); if (k % 2) g.scale(-1, 1); g.drawImage(img, 0, 0, segW, hh); g.restore();
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
