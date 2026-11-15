// Геометрия квартиры по планировке (метры). Координаты сняты с плана: 1 пиксель плана = 0.0256 м.
// Ось X — вправо по плану, ось Z — вниз по плану (на юг).
export const H = 2.7;   // высота потолка
export const T = 0.1;   // половина толщины стены (стены строятся внутрь каждого помещения)
const S = 0.0256, OX = 57, OZ = 131;
const X = p => +((p - OX) * S).toFixed(3), Z = p => +((p - OZ) * S).toFixed(3);

// wall — материал стен (ключ текстуры из tex/), floor — материал пола
export const RECTS = [
  { id: 'r1',      group: 'r1',      x0: X(57),    x1: X(201),   z0: Z(131),   z1: Z(366.5), wall: 'wp_living',  floor: 'lino' },
  { id: 'balcony', group: 'balcony', x0: X(57),    x1: X(180),   z0: Z(72),    z1: Z(131),   open: true,         floor: 'floor_balcony' },
  { id: 'hall',    group: 'hall',    x0: X(201),   x1: X(356.5), z0: Z(317.5), z1: Z(413.5), wall: 'wp_hall',    floor: 'lino' },
  { id: 'hall2',   group: 'hall',    x0: X(356.5), x1: X(420.5), z0: Z(317.5), z1: Z(394.5), wall: 'wp_hall',    floor: 'lino' },
  { id: 'corr',    group: 'corr',    x0: X(356.5), x1: X(408),   z0: Z(394.5), z1: Z(519.5), wall: 'wp_hall',    floor: 'lino' },
  { id: 'bath',    group: 'bath',    x0: X(408),   x1: X(495),   z0: Z(394.5), z1: Z(472.5), wall: 'pvc_bath',   floor: 'tile_wc', wet: true },
  { id: 'wc',      group: 'wc',      x0: X(408),   x1: X(495),   z0: Z(472.5), z1: Z(519.5), wall: 'wp_wc',      floor: 'tile_wc' },
  { id: 'kitchen', group: 'kitchen', x0: X(356.5), x1: X(495),   z0: Z(519.5), z1: Z(635),   wall: 'wp_kitchen', floor: 'floor_kitchen', border: true },
  { id: 'r2',      group: 'r2',      x0: X(57),    x1: X(201),   z0: Z(366.5), z1: Z(540),   wall: 'wp_bedroom', floor: 'lino' },
  { id: 'r3',      group: 'r3',      x0: X(201),   x1: X(356.5), z0: Z(413.5), z1: Z(540),   wall: 'wp_room3',   floor: 'lino' },
];
// Помещения произвольной формы (эркер кухни, трапециевидная лоджия) — строятся отдельно
export const BAY = { z: Z(635), a: 8.45, b: 11.05, depth: 0.5 };   // эркер кухни: 5 створок
export const LOGGIA = [[X(201), Z(540)], [X(356.5), Z(540)], [X(356.5), Z(635)], [X(290), Z(635)]];
export const POLYS = [
  { id: 'bay', group: 'kitchen', poly: [[BAY.a, BAY.z], [BAY.b, BAY.z], [BAY.b - BAY.depth, BAY.z + BAY.depth], [BAY.a + BAY.depth, BAY.z + BAY.depth]] },
  { id: 'loggia', group: 'loggia', poly: LOGGIA },
];

export const ROOMS = {
  r1:      { name: 'Большая комната', area: 18.9, spawn: [1.8, 5.6, 0],     label: [1.8, 3.0] },
  balcony: { name: 'Балкон (открытый)', area: 4.1, spawn: [2.5, -0.3, 320], label: [1.6, -0.8] },
  hall:    { name: 'Холл', area: 7.5, spawn: [9.0, 5.75, 270], label: [5.8, 5.9] },
  corr:    { name: 'Коридор', area: 4.8, spawn: [8.3, 6.95, 180], label: [8.3, 8.4] },
  bath:    { name: 'Ванная', area: 3.9, spawn: [9.25, 7.4, 95], label: [10.1, 7.7] },
  wc:      { name: 'Туалет', area: 1.5, spawn: [9.25, 9.4, 90], label: [10.0, 9.4] },
  kitchen: { name: 'Кухня', area: 10.0, spawn: [8.55, 10.4, 165], label: [9.4, 11.5] },
  r2:      { name: 'Спальня', area: 14.8, spawn: [3.1, 6.5, 205], label: [1.8, 8.3] },
  r3:      { name: 'Комната', area: 11.1, spawn: [5.7, 7.6, 180], label: [5.7, 8.9] },
  loggia:  { name: 'Лоджия (застеклённая)', area: 4.8, spawn: [6.7, 10.75, 225], label: [6.3, 11.6] },
};

// Проёмы: o:'h' — на линии z=at (диапазон по x), o:'v' — на линии x=at (диапазон по z)
export const OPENINGS = [
  { o: 'h', at: Z(131),   a: 0.42, b: 1.95, kind: 'window', bot: 0.85, top: 2.3, panes: 2 },
  { o: 'h', at: Z(131),   a: 2.12, b: 2.9,  kind: 'balcdoor', bot: 0, top: 2.3 },
  { o: 'v', at: X(201),   a: 4.97, b: 5.81, kind: 'door', bot: 0, top: 2.05, id: 'r1' },
  { o: 'v', at: X(201),   a: 6.22, b: 7.06, kind: 'door', bot: 0, top: 2.05, id: 'r2' },
  { o: 'h', at: Z(413.5), a: 5.07, b: 6.35, kind: 'glassdouble', bot: 0, top: 2.1 },
  { o: 'v', at: X(420.5), a: 5.22, b: 6.17, kind: 'entry', bot: 0, top: 2.05 },
  { o: 'v', at: X(356.5), a: Z(317.5), b: Z(394.5), kind: 'void', bot: 0, top: 2.7 },
  { o: 'h', at: Z(394.5), a: X(356.5), b: X(408), kind: 'void', bot: 0, top: 2.7 },
  { o: 'v', at: X(408),   a: 7.02, b: 7.7,  kind: 'door', bot: 0, top: 2.0, id: 'bath' },
  { o: 'v', at: X(408),   a: 8.98, b: 9.66, kind: 'door', bot: 0, top: 2.0, id: 'wc' },
  { o: 'h', at: Z(519.5), a: 8.3,  b: 8.9,  kind: 'door', bot: 0, top: 2.05, id: 'kitchen' },
  { o: 'h', at: Z(540),   a: 0.85, b: 2.35, kind: 'window', bot: 0.85, top: 2.3, panes: 2 },
  { o: 'h', at: Z(540),   a: 4.33, b: 6.02, kind: 'window', bot: 0.85, top: 2.3, panes: 2 },
  { o: 'h', at: Z(540),   a: 6.12, b: 6.89, kind: 'balcdoor', bot: 0, top: 2.3 },
  { o: 'h', at: BAY.z,    a: BAY.a, b: BAY.b, kind: 'void', bot: 0, top: 2.7 },
];

// Фотографии и точка/направление съёмки (dir: 0 — вверх по плану/север, 90 — восток, 180 — юг, 270 — запад),
// pitch — наклон камеры (рад, + вверх), vfov — вертикальный угол обзора снимка (градусы).
export const PHOTOS = [
  { file: 'kitchen-1.jpg', room: 'kitchen', x: 9.05, z: 10.7, y: 1.3, dir: 147, pitch: 0.0, vfov: 98, caption: 'Кухня: эркер и гарнитур' },
  { file: 'kitchen-2.jpg', room: 'kitchen', x: 8.85, z: 12.7, y: 1.3, dir: 38, pitch: 0.0, vfov: 87, caption: 'Кухня: угловой гарнитур, холодильник, дверь' },
  { file: 'kitchen-3.jpg', room: 'kitchen', x: 9.35, z: 11.2, y: 1.3, dir: 175, pitch: 0.0, vfov: 66, caption: 'Кухня: эркерное окно' },
  { file: 'wc.jpg',        room: 'wc',      x: 9.15, z: 9.4, y: 1.3, dir: 90, pitch: -0.15, vfov: 100, caption: 'Туалет' },
  { file: 'bath.jpg',      room: 'bath',    x: 8.9, z: 7.4, y: 1.3, dir: 95, pitch: 0.0, vfov: 84, caption: 'Ванная комната' },
  { file: 'bedroom.jpg',   room: 'r2',      x: 3.0, z: 7.1, y: 1.3, dir: 224, pitch: 0.0, vfov: 82, caption: 'Спальня 14,8 м²' },
  { file: 'balcony.jpg',   room: 'balcony', x: 2.6, z: -0.2, y: 1.3, dir: 330, pitch: 0.0, vfov: 87, caption: 'Открытый балкон' },
  { file: 'view.jpg',      room: 'balcony', x: 1.6, z: -0.9, y: 1.3, dir: 0, pitch: -0.1, vfov: 60, caption: 'Вид с балкона и из окон большой комнаты' },
  { file: 'living.jpg',    room: 'r1',      x: 3.25, z: 5.4, y: 1.3, dir: 333, pitch: 0.0, vfov: 84, caption: 'Большая комната 18,9 м²' },
  { file: 'loggia.jpg',    room: 'loggia',  x: 6.9, z: 10.7, y: 1.3, dir: 205, pitch: 0.0, vfov: 87, caption: 'Застеклённая лоджия' },
  { file: 'room3.jpg',     room: 'r3',      x: 6.05, z: 8.0, y: 1.3, dir: 196, pitch: 0.0, vfov: 84, caption: 'Комната 11,1 м² с выходом на лоджию' },
  { file: 'corridor.jpg',  room: 'corr',    x: 8.3, z: 6.85, y: 1.3, dir: 180, pitch: 0.0, vfov: 87, caption: 'Коридор, вид на кухню' },
  { file: 'hall.jpg',      room: 'hall',    x: 9.25, z: 5.75, y: 1.3, dir: 290, pitch: 0.0, vfov: 96, caption: 'Холл' },
];
export const PLAN_IMAGE = 'photos/plan.jpg';
