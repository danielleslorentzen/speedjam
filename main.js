import * as THREE from 'three';

const TRACK_LENGTH = 400;
const TRACK_WIDTH = 20;
const FINISH_Z = -TRACK_LENGTH;
const SPEED = 35;
const STEER = 14;
const SEND_HZ = 20;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 80, 350);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 1000);

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

function makeCar(color) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.8, 3),
    new THREE.MeshStandardMaterial({ color })
  );
  m.position.y = 0.4;
  return m;
}

const car = makeCar(0xcccccc);
scene.add(car);

const remotes = new Map();
function addRemote(p) {
  const mesh = makeCar(p.color);
  mesh.position.set(p.x, 0.4, p.z);
  scene.add(mesh);
  remotes.set(p.id, { mesh, tx: p.x, tz: p.z });
}

const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(`${wsProto}//${location.host}`);
let connected = false;

ws.addEventListener('open', () => { connected = true; });
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.type === 'welcome') {
    car.material.color.setHex(m.color);
    if (typeof m.x === 'number') car.position.x = m.x;
    for (const p of m.players) addRemote(p);
  } else if (m.type === 'join') {
    addRemote(m.player);
  } else if (m.type === 'leave') {
    const r = remotes.get(m.id);
    if (r) { scene.remove(r.mesh); remotes.delete(m.id); }
  } else if (m.type === 'state') {
    const r = remotes.get(m.id);
    if (r) { r.tx = m.x; r.tz = m.z; }
  }
});

const keys = Object.create(null);
addEventListener('keydown', e => { keys[e.key] = true; });
addEventListener('keyup', e => { keys[e.key] = false; });

const msg = document.getElementById('msg');
let finished = false;
let last = performance.now();
let sendAcc = 0;
const sendInterval = 1 / SEND_HZ;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (!finished) {
    car.position.z -= SPEED * dt;
    const left = keys['ArrowLeft'] || keys['a'] || keys['A'];
    const right = keys['ArrowRight'] || keys['d'] || keys['D'];
    if (left) car.position.x -= STEER * dt;
    if (right) car.position.x += STEER * dt;
    const half = TRACK_WIDTH / 2 - 1;
    car.position.x = Math.max(-half, Math.min(half, car.position.x));
    car.rotation.z = (left ? 0.1 : 0) - (right ? 0.1 : 0);

    if (car.position.z <= FINISH_Z) {
      finished = true;
      msg.textContent = 'Finished!';
      msg.style.display = 'block';
    }
  }

  for (const r of remotes.values()) {
    const k = Math.min(1, dt * 12);
    r.mesh.position.x += (r.tx - r.mesh.position.x) * k;
    r.mesh.position.z += (r.tz - r.mesh.position.z) * k;
  }

  sendAcc += dt;
  if (connected && sendAcc >= sendInterval) {
    sendAcc = 0;
    ws.send(JSON.stringify({ type: 'state', x: car.position.x, z: car.position.z }));
  }

  camera.position.set(car.position.x * 0.6, 4, car.position.z + 9);
  camera.lookAt(car.position.x, 1, car.position.z - 6);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
