import * as THREE from 'three';

const TRACK_LENGTH = 400;
const TRACK_WIDTH = 20;
const FINISH_Z = -TRACK_LENGTH;
const SPEED = 35;
const BOOST_SPEED = 90;
const SEND_HZ = 20;

const STEER_ACCEL = 55;
const STEER_MAX = 14;
const STEER_FRICTION = 40;

const FOV_NORMAL = 52;
const FOV_BOOST  = 38;
const FOV_EASE   = 5;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 80, 350);

const camera = new THREE.PerspectiveCamera(FOV_NORMAL, innerWidth / innerHeight, 0.1, 1000);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.0));
const sun = new THREE.DirectionalLight(0xffffff, 0.6);
sun.position.set(20, 40, 10);
scene.add(sun);

const grass = new THREE.Mesh(
  new THREE.PlaneGeometry(400, TRACK_LENGTH + 200),
  new THREE.MeshStandardMaterial({ color: 0x4a8a3a })
);
grass.rotation.x = -Math.PI / 2;
grass.position.set(0, -0.01, -TRACK_LENGTH / 2);
scene.add(grass);

const track = new THREE.Mesh(
  new THREE.PlaneGeometry(TRACK_WIDTH, TRACK_LENGTH),
  new THREE.MeshStandardMaterial({ color: 0x333338 })
);
track.rotation.x = -Math.PI / 2;
track.position.z = -TRACK_LENGTH / 2;
scene.add(track);

function makeLine(z, color) {
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(TRACK_WIDTH, 2),
    new THREE.MeshStandardMaterial({ color })
  );
  line.rotation.x = -Math.PI / 2;
  line.position.set(0, 0.01, z);
  scene.add(line);
}
makeLine(0, 0xffffff);
makeLine(FINISH_Z, 0xffeb3b);

// Dashed center lane markings
const dashGeo = new THREE.PlaneGeometry(0.4, 4);
const dashMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
const DASH_SPACING = 10;
for (let z = -DASH_SPACING / 2; z > FINISH_Z; z -= DASH_SPACING) {
  const dash = new THREE.Mesh(dashGeo, dashMat);
  dash.rotation.x = -Math.PI / 2;
  dash.position.set(0, 0.02, z);
  scene.add(dash);
}

// Trees
const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c3a1e });
const leavesMat = new THREE.MeshStandardMaterial({ color: 0x2d6a2d });
const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 2, 6);
const leavesGeo = new THREE.ConeGeometry(1.4, 3.5, 7);

const TREE_MARGIN = 2;
const TREE_COLS = 3;
const TREE_COL_SPACING = 4;
const TREE_ROW_SPACING = 12;

for (let col = 0; col < TREE_COLS; col++) {
  const xOffset = TRACK_WIDTH / 2 + TREE_MARGIN + col * TREE_COL_SPACING;
  for (let row = 0; row <= TRACK_LENGTH / TREE_ROW_SPACING; row++) {
    const z = -row * TREE_ROW_SPACING + (col % 2 === 0 ? 0 : TREE_ROW_SPACING / 2);
    for (const side of [-1, 1]) {
      const x = side * (xOffset + (Math.sin(row * 7.3 + col * 3.1) * 0.8));
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.set(x, 1, z);
      scene.add(trunk);
      const leaves = new THREE.Mesh(leavesGeo, leavesMat);
      leaves.position.set(x, 3.5, z);
      scene.add(leaves);
    }
  }
}

function makeCar(color) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.8, 3),
    new THREE.MeshStandardMaterial({ color })
  );
  m.position.y = 0.4;
  return m;
}

const car = makeCar(0xe53935);
scene.add(car);

const remotes = new Map();
const colorById = new Map();
function addRemote(p) {
  const mesh = makeCar(p.color);
  mesh.position.set(p.x, 0.4, p.z);
  scene.add(mesh);
  remotes.set(p.id, { mesh, tx: p.x, tz: p.z });
  colorById.set(p.id, p.color);
}

// Lifecycle state (server-authoritative)
let myId = 0;
let phase = 'racing';
let round = 0;
let myInRound = false;
let phaseEnd = 0;        // performance.now()-based deadline for countdown/roundend
let goUntil = 0;         // show "GO!" until this time
let standings = [];      // [{ id, place }]

const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(`${wsProto}//${location.host}`);
let connected = false;

function placeAtStart(starts) {
  for (const [pid, sx] of Object.entries(starts)) {
    const idNum = Number(pid);
    if (idNum === myId) {
      car.position.set(sx, 0.4, 0);
      carVelX = 0;
    } else {
      const r = remotes.get(idNum);
      if (r) { r.mesh.position.set(sx, 0.4, 0); r.tx = sx; r.tz = 0; }
    }
  }
}

function applyPhase(m) {
  phase = m.phase;
  if (typeof m.round === 'number') round = m.round;
  phaseEnd = m.duration ? performance.now() + m.duration : 0;

  if (phase === 'countdown') {
    finished = false;
    boostMeter = 1.0;
    standings = [];
    myInRound = !!(m.starts && m.starts[myId] !== undefined);
    if (m.starts) placeAtStart(m.starts);
  } else if (phase === 'racing') {
    goUntil = performance.now() + 700;
  } else if (phase === 'roundend') {
    standings = m.standings || [];
  }
}

ws.addEventListener('open', () => { connected = true; });
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.type === 'welcome') {
    myId = m.id;
    car.material.color.setHex(m.color);
    colorById.set(m.id, m.color);
    if (typeof m.x === 'number') car.position.x = m.x;
    for (const p of m.players) addRemote(p);
    phase = m.phase;
    round = m.round || 0;
    myInRound = !!m.inRound;
    phaseEnd = m.phaseRemaining ? performance.now() + m.phaseRemaining : 0;
    standings = m.standings || [];
  } else if (m.type === 'phase') {
    applyPhase(m);
  } else if (m.type === 'finish') {
    standings = standings.filter(s => s.id !== m.id);
    standings.push({ id: m.id, place: m.place });
    standings.sort((a, b) => a.place - b.place);
  } else if (m.type === 'join') {
    addRemote(m.player);
  } else if (m.type === 'leave') {
    const r = remotes.get(m.id);
    if (r) { scene.remove(r.mesh); remotes.delete(m.id); }
    colorById.delete(m.id);
  } else if (m.type === 'state') {
    const r = remotes.get(m.id);
    if (r) { r.tx = m.x; r.tz = m.z; }
  }
});

const keys = Object.create(null);
addEventListener('keydown', e => { keys[e.key] = true; });
addEventListener('keyup', e => { keys[e.key] = false; });

const hud = document.getElementById('hud');
const msg = document.getElementById('msg');
let finished = false;
let last = performance.now();
let boostMeter = 1.0;
const BOOST_DRAIN = 0.4;
const BOOST_REGEN = 0.15;

let carVelX = 0;
let currentFov = FOV_NORMAL;
let sendAcc = 0;
const sendInterval = 1 / SEND_HZ;

const camPos  = new THREE.Vector3(0, 4, 9);
const camLook = new THREE.Vector3(0, 1, -6);

function colorHex(id) {
  const c = colorById.get(id);
  return c !== undefined ? '#' + c.toString(16).padStart(6, '0') : '#fff';
}

// Front-runner among still-racing cars (falls back to any car if all finished).
function getLeader() {
  const done = new Set(standings.map(s => s.id));
  let bx = 0, bz = Infinity, found = false;
  const consider = (id, pos) => { if (pos.z < bz) { bz = pos.z; bx = pos.x; found = true; } };
  if (myInRound && !finished && !done.has(myId)) consider(myId, car.position);
  for (const [pid, r] of remotes) if (!done.has(pid)) consider(pid, r.mesh.position);
  if (!found) {
    if (myInRound) consider(myId, car.position);
    for (const [pid, r] of remotes) consider(pid, r.mesh.position);
  }
  return found ? { x: bx, z: bz } : null;
}

function renderStandings() {
  if (standings.length === 0) return 'Round over';
  const rows = standings.map(s => {
    const me = s.id === myId ? ' (you)' : '';
    return `<div style="color:${colorHex(s.id)}">#${s.place} &nbsp; P${s.id}${me}</div>`;
  });
  return `<div style="font-size:30px; line-height:1.4">${rows.join('')}</div>`;
}

function updateUI(now) {
  const pct = Math.round(boostMeter * 100);
  const filled = Math.round(boostMeter * 10);
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
  const graceSecs = phaseEnd ? Math.max(0, Math.ceil((phaseEnd - now) / 1000)) : 0;

  let status;
  if (phase === 'countdown') status = myInRound ? 'Get ready!' : 'Joining next round…';
  else if (!myInRound) status = 'Spectating — next round soon';
  else if (finished) status = 'Finished!';
  else if (phase === 'roundend') status = `Hurry! ${graceSecs}s left`;
  else status = 'Arrow / A,D steer · W boost';
  hud.textContent = `5 Seconds To Finish — Round ${round}\n${status}\nBoost: ${bar} ${pct}%`;

  if (phase === 'countdown') {
    msg.textContent = graceSecs > 0 ? String(graceSecs) : 'GO!';
    msg.style.display = 'block';
  } else if (phase === 'racing' && now < goUntil) {
    msg.textContent = 'GO!';
    msg.style.display = 'block';
  } else if (phase === 'roundend' && (finished || !myInRound)) {
    msg.innerHTML = renderStandings();
    msg.style.display = 'block';
  } else {
    msg.style.display = 'none';
  }
}

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  const racingPhase = phase === 'racing' || phase === 'roundend';
  const canDrive = racingPhase && myInRound && !finished;
  const boosting = canDrive && (keys['w'] || keys['W']) && boostMeter > 0;

  if (canDrive) {
    if (boosting) {
      boostMeter = Math.max(0, boostMeter - BOOST_DRAIN * dt);
    } else {
      boostMeter = Math.min(1, boostMeter + BOOST_REGEN * dt);
    }

    const speed = boosting ? BOOST_SPEED : SPEED;
    car.position.z -= speed * dt;

    const left  = keys['ArrowLeft']  || keys['a'] || keys['A'];
    const right = keys['ArrowRight'] || keys['d'] || keys['D'];

    if (left)       carVelX -= STEER_ACCEL * dt;
    else if (right) carVelX += STEER_ACCEL * dt;
    else {
      const friction = STEER_FRICTION * dt;
      carVelX = Math.abs(carVelX) <= friction ? 0 : carVelX - Math.sign(carVelX) * friction;
    }
    carVelX = Math.max(-STEER_MAX, Math.min(STEER_MAX, carVelX));

    car.position.x += carVelX * dt;
    const half = TRACK_WIDTH / 2 - 1;
    car.position.x = Math.max(-half, Math.min(half, car.position.x));
    car.rotation.z = -carVelX / STEER_MAX * 0.13;

    if (car.position.z <= FINISH_Z) {
      car.position.z = FINISH_Z;
      finished = true;
      if (connected) ws.send(JSON.stringify({ type: 'finish' }));
    }
  }

  updateUI(now);

  // Interpolate remote cars
  for (const r of remotes.values()) {
    const k = Math.min(1, dt * 12);
    r.mesh.position.x += (r.tx - r.mesh.position.x) * k;
    r.mesh.position.z += (r.tz - r.mesh.position.z) * k;
  }

  // Network send
  sendAcc += dt;
  if (connected && sendAcc >= sendInterval) {
    sendAcc = 0;
    ws.send(JSON.stringify({ type: 'state', x: car.position.x, z: car.position.z }));
  }

  // FOV ease toward target
  const targetFov = boosting ? FOV_BOOST : FOV_NORMAL;
  currentFov += (targetFov - currentFov) * Math.min(1, FOV_EASE * dt);
  camera.fov = currentFov;
  camera.updateProjectionMatrix();

  // Spectators and finished players watch the leader from the front, facing back.
  const spectating = racingPhase && (!myInRound || finished);
  let focusX = car.position.x, focusZ = car.position.z;
  let camBack = boosting ? 7 : 9;
  let camHeight = boosting ? 3.2 : 4;
  let back = 1; // 1 = behind looking forward, -1 = in front looking back

  if (spectating) {
    const leader = getLeader();
    if (leader) {
      focusX = leader.x; focusZ = leader.z;
      camBack = 11; camHeight = 5; back = -1;
    }
  }

  const targetPos  = new THREE.Vector3(focusX * 0.6, camHeight, focusZ + camBack * back);
  const targetLook = new THREE.Vector3(focusX, 1, focusZ - 6 * back);
  camPos.lerp(targetPos,   Math.min(1, 9 * dt));
  camLook.lerp(targetLook, Math.min(1, 9 * dt));
  camera.position.copy(camPos);
  camera.lookAt(camLook);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
