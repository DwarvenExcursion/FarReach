// main.js

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const statusEl = document.getElementById("status");
const hintEl = document.getElementById("hint");
const logEl = document.getElementById("log");

// --- Config ---
const GRID_W = 24;
const GRID_H = 24;

// Diamond tile size (screen space)
const TILE_W = 36; // width of diamond
const TILE_H = 18; // height of diamond

// Where grid (0,0) lands on screen
let ORIGIN = { x: canvas.width / 2, y: 80 };

// Fog of war visibility radius (in tile units)
const VIS_RADIUS = 4;

// --- State ---
const player = {
  wx: 12, wy: 12,  // world position (float tiles)
  px: 0,  py: 0,   // screen position
  vx: 0,  vy: 0,   // velocity in world space
};

const ship = {
  hull: 10,
  maxHull: 10,
  scrap: 0,
  hasLegendary: false,
  fragments: new Set(), // holds 1..10
  fuel: 30,
  maxFuel: 30,
};

const input = {
  up: false, down: false, left: false, right: false,
  boost: false,
  brake: false,
};

const FRAG_TOTAL = 10;

// --- POIs ---
const FIXED_POIS = [
  { x: 6,  y: 6,  type: "Station" },
  { x: 18, y: 9,  type: "Asteroids" },
  { x: 10, y: 18, type: "Derelict" },
  { x: 22, y: 22, type: "Far Corner" },
];

// --- Canvas ---
let VIEW_W = window.innerWidth;
let VIEW_H = window.innerHeight;

// --- Camera ---
const camera = { x: 0, y: 0 }; // screen-space offset
const CAMERA_FOLLOW = 8.5;     // higher = snappier follow (try 6–14)
const CAMERA_DEADZONE = 0.0;   // pixels; set 20–60 if you want a slack zone


let pois = []; // loaded or generated

// Center camera on player immediately
function centerCameraOnPlayer() {
  camera.x = (VIEW_W / 2) - player.px;
  camera.y = (VIEW_H / 2) - player.py;
}

// --- Log ---
let logLines = [];
function addLog(text) {
  logLines.unshift(text);
  logLines = logLines.slice(0, 8);
  logEl.textContent = logLines.join("\n");
}

// --- Math ---
function gridToScreen(gx, gy) {
  const sx = ORIGIN.x + (gx - gy) * (TILE_W / 2);
  const sy = ORIGIN.y + (gx + gy) * (TILE_H / 2);
  return { x: sx, y: sy };
}

function drawDiamond(cx, cy, w, h) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - h / 2);
  ctx.lineTo(cx + w / 2, cy);
  ctx.lineTo(cx, cy + h / 2);
  ctx.lineTo(cx - w / 2, cy);
  ctx.closePath();
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function chance(p01) {
  return Math.random() < p01;
}

function fragmentsCount() {
  return ship.fragments.size;
}

function getRandomMissingFragment() {
  const missing = [];
  for (let i = 1; i <= FRAG_TOTAL; i++) {
    if (!ship.fragments.has(i)) missing.push(i);
  }
  if (missing.length === 0) return null;
  return missing[Math.floor(Math.random() * missing.length)];
}

function manhattan(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function getNearestPOI(wx, wy, radius = 0.65) {
  let best = null;
  for (const p of pois) {
    const d = Math.hypot(p.x - wx, p.y - wy);
    if (d <= radius && (!best || d < best.d)) best = { d, poi: p };
  }
  return best ? best.poi : null;
}

// --- Damage / Repair / Spend ---
function damage(amount) {
  ship.hull = clamp(ship.hull - amount, 0, ship.maxHull);

  if (ship.hull <= 0) {
    addLog("💥 Ship destroyed! Resetting run (keeping collection).");

    ship.hull = ship.maxHull;
    ship.scrap = 0;
    ship.fuel = ship.maxFuel;

    player.wx = 12;
    player.wy = 12;
    player.vx = 0;
    player.vy = 0;

    const s = gridToScreen(player.wx, player.wy);
    player.px = s.x;
    player.py = s.y;

    saveGame();
  }
}

function repair(amount) {
  ship.hull = clamp(ship.hull + amount, 0, ship.maxHull);
}

function spendScrap(amount) {
  if (ship.scrap < amount) return false;
  ship.scrap -= amount;
  return true;
}

// --- POI Generation ---
const EXTRA_POI_COUNT = 26; // tune 20–40
const MIN_DIST_FROM_STATION = 4;

function keyXY(x, y) {
  return `${x},${y}`;
}

function generatePOIs() {
  const station = FIXED_POIS.find(p => p.type === "Station");
  const used = new Set();
  const out = [];

  for (const p of FIXED_POIS) {
    out.push({ ...p });
    used.add(keyXY(p.x, p.y));
  }

  const extraTypes = ["Relay", "Wreckage", "Gas", "Beacon"];

  let attempts = 0;
  while (out.length < FIXED_POIS.length + EXTRA_POI_COUNT && attempts < 5000) {
    attempts++;

    const x = randInt(0, GRID_W - 1);
    const y = randInt(0, GRID_H - 1);
    const k = keyXY(x, y);

    if (used.has(k)) continue;
    if (manhattan(x, y, station.x, station.y) < MIN_DIST_FROM_STATION) continue;

    let tooClose = false;
    for (const p of out) {
      if (manhattan(x, y, p.x, p.y) <= 1) { tooClose = true; break; }
    }
    if (tooClose) continue;

    const type = extraTypes[randInt(0, extraTypes.length - 1)];
    out.push({ x, y, type });
    used.add(k);
  }

  return out;
}

// --- Save/Load ---
function saveGame() {
  const data = {
    ship: {
      hull: ship.hull,
      maxHull: ship.maxHull,
      scrap: ship.scrap,
      fuel: ship.fuel,
      maxFuel: ship.maxFuel,
      hasLegendary: ship.hasLegendary,
      fragments: Array.from(ship.fragments),
    },
    player: {
      wx: player.wx,
      wy: player.wy,
    },
    pois: pois,
  };
  localStorage.setItem("iso_space_save", JSON.stringify(data));
}

function loadGame() {
  const raw = localStorage.getItem("iso_space_save");
  if (!raw) return false;

  try {
    const data = JSON.parse(raw);

    if (data?.ship) {
      ship.hull = data.ship.hull ?? ship.hull;
      ship.maxHull = data.ship.maxHull ?? ship.maxHull;
      ship.scrap = data.ship.scrap ?? ship.scrap;
      ship.fuel = data.ship.fuel ?? ship.fuel;
      ship.maxFuel = data.ship.maxFuel ?? ship.maxFuel;
      ship.hasLegendary = !!data.ship.hasLegendary;
      ship.fragments = new Set(Array.isArray(data.ship.fragments) ? data.ship.fragments : []);
    }

    if (data?.player) {
      player.wx = data.player.wx ?? player.wx;
      player.wy = data.player.wy ?? player.wy;
      player.vx = 0;
      player.vy = 0;
      player.wx = clamp(player.wx, 0, GRID_W - 1);
      player.wy = clamp(player.wy, 0, GRID_H - 1);
    }

    if (Array.isArray(data?.pois) && data.pois.length > 0) {
      pois = data.pois;
    }

    const s = gridToScreen(player.wx, player.wy);
    player.px = s.x;
    player.py = s.y;

    return true;
  } catch {
    return false;
  }
}

// --- Zoom ---
let zoom = 1.0;
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.6;
const ZOOM_STEP = 1.10; // 10% per scroll notch

function clampZoom(z) {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;

  // CSS size (what you see)
  const cssW = window.innerWidth;
  const cssH = window.innerHeight;

  // Real pixel buffer (what you draw into)
  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);

  // Make drawing coordinates be in CSS pixels (not device pixels)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Re-center the origin now that the screen size changed
  ORIGIN.x = cssW / 2;
  ORIGIN.y = 80;

  //Set Cavnas Globals
  VIEW_W = cssW;
  VIEW_H = cssH;

}

window.addEventListener("wheel", (e) => {
  e.preventDefault();

  // Zoom in/out
  const dir = Math.sign(e.deltaY); // +1 scroll down, -1 scroll up
  const factor = dir > 0 ? 1 / ZOOM_STEP : ZOOM_STEP;

  zoom = clampZoom(zoom * factor);
  // keep player centered while zooming
  centerCameraOnPlayer();
}, { passive: false });

window.addEventListener("keydown", (e) => {
  const k = e.key;
  if (k === "+" || k === "=") zoom = clampZoom(zoom * ZOOM_STEP);
  if (k === "-" || k === "_") zoom = clampZoom(zoom / ZOOM_STEP);
  if (k === "0") zoom = 1.0; // reset
  // immediately re-center after keyboard zoom
  centerCameraOnPlayer();
});

// --- Input ---
window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();

  if (key === "shift") input.boost = true;

  if (key === "arrowup" || key === "w") input.up = true;
  if (key === "arrowdown" || key === "s") input.down = true;
  if (key === "arrowleft" || key === "a") input.left = true;
  if (key === "arrowright" || key === "d") input.right = true;
  if (key === " ") input.brake = true;   // keydown


  if (key === "n") { newGame(); return; }

  if (key === "e") {
    // Only interact if near something
    const poi = getNearestPOI(player.wx, player.wy, 0.70);
    if (poi) handleInteract();
    return;
  }
});

window.addEventListener("keyup", (e) => {
  const key = e.key.toLowerCase();

  if (key === "shift") input.boost = false;

  if (key === "arrowup" || key === "w") input.up = false;
  if (key === "arrowdown" || key === "s") input.down = false;
  if (key === "arrowleft" || key === "a") input.left = false;
  if (key === "arrowright" || key === "d") input.right = false;
  if (key === " ") input.brake = false;  // keyup

});

// --- Update loop (movement + fuel) ---
let saveCooldown = 0; // throttle localStorage writes while moving

function update(dt) {
  // Thrust direction from keys (diagonals allowed)
  let ax = 0, ay = 0;
  if (input.left) ax -= 1;
  if (input.right) ax += 1;
  if (input.up) ay -= 1;
  if (input.down) ay += 1;

  const len = Math.hypot(ax, ay);
  if (len > 0) { ax /= len; ay /= len; }

  const accel = input.boost ? 38 : 24;
  const maxSpeed = input.boost ? 14 : 9;
  const drag = 3.2;

  player.vx += ax * accel * dt;
  player.vy += ay * accel * dt;

  const brakeDrag = 14;
  const usedDrag = input.brake ? brakeDrag : drag;
  const dragFactor = Math.exp(-usedDrag * dt);
  player.vx *= dragFactor;
  player.vy *= dragFactor;

  const sp = Math.hypot(player.vx, player.vy);
  if (sp > maxSpeed) {
    const over = sp - maxSpeed;
    const damp = Math.exp(-over * 0.35 * dt);
    player.vx *= damp;
    player.vy *= damp;
  }

  const oldWx = player.wx;
  const oldWy = player.wy;

  player.wx = clamp(player.wx + player.vx * dt, 0, GRID_W - 1);
  player.wy = clamp(player.wy + player.vy * dt, 0, GRID_H - 1);

  const dist = Math.hypot(player.wx - oldWx, player.wy - oldWy);

  saveCooldown -= dt;

  if (dist > 0.00005) {
    const fuelRate = input.boost ? 1.6 : 1.0;

    if (ship.fuel <= 0) {
      if (chance(0.02)) damage(1);
    } else {
      ship.fuel = clamp(ship.fuel - dist * fuelRate, 0, ship.maxFuel);
    }

    if (saveCooldown <= 0) {
      saveGame();
      saveCooldown = 0.25;
    }
  }

  // Update render position from world position
  const s = gridToScreen(player.wx, player.wy);
  player.px = s.x;
  player.py = s.y;

  // ✅ camera follow MUST happen after px/py are updated
  updateCamera(dt);
}


function updateCamera(dt) {
  const targetX = VIEW_W / 2;
  const targetY = VIEW_H / 2;
  // Compute the desired camera target (screen-space translation)
  let tx = (targetX - player.px);
  let ty = (targetY - player.py);

  // deadzone (optional): if player is within deadzone of center, don't move that axis
  if (CAMERA_DEADZONE > 0) {
    const ex = targetX - player.px;
    const ey = targetY - player.py;
    if (Math.abs(ex) < CAMERA_DEADZONE) tx = camera.x;
    if (Math.abs(ey) < CAMERA_DEADZONE) ty = camera.y;
  }

  // Smoothly lerp camera toward the target translation (prevents initial overshoot)
  const t = 1 - Math.exp(-CAMERA_FOLLOW * dt);
  camera.x += (tx - camera.x) * t;
  camera.y += (ty - camera.y) * t;
}

// --- Interactions ---
function handleInteract() {
  const poi = getNearestPOI(player.wx, player.wy, 0.70);
  if (!poi) return;

  // Gate Far Corner until legendary is crafted
  if (poi.type === "Far Corner" && !ship.hasLegendary) {
    addLog("🔒 Far Corner is unreachable. Craft the Legendary Module first.");
    saveGame();
    return;
  }

  if (poi.type === "Station") {
    // Repair
    if (ship.hull < ship.maxHull && spendScrap(3)) {
      repair(5);
      addLog("🛠️ Station: repaired +5 hull for 3 scrap.");
    } else if (ship.hull < ship.maxHull) {
      addLog("🛠️ Station: need 3 scrap to repair.");
    } else {
      addLog("🛠️ Station: hull already full.");
    }

    // Refuel
    if (ship.fuel < ship.maxFuel && spendScrap(2)) {
      ship.fuel = clamp(ship.fuel + 10, 0, ship.maxFuel);
      addLog("⛽ Refueled +10 for 2 scrap.");
    }

    // Craft Legendary if complete
    if (!ship.hasLegendary && fragmentsCount() >= FRAG_TOTAL) {
      ship.hasLegendary = true;
      addLog("✨ Crafted LEGENDARY MODULE! Far Corner unlocked.");
      addLog("Bonus: better loot odds (placeholder).");
    }

    saveGame();
    return;
  }

  if (poi.type === "Asteroids") {
    const gained = ship.hasLegendary ? randInt(2, 4) : randInt(1, 3);
    ship.scrap += gained;
    addLog(`⛏️ Asteroids: +${gained} scrap.`);
    if (chance(0.20)) {
      damage(1);
      addLog("⚠️ Took 1 hull damage from debris.");
    }
    saveGame();
    return;
  }

  if (poi.type === "Derelict") {
    const fragChance = ship.hasLegendary ? 0.75 : 0.60;
    if (chance(fragChance)) {
      const frag = getRandomMissingFragment();
      if (frag === null) {
        addLog("📦 Derelict: nothing new—collection complete.");
      } else {
        ship.fragments.add(frag);
        addLog(`📦 Derelict: found Fragment ${frag}/${FRAG_TOTAL}! (${fragmentsCount()}/${FRAG_TOTAL})`);
      }
    } else {
      ship.scrap += 4;
      damage(2);
      addLog("💣 Derelict trap! +4 scrap, took 2 hull damage.");
    }
    saveGame();
    return;
  }

  if (poi.type === "Far Corner") {
    const gained = randInt(4, 7);
    ship.scrap += gained;
    addLog(`🧭 Far Corner: +${gained} scrap. Strange signals...`);

    if (chance(0.50)) {
      const frag = getRandomMissingFragment();
      if (frag !== null) {
        ship.fragments.add(frag);
        addLog(`🌌 Far Corner: discovered Fragment ${frag}/${FRAG_TOTAL}! (${fragmentsCount()}/${FRAG_TOTAL})`);
      }
    }

    if (chance(0.35)) {
      damage(3);
      addLog("☠️ Hazard surge! Took 3 hull damage.");
    }

    saveGame();
    return;
  }

  // --- Extra generated POIs ---
  if (poi.type === "Relay") {
    ship.scrap += 1;
    addLog("📡 Relay: +1 scrap. Rumor: 'Derelict signals spike near the outer rim.'");
    saveGame();
    return;
  }

  if (poi.type === "Wreckage") {
    const gained = randInt(1, 3);
    ship.scrap += gained;
    addLog(`🧩 Wreckage: +${gained} scrap.`);
    if (chance(0.15)) { damage(1); addLog("⚠️ Sharp debris: took 1 hull damage."); }
    saveGame();
    return;
  }

  if (poi.type === "Gas") {
    if (chance(0.35)) { damage(2); addLog("☁️ Gas Cloud: corrosive! took 2 hull damage."); }
    else { ship.scrap += 3; addLog("☁️ Gas Cloud: harvested condensates. +3 scrap."); }
    saveGame();
    return;
  }

  if (poi.type === "Beacon") {
    // Find nearest Derelict (use world coords!)
    let best = null;
    for (const p of pois) {
      if (p.type !== "Derelict") continue;
      const d = Math.hypot(player.wx - p.x, player.wy - p.y);
      if (!best || d < best.d) best = { d, p };
    }
    if (best) addLog(`🛰️ Beacon: nearest Derelict is ~${best.d.toFixed(1)} tiles away.`);
    else addLog("🛰️ Beacon: no derelict found (weird).");
    saveGame();
    return;
  }

  addLog(`Nothing configured for: ${poi.type}`);
  saveGame();
}

// --- Rendering ---
function clear() {
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);  

  // starfield
  ctx.fillStyle = "#05060a";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  ctx.fillStyle = "rgba(255,255,255,0.10)";
  for (let i = 0; i < 120; i++) {
    const x = (i * 73) % VIEW_W;
    const y = (i * 151) % VIEW_H;
    ctx.fillRect(x, y, 1, 1);
  }
}

function drawGrid() {
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255,255,255,0.10)";

  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const s = gridToScreen(x, y);
      drawDiamond(s.x, s.y, TILE_W, TILE_H);
      ctx.stroke();
    }
  }
}

function drawPOIs() {
  for (const p of pois) {
    // fog of war (Station always visible)
    if (p.type !== "Station") {
      const d = Math.hypot(player.wx - p.x, player.wy - p.y);
      if (d > VIS_RADIUS) continue;
    }

    const s = gridToScreen(p.x, p.y);

    // color by type
    ctx.fillStyle = "rgba(120,200,255,0.9)";
    if (p.type === "Asteroids") ctx.fillStyle = "rgba(200,200,120,0.9)";
    if (p.type === "Derelict") ctx.fillStyle = "rgba(200,120,200,0.9)";
    if (p.type === "Far Corner") ctx.fillStyle = "rgba(255,120,120,0.95)";
    if (p.type === "Relay") ctx.fillStyle = "rgba(120,255,180,0.9)";
    if (p.type === "Wreckage") ctx.fillStyle = "rgba(180,180,180,0.9)";
    if (p.type === "Gas") ctx.fillStyle = "rgba(120,180,255,0.9)";
    if (p.type === "Beacon") ctx.fillStyle = "rgba(255,220,120,0.9)";

    ctx.beginPath();
    ctx.arc(s.x, s.y - 6, 5, 0, Math.PI * 2);
    ctx.fill();

    // label
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.font = "12px system-ui";
    ctx.fillText(p.type, s.x + 8, s.y - 6);
  }
}

function drawPlayer() {
  const sx = player.px;
  const sy = player.py;

  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  ctx.moveTo(sx, sy - 14);
  ctx.lineTo(sx + 7, sy - 2);
  ctx.lineTo(sx, sy + 2);
  ctx.lineTo(sx - 7, sy - 2);
  ctx.closePath();
  ctx.fill();
}

function updateUI() {
  const poi = getNearestPOI(player.wx, player.wy, 0.70);

  statusEl.textContent =
    `Pos: (${player.wx.toFixed(2)}, ${player.wy.toFixed(2)})  |  Hull: ${ship.hull}/${ship.maxHull}  |  Fuel: ${ship.fuel.toFixed(1)}/${ship.maxFuel}  |  Scrap: ${ship.scrap}  |  Fragments: ${fragmentsCount()}/${FRAG_TOTAL}  |  Legendary: ${ship.hasLegendary ? "YES" : "no"}`;

  if (!poi) {
    hintEl.textContent = "";
    return;
  }

  if (poi.type === "Far Corner" && !ship.hasLegendary) {
    hintEl.textContent = "Far Corner — locked (craft legendary)";
  } else if (poi.type === "Station") {
    const canRepair = ship.hull < ship.maxHull && ship.scrap >= 3;
    const canCraft = !ship.hasLegendary && fragmentsCount() >= FRAG_TOTAL;
    hintEl.textContent = `Station — press E (${canRepair ? "Repair" : "Repair: 3 scrap"}${canCraft ? ", Craft Legendary" : ""})`;
  } else {
    hintEl.textContent = `${poi.type} — press E`;
  }
}

function render() {
  clear();

  ctx.save();

  // 1) Apply camera translation (screen space)
  // 1) Zoom around screen center (screen space)
  const pivotX = VIEW_W / 2;
  const pivotY = VIEW_H / 2;
  ctx.translate(pivotX, pivotY);
  ctx.scale(zoom, zoom);
  ctx.translate(-pivotX, -pivotY);

  // 2) Apply camera translation (screen space, after zoom)
  ctx.translate(camera.x, camera.y);

  drawGrid();
  drawPOIs();
  drawPlayer();

  ctx.restore();

  updateUI();
}

// --- New Game ---
function newGame() {
  ship.hull = ship.maxHull;
  ship.scrap = 0;
  ship.fuel = ship.maxFuel;
  ship.hasLegendary = false;
  ship.fragments = new Set();

  player.wx = 12;
  player.wy = 12;
  player.vx = 0;
  player.vy = 0;

  const s = gridToScreen(player.wx, player.wy);
  player.px = s.x;
  player.py = s.y;

  pois = generatePOIs();

  logLines = [];
  addLog("🆕 New Game started. Fresh sector generated.");

  saveGame();
}

// --- Game Loop ---
let lastTime = performance.now();

function tick(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  update(dt);
  render();

  requestAnimationFrame(tick);
}

// --- Boot ---
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

const loaded = loadGame();

if (!loaded || !Array.isArray(pois) || pois.length === 0) {
  pois = generatePOIs();
  saveGame();
  addLog("Generated a new sector map.");
} else {
  addLog("Loaded saved sector map.");
}

// Ensure player screen position is initialized even on first run
{
  const s = gridToScreen(player.wx, player.wy);
  player.px = s.x;
  player.py = s.y;
}
camera.x = 0;
camera.y = 0;

// one-time center correction (zoom-safe)
camera.x += (VIEW_W / 2) - player.px;
camera.y += (VIEW_H / 2) - player.py;

addLog("MVP booted. Move with WASD/Arrows. Hold Shift to boost. Press E near POIs. Press N for New Game.");

requestAnimationFrame(tick);