'use strict';
/* =====================================================================
   BASE DEFENSE — tower defense en JavaScript vanilla (version stylisée)
   ===================================================================== */

/* ---------- CONFIGURATION ---------- */
const W = 960, H = 600;          // taille logique du canvas
const ROAD = 26;                 // demi-largeur de la route
const MAX_LVL = 5;               // niveau max des tourelles
const BASE = { x: 915, y: 300, r: 34 };
const LVL_COL = ['#94a3b8', '#4ade80', '#38bdf8', '#c084fc', '#fbbf24']; // couleur d'anneau par niveau

// Deux routes (deux points d'apparition) qui convergent vers la base
const PATHS = [
  [{x:-30,y:110},{x:300,y:110},{x:300,y:300},{x:890,y:300}],
  [{x:-30,y:500},{x:500,y:500},{x:500,y:300},{x:890,y:300}]
];

// Tourelles : rate = délai entre tirs (s). Laser : dmg = dégâts par seconde.
const TURRETS = {
  basic:  { name:'Basique',      icon:'🔫', cost:50,  dmg:18, range:120, rate:0.6,  color:'#4ade80' },
  gun:    { name:'Mitrailleuse', icon:'⚙️', cost:90,  dmg:5,  range:110, rate:0.09, color:'#facc15' },
  cannon: { name:'Canon',        icon:'💣', cost:140, dmg:60, range:140, rate:1.8,  color:'#fb923c', splash:55 },
  laser:  { name:'Laser',        icon:'⚡', cost:300, dmg:50, range:190, rate:0,    color:'#f472b6', laser:true }
};

// Ennemis (stats de base, multipliées selon la vague)
const ENEMIES = {
  runner:  { hp:28,   speed:105, r:8,  reward:5,   color:'#a3e635' }, // zombie rapide
  soldier: { hp:70,   speed:62,  r:10, reward:9,   color:'#60a5fa' }, // équilibré
  tank:    { hp:320,  speed:34,  r:15, reward:26,  color:'#94a3b8' }, // lent et solide
  boss:    { hp:1300, speed:24,  r:24, reward:200, color:'#ef4444' }  // toutes les 5 vagues
};

/* ---------- RACCOURCIS DOM ---------- */
const $ = id => document.getElementById(id);
const cv = $('game'), ctx = cv.getContext('2d');
let T = 0; // temps écoulé (pour les animations)

/* ---------- SAUVEGARDE (localStorage) ---------- */
let rec = { bestWave:0, bestScore:0, kills:0, games:0 };
try { Object.assign(rec, JSON.parse(localStorage.getItem('bd_save') || '{}')); } catch (e) {}
function persist() { try { localStorage.setItem('bd_save', JSON.stringify(rec)); } catch (e) {} }

/* ---------- ÉTAT DU JEU ---------- */
let S;
function reset() {
  S = { money:200, life:100, wave:0, score:0, kills:0,
        enemies:[], turrets:[], bullets:[], fx:[], texts:[], queue:[],
        spawnT:0, sel:null, build:null, mouse:{x:0,y:0},
        paused:false, over:false, speed:1, banner:0, waveDone:true, waveTotal:1, shake:0 };
  $('overlay').classList.add('hidden');
  $('btnPause').textContent = '⏸ Pause';
  updateInfo(); updateUI();
}

/* ---------- GÉOMÉTRIE ---------- */
function distSeg(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((px-a.x)*dx + (py-a.y)*dy) / (dx*dx + dy*dy)));
  return Math.hypot(px - (a.x + t*dx), py - (a.y + t*dy));
}
function onRoad(x, y, margin) {
  for (const p of PATHS)
    for (let i = 0; i < p.length - 1; i++)
      if (distSeg(x, y, p[i], p[i+1]) < margin) return true;
  return false;
}
// Emplacement valide : dans la carte, hors route, hors base, sans autre tourelle
function canBuild(x, y) {
  return x > 20 && x < W-20 && y > 20 && y < H-20
    && !onRoad(x, y, ROAD + 16)
    && Math.hypot(x-BASE.x, y-BASE.y) > BASE.r + 24
    && !S.turrets.some(t => Math.hypot(t.x-x, t.y-y) < 34);
}

/* ---------- EFFETS VISUELS ---------- */
function burst(x, y, color, n = 8) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.28, v = 40 + Math.random() * 120;
    S.fx.push({ x, y, vx:Math.cos(a)*v, vy:Math.sin(a)*v, life:.4+Math.random()*.3, max:.7, color, r:2+Math.random()*2 });
  }
}
function ring(x, y, R, color) { S.fx.push({ ring:true, x, y, R, life:.4, max:.4, color }); }
// Texte flottant (gains d'argent, dégâts subis…)
function floatText(x, y, text, color) { S.texts.push({ x, y, text, color, life:1, max:1 }); }

/* ---------- VAGUES ---------- */
function startWave() {
  if (S.over || S.paused || S.queue.length) return;
  S.wave++; S.waveDone = false; S.banner = 2.2;
  const w = S.wave, n = 5 + Math.floor(w * 1.8);
  // Les types d'ennemis se débloquent progressivement
  const pool = ['runner'];
  if (w >= 2) pool.push('soldier', 'soldier');
  if (w >= 4) pool.push('tank');
  if (w >= 8) pool.push('tank', 'soldier');
  for (let i = 0; i < n; i++) S.queue.push(pool[Math.random() * pool.length | 0]);
  if (w % 5 === 0) for (let i = 0; i < w / 5; i++) S.queue.push('boss'); // boss réguliers
  S.waveTotal = S.queue.length;
  if (w > rec.bestWave) { rec.bestWave = w; persist(); }
  ring(BASE.x, BASE.y, 120, '#38bdf8');
  updateUI();
}
function spawn(type) {
  const d = ENEMIES[type], path = PATHS[Math.random() * PATHS.length | 0];
  const mult = Math.pow(1.11, S.wave - 1) * (type === 'boss' ? 1 + S.wave * 0.05 : 1);
  S.enemies.push({ type, ...d, hp:d.hp*mult, max:d.hp*mult,
    reward:Math.round(d.reward * (1 + S.wave * 0.05)),
    path, i:1, x:path[0].x, y:path[0].y, dist:0, flash:0, ang:0 });
}

/* ---------- DÉGÂTS / MORT ---------- */
function damage(e, d) {
  if (e.dead) return;
  e.hp -= d; e.flash = .1;
  burst(e.x, e.y, '#fff', 2);                       // effet de touche
  if (e.hp <= 0) {                                  // mort
    e.dead = true;
    S.money += e.reward; S.score += e.reward * 10; S.kills++; rec.kills++;
    burst(e.x, e.y, e.color, e.type === 'boss' ? 40 : 14);
    ring(e.x, e.y, e.r * 2.5, e.color);
    floatText(e.x, e.y - e.r, '+' + e.reward, '#fbbf24');
    if (e.type === 'boss') S.shake = 10;
  }
}

/* ---------- MISE À JOUR ---------- */
function update(dt) {
  // Apparition progressive des ennemis
  S.spawnT -= dt;
  if (S.queue.length && S.spawnT <= 0) { spawn(S.queue.shift()); S.spawnT = 0.7; }

  // Déplacement des ennemis le long de leur route
  for (const e of S.enemies) {
    e.flash = Math.max(0, e.flash - dt);
    const t = e.path[e.i], dx = t.x - e.x, dy = t.y - e.y, d = Math.hypot(dx, dy), st = e.speed * dt;
    if (d > 0) e.ang = Math.atan2(dy, dx);
    if (d <= st) {
      e.x = t.x; e.y = t.y; e.i++;
      if (e.i >= e.path.length) {                   // arrivé à la base
        const loss = e.type==='boss' ? 40 : e.type==='tank' ? 10 : e.type==='soldier' ? 5 : 3;
        S.life -= loss; S.shake = 9;
        floatText(BASE.x - 20, BASE.y - 60, '-' + loss, '#f87171');
        e.dead = true; burst(BASE.x, BASE.y, '#ef4444', 16);
        if (S.life <= 0) { S.life = 0; gameOver(); }
      }
    } else { e.x += dx/d*st; e.y += dy/d*st; }
    e.dist += st;
  }

  // Tourelles : ciblent l'ennemi le plus avancé dans la portée
  for (const t of S.turrets) {
    t.cd -= dt; t.rec = Math.max(0, t.rec - dt * 6); t.beam = null;
    let tg = null;
    for (const e of S.enemies)
      if (!e.dead && Math.hypot(e.x-t.x, e.y-t.y) <= t.range + e.r && (!tg || e.dist > tg.dist)) tg = e;
    if (!tg) continue;
    t.ang = Math.atan2(tg.y - t.y, tg.x - t.x);
    if (t.def.laser) {                              // laser : dégâts continus
      t.beam = tg; damage(tg, t.dmg * dt);
    } else if (t.cd <= 0) {                         // tir d'un projectile
      t.cd = t.rate; t.rec = 1;
      S.bullets.push({ x:t.x, y:t.y, tg, tx:tg.x, ty:tg.y, dmg:t.dmg, splash:t.def.splash, color:t.def.color });
      burst(t.x + Math.cos(t.ang)*18, t.y + Math.sin(t.ang)*18, t.def.color, 3);
    }
  }

  // Projectiles
  for (const b of S.bullets) {
    b.trail = (b.trail || []); b.trail.push({x:b.x, y:b.y}); if (b.trail.length > 6) b.trail.shift();
    if (b.tg && !b.tg.dead) { b.tx = b.tg.x; b.ty = b.tg.y; }
    const dx = b.tx - b.x, dy = b.ty - b.y, d = Math.hypot(dx, dy), st = 440 * dt;
    if (d <= st + 4) {
      b.done = true;
      if (b.splash) {                               // dégâts de zone
        ring(b.tx, b.ty, b.splash, b.color); burst(b.tx, b.ty, b.color, 14); S.shake = Math.max(S.shake, 3);
        for (const e of S.enemies) if (Math.hypot(e.x-b.tx, e.y-b.ty) <= b.splash + e.r) damage(e, b.dmg);
      } else if (b.tg && !b.tg.dead) damage(b.tg, b.dmg);
    } else { b.x += dx/d*st; b.y += dy/d*st; }
  }

  // Particules et textes flottants
  for (const f of S.fx) {
    f.life -= dt;
    if (!f.ring) { f.x += f.vx*dt; f.y += f.vy*dt; }
  }
  for (const t of S.texts) { t.life -= dt; t.y -= 34 * dt; }

  // Nettoyage
  S.enemies = S.enemies.filter(e => !e.dead);
  S.bullets = S.bullets.filter(b => !b.done);
  S.fx = S.fx.filter(f => f.life > 0);
  S.texts = S.texts.filter(t => t.life > 0);
  S.banner = Math.max(0, S.banner - dt);
  S.shake = Math.max(0, S.shake - dt * 30);

  // Fin de vague : bonus
  if (!S.waveDone && !S.queue.length && !S.enemies.length && !S.over) {
    S.waveDone = true;
    const bonus = 25 + S.wave * 6;
    S.money += bonus; S.score += S.wave * 100;
    floatText(W/2, H/2 + 50, 'Vague terminée ! +' + bonus + ' 💰', '#4ade80');
    if (S.score > rec.bestScore) rec.bestScore = S.score;
    persist();
  }
}

function gameOver() {
  S.over = true; rec.games++;
  if (S.score > rec.bestScore) rec.bestScore = S.score;
  persist();
  showOverlay('💀 Game Over',
    `Vague ${S.wave} · Score ${S.score} · ${S.kills} ennemis détruits\nMeilleur : vague ${rec.bestWave}, score ${rec.bestScore}`,
    'Rejouer', reset);
  updateUI();
}

/* =====================================================================
   RENDU : décor pré-rendu (herbe, buissons, routes) + vignettage
   ===================================================================== */
const bg = document.createElement('canvas'); bg.width = W; bg.height = H;
const vig = document.createElement('canvas'); vig.width = W; vig.height = H;

function buildBackground() {
  const g = bg.getContext('2d');
  let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647; // aléatoire reproductible

  // Herbe dégradée + damier discret
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, '#1f7a43'); gr.addColorStop(1, '#14532d');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,.035)';
  for (let x = 0; x < W; x += 40) for (let y = 0; y < H; y += 40) if ((x+y)/40 % 2 === 0) g.fillRect(x, y, 40, 40);

  // Touffes d'herbe
  for (let i = 0; i < 240; i++) {
    const x = rnd()*W, y = rnd()*H; if (onRoad(x, y, ROAD + 10)) continue;
    g.strokeStyle = rnd() > .5 ? 'rgba(134,239,172,.25)' : 'rgba(0,0,0,.18)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x - 2, y - 5); g.moveTo(x, y); g.lineTo(x + 2, y - 6); g.stroke();
  }
  // Buissons décoratifs
  for (let i = 0; i < 30; i++) {
    const x = rnd()*W, y = rnd()*H, r = 7 + rnd()*7;
    if (onRoad(x, y, ROAD + 30) || Math.hypot(x-BASE.x, y-BASE.y) < 90) continue;
    g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(x+3, y+r*.6, r, r*.6, 0, 0, 6.28); g.fill();
    const bg2 = g.createRadialGradient(x-r*.3, y-r*.3, 1, x, y, r);
    bg2.addColorStop(0, '#22c55e'); bg2.addColorStop(1, '#166534');
    g.fillStyle = bg2; g.beginPath(); g.arc(x, y, r, 0, 6.28); g.fill();
  }

  // Routes : bordure, asphalte, liseré, ligne centrale en pointillés
  g.lineCap = 'round'; g.lineJoin = 'round';
  const layers = [[ROAD*2+12,'rgba(0,0,0,.3)'], [ROAD*2+6,'#292524'], [ROAD*2,'#44444c'], [ROAD*2-12,'#4b4b54']];
  for (const [w, c] of layers) {
    g.strokeStyle = c; g.lineWidth = w;
    for (const p of PATHS) { g.beginPath(); p.forEach((q,i) => i ? g.lineTo(q.x,q.y) : g.moveTo(q.x,q.y)); g.stroke(); }
  }
  g.setLineDash([14, 14]); g.lineCap = 'butt'; g.strokeStyle = 'rgba(250,204,21,.35)'; g.lineWidth = 2;
  for (const p of PATHS) { g.beginPath(); p.forEach((q,i) => i ? g.lineTo(q.x,q.y) : g.moveTo(q.x,q.y)); g.stroke(); }
  g.setLineDash([]);

  // Vignettage (assombrit les bords)
  const v = vig.getContext('2d');
  const vg = v.createRadialGradient(W/2, H/2, H*.45, W/2, H/2, W*.62);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.45)');
  v.fillStyle = vg; v.fillRect(0, 0, W, H);
}

/* ---------- DESSIN ---------- */
function draw() {
  ctx.save();
  if (S.shake > 0) ctx.translate((Math.random()-.5)*S.shake, (Math.random()-.5)*S.shake); // tremblement d'écran
  ctx.drawImage(bg, 0, 0);

  // Portails d'apparition pulsants
  for (const p of PATHS) {
    const y = p[0].y, k = .5 + .5 * Math.sin(T * 4);
    const g = ctx.createRadialGradient(0, y, 2, 0, y, 55);
    g.addColorStop(0, `rgba(239,68,68,${.55 + k*.3})`); g.addColorStop(1, 'rgba(239,68,68,0)');
    ctx.fillStyle = g; ctx.fillRect(0, y - 55, 65, 110);
  }

  drawBase();

  // Portée : tourelle sélectionnée ou fantôme de construction
  const m = S.mouse;
  if (S.sel) rangeCircle(S.sel.x, S.sel.y, S.sel.range, '#ffffff');
  if (S.build) {
    const d = TURRETS[S.build], ok = canBuild(m.x, m.y) && S.money >= d.cost;
    rangeCircle(m.x, m.y, d.range, ok ? '#4ade80' : '#f87171');
    ctx.globalAlpha = .65; drawTurret(m.x, m.y, d, 0, 0, 1); ctx.globalAlpha = 1;
  }

  // Tourelles
  for (const t of S.turrets) {
    drawTurret(t.x, t.y, t.def, t.ang, t.rec, t.lvl);
    if (t === S.sel) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.lineDashOffset = -T * 15;
      ctx.beginPath(); ctx.arc(t.x, t.y, 22, 0, 6.28); ctx.stroke(); ctx.setLineDash([]);
    }
    if (t.beam && !t.beam.dead) drawBeam(t);
  }

  // Ennemis (triés par y pour un léger effet de profondeur)
  [...S.enemies].sort((a, b) => a.y - b.y).forEach(drawEnemy);

  // Projectiles avec traînée
  for (const b of S.bullets) {
    (b.trail || []).forEach((p, i, arr) => {
      ctx.globalAlpha = (i + 1) / arr.length * .4; ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, (b.splash ? 5 : 2.5) * (i + 1) / arr.length, 0, 6.28); ctx.fill();
    });
    ctx.globalAlpha = 1;
    ctx.save(); ctx.shadowColor = b.color; ctx.shadowBlur = 12; ctx.fillStyle = b.color;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.splash ? 6 : 3, 0, 6.28); ctx.fill(); ctx.restore();
  }

  // Particules et ondes de choc
  for (const f of S.fx) {
    const k = f.life / f.max; ctx.globalAlpha = Math.max(0, k);
    if (f.ring) { ctx.strokeStyle = f.color; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(f.x, f.y, f.R * (1 - k), 0, 6.28); ctx.stroke(); }
    else { ctx.fillStyle = f.color; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 6.28); ctx.fill(); }
  }
  ctx.globalAlpha = 1;

  // Textes flottants
  ctx.font = 'bold 15px system-ui'; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.7)';
  for (const t of S.texts) {
    ctx.globalAlpha = Math.max(0, Math.min(1, t.life / t.max * 1.5)); ctx.fillStyle = t.color;
    ctx.strokeText(t.text, t.x, t.y); ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  ctx.drawImage(vig, 0, 0);

  // Bannière de début de vague
  if (S.banner > 0) {
    const a = Math.min(1, S.banner, (2.2 - S.banner) * 4);
    ctx.save(); ctx.globalAlpha = Math.max(0, a);
    const bandH = 90, y = H/2 - bandH/2 - 40;
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, 'rgba(2,6,23,0)'); g.addColorStop(.25, 'rgba(2,6,23,.8)');
    g.addColorStop(.75, 'rgba(2,6,23,.8)'); g.addColorStop(1, 'rgba(2,6,23,0)');
    ctx.fillStyle = g; ctx.fillRect(0, y, W, bandH);
    const boss = S.wave % 5 === 0;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = boss ? '#ef4444' : '#38bdf8'; ctx.shadowBlur = 24;
    ctx.fillStyle = '#fff'; ctx.font = 'bold 52px system-ui';
    ctx.fillText(`VAGUE ${S.wave}`, W/2, y + 38);
    ctx.shadowBlur = 0; ctx.font = '600 18px system-ui'; ctx.fillStyle = boss ? '#fca5a5' : '#7dd3fc';
    ctx.fillText(boss ? '⚠ UN BOSS APPROCHE ⚠' : 'Les ennemis arrivent', W/2, y + 72);
    ctx.restore();
  }
}

function drawBase() {
  const { x, y, r } = BASE, k = S.life / 100, pulse = .5 + .5 * Math.sin(T * 2.5);
  // Corps lumineux
  ctx.save(); ctx.shadowColor = '#38bdf8'; ctx.shadowBlur = 20 + pulse * 14;
  const g = ctx.createRadialGradient(x - 10, y - 10, 4, x, y, r);
  g.addColorStop(0, '#7dd3fc'); g.addColorStop(1, '#0369a1');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.28); ctx.fill(); ctx.restore();
  ctx.strokeStyle = '#e0f2fe'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.28); ctx.stroke();
  // Anneau de vie (vert → rouge)
  ctx.lineCap = 'round'; ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.beginPath(); ctx.arc(x, y, r + 10, 0, 6.28); ctx.stroke();
  if (k > 0) {
    ctx.strokeStyle = `hsl(${k * 120},85%,50%)`;
    ctx.beginPath(); ctx.arc(x, y, r + 10, -Math.PI/2, -Math.PI/2 + 6.2832 * k); ctx.stroke();
  }
  ctx.lineCap = 'butt';
  ctx.save(); ctx.font = '26px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('🏰', x, y + 1); ctx.restore();
}

function drawEnemy(e) {
  const x = e.x, y = e.y, r = e.r;
  // Ombre
  ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(x + 2, y + r*.7, r, r*.55, 0, 0, 6.28); ctx.fill();
  ctx.save();
  if (e.type === 'boss') { ctx.shadowColor = '#ef4444'; ctx.shadowBlur = 20 + 8 * Math.sin(T * 6); }
  // Corps + reflet
  ctx.fillStyle = e.flash > 0 ? '#fff' : e.color;
  ctx.beginPath(); ctx.arc(x, y, r, 0, 6.28); ctx.fill();
  ctx.restore();
  const g = ctx.createRadialGradient(x - r*.35, y - r*.35, 1, x, y, r);
  g.addColorStop(0, 'rgba(255,255,255,.4)'); g.addColorStop(1, 'rgba(0,0,0,.4)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.28); ctx.fill();
  // Détails selon le type
  if (e.type === 'tank') { ctx.strokeStyle = '#475569'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x, y, r - 3, 0, 6.28); ctx.stroke(); }
  if (e.type === 'boss') { ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r - 2, 0, 6.28); ctx.stroke(); }
  // Yeux orientés dans le sens de la marche
  const ex = Math.cos(e.ang), ey = Math.sin(e.ang), px = -ey, py = ex, eo = r * .35;
  for (const s of [-1, 1]) {
    const cx = x + ex * r*.35 + px * eo * s, cy = y + ey * r*.35 + py * eo * s;
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, r*.22, 0, 6.28); ctx.fill();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(cx + ex*r*.08, cy + ey*r*.08, r*.11, 0, 6.28); ctx.fill();
  }
  // Barre de vie (visible seulement si blessé, toujours pour le boss)
  if (e.hp < e.max || e.type === 'boss') {
    const w = Math.max(r * 2, 22), bx = x - w/2, by = y - r - 11;
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(bx - 1, by - 1, w + 2, 6);
    ctx.fillStyle = `hsl(${Math.max(0, e.hp / e.max) * 120},80%,50%)`; ctx.fillRect(bx, by, w * Math.max(0, e.hp / e.max), 4);
  }
}

function drawTurret(x, y, d, ang, rec, lvl) {
  // Ombre
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(x + 3, y + 6, 18, 14, 0, 0, 6.28); ctx.fill();
  // Plaque de base + anneau de niveau
  const g = ctx.createRadialGradient(x - 6, y - 6, 2, x, y, 19);
  g.addColorStop(0, '#64748b'); g.addColorStop(1, '#1e293b');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 17, 0, 6.28); ctx.fill();
  ctx.strokeStyle = LVL_COL[lvl - 1]; ctx.lineWidth = 3; ctx.stroke();
  // Canon orienté, avec recul et flash de tir
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  ctx.fillStyle = d.color; ctx.fillRect(2 - rec * 4, -4, 22, 8);
  ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(2 - rec * 4, 0, 22, 4);
  if (rec > .6) { ctx.fillStyle = `rgba(255,255,200,${rec})`; ctx.beginPath(); ctx.arc(27, 0, 7 * rec, 0, 6.28); ctx.fill(); }
  ctx.restore();
  // Moyeu central lumineux
  ctx.save(); if (d.laser) { ctx.shadowColor = d.color; ctx.shadowBlur = 10 + 6 * Math.sin(T * 8); }
  const h = ctx.createRadialGradient(x - 3, y - 3, 1, x, y, 10);
  h.addColorStop(0, '#fff'); h.addColorStop(.3, d.color); h.addColorStop(1, d.color);
  ctx.fillStyle = h; ctx.beginPath(); ctx.arc(x, y, 9, 0, 6.28); ctx.fill(); ctx.restore();
  // Points de niveau
  ctx.fillStyle = '#fbbf24';
  for (let i = 0; i < lvl; i++) { ctx.beginPath(); ctx.arc(x + (i - (lvl - 1) / 2) * 7, y + 26, 2.4, 0, 6.28); ctx.fill(); }
}

function drawBeam(t) {
  const b = t.beam;
  ctx.save(); ctx.lineCap = 'round';
  ctx.shadowColor = t.def.color; ctx.shadowBlur = 16;
  ctx.strokeStyle = 'rgba(244,114,182,.4)'; ctx.lineWidth = 9 + 2 * Math.sin(T * 40);
  ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(b.x, b.y, 5 + 2 * Math.sin(T * 30), 0, 6.28); ctx.fill();
  ctx.restore();
}

function rangeCircle(x, y, r, c) {
  const g = ctx.createRadialGradient(x, y, r * .2, x, y, r);
  g.addColorStop(0, c + '10'); g.addColorStop(1, c + '38');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.28); ctx.fill();
  ctx.strokeStyle = c + 'cc'; ctx.lineWidth = 2; ctx.setLineDash([8, 6]); ctx.lineDashOffset = -T * 20; // pointillés animés
  ctx.stroke(); ctx.setLineDash([]);
}

/* =====================================================================
   INTERFACE
   ===================================================================== */
function buildShop() {
  let i = 1;
  for (const k in TURRETS) {
    const d = TURRETS[k], dps = d.laser ? d.dmg : d.dmg / d.rate, b = document.createElement('button');
    b.className = 'shop'; b.dataset.k = k; b.style.setProperty('--c', d.color);
    b.innerHTML = `<kbd>${i++}</kbd><span class="ico">${d.icon}</span>
      <span class="meta"><b>${d.name}</b>
        <span class="mini" title="Puissance"><i style="width:${Math.min(100, dps / 60 * 100)}%"></i></span>
        <span class="mini" title="Portée"><i style="width:${d.range / 200 * 100}%"></i></span></span>
      <span class="price">${d.cost} 💰</span>`;
    b.onclick = () => pickBuild(k);
    $('shop').appendChild(b);
  }
}
function pickBuild(k) {
  S.build = S.build === k ? null : k; S.sel = null;
  updateInfo(); updateUI();
}

// Met à jour un texte du HUD seulement s'il change (et joue une petite animation)
const cache = {};
function setStat(id, v, bump) {
  if (cache[id] === v) return; cache[id] = v;
  const el = $(id); el.textContent = v;
  if (bump) { const c = el.closest('.stat'); c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
}
function updateUI() {
  setStat('money', Math.floor(S.money), true);
  setStat('life', S.life, true);
  setStat('wave', S.wave, true);
  setStat('left', S.enemies.length + S.queue.length);
  setStat('score', S.score);
  $('lifeFill').style.width = S.life + '%';
  $('life').closest('.stat').classList.toggle('low', S.life <= 30);
  const left = S.enemies.length + S.queue.length;
  $('waveFill').style.width = (S.waveDone ? (S.wave ? 100 : 0) : (1 - left / S.waveTotal) * 100) + '%';
  $('btnWave').disabled = S.over || S.queue.length > 0;
  document.querySelectorAll('.shop').forEach(b => {
    b.classList.toggle('sel', S.build === b.dataset.k);
    b.classList.toggle('poor', S.money < TURRETS[b.dataset.k].cost);
  });
  const up = $('btnUp'); if (up && S.sel) up.disabled = S.sel.lvl >= MAX_LVL || S.money < upCost(S.sel);
  const r = `🏆 Record : vague ${rec.bestWave} · score ${rec.bestScore}<br>Éliminations totales : ${rec.kills} · Parties : ${rec.games}`;
  if (cache.rec !== r) { cache.rec = r; $('records').innerHTML = r; }
}
const upCost = t => Math.round(t.def.cost * 0.7 * t.lvl);

function statRow(label, val, pct) {
  return `<div class="stat-row"><span>${label}</span><div class="bar"><i style="width:${Math.min(100, pct)}%"></i></div><b>${val}</b></div>`;
}
function updateInfo() {
  const box = $('info'), t = S.sel;
  if (t) {                                          // tourelle sélectionnée
    const max = t.lvl >= MAX_LVL, L = t.def.laser;
    box.innerHTML = `<div class="ihead"><span class="ico">${t.def.icon}</span>
        <div><b>${t.def.name}</b><span class="pips">${'●'.repeat(t.lvl)}${'○'.repeat(MAX_LVL - t.lvl)}</span></div></div>
      ${statRow('Dégâts', t.dmg.toFixed(1) + (L ? '/s' : ''), t.dmg / 200 * 100)}
      ${statRow('Cadence', L ? 'continue' : (1 / t.rate).toFixed(1) + '/s', L ? 100 : (1 / t.rate) / 18 * 100)}
      ${statRow('Portée', Math.round(t.range), t.range / 260 * 100)}
      <div class="row"><button id="btnUp" class="primary">${max ? 'Niveau max' : 'Améliorer · ' + upCost(t) + ' 💰'}</button>
      <button id="btnSell" class="danger">Vendre · ${Math.floor(t.spent * 0.7)}</button></div>`;
    $('btnUp').onclick = upgrade; $('btnSell').onclick = sell;
  } else if (S.build) {                             // aperçu de la tourelle choisie
    const d = TURRETS[S.build];
    box.innerHTML = `<div class="ihead"><span class="ico">${d.icon}</span><div><b>${d.name}</b><span class="pips">${d.cost} 💰</span></div></div>
      ${statRow('Dégâts', d.dmg + (d.laser ? '/s' : ''), d.dmg / 200 * 100)}
      ${statRow('Cadence', d.laser ? 'continue' : (1 / d.rate).toFixed(1) + '/s', d.laser ? 100 : (1 / d.rate) / 18 * 100)}
      ${statRow('Portée', d.range, d.range / 260 * 100)}
      <p class="muted">${d.splash ? '💥 Dégâts de zone. ' : ''}Clique sur la carte pour construire.</p>`;
  } else box.innerHTML = '<p class="muted">Choisis une tourelle dans l\'arsenal, ou clique sur une tourelle existante pour l\'améliorer.</p>';
}
function showOverlay(title, text, btn, fn) {
  $('ovTitle').textContent = title; $('ovText').innerText = text;
  $('ovText').style.whiteSpace = 'pre-line';
  $('ovBtn').textContent = btn; $('ovBtn').onclick = fn;
  $('overlay').classList.remove('hidden');
}
function togglePause() {
  if (S.over) return;
  S.paused = !S.paused;
  $('btnPause').textContent = S.paused ? '▶ Reprendre' : '⏸ Pause';
  if (S.paused) showOverlay('⏸ Pause', 'Jeu en pause', 'Reprendre', togglePause);
  else $('overlay').classList.add('hidden');
}

/* ---------- ACTIONS : construire / améliorer / vendre ---------- */
function upgrade() {
  const t = S.sel;
  if (!t || t.lvl >= MAX_LVL || S.money < upCost(t)) return;
  const c = upCost(t); S.money -= c; t.spent += c; t.lvl++;
  t.dmg *= 1.4; t.range *= 1.06; t.rate *= 0.9;
  ring(t.x, t.y, 45, LVL_COL[t.lvl - 1]); burst(t.x, t.y, LVL_COL[t.lvl - 1], 14);
  floatText(t.x, t.y - 30, 'NIV. ' + t.lvl, LVL_COL[t.lvl - 1]);
  updateInfo(); updateUI();
}
function sell() {
  const t = S.sel; if (!t) return;
  const gain = Math.floor(t.spent * 0.7);
  S.money += gain; floatText(t.x, t.y - 25, '+' + gain, '#fbbf24');
  S.turrets = S.turrets.filter(o => o !== t);
  burst(t.x, t.y, '#facc15', 12); S.sel = null;
  updateInfo(); updateUI();
}
function place(x, y) {
  const d = TURRETS[S.build];
  if (!canBuild(x, y) || S.money < d.cost) return;
  S.money -= d.cost;
  S.turrets.push({ x, y, def:d, lvl:1, dmg:d.dmg, range:d.range, rate:d.rate, cd:0, ang:0, rec:0, spent:d.cost });
  ring(x, y, 50, d.color); burst(x, y, d.color, 12);   // effet de construction
  updateUI();
}

/* ---------- ENTRÉES ---------- */
function pos(e) {
  const r = cv.getBoundingClientRect();
  return { x:(e.clientX - r.left) * W / r.width, y:(e.clientY - r.top) * H / r.height };
}
cv.addEventListener('pointermove', e => { S.mouse = pos(e); });
cv.addEventListener('pointerdown', e => {
  if (S.paused || S.over || e.button === 2) return;
  const p = pos(e); S.mouse = p;
  if (S.build) { place(p.x, p.y); return; }
  S.sel = S.turrets.find(t => Math.hypot(t.x - p.x, t.y - p.y) < 20) || null;
  updateInfo(); updateUI();
});
cv.addEventListener('contextmenu', e => { e.preventDefault(); S.build = null; updateInfo(); updateUI(); });
addEventListener('keydown', e => {
  const k = Object.keys(TURRETS)[+e.key - 1];
  if (k) pickBuild(k);
  if (e.key === 'Escape') { S.build = null; S.sel = null; updateInfo(); updateUI(); }
  if (e.key.toLowerCase() === 'p') togglePause();
});
$('btnWave').onclick = startWave;
$('btnPause').onclick = togglePause;
$('btnSpeed').onclick = () => { S.speed = S.speed === 1 ? 2 : 1; $('btnSpeed').textContent = 'x' + S.speed; };

/* ---------- BOUCLE PRINCIPALE ---------- */
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  T += dt;
  if (!S.paused && !S.over) update(dt * S.speed);
  else if (S.over) { for (const f of S.fx) f.life -= dt; for (const t of S.texts) t.life -= dt; }
  draw(); updateUI();
  requestAnimationFrame(loop);
}
buildBackground(); buildShop(); reset();
requestAnimationFrame(loop);
