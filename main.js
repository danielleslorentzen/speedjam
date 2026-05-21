import * as THREE from 'three';

const TRACK_LENGTH = 400;
const TRACK_WIDTH = 20;
const FINISH_Z = -TRACK_LENGTH;
const SPEED = 35;
const BOOST_SPEED = 90;

const STEER_ACCEL = 55;   // lateral acceleration (units/s²)
const STEER_MAX = 14;     // max lateral speed
const STEER_FRICTION = 40; // deceleration when no input

const FOV_NORMAL = 52;
const FOV_BOOST  = 38;
const FOV_EASE   = 5;     // lerp rate (higher = snappier)

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
grass.position.z = -TRACK_LENGTH / 2;
grass.position.y = -0.01;
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

const car = new THREE.Mesh(
  new THREE.BoxGeometry(1.6, 0.8, 3),
  new THREE.MeshStandardMaterial({ color: 0xe53935 })
);
car.position.y = 0.4;
scene.add(car);

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

const camPos  = new THREE.Vector3(0, 4, 9);
const camLook = new THREE.Vector3(0, 1, -6);

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  const boosting = (keys['w'] || keys['W']) && boostMeter > 0;

  if (!finished) {
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

    const pct = Math.round(boostMeter * 100);
    const bar = '█'.repeat(Math.round(boostMeter * 10)) + '░'.repeat(10 - Math.round(boostMeter * 10));
    hud.textContent = `Arrow keys / A,D to steer   W = boost\nBoost: ${bar} ${pct}%`;

    if (car.position.z <= FINISH_Z) {
      finished = true;
      msg.textContent = 'Finished!';
      msg.style.display = 'block';
    }
  }

  // FOV ease-in toward target
  const targetFov = boosting ? FOV_BOOST : FOV_NORMAL;
  currentFov += (targetFov - currentFov) * Math.min(1, FOV_EASE * dt);
  camera.fov = currentFov;
  camera.updateProjectionMatrix();

  const camBack   = boosting ? 7 : 9;
  const camHeight = boosting ? 3.2 : 4;
  const targetPos  = new THREE.Vector3(car.position.x * 0.6, camHeight, car.position.z + camBack);
  const targetLook = new THREE.Vector3(car.position.x, 1, car.position.z - 6);
  camPos.lerp(targetPos,   Math.min(1, 9 * dt));
  camLook.lerp(targetLook, Math.min(1, 9 * dt));
  camera.position.copy(camPos);
  camera.lookAt(camLook);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
