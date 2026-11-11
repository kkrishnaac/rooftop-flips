// Rooftop Flips: the whole game, in the browser.
//
// The character is one file (character.glb) holding every pose of the flips as a one-frame clip.
// Nothing here plays a clip straight through. The buttons decide which pose comes next and when,
// the poses are joined by a smooth curve, the body is carried on a real arc under gravity and
// turned as fast as its shape allows (tucked small turns fast, stretched long turns slowly), and
// the clothes follow their own simple rules. The sums are the same ones the Blender previews use
// (blender/animation/flip_preview.py and blender/cloth/cloth_sim.py in the project).

import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/addons/loaders/GLTFLoader.js';
import { OrbitControls } from './vendor/addons/controls/OrbitControls.js';

// Which release of the game this is. The same number is in version.json and in the address of this
// file in index.html: tools/publish_pages.py refuses to publish unless all three agree.
const VERSION = 12;

const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const ramp = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const X_AXIS = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------- the picture
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
camera.position.set(-3.1, 1.3, 3.3);                           // front and to one side, clear of the platforms

function evening() {
  // a clear Los Angeles evening: pale blue overhead, peach, then gold at the horizon
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0.0, '#5f7fb4');
  sky.addColorStop(0.45, '#b7a8c0');
  sky.addColorStop(0.62, '#f0b58c');
  sky.addColorStop(0.72, '#ffd7a1');
  sky.addColorStop(1.0, '#e9a878');
  g.fillStyle = sky; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
scene.background = evening();
scene.fog = new THREE.Fog(0xe7b592, 45, 170);

scene.add(new THREE.HemisphereLight(0xc6d4ff, 0x6a5648, 1.15));
const sun = new THREE.DirectionalLight(0xffd0a0, 2.7);          // low and warm
sun.position.set(-7, 5.5, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -11; sun.shadow.camera.right = 11; sun.shadow.camera.top = 11; sun.shadow.camera.bottom = -11;   // wide enough that a block's shadow is whole wherever he walks (it was cut off 6 m from him)
sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 40;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const rim = new THREE.DirectionalLight(0xd4dcf0, 1.0);          // so black clothes keep an edge against the sky (nearly white: a blue one turned them navy)
rim.position.set(5, 3, -6);
scene.add(rim);

// ---------------------------------------------------------------- the rooftop
const concrete = new THREE.MeshStandardMaterial({ color: 0x8f8b86, roughness: 0.95 });
const pale = new THREE.MeshStandardMaterial({ color: 0xb9b3ab, roughness: 0.9 });
const dark = new THREE.MeshStandardMaterial({ color: 0x4b4d57, roughness: 1.0 });
const EDGE = 12.4;                                              // how far out the roof goes before its wall
const BOXES = [];                                               // things to stand on: {minX, maxX, minZ, maxZ, top}
const SOLIDS = [];                                              // things too big to climb: he walks round them
const ALL_BLOCKS = [];                                          // both
function block(x, z, w, d, h, material, standOn = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, h / 2, z);
  m.castShadow = true; m.receiveShadow = true;
  scene.add(m);
  if (standOn) BOXES.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: h });
  else if (Math.abs(x) < 12 && Math.abs(z) < 12) SOLIDS.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: h });
  if (Math.abs(x) < 12 && Math.abs(z) < 12) {
    m.material = material.clone();                              // (its own, so it alone can turn to glass when it is between the camera and him)
    ALL_BLOCKS.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: h, mesh: m, seen: 1 });
  }
  return m;
}
const roof = new THREE.Mesh(new THREE.BoxGeometry(26, 1, 26), concrete);
roof.position.y = -0.5; roof.receiveShadow = true; scene.add(roof);
for (const [x, z, w, d] of [[0, 13, 26, 0.35], [0, -13, 26, 0.35], [13, 0, 0.35, 26], [-13, 0, 0.35, 26]]) block(x, z, w, d, 0.9, pale, false);
block(-2.6, 0.9, 1.8, 1.8, 0.6, pale);                          // low platform
block(2.6, 0.9, 1.8, 1.8, 1.2, pale);                           // high platform
block(-7, -6, 3, 2.2, 1.6, pale, false);                        // roof furniture, out of the way
block(7.5, 5.5, 2, 2, 2.3, pale, false);
{
  // the city: plain blocks far off, softened by the haze
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 70; i++) {
    const a = rnd() * Math.PI * 2, r = 55 + rnd() * 80, h = 6 + rnd() * rnd() * 46, w = 6 + rnd() * 10;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), dark);
    b.position.set(Math.cos(a) * r, h / 2 - 18, Math.sin(a) * r);
    scene.add(b);
  }
}
function groundAt(x, z) {
  let top = 0;
  for (const b of BOXES) if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) top = Math.max(top, b.top);
  return top;
}
// The floor under one point of him. A platform counts only if the point is on top of it or just
// into its top (a point well down its side is passing beside it, not landing on it), and only if
// his weight is over it too: a toe on the edge with the rest of him out in the air holds nothing up.
const weight = new THREE.Vector3();
let onFoot = false;                                             // walking or climbing: each foot stands on whatever is under it
function floorUnder(p) {
  let top = 0;
  for (const b of BOXES) {
    if (!onFoot && (weight.x <= b.minX || weight.x >= b.maxX || weight.z <= b.minZ || weight.z >= b.maxZ)) continue;
    if (p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ && p.y > b.top - 0.25) top = Math.max(top, b.top);
  }
  return top;
}
// where a flip can start: on the roof, and with the back to the edge of each platform
const SPOTS = [
  { label: 'Roof', x: 0, z: 0.4 },
  { label: 'Low Ledge', x: -2.6, z: 0.16 },                      // heels at the edge, so the flip clears it
  { label: 'High Ledge', x: 2.6, z: 0.16 },
];

// ---------------------------------------------------------------- camera
const controls = new OrbitControls(camera, canvas);
controls.enablePan = false;
controls.enableDamping = true;
controls.minDistance = 2.2; controls.maxDistance = 9;
controls.minPolarAngle = 18 * DEG;
controls.maxPolarAngle = 88 * DEG;                              // low, but never under the floor
controls.target.set(0, 1.0, 0.4);
controls.update();

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w / h < 1 ? 58 : 42;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- small helpers on arrays
const hermite = (a, ma, b, mb, s, span, out) => {
  const s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  for (let i = 0; i < a.length; i++) out[i] = h00 * a[i] + h10 * span * ma[i] + h01 * b[i] + h11 * span * mb[i];
  return out;
};
const dot = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i]; return d; };

// The poses joined into one movement. A key is a pose at a time; a joint flows through a key at the
// pace of its neighbours and stops only where a pose is held, at the ends, or where it turns back.
class Timeline {
  constructor(poses, boneNames) { this.poses = poses; this.bones = boneNames; this.keys = []; this.m = []; }

  poseKey(name, t) {
    const p = this.poses[name];
    return { t, name, q: p.q, hips: p.hips, centre: p.centre, inertia: p.inertia, gain: GAIN[name] ?? 1, lean: p.lean };
  }

  set(keys) {
    // write every joint's turn the near way round from the key before it, then work out the flow through each key
    for (let k = 1; k < keys.length; k++) {
      const fixed = {};
      for (const b of this.bones) {
        const prev = keys[k - 1].q[b], cur = keys[k].q[b];
        fixed[b] = dot(prev, cur) < 0 ? cur.map((v) => -v) : cur;
      }
      keys[k] = { ...keys[k], q: fixed };
    }
    this.keys = keys;
    const last = keys.length - 1;
    this.m = keys.map((key, k) => {
      const flow = { q: {}, hips: [0, 0, 0] };
      const stop = k === 0 || k === last || (key.name && (key.name === keys[k - 1].name || key.name === keys[k + 1].name));
      const span = stop ? 1 : keys[k + 1].t - keys[k - 1].t;
      for (const b of this.bones) {
        const m = [0, 0, 0, 0];
        if (!stop) {
          const a = keys[k - 1].q[b], c = key.q[b], d = keys[k + 1].q[b];
          let forward = 0;
          for (let i = 0; i < 4; i++) forward += (d[i] - c[i]) * (c[i] - a[i]);
          if (forward > 0) for (let i = 0; i < 4; i++) m[i] = (d[i] - a[i]) / span;
        }
        flow.q[b] = m;
      }
      if (!stop) for (let i = 0; i < 3; i++) flow.hips[i] = (keys[k + 1].hips[i] - keys[k - 1].hips[i]) / span;
      return flow;
    });
  }

  segment(t) {
    const keys = this.keys;
    t = clamp(t, keys[0].t, keys[keys.length - 1].t);
    let k = keys.length - 2;
    while (k > 0 && keys[k].t > t) k--;
    const span = Math.max(1e-6, keys[k + 1].t - keys[k].t);
    return [k, (t - keys[k].t) / span, span];
  }

  bone(name, t, out) {
    const [k, s, span] = this.segment(t);
    hermite(this.keys[k].q[name], this.m[k].q[name], this.keys[k + 1].q[name], this.m[k + 1].q[name], s, span, out);
    const n = Math.hypot(out[0], out[1], out[2], out[3]) || 1;
    for (let i = 0; i < 4; i++) out[i] /= n;
    return out;
  }

  hips(t, out) {
    const [k, s, span] = this.segment(t);
    return hermite(this.keys[k].hips, this.m[k].hips, this.keys[k + 1].hips, this.m[k + 1].hips, s, span, out);
  }

  mix(t) {                                                      // the plain numbers, straight between keys
    const [k, s] = this.segment(t);
    const a = this.keys[k], b = this.keys[k + 1];
    return {
      centre: a.centre.map((v, i) => v + (b.centre[i] - v) * s),
      inertia: a.inertia + (b.inertia - a.inertia) * s,
      gain: a.gain + (b.gain - a.gain) * s,
      lean: a.lean + (b.lean - a.lean) * s,
    };
  }

  get end() { return this.keys[this.keys.length - 1].t; }

  snapshot(t) {
    const q = {};
    for (const b of this.bones) q[b] = this.bone(b, t, [0, 0, 0, 0]);
    const lastKey = this.keys[this.keys.length - 1];
    return { t, name: t >= lastKey.t - 1e-6 ? lastKey.name : null, q, hips: this.hips(t, [0, 0, 0]), ...this.mix(t) };
  }

  // from now on: the pose as it is this instant, then these poses, each `seconds` after the last.
  // `real` says where the hips truly are and how they are moving (they belong to the physics while
  // he is in the air), so a fall carries on from the body as it hit the floor.
  plan(t, steps, real = null) {
    const now = this.snapshot(t);
    const before = this.keys.filter((key) => key.t < t - 1e-6).slice(-2);
    if (real) { now.q = { ...now.q, Hips: real.q }; now.hips = real.hips; now.lean = real.lean; }
    const keys = [...before, now];
    let at = t;
    for (const [seconds, name] of steps) { at += seconds; keys.push(this.poseKey(name, at)); }
    this.set(keys);
    if (real) {
      const k = before.length, flip = dot(this.keys[k].q.Hips, real.q) < 0 ? -1 : 1;
      this.m[k].q.Hips = real.qDot.map((v) => v * flip);
      this.m[k].hips = real.hipsDot;
    }
  }
}

// How much faster or slower than its shape alone a pose turns. The float of the stall is held back;
// the tuck is given the extra speed of a tighter tuck than baggy trousers allow.
const GAIN = { tuck: 1.35, tuck_spot: 1.35, open: 0.8, land_reach: 0.6, hang: 0.35 };

// ---------------------------------------------------------------- the clothes
// The same rules as blender/cloth/cloth_sim.py: each cloth bone ends in a point that lives in the
// world; it keeps moving, is carried a little by the body and held back by the air, feels the
// change in which way is down, is pulled back to rest, and is kept on its bone, outside the body
// and within its limit.
class Cloth {
  constructor(data, bones, bind) {
    this.p = data.params; this.data = data; this.bones = bones; this.bind = bind;
    this.swings = data.swings.map((s) => ({
      ...s, pivot: new THREE.Vector3(...s.pivot), direction: new THREE.Vector3(...s.direction),
      at: new THREE.Vector3(), before: new THREE.Vector3(), restBefore: new THREE.Vector3(),
    }));
    this.byName = Object.fromEntries(this.swings.map((s) => [s.bone, s]));
    this.ring = data.ring.map((name, i) => [this.byName[name], this.byName[data.ring[(i + 1) % data.ring.length]], 0]);
    this.slide = 0; this.slideAt = new THREE.Vector3(); this.slideBefore = new THREE.Vector3(); this.baseBefore = new THREE.Vector3();
    this.prev = null;
    this.started = false;
    this.rise = 1;                                              // how much of the shirt's ride-up is allowed right now, 0 to 1
    this.tug = 0;                                               // metres the hem is drawn down over the hips when he folds at the waist
  }

  read() {                                                      // where the body is right now
    const carry = {};
    for (const name of new Set([this.data.slide.driver, ...this.swings.map((s) => s.driver)])) {
      carry[name] = new THREE.Matrix4().multiplyMatrices(this.bones[name].matrixWorld, this.bind.inverse[name]);
    }
    const points = {};
    for (const c of this.data.capsules) for (const n of [c.a, c.b]) points[n] = new THREE.Vector3().setFromMatrixPosition(this.bones[n].matrixWorld);
    return { carry, points };
  }

  targets(body, slide) {
    const out = {};
    const carry = body.carry[this.data.slide.driver];
    const base = new THREE.Vector3(...this.data.slide.pivot).applyMatrix4(carry);
    const axis = new THREE.Vector3(...this.data.slide.axis).transformDirection(carry);
    out.slide = { base, axis, carry };
    for (const s of this.swings) {
      const c = body.carry[s.driver];
      const pivot = s.pivot.clone().applyMatrix4(c);
      if (s.rides) pivot.addScaledVector(axis, slide - this.tug);
      const rest = s.direction.clone().transformDirection(c).multiplyScalar(s.length).add(pivot);
      out[s.bone] = { pivot, rest, carry: c };
    }
    return out;
  }

  reset() { this.started = false; }

  start(body) {
    const now = this.targets(body, 0);
    this.slide = 0;
    this.slideAt.copy(now.slide.base); this.slideBefore.copy(now.slide.base); this.baseBefore.copy(now.slide.base);
    for (const s of this.swings) { s.at.copy(now[s.bone].rest); s.before.copy(s.at); s.restBefore.copy(s.at); }
    for (const pair of this.ring) pair[2] = pair[0].at.distanceTo(pair[1].at);
    this.prev = body;
    this.started = true;
  }

  step(frameDt) {
    const body = this.read();
    if (!this.started) this.start(body);
    const p = this.p, n = p.substeps, dt = frameDt / n;
    const v = new THREE.Vector3(), w = new THREE.Vector3(), pull = new THREE.Vector3();
    const down = new THREE.Vector3(0, -p.gravity, 0);
    const mixed = { carry: body.carry, points: {} };
    let now;
    for (let sub = 1; sub <= n; sub++) {
      const f = sub / n;
      for (const k in body.points) mixed.points[k] = this.prev.points[k].clone().lerp(body.points[k], f);
      // (the body's turn is taken from the end of the frame; its places are stepped through the frame)
      now = this.targets(body, this.slide);
      const lag = 1 - f;
      const shift = (name) => new THREE.Vector3().setFromMatrixPosition(this.prev.carry[name]).sub(new THREE.Vector3().setFromMatrixPosition(body.carry[name])).multiplyScalar(lag);
      const weight = (carry) => w.copy(down).transformDirection(carry).multiplyScalar(-p.gravity).add(down).multiplyScalar(p.lift);

      // the slide: one point on the line of the spine
      const sl = now.slide;
      const base = sl.base.clone().add(shift(this.data.slide.driver));
      v.copy(this.slideAt).sub(this.slideBefore).divideScalar(dt);
      pull.copy(base).addScaledVector(sl.axis, this.slide).sub(this.baseBefore).divideScalar(dt).sub(v);
      v.addScaledVector(pull, Math.min(1, p.damping * dt));
      v.multiplyScalar(1 - Math.min(1, p.drag * dt));
      v.addScaledVector(weight(sl.carry), dt).addScaledVector(pull.copy(base).sub(this.slideAt), p.slide_return * dt);
      this.slideBefore.copy(this.slideAt);
      this.slideAt.addScaledVector(v, dt);
      this.slide = clamp(pull.copy(this.slideAt).sub(base).dot(sl.axis), 0, this.data.slide.limit * this.rise);
      this.slideAt.copy(base).addScaledVector(sl.axis, this.slide);
      this.baseBefore.copy(this.slideAt);
      now = this.targets(body, this.slide);                     // the shirt's bones ride up with the slide

      const moved = {};
      for (const s of this.swings) {
        const t = now[s.bone], off = shift(s.driver);
        const pivot = t.pivot.clone().add(off), rest = t.rest.clone().add(off);
        moved[s.bone] = { pivot, rest, carry: t.carry };
        v.copy(s.at).sub(s.before).divideScalar(dt);
        pull.copy(rest).sub(s.restBefore).divideScalar(dt).sub(v);
        v.addScaledVector(pull, Math.min(1, p.damping * dt));
        v.multiplyScalar(1 - Math.min(1, p.drag * dt));
        v.addScaledVector(weight(t.carry), dt).addScaledVector(pull.copy(rest).sub(s.at), p.swing_return * dt);
        s.before.copy(s.at);
        s.at.addScaledVector(v, dt);
        s.restBefore.copy(rest);
      }
      for (const [a, b, far] of this.ring) {
        pull.copy(b.at).sub(a.at);
        const size = pull.length();
        if (size > 1e-9) { pull.multiplyScalar(((size - far) / size) * 0.5 * p.ring); a.at.add(pull); b.at.sub(pull); }
      }
      for (const s of this.swings) {
        const { pivot, rest } = moved[s.bone];
        const dir = s.at.clone().sub(pivot).normalize();
        s.at.copy(pivot).addScaledVector(dir, s.length);
        if (s.rides) {
          for (const c of this.data.capsules) {                 // out of the torso and thighs
            const a = mixed.points[c.a], ab = mixed.points[c.b].clone().sub(a);
            const along = clamp(s.at.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1);
            const away = s.at.clone().sub(a).addScaledVector(ab, -along);
            const gap = away.length();
            if (gap > 1e-9 && gap < c.radius) s.at.copy(a).addScaledVector(ab, along).addScaledVector(away, c.radius / gap);
          }
          dir.copy(s.at).sub(pivot).normalize();
          s.at.copy(pivot).addScaledVector(dir, s.length);
        }
        const restDir = rest.clone().sub(pivot).normalize();
        const angle = Math.acos(clamp(restDir.dot(dir), -1, 1)), limit = s.limit * DEG;
        if (angle > limit) {
          const side = dir.clone().addScaledVector(restDir, -dir.dot(restDir)).normalize();
          s.at.copy(pivot).addScaledVector(restDir, Math.cos(limit) * s.length).addScaledVector(side, Math.sin(limit) * s.length);
        }
      }
    }
    this.prev = body;

    // hand the result to the cloth bones
    const final = this.targets(body, this.slide);
    const slideBone = this.bones[this.data.slide.bone];
    slideBone.position.copy(this.bind.position[this.data.slide.bone]).add(new THREE.Vector3(0, this.slide - this.tug, 0).applyQuaternion(this.bind.local[this.data.slide.bone]));
    const q = new THREE.Quaternion(), inv = new THREE.Quaternion(), arc = new THREE.Quaternion();
    for (const s of this.swings) {
      const t = final[s.bone];
      const dirWorld = s.at.clone().sub(t.pivot).normalize();
      q.setFromRotationMatrix(t.carry);
      const dirRest = dirWorld.applyQuaternion(inv.copy(q).invert());
      arc.setFromUnitVectors(s.direction, dirRest);
      const world = this.bind.world[s.bone];
      this.bones[s.bone].quaternion.copy(this.bind.local[s.bone]).multiply(inv.copy(world).invert()).multiply(arc).multiply(world);
    }
  }
}

// ---------------------------------------------------------------- the game
const note = $('note');
let noteTimer = 0;
function say(text, bad = false) {
  note.textContent = text;
  note.classList.toggle('bad', bad);
  note.classList.add('show');
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => note.classList.remove('show'), 1400);
}

// A phone keeps old copies of the game's files. Ask the server itself (never a kept copy) which
// release is current; if it is newer than this one, open the page again under the new release's
// address, which no kept copy can answer for.
async function upToDate() {
  try {
    const latest = (await (await fetch('./version.json', { cache: 'no-store' })).json()).version;
    if (latest > VERSION && new URLSearchParams(location.search).get('v') !== String(latest)) {
      location.replace(`./?v=${latest}`);
      return false;
    }
  } catch { /* offline, or no such file: play the copy we have */ }
  return true;
}

async function main() {
  if (!(await upToDate())) return;
  if ($('version')) $('version').textContent = `Version ${VERSION}`;   // a kept copy of an older page has no such line
  const stamp = new URLSearchParams(location.search).get('n') || VERSION;   // (tests add ?n=<anything> so no kept copy of a file can answer)
  const data = await (await fetch(`./flip_data.json?v=${stamp}`)).json();
  const gltf = await new GLTFLoader().loadAsync(`./character.glb?v=${stamp}`, (e) => {
    if (e.total) $('coverBar').style.width = `${Math.min(100, Math.round((e.loaded / e.total) * 100))}%`;
  });

  const underShown = { value: 0 };                              // 0: what is under the shirt is dark; 1: it shows as skin
  // the shirt's own colour, from the model's picture: what is under the shirt is drawn in it until the shirt lifts
  const clothColour = { value: new THREE.Color().setRGB(...(data.cloth_colour || [0.16, 0.153, 0.172]), THREE.SRGBColorSpace) };
  const root = new THREE.Group();
  root.add(gltf.scene);
  scene.add(root);
  const bones = {};
  let skinned = null;
  gltf.scene.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    if (o.isSkinnedMesh) { skinned = o; o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false; }
  });
  root.updateMatrixWorld(true);

  // The loose shirt hangs over a bare waist. When his back bends, that skin can push through the
  // cloth, which looks like the shirt tearing. So the skin under the shirt is drawn as if it were a
  // hand's breadth further from the eye: the shirt always wins where it covers, and the stomach
  // still shows where the shirt has really lifted clear. Nothing moves on the screen.
  {
    const top = data.cloth.slide.pivot[1], swing = data.cloth.swings[0];
    const hem = top - swing.length * Math.abs(swing.direction[1]) - 0.02;
    gltf.scene.traverse((o) => {
      if (!o.isSkinnedMesh || !/Body/.test(o.material.name)) return;
      o.material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
          {
            float under = smoothstep(${(hem - 0.16).toFixed(3)}, ${(hem - 0.08).toFixed(3)}, position.y) * (1.0 - smoothstep(${(top - 0.02).toFixed(3)}, ${(top + 0.02).toFixed(3)}, position.y)) * (1.0 - smoothstep(0.19, 0.24, abs(position.x)));
            vec4 back = mvPosition;
            back.xyz += normalize(mvPosition.xyz) * (0.09 * under);
            vec4 clipBack = projectionMatrix * back;
            gl_Position.z = clipBack.z / clipBack.w * gl_Position.w;
          }`);
      };
      o.material.needsUpdate = true;
    });
    // What is under the shirt (a bare waist) is its own layer in the model. It is always drawn behind
    // the shirt, and it only takes its skin colour once the shirt has really slid up off it, in the
    // air. Until then it is as dark as the shirt, so a gap at the waist in a crouch or a squat reads
    // as shadow under the hem, not as the cloth tearing.
    gltf.scene.traverse((o) => {
      if (!o.isSkinnedMesh || !/Under/.test(o.material.name)) return;
      o.material.onBeforeCompile = (shader) => {
        shader.uniforms.underShown = underShown;
        shader.uniforms.clothColour = clothColour;
        shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
          {
            vec4 back = mvPosition;
            back.xyz += normalize(mvPosition.xyz) * 0.10;
            vec4 clipBack = projectionMatrix * back;
            gl_Position.z = clipBack.z / clipBack.w * gl_Position.w;
          }`);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float underShown;')
          .replace('#include <common>', '#include <common>\nuniform vec3 clothColour;')
          .replace('#include <map_fragment>', '#include <map_fragment>\n  diffuseColor.rgb = mix(clothColour, diffuseColor.rgb, underShown);');
      };
      o.material.needsUpdate = true;
    });
    // Black cloth stays black. The evening's light is coloured (a warm sun on one side, a cool sky on
    // the other), and on black cloth that showed as brown from the front and navy from behind
    // (Krishna, 11 November: "the t-shirt color is changing, like to blue"). So whatever is as dark as
    // the cloth is lit by the light's brightness only, not its colour. Skin keeps the evening's warmth.
    const clothDark = Math.max(clothColour.value.r, clothColour.value.g, clothColour.value.b);
    gltf.scene.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      const before = o.material.onBeforeCompile, allCloth = /Shirt/.test(o.material.name);
      o.material.onBeforeCompile = (shader, renderer) => {
        before?.call(o.material, shader, renderer);
        shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
          {
            float cloth = ${allCloth ? '1.0' : `1.0 - smoothstep(${(clothDark * 2.2).toFixed(4)}, ${(clothDark * 5.0).toFixed(4)}, max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)))`};
            outgoingLight = mix(outgoingLight, vec3(dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722))), cloth);
          }
          #include <opaque_fragment>`);
      };
      o.material.customProgramCacheKey = () => `rooftop-${o.material.name}`;
      o.material.needsUpdate = true;
    });
    // the picture is small patches packed close: seen at a slant, sample it properly
    const sharp = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    gltf.scene.traverse((o) => { if (o.isSkinnedMesh) for (const map of [o.material.map, o.material.normalMap]) if (map) { map.anisotropy = sharp; map.needsUpdate = true; } });
  }

  // the rest pose, as loaded
  const bind = { local: {}, position: {}, world: {}, inverse: {}, rest: {} };
  for (const [name, bone] of Object.entries(bones)) {
    bind.rest[name] = bone.getWorldPosition(new THREE.Vector3());
    bind.local[name] = bone.quaternion.clone();
    bind.position[name] = bone.position.clone();
    bind.world[name] = bone.getWorldQuaternion(new THREE.Quaternion());
  }
  skinned.skeleton.bones.forEach((bone, i) => { bind.inverse[bone.name] = skinned.skeleton.boneInverses[i].clone(); });
  const hips = bones.Hips;
  const hipsParentQ = hips.parent.getWorldQuaternion(new THREE.Quaternion());      // with the root unturned
  const toeRest = bones.LeftToeBase.getWorldPosition(new THREE.Vector3()).add(bones.RightToeBase.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
  const ankleRest = (bones.LeftFoot.getWorldPosition(new THREE.Vector3()).y + bones.RightFoot.getWorldPosition(new THREE.Vector3()).y) / 2;   // how high an ankle is above the floor he stands on
  const toeRestOf = { LeftToeBase: bones.LeftToeBase.getWorldPosition(new THREE.Vector3()), RightToeBase: bones.RightToeBase.getWorldPosition(new THREE.Vector3()) };

  // every pose: each bone's turn, where the hips sit, and the numbers from Blender
  const poses = {};
  for (const clip of gltf.animations) {
    if (!clip.name.startsWith('pose_')) continue;
    const name = clip.name.slice(5), q = {};
    let at = null;
    for (const track of clip.tracks) {
      const cut = track.name.lastIndexOf('.'), bone = track.name.slice(0, cut), what = track.name.slice(cut + 1);
      if (what === 'quaternion') q[bone] = Array.from(track.values.slice(0, 4));
      if (what === 'position' && bone === 'Hips') at = Array.from(track.values.slice(0, 3));
    }
    poses[name] = { q, hips: at, ...data.poses[name] };
  }
  const clothNames = new Set([data.cloth.slide.bone, ...data.cloth.swings.map((s) => s.bone)]);
  const bodyBones = Object.keys(poses.stand.q).filter((b) => bones[b] && !clothNames.has(b));

  // Points spread over his surface, so that any part of him can meet the floor, not only the feet.
  // (The loose shirt is left out: it hangs where it likes.)
  const SKIN = [];
  {
    const seen = new Set(), v = new THREE.Vector3();
    gltf.scene.traverse((mesh) => {
      if (!mesh.isSkinnedMesh) return;
      const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
      for (let i = 0; i < position.count; i++) {
        mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
        const cell = `${Math.round(v.x / 0.07)},${Math.round(v.y / 0.07)},${Math.round(v.z / 0.07)}`;
        if (seen.has(cell)) continue;
        let most = -1, bone = 0;
        for (let k = 0; k < 4; k++) if (skinWeight.getComponent(i, k) > most) { most = skinWeight.getComponent(i, k); bone = skinIndex.getComponent(i, k); }
        const name = mesh.skeleton.bones[bone].name;
        if (name.startsWith('cloth_')) continue;
        seen.add(cell);
        SKIN.push({ mesh, i, name, foot: /Foot|ToeBase/.test(name), hand: /Hand|Fingers|ForeArm/.test(name) });       // the feet are judged on their own
      }
    });
  }
  const skinV = new THREE.Vector3();
  function bodyLow(feet, hands = true) {                         // how high his lowest point is above whatever is under it
    let low = Infinity;
    for (const p of SKIN) {
      if ((p.foot && !feet) || (p.hand && !hands)) continue;
      p.mesh.getVertexPosition(p.i, skinV).applyMatrix4(p.mesh.matrixWorld);
      low = Math.min(low, skinV.y - floorUnder(skinV));
    }
    return low;
  }

  const line = new Timeline(poses, bodyBones);
  line.set([line.poseKey('stand', -1), line.poseKey('stand', 0)]);
  const cloth = new Cloth(data.cloth, bones, bind);
  cloth.rise = 0.25;

  // how hard the default backflip has to be thrown to come round: worked out once from its own timeline
  const pushFor = (flip) => {
    const air = data.timelines[flip].air, ground = data.timelines[flip].ground;
    const start = poses[ground[ground.length - 1][0]];
    const trial = new Timeline(poses, []);
    const keys = [trial.poseKey(ground[ground.length - 1][0], 0)];
    let t = 0;
    for (const [name, ease, hold] of air) { t += ease; keys.push(trial.poseKey(name, t)); if (hold) { t += hold; keys.push(trial.poseKey(name, t)); } }
    trial.keys = keys;
    let sum = 0;
    for (let s = 0; s < t; s += 1 / 240) { const m = trial.mix(s); sum += (m.gain / m.inertia) / 240; }
    return (360 - poses[air[air.length - 1][0]].lean + start.lean) / sum;
  };
  // The game bends the physics for the stall on purpose, so that it can be landed: holding Stall
  // eases gravity, which buys the time the float uses up.
  const spinPush = pushFor('backflip');
  const FLOAT = 0.6;
  const STALL_LEAN = 75;                                        // degrees a second the stall leans him back: slow (Krishna: "it should slowly lean backwards")

  // ------------------------------------------------------------ state
  const G = data.gravity;
  let now = 0, mode = 'ground', spot = 0;
  let charging = false, chargeAt = 0, takeoffAt = Infinity, charge = 0;
  let turn = 0, landing = 'land_reach', planned = false, tucked = false, stalled = false, touchdownAt = -10;
  let hang = false;                                             // he is in the stall's pose right now
  let stallRate = 0;                                            // how fast the stall is leaning him back, degrees a second
  let wantStall = false, stallAt = 0, stallUntil = 0;           // a tap of Stall on the floor still counts; even a tap holds the pose a moment
  let airBlend = 0;
  let plainLean = 9;                                            // how far a jump with no flip in it leans back, in degrees
  let lastFall = null;                                          // which fall he took last, for looking at
  let drop = 0;                                                 // how fast he is dropping when a fall leaves him over nothing
  const hipsQBefore = [0, 0, 0, 1], hipsQDot = [0, 0, 0, 0];    // how the hips were turning as he came down
  const com = new THREE.Vector3(), vel = new THREE.Vector3();
  const settle = { lean: 0, at: new THREE.Vector3(), twist: 0 };
  const toesAt = new THREE.Vector3();                           // where the balls of his feet came down
  const pin = { foot: null, at: new THREE.Vector3() };          // during a step: the one foot that stays planted, and where
  let grade = '';                                               // how the last landing went: stick, fought, step, stumble or fall
  let stepAt = Infinity, stepQueue = [];                        // steps still to come: when each foot lands, and which foot
  const held = { jump: false, tuck: false, stall: false };
  let jumpPower = 1, spinPower = 1;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // how high his balance point is when he stands in each landing pose: the time left in the air is
  // the time it takes to fall to that
  const landHeight = {};
  for (const name of ['land_reach', 'squat_reach', 'land_rise', 'land_sink']) {
    const p = poses[name];
    const turned = new THREE.Quaternion().copy(hipsParentQ).multiply(new THREE.Quaternion().fromArray(p.q.Hips)).multiply(bind.world.Hips.clone().invert());
    landHeight[name] = hips.parent.localToWorld(new THREE.Vector3(...p.hips)).y - root.position.y + new THREE.Vector3(...p.centre).applyQuaternion(turned).y;
  }
  const timeToFloor = (name) => {
    const h = com.y - floorUnder(com) - landHeight[name];
    return h <= 0 ? 0 : (vel.y + Math.sqrt(vel.y * vel.y + 2 * G * h)) / G;
  };
  // how far round each landing wants him: a flip comes all the way round to its landing's lean; a plain jump just comes down
  const wanted = (name) => (name === 'land_rise' ? 0 : 360) - poses[name].lean;
  // The flips the Tuck button can do (Krishna, 11 November: "in the backflip button, I should be able to
  // change it, like swap the flips"). Each is held and let go like the tuck: `enter` is the shape he
  // takes while the button is held, `exit` the one he opens to when it is let go, `held` the landing
  // if it is never let go. A full also twists him once round his own length as he goes over.
  const FLIPS = [
    { id: 'tuck', label: 'Backflip', button: 'Tuck', shape: 'tuck', enter: [[0.22, 'tuck'], [0.08, 'tuck_spot']], fromStall: [[0.16, 'tuck'], [0.07, 'tuck_spot']], exit: [[0.14, 'open']], held: 'squat_reach' },
    { id: 'full', label: 'Full', button: 'Full', shape: 'full_wrap', enter: [[0.15, 'full_wrap']], fromStall: [[0.14, 'full_wrap']], exit: [[0.15, 'lay_open']], held: 'land_sink', twist: true },
    { id: 'layout', label: 'Layout', button: 'Layout', shape: 'lay_arch', enter: [[0.17, 'lay_arch']], fromStall: [[0.15, 'lay_arch']], exit: [[0.16, 'lay_open']], held: 'land_sink' },
  ];
  let flip = FLIPS[0], twist = 0, twistFrom = null;              // which one is chosen; how far round his own length he has twisted, in degrees; how far over he was when the twist began
  // How fast these shapes turn him, in degrees a second at full rotation power. (A straight body turns
  // a third as fast as a tuck for the same throw; a real layout is thrown much harder. The game gives
  // the long shapes the speed the reference clips show: once round in a little over half a second.)
  for (const [name, rate] of Object.entries({ lay_arch: 560, full_wrap: 580, lay_open: 240 })) GAIN[name] = rate * poses[name].inertia / spinPush;
  const tuckRate = () => spinPush * spinPower * (GAIN[flip.shape] / poses[flip.shape].inertia);   // degrees a second, in the chosen flip's held shape
  function chooseFlip(id) {
    if (mode !== 'ground' && id === undefined) return;          // not in the middle of one
    flip = id === undefined ? FLIPS[(FLIPS.indexOf(flip) + 1) % FLIPS.length] : FLIPS.find((f) => f.id === id) || flip;
    $('flip').textContent = `Flip: ${flip.label}`;
    $('tuck').textContent = flip.button;
  }

  let aimLift = 0;                                             // (tests look higher or lower on him with this)
  let snapCamera = false;                                      // the camera goes with him in one step instead of chasing him
  function place(index, snap = false) {
    const s = SPOTS[index];
    snapCamera = snap;
    root.position.set(s.x, groundAt(s.x, s.z), s.z);
    root.quaternion.identity();
    loco.yaw = 0; loco.speed = 0; loco.blend = 0; loco.jog = 0;
    cloth.reset();
    $('spot').textContent = `Spot: ${s.label}`;
  }

  // ------------------------------------------------------------ walking and jogging
  // Four poses make a stride: a contact and a passing pose on each foot. They are run round as a
  // loop, as fast as he moves, so that a foot on the floor stays on the floor. The loop is mixed into
  // whatever he is doing otherwise (standing), more of it the harder the stick is pushed.
  function loop(names) {
    const tl = new Timeline(poses, bodyBones), n = names.length;
    const keys = [];
    for (let i = -1; i <= n + 1; i++) keys.push(tl.poseKey(names[((i % n) + n) % n], i / n));
    tl.set(keys);
    return tl;
  }
  const walkLoop = loop(['walk_c_l', 'walk_p_l', 'walk_c_r', 'walk_p_r']);
  const jogLoop = loop(['jog_c_l', 'jog_p_l', 'jog_c_r', 'jog_p_r']);
  const STEP = { walk: 0.70, jog: 1.2 };                       // metres between one foot's print and the next
  const loco = { blend: 0, phase: 0, speed: 0, jog: 0, yaw: 0 };
  const pad = { x: 0, y: 0 }, arrows = { x: 0, y: 0 };          // the on-screen stick and the arrow keys: x to the right, y up the screen, each -1 to 1
  const LIMIT = 10.1, RADIUS = 0.34;                             // how far out on the roof he may walk; how wide he is
  const fwdV = new THREE.Vector3(), rightV = new THREE.Vector3(), wantV = new THREE.Vector3();
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const hipsA = [0, 0, 0], hipsB = [0, 0, 0];
  let aimYaw = null;                                            // (the tests walk a compass heading instead of a way across the screen)
  place(0);

  // Keep him on the roof and out of anything solid. Says which platform he is pushing against, if it is one he could climb.
  function resolve(y, most = Infinity) {
    const p = root.position;
    let hit = null;
    p.x = clamp(p.x, -LIMIT, LIMIT); p.z = clamp(p.z, -LIMIT, LIMIT);
    for (const list of [SOLIDS, BOXES]) {
      for (const b of list) {
        if (b.top <= y + 0.02) continue;                        // he is on it, or it is below him
        const nx = clamp(p.x, b.minX, b.maxX), nz = clamp(p.z, b.minZ, b.maxZ);
        let ox = p.x - nx, oz = p.z - nz;
        const d = Math.hypot(ox, oz);
        if (d >= RADIUS) continue;
        if (d > 1e-6) { ox /= d; oz /= d; } else {              // (the middle of him is inside: out by the nearest side)
          const ways = [[p.x - b.minX, -1, 0], [b.maxX - p.x, 1, 0], [p.z - b.minZ, 0, -1], [b.maxZ - p.z, 0, 1]];
          [, ox, oz] = ways.reduce((best, way) => (way[0] < best[0] ? way : best));
        }
        // (he is moved out by as much as he walked in, no more: landed or fallen nearer to a wall than he
        // would walk, he is not snapped away from it when he stands)
        const out = Math.min(RADIUS - d, most);
        p.x += ox * out; p.z += oz * out;
        if (list === BOXES && b.top - y <= 1.4) hit = { box: b, nx: -ox, nz: -oz };
      }
    }
    return hit;
  }

  // How far he can go that way before something solid stops him (the roof's limit, a block he is
  // not standing level with), and what that is: the block, and which way its face looks at him.
  const ahead = { room: Infinity, box: null, nx: 0, nz: 0 };
  function roomAhead(dx, dz) {
    const p = root.position;
    ahead.room = Infinity; ahead.box = null;
    if (dx > 1e-6) ahead.room = Math.min(ahead.room, (LIMIT - p.x) / dx); else if (dx < -1e-6) ahead.room = Math.min(ahead.room, (-LIMIT - p.x) / dx);
    if (dz > 1e-6) ahead.room = Math.min(ahead.room, (LIMIT - p.z) / dz); else if (dz < -1e-6) ahead.room = Math.min(ahead.room, (-LIMIT - p.z) / dz);
    for (const list of [SOLIDS, BOXES]) {
      for (const b of list) {
        if (b.top <= p.y + 0.02) continue;
        // where the line of his walk enters the block, grown by his own width, and through which side
        let enter = -Infinity, leave = Infinity, nx = 0, nz = 0;
        for (const [o, d, lo, hi, x] of [[p.x, dx, b.minX - RADIUS, b.maxX + RADIUS, true], [p.z, dz, b.minZ - RADIUS, b.maxZ + RADIUS, false]]) {
          if (Math.abs(d) < 1e-6) { if (o <= lo || o >= hi) { enter = Infinity; break; } continue; }
          const t1 = (lo - o) / d, t2 = (hi - o) / d;
          if (Math.min(t1, t2) > enter) { enter = Math.min(t1, t2); nx = x ? Math.sign(d) : 0; nz = x ? 0 : Math.sign(d); }
          leave = Math.min(leave, Math.max(t1, t2));
        }
        if (enter < leave && leave > 0 && Math.max(enter, 0) < ahead.room) { ahead.room = Math.max(enter, 0); ahead.box = list === BOXES && b.top - p.y <= 1.4 ? b : null; ahead.nx = nx; ahead.nz = nz; }
      }
    }
    return ahead.room;
  }

  // What the stick asks for: turn to face that way, then walk or jog, by how hard it is pushed.
  function walkStep(dt) {
    let sx = clamp(pad.x + arrows.x, -1, 1), sy = clamp(pad.y + arrows.y, -1, 1);
    const mag = Math.min(1, Math.hypot(sx, sy));
    let target = 0, diff = 0;
    if (mag > 0.08) {
      camera.getWorldDirection(fwdV); fwdV.y = 0; fwdV.normalize();
      rightV.set(-fwdV.z, 0, fwdV.x);
      wantV.copy(fwdV).multiplyScalar(sy).addScaledVector(rightV, sx);
      diff = wrap((aimYaw ?? Math.atan2(wantV.x, wantV.z)) - loco.yaw);
      const rate = (loco.speed > 0.6 ? 5 : 8) * dt;             // radians a second at most
      loco.yaw = wrap(loco.yaw + clamp(diff * (1 - Math.exp(-dt / 0.09)), -rate, rate));
      // a gentle push turns him on the spot; a firmer one walks; a full push jogs. He walks only once he faces that way.
      if (mag > 0.2) target = (mag < 0.65 ? 0.4 + (mag - 0.2) * 2.44 : 1.5 + (mag - 0.65) * 4.86) * clamp(1.35 - Math.abs(diff), 0, 1);   // a stroll to a brisk walk, then a jog up to 3.2 m/s
    }
    loco.speed += (target - loco.speed) * (1 - Math.exp(-dt / (target > loco.speed ? 0.16 : 0.10)));
    // He does not stride into a wall: he slows as it comes up, to arrive at it standing. (A foot is
    // further forward in a stride than he is wide, and went into the block.)
    loco.speed = Math.min(loco.speed, 0.12 + Math.max(0, roomAhead(Math.sin(loco.yaw), Math.cos(loco.yaw))) / 0.24);
    if (target === 0 && loco.speed < 0.03) loco.speed = 0;
    root.quaternion.setFromAxisAngle(UP, loco.yaw);
    const fromX = root.position.x, fromZ = root.position.z;
    if (loco.speed > 0) {
      root.position.x += Math.sin(loco.yaw) * loco.speed * dt;
      root.position.z += Math.cos(loco.yaw) * loco.speed * dt;
    }
    // Walking at a ledge he can climb, he starts up it a step before he would touch it.
    if (ahead.box && target > 0.3 && ahead.room < (ahead.box.top - root.position.y <= 0.75 ? 0.26 : 0.14)
      && Math.sin(loco.yaw) * ahead.nx + Math.cos(loco.yaw) * ahead.nz > 0.8 && startClimb({ box: ahead.box, nx: ahead.nx, nz: ahead.nz })) return;
    const hit = resolve(root.position.y, loco.speed * dt * 1.5 + 0.0005);
    // (and held by a wall, or sliding along one, he strides only as fast as he is really going)
    const really = Math.hypot(root.position.x - fromX, root.position.z - fromZ) / dt;
    if (really < loco.speed * 0.8) loco.speed += (really - loco.speed) * (1 - Math.exp(-dt / 0.06));
    if (hit && target > 0.3 && Math.sin(loco.yaw) * hit.nx + Math.cos(loco.yaw) * hit.nz > 0.8 && startClimb(hit)) return;
    // Once the middle of his body is out over nothing he goes over the edge. Walking, his weight sits a
    // little behind his hips, so he goes when a point just behind them is out over nothing too.
    hips.getWorldPosition(tmpV);
    const back = loco.speed > 0.3 ? 0.14 : 0;
    if (!hit && groundAt(tmpV.x - Math.sin(loco.yaw) * back, tmpV.z - Math.cos(loco.yaw) * back) < root.position.y - 0.1) { dropOff(); return; }

    // the stride
    const moving = loco.speed > 0.12;
    const shuffle = !moving && mag > 0.08 && Math.abs(diff) > 0.12;            // turning on the spot: small steps
    // (slowly, he takes short steps: the stride is mixed in by how fast he goes, and its pace kept to match)
    const want = moving ? clamp(loco.speed / 0.9, 0.25, 1) : shuffle ? 0.4 : 0;
    loco.blend += clamp(want - loco.blend, -dt / 0.22, dt / 0.14);
    loco.jog += (ramp((loco.speed - 1.45) / 0.5) - loco.jog) * (1 - Math.exp(-dt / 0.15));
    const step = (STEP.walk + (STEP.jog - STEP.walk) * loco.jog) * Math.max(loco.blend, 0.25);
    const stepsPerSecond = moving ? Math.min(loco.speed / step, 3.4) : shuffle ? 1.5 : 1.2;
    if (loco.blend > 0.002) loco.phase = (loco.phase + dt * stepsPerSecond / 2) % 1;
  }
  // he stops being a walker (to jump, to fall, to climb): whatever he is doing becomes the pose the next movement starts from
  function holdPose() {
    if (loco.blend <= 0.002 && mode === 'ground') { loco.blend = 0; return; }
    const q = {};
    for (const b of bodyBones) q[b] = bones[b].quaternion.toArray();
    const rest = poses.stand;
    const key = { t: now, name: null, q, hips: hips.position.toArray(), centre: rest.centre, inertia: rest.inertia, gain: 1, lean: 0 };
    line.set([{ ...key, t: now - 1 }, key]);
    loco.blend = 0; loco.speed = 0;
  }

  // ------------------------------------------------------------ reaching
  // A leg or an arm bent so that its end (ankle or wrist) is at a given place: the thigh and shin
  // (upper arm and forearm) are swung so the two of them span from the hip to the place asked for,
  // with the knee (elbow) out toward `pole`. Out of reach, the limb stretches toward it.
  const ikH = new THREE.Vector3(), ikK = new THREE.Vector3(), ikE = new THREE.Vector3(), ikT = new THREE.Vector3(), ikS = new THREE.Vector3(), ikK2 = new THREE.Vector3(), ikA = new THREE.Vector3(), ikB = new THREE.Vector3();
  const ikQ = new THREE.Quaternion(), ikP = new THREE.Quaternion(), ikU0 = new THREE.Quaternion(), ikL0 = new THREE.Quaternion(), ikN = new THREE.Quaternion();
  function swing(bone, from, to) {                              // turn a bone, in the world, so that the direction `from` becomes `to`
    bone.parent.updateWorldMatrix(true, false);
    bone.parent.getWorldQuaternion(ikP);
    ikQ.setFromUnitVectors(from, to);
    bone.quaternion.premultiply(ikN.copy(ikP).invert().multiply(ikQ).multiply(ikP));
  }
  function reach(upper, lower, end, target, pole, weight = 1) {
    if (weight <= 0.001) return;
    upper.updateWorldMatrix(true, true);
    upper.getWorldPosition(ikH); lower.getWorldPosition(ikK); end.getWorldPosition(ikE);
    const l1 = ikH.distanceTo(ikK), l2 = ikK.distanceTo(ikE);
    ikT.copy(target).sub(ikH);
    // (nearly out of reach the limb straightens gently, never quite: reaching the limit all at once snaps the knee straight)
    const full = l1 + l2 - 0.004, soft = 0.07, far = ikT.length();
    const d = Math.max(Math.abs(l1 - l2) + 0.03, far < full - soft ? far : full - soft * Math.exp(-(far - (full - soft)) / soft));
    ikT.normalize();
    const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d), out = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    ikS.copy(pole).addScaledVector(ikT, -pole.dot(ikT));
    if (ikS.lengthSq() < 1e-8) ikS.set(0, 1, 0).addScaledVector(ikT, -ikT.y);
    ikS.normalize();
    ikK2.copy(ikH).addScaledVector(ikT, along).addScaledVector(ikS, out);     // where the knee (or elbow) goes
    ikU0.copy(upper.quaternion); ikL0.copy(lower.quaternion);
    swing(upper, ikA.copy(ikK).sub(ikH).normalize(), ikB.copy(ikK2).sub(ikH).normalize());
    upper.updateWorldMatrix(false, true);
    lower.getWorldPosition(ikK); end.getWorldPosition(ikE);
    swing(lower, ikA.copy(ikE).sub(ikK).normalize(), ikB.copy(ikH).addScaledVector(ikT, d).sub(ikK).normalize());
    if (weight < 1) {
      upper.quaternion.copy(ikN.copy(upper.quaternion)).copy(ikU0).slerp(ikN, weight);
      ikN.copy(lower.quaternion);
      lower.quaternion.copy(ikL0).slerp(ikN, weight);
    }
    upper.updateWorldMatrix(false, true);
  }
  function flatFoot(name, weight) {                             // the sole level, toes the way he faces
    if (weight <= 0.001) return;
    const foot = bones[name];
    foot.parent.updateWorldMatrix(true, false);
    foot.parent.getWorldQuaternion(ikP);
    foot.quaternion.slerp(ikQ.copy(ikP).invert().multiply(root.quaternion).multiply(bind.world[name]), weight);
    foot.updateWorldMatrix(false, true);
  }
  // a hand laid flat: palm down, fingers pointing `way`. (Worked out from how the hand lies at rest:
  // which way its fingers point and which way its palm faces then.)
  const handRest = {};
  for (const side of ['Left', 'Right']) {
    const fingers = bind.rest[`${side}Fingers1`].clone().sub(bind.rest[`${side}Hand`]).normalize();
    const thumb = new THREE.Vector3(0, 0, 1).addScaledVector(fingers, -fingers.z).normalize();          // at rest the thumbs point forward
    const palm = side === 'Left' ? fingers.clone().cross(thumb) : thumb.clone().cross(fingers);
    handRest[`${side}Hand`] = new THREE.Matrix4().makeBasis(fingers, palm, fingers.clone().cross(palm));
  }
  const handM = new THREE.Matrix4(), handX = new THREE.Vector3(), DOWN = new THREE.Vector3(0, -1, 0);
  function flatHand(name, way, weight) {
    if (weight <= 0.001) return;
    const hand = bones[name];
    hand.parent.updateWorldMatrix(true, false);
    hand.parent.getWorldQuaternion(ikP);
    handM.makeBasis(way, DOWN, handX.copy(way).cross(DOWN)).multiply(ikM.copy(handRest[name]).transpose());   // turns the hand as it lay at rest into flat
    hand.quaternion.slerp(ikQ.copy(ikP).invert().multiply(ikN.setFromRotationMatrix(handM)).multiply(bind.world[name]), weight);
    hand.updateWorldMatrix(false, true);
  }
  const ikM = new THREE.Matrix4();
  const arc = (a, c, b, s, out) => out.set(0, 0, 0).addScaledVector(a, (1 - s) * (1 - s)).addScaledVector(c, 2 * s * (1 - s)).addScaledVector(b, s * s);   // from a to b, bowed toward c

  // ------------------------------------------------------------ climbing and stepping off
  // The low ledge is a step up; the high one, chest-high, is hands on the edge, a jump and press up
  // on straight arms, then a foot brought up over the edge. The poses say how his body looks. Where
  // it is comes from what is planted: the body is moved so that a planted foot (or his hands) is on
  // its place, and each foot or hand that is planted or on its way is bent to its place exactly, on
  // a path that goes up and over the ledge's edge, never through it. Then, whatever the poses do, no
  // part of his legs or trunk is let into the ledge's face: the body is held back from it, and his
  // hands and feet stay where they were put. (Release 10 only moved the body, and his knees went into the block.)
  let climb = null, dropGrace = 0;
  const at = (name) => bones[name].getWorldPosition(new THREE.Vector3());
  const limbOf = { LeftFoot: ['LeftUpLeg', 'LeftLeg'], RightFoot: ['RightUpLeg', 'RightLeg'], LeftHand: ['LeftArm', 'LeftForeArm'], RightHand: ['RightArm', 'RightForeArm'] };
  function startClimb(hit) {
    const b = hit.box;
    const into = Math.abs(hit.nx) > Math.abs(hit.nz) ? new THREE.Vector3(Math.sign(hit.nx), 0, 0) : new THREE.Vector3(0, 0, Math.sign(hit.nz));
    const along = into.x ? root.position.z : root.position.x, lo = into.x ? b.minZ : b.minX, hi = into.x ? b.maxZ : b.maxX;
    if (along < lo + 0.3 || along > hi - 0.3) return false;      // too near a corner: no room for both feet
    const dist = into.x > 0 ? b.minX - root.position.x : into.x < 0 ? root.position.x - b.maxX : into.z > 0 ? b.minZ - root.position.z : root.position.z - b.maxZ;
    const kind = b.top - root.position.y <= 0.75 ? 'low' : 'high';
    root.updateMatrixWorld(true);
    const start = { LeftFoot: at('LeftFoot'), RightFoot: at('RightFoot'), LeftHand: at('LeftHand'), RightHand: at('RightHand') };
    holdPose();
    mode = 'climb';
    const c = climb = { kind, box: b, into, left: new THREE.Vector3(into.z, 0, -into.x), dist, t0: now, base: root.position.clone(), y0: root.position.y, top: b.top,
      yaw0: loco.yaw, yaw1: Math.atan2(into.x, into.z), start, push: 0, mark: {} };
    c.depth = (p) => (p.x - c.base.x) * into.x + (p.z - c.base.z) * into.z - dist;      // how far past the ledge's face a place is (negative: this side of it)
    c.place = (depth, y, like) => like.clone().addScaledVector(into, depth - c.depth(like)).setY(y);   // a place that deep and that high, level with `like` along the ledge
    if (kind === 'low') {
      // the higher foot goes up first; the lower one is the one he pushes from
      const first = start.LeftFoot.y >= start.RightFoot.y - 0.01 ? 'Left' : 'Right';
      c.lift = `${first}Foot`; c.trail = first === 'Left' ? 'RightFoot' : 'LeftFoot';
      c.on = c.place(0.17, c.top + ankleRest, start[c.lift]);    // where the first foot comes down on the ledge
      line.plan(now, [[0.34, `up_low_a${first === 'Left' ? '' : '_r'}`], [0.08, `up_low_a${first === 'Left' ? '' : '_r'}`], [0.30, `up_low_b${first === 'Left' ? '' : '_r'}`], [0.34, 'stand']]);
    } else {
      c.lift = 'LeftFoot'; c.trail = 'RightFoot';
      const mid = root.position;
      // his left foot comes up on to the ledge out to the left of his left hand (as far as the ledge goes that way)
      const room = c.left.x ? (c.left.x > 0 ? b.maxX - mid.x : mid.x - b.minX) : (c.left.z > 0 ? b.maxZ - mid.z : mid.z - b.minZ);
      c.wide = Math.min(0.40, room - 0.12);
      c.on = c.place(0.20, c.top + ankleRest, mid).addScaledVector(c.left, c.wide);
      c.hands = { LeftHand: c.place(0.05, c.top + 0.045, mid).addScaledVector(c.left, 0.17), RightHand: c.place(0.05, c.top + 0.045, mid).addScaledVector(c.left, -0.17) };
      line.plan(now, [[0.18, 'climb_dip'], [0.08, 'climb_dip'], [0.26, 'mantle_press'], [0.08, 'mantle_press'], [0.34, 'land_squat'], [0.10, 'land_squat'], [0.26, 'land_rise'], [0.28, 'stand']]);
    }
    return true;
  }
  const pinA = new THREE.Vector3(), pinB = new THREE.Vector3(), goal = new THREE.Vector3(), over = new THREE.Vector3(), kneeWay = new THREE.Vector3(), elbowWay = new THREE.Vector3();
  // where each planted or travelling foot and hand should be at this moment: [bone, place, how much, how flat (feet)]
  function climbGoals(c, t) {
    const goals = [], mark = c.mark;
    const swingOver = (name, from, to, s, high, wide = 0) => {   // from `from` up and over the ledge's edge to `to` (out to his left by `wide` on the way)
      over.copy(c.place(Math.min(c.depth(from), -0.22) - 0.08, c.top + high, from)).addScaledVector(c.left, wide);
      return arc(from, over, to, ramp(s), new THREE.Vector3());
    };
    if (c.kind === 'low') {
      goals.push([c.lift, t < 0.42 ? swingOver(c.lift, c.start[c.lift], c.on, t / 0.42, 0.34) : c.on, ramp(t / 0.10), ramp((t - 0.20) / 0.16)]);
      if (t < 0.44) goals.push([c.trail, c.start[c.trail], 1, 1 - ramp((t - 0.36) / 0.08)]);
      else if (t < 0.86) goals.push([c.trail, swingOver(c.trail, c.start[c.trail], at(c.trail), (t - 0.44) / 0.40, 0.5), 1 - ramp((t - 0.72) / 0.14), 0]);
    } else {
      // his hands come up and over the edge on to it (not through it), and stay there until he is squatting on top
      const hold = ramp(t / 0.24) * (1 - ramp((t - 0.90) / 0.16));
      for (const name of ['LeftHand', 'RightHand']) {
        over.copy(c.place(Math.min(c.depth(c.start[name]), -0.12) - 0.12, c.top + 0.46, c.hands[name]));
        goals.push([name, t < 0.30 ? arc(c.start[name], over, c.hands[name], ramp(t / 0.30), new THREE.Vector3()) : c.hands[name], hold, ramp(t / 0.16)]);
      }
      t -= 0.04;                                                  // (the times below were set when the dip was that much shorter)
      for (const name of ['LeftFoot', 'RightFoot']) if (t < 0.27) goals.push([name, c.start[name], 1 - ramp((t - 0.22) / 0.05), 1]);   // feet on the floor until the jump
      if (t >= 0.52) {
        mark.lift ||= at(c.lift);
        goals.push([c.lift, t < 0.88 ? swingOver(c.lift, mark.lift, c.on, (t - 0.52) / 0.36, 0.30, c.wide + 0.2) : c.on, ramp((t - 0.52) / 0.14), ramp((t - 0.70) / 0.14)]);
      }
      if (t >= 0.60 && t < 1.20) {
        // the other foot stays hanging where it is, outside the edge, while his body goes in over the ledge; then it follows, over the edge
        mark.trail ||= at(c.trail);
        goals.push([c.trail, t < 0.82 ? mark.trail : swingOver(c.trail, mark.trail, at(c.trail), (t - 0.82) / 0.38, 0.5), ramp((t - 0.60) / 0.12) * (1 - ramp((t - 1.08) / 0.12)), 0]);
      }
    }
    return goals;
  }
  function bendTo(c, goals) {
    for (const [name, place, weight, flat] of goals) {
      const [upper, lower] = limbOf[name];
      if (/Foot/.test(name)) {
        // which way the knee goes: forward when the foot is below the hip, up when it is out in front
        // (a knee asked to point along the leg's own reach flips from side to side)
        bones[upper].getWorldPosition(ikH);
        ikT.copy(place).sub(ikH).normalize();
        kneeWay.copy(c.into).multiplyScalar(Math.max(0, -ikT.y)).addScaledVector(UP, Math.max(0, ikT.dot(c.into)) + Math.abs(ikT.dot(c.left))).addScaledVector(c.left, name === 'LeftFoot' ? 0.06 : -0.06);
      }
      if (/Hand/.test(name)) elbowWay.copy(c.into).multiplyScalar(-1).addScaledVector(c.left, name === 'LeftHand' ? 0.5 : -0.5).setY(-0.2);
      reach(bones[upper], bones[lower], bones[name], place, /Hand/.test(name) ? elbowWay : kneeWay, weight);
      if (/Hand/.test(name)) flatHand(name, c.into, flat * weight);
      else if (flat) flatFoot(name, flat * weight);
    }
  }
  function placeClimb(dt) {
    const c = climb, t = now - c.t0;
    root.quaternion.setFromAxisAngle(UP, c.yaw0 + wrap(c.yaw1 - c.yaw0) * ramp(t / 0.25));
    root.position.copy(c.base);
    root.updateMatrixWorld(true);
    // the body goes where what is planted puts it (each worked out from where the body would be without it)
    if (c.kind === 'low') {
      const shift = ramp((t - 0.34) / 0.32);                      // his weight goes from the foot on the floor to the foot on the ledge
      pinA.copy(c.start[c.trail]).sub(at(c.trail)).multiplyScalar(1 - shift);
      pinA.addScaledVector(c.into, clamp(c.dist - 0.42, 0, 0.28) * ramp(t / 0.3) * (1 - shift));   // (from a long step away he leans in over the planted foot first)
      pinB.copy(c.on).sub(at(c.lift)).multiplyScalar(shift);
      root.position.add(pinA).add(pinB);
    } else {
      const onHands = ramp((t - 0.26) / 0.10), onFootNow = ramp((t - 0.68) / 0.26);
      pinA.copy(c.hands.LeftHand).add(c.hands.RightHand).sub(at('LeftHand')).sub(at('RightHand')).multiplyScalar(0.5 * onHands * (1 - onFootNow));
      pinB.copy(c.on).sub(at(c.lift)).multiplyScalar(onFootNow);
      root.position.add(pinA).add(pinB);
      if (t < 0.24) root.position.y = Math.max(root.position.y, c.y0);
    }
    root.position.addScaledVector(c.into, -c.push);
    root.updateMatrixWorld(true);
    const goals = climbGoals(c, t);
    bendTo(c, goals);
    // nothing of his legs or trunk inside the ledge's face: he is held back from it, at once; he comes back in no faster than a walk
    for (let pass = 0; pass < 2; pass++) {
      let least = Infinity;
      for (const p of SKIN) {
        if (p.hand || p.foot) continue;                          // (his hands rest on it; his feet are put where they go)
        p.mesh.getVertexPosition(p.i, skinV).applyMatrix4(p.mesh.matrixWorld);
        if (skinV.y < c.top - 0.02) least = Math.min(least, -c.depth(skinV));
      }
      const gap = least - 0.012, push = Math.max(0, c.push - (pass ? Math.min(gap, 0) : Math.min(gap, 1.2 * dt)));
      if (Math.abs(push - c.push) < 1e-5) break;
      root.position.addScaledVector(c.into, c.push - push);
      c.push = push;
      root.updateMatrixWorld(true);
      bendTo(c, goals);
    }
    root.updateMatrixWorld(true);
  }
  function endClimb() {
    root.position.y = climb.top;
    loco.yaw = climb.yaw1;                                       // he stays facing the way he climbed
    climb = null; mode = 'ground';
    loco.speed = 0; loco.blend = 0;
    root.updateMatrixWorld(true);
  }

  // Walking off the edge of a platform: he drops, and lands as from a jump.
  function dropOff() {
    const carry = Math.min(loco.speed, 2.0);
    holdPose();
    root.updateMatrixWorld(true);
    mode = 'air'; takeoffAt = Infinity;
    tucked = stalled = planned = hang = false; stallRate = 0; landing = 'land_rise'; twist = 0; twistFrom = null;
    balance(com);
    turn = -leanNow();
    plainLean = 4;
    vel.set(Math.sin(loco.yaw), 0, Math.cos(loco.yaw)).multiplyScalar(Math.max(carry * 0.7, 1.4));   // (a slow walker is still carried clear of the edge)
    vel.y = 0.9;                                                 // a small hop off it, so the foot behind him clears the edge too
    dropGrace = now + 0.12;                                      // for a moment the platform he is leaving is not the floor he lands on
    line.plan(now, [[0.22, 'land_rise']]);
  }

  // ------------------------------------------------------------ posing
  const tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), tmpV = new THREE.Vector3(), arr4 = [0, 0, 0, 0], arr3 = [0, 0, 0];
  const WANDER = [[/Fingers/, 3.0], [/Hand/, 2.2], [/ForeArm/, 1.4], [/Arm/, 1.2], [/Shoulder/, 0.6], [/Head/, 1.0], [/neck/, 0.7], [/Spine/, 0.5],
    [/ToeBase/, 2.2, true], [/Foot/, 1.8, true], [/UpLeg/, 0.7, true], [/Leg/, 1.1, true]];
  const wanderOf = {};
  for (const b of bodyBones) {
    const hit = WANDER.find(([re]) => re.test(b));
    let seed = 0;
    for (const ch of b) seed = (seed * 31 + ch.charCodeAt(0)) % 9973;
    wanderOf[b] = hit ? { size: hit[1] * DEG, airOnly: !!hit[2], a: (seed % 97) / 97, b: (seed % 89) / 89 } : null;
  }
  const euler = new THREE.Euler();

  const strideQ = new THREE.Quaternion(), jogQ = new THREE.Quaternion();
  function pose(inAir, trail) {
    const striding = mode === 'ground' && loco.blend > 0.002;
    for (const b of bodyBones) {
      if (b === 'Hips' && mode === 'air') continue;
      const late = (data.always_late[b] || 0) + (data.late_in_air[b] || 0) * inAir + (data.trail_after_landing[b] || 0) * trail;
      line.bone(b, now - late, arr4);
      const bone = bones[b];
      bone.quaternion.set(arr4[0], arr4[1], arr4[2], arr4[3]);
      if (striding) {                                            // the stride, mixed in by how much he is walking
        walkLoop.bone(b, loco.phase, arr4);
        strideQ.fromArray(arr4);
        if (loco.jog > 0.002) { jogLoop.bone(b, loco.phase, arr4); strideQ.slerp(jogQ.fromArray(arr4), loco.jog); }
        bone.quaternion.slerp(strideQ, loco.blend);
      }
      const w = wanderOf[b];
      if (w && !reduced) {                                       // a living body is never perfectly still
        const size = w.size * (w.airOnly ? inAir : 1);
        if (size > 0) {
          const s1 = Math.sin(2 * Math.PI * ((0.6 + 0.7 * w.a) * now + w.a)), s2 = Math.sin(2 * Math.PI * ((1.3 + 0.9 * w.b) * now + w.b));
          euler.set(size * (0.65 * s1 + 0.35 * s2), size * 0.5 * s2, size * 0.5 * s1);
          bone.quaternion.multiply(tmpQ.setFromEuler(euler));
        }
      }
    }
  }

  // Turn one joint a little further, about the body's own side-to-side (x) or front-to-back (z) line.
  const BODY_AXIS = { x: new THREE.Vector3(1, 0, 0), z: new THREE.Vector3(0, 0, 1) };
  const turnParent = new THREE.Quaternion(), turnBy = new THREE.Quaternion(), turnAxis = new THREE.Vector3();
  function turnInBody(bone, axis, degrees) {
    if (Math.abs(degrees) < 0.01) return;
    bone.parent.updateWorldMatrix(true, false);
    bone.parent.getWorldQuaternion(turnParent);
    turnBy.setFromAxisAngle(turnAxis.copy(BODY_AXIS[axis]).applyQuaternion(root.quaternion), degrees * DEG);
    bone.quaternion.premultiply(tmpQ.copy(turnParent).invert().multiply(turnBy).multiply(turnParent));
  }
  // What a body does on top of its poses: it breathes, and after a rough landing it fights for balance.
  function alive(inAir, sinceLanding) {
    if (reduced) return;
    const breath = Math.sin(2 * Math.PI * 0.26 * now) * (1 - 0.8 * inAir);
    turnInBody(bones.Spine, 'x', -1.0 * breath);                 // the chest lifts as he breathes in...
    turnInBody(bones.LeftShoulder, 'z', 0.8 * breath);           // ...and the shoulders with it
    turnInBody(bones.RightShoulder, 'z', -0.8 * breath);
    if (mode === 'landing' && Math.abs(settle.lean) > 10) {
      // the arms go out as he rocks over his feet, further the rougher the landing, then come back in
      const fight = Math.min(1, (Math.abs(settle.lean) - 10) / 30) * Math.sin(Math.PI * Math.min(sinceLanding, 0.55) / 0.55) * Math.exp(-sinceLanding / 0.5);
      turnInBody(bones.LeftArm, 'z', 30 * fight);
      turnInBody(bones.RightArm, 'z', -24 * fight);
    }
  }

  // the body's balance point in the world, from where the hips are and how they are turned
  function balance(out) {
    hips.getWorldQuaternion(tmpQ);
    tmpQ2.copy(root.quaternion).multiply(bind.world.Hips).invert();
    tmpQ.multiply(tmpQ2).multiply(root.quaternion);              // how far the hips are turned from rest, in the world
    const c = line.mix(now).centre;
    return out.set(c[0], c[1], c[2]).applyQuaternion(tmpQ).add(hips.getWorldPosition(tmpV));
  }
  function leanNow() {                                           // forward lean of the hips, in degrees
    hips.getWorldQuaternion(tmpQ);
    tmpQ2.copy(root.quaternion).multiply(bind.world.Hips).invert();
    tmpQ.multiply(tmpQ2);
    tmpV.copy(UP).applyQuaternion(tmpQ).applyQuaternion(tmpQ2.copy(root.quaternion).invert());
    return Math.atan2(tmpV.z, tmpV.y) / DEG;
  }
  const FEET = SKIN.filter((p) => p.foot);
  const contact = { floor: 0, x: 0, z: 0 };                      // what the lowest part of his feet is over: how high that floor is, and where
  function feetLow() {                                           // how high the lowest part of either foot is: the sock itself, not its bones
    let low = Infinity;
    for (const p of FEET) {
      p.mesh.getVertexPosition(p.i, skinV).applyMatrix4(p.mesh.matrixWorld);
      const floor = floorUnder(skinV);
      if (skinV.y - floor < low) { low = skinV.y - floor; contact.floor = floor; contact.x = skinV.x; contact.z = skinV.z; }
    }
    return low;
  }

  // ------------------------------------------------------------ what the buttons do
  function press(which) {
    if (held[which]) return;
    held[which] = true;
    $(which).classList.add('down');
    $('hint').hidden = true;
    if (which === 'jump' && mode === 'ground' && !charging && takeoffAt === Infinity) {
      // no room left behind him for another flip before the wall at the roof's edge: back to his spot first
      const behind = tmpV.set(0, 0, -1).applyQuaternion(root.quaternion).multiplyScalar(2.2).add(root.position);
      if (Math.abs(behind.x) > EDGE || Math.abs(behind.z) > EDGE) { place(spot, true); say('Back to the middle'); }
      holdPose();
      charging = true; chargeAt = now;
      line.plan(now, [[0.18, 'reach'], [0.30, 'charge_full']]);
    }
    if (which === 'stall' && mode === 'ground' && (charging || takeoffAt !== Infinity)) wantStall = true;
    if (mode !== 'air') return;                                  // held before the feet leave, it is picked up at takeoff
    if (which === 'tuck') startTuck();
    if (which === 'stall') startStall();
  }
  function startTuck() {
    if (tucked) return;
    tucked = true; hang = false; landing = 'land_reach'; planned = false;
    line.plan(now, stalled ? flip.fromStall : flip.enter);        // (out of a stall he goes into it quicker)
  }
  // The stall is a pose, not a flip (Krishna, 10 November: "for however long I press it, it should
  // just stall ... I still have to tap tuck in order to complete the whole flip"). While Stall is
  // held he hangs in a long line and leans slowly backward; let go, and he only leaves the pose.
  function startStall() {
    if (tucked || hang) return;
    if (!stalled) stallAt = now;
    stalled = true; hang = true; planned = false; stallUntil = 0;
    line.plan(now, [[0.11, 'layout'], [0.13, 'hang']]);
  }
  function endStall() {
    hang = false;
    if (!planned) line.plan(now, [[0.28, 'layout']]);            // (unhurried: the arms are not whipped back overhead)
  }
  function release(which) {
    if (!held[which]) return;
    held[which] = false;
    $(which).classList.remove('down');
    if (which === 'jump' && charging) {
      charging = false;
      charge = clamp((now - chargeAt - 0.12) / 0.5, 0, 1);       // the longer the crouch, the higher the jump
      line.plan(now, [[0.13, 'swing'], [0.14, 'drive'], [0.13, 'set_tall']]);
      takeoffAt = now + 0.40;
    }
    if (mode !== 'air') return;
    if (which === 'tuck' && tucked && !planned) line.plan(now, flip.exit);
    if (which === 'stall' && hang) stallUntil = Math.max(now, stallAt + 0.15);   // even a tap holds the pose for a moment
  }
  for (const which of ['jump', 'tuck', 'stall']) {
    const el = $(which);
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); press(which); });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(type, () => release(which));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  const KEYS = { Space: 'jump', KeyJ: 'jump', KeyT: 'tuck', KeyF: 'tuck', KeyS: 'stall', KeyG: 'stall' };
  $('flip').addEventListener('click', () => chooseFlip());
  window.addEventListener('keydown', (e) => { if (e.code === 'KeyX' && !e.repeat && e.target.tagName !== 'INPUT') chooseFlip(); });
  window.addEventListener('keydown', (e) => { if (KEYS[e.code]) { e.preventDefault(); press(KEYS[e.code]); } });   // (a key already held does nothing more: press() sees to that)
  window.addEventListener('keyup', (e) => { if (KEYS[e.code]) release(KEYS[e.code]); });
  window.addEventListener('blur', () => ['jump', 'tuck', 'stall'].forEach(release));

  $('menu').addEventListener('click', () => {
    const sheet = $('settings');
    sheet.hidden = !sheet.hidden;
    $('menu').setAttribute('aria-expanded', String(!sheet.hidden));
  });
  const percent = new Intl.NumberFormat(undefined, { style: 'percent' });
  $('jumpPower').addEventListener('input', (e) => { jumpPower = e.target.value / 100; $('jumpPowerOut').textContent = percent.format(jumpPower); });
  $('spinPower').addEventListener('input', (e) => { spinPower = e.target.value / 100; $('spinPowerOut').textContent = percent.format(spinPower); });
  // looking around without a mouse or a finger: the arrow keys swing the camera round him
  const LOOK = { KeyQ: [-6, 0], KeyE: [6, 0], KeyR: [0, -5], KeyV: [0, 5] };
  window.addEventListener('keydown', (e) => {
    if (!LOOK[e.code] || !controls.enableRotate || e.target.tagName === 'INPUT') return;
    e.preventDefault();
    const ball = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    ball.theta += LOOK[e.code][0] * DEG;
    ball.phi = clamp(ball.phi + LOOK[e.code][1] * DEG, controls.minPolarAngle, controls.maxPolarAngle);
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(ball));
  });
  // walking: the arrow keys (Shift to jog) or the stick on the screen
  const ARROW = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
  const arrowsDown = new Set();
  let shiftDown = false;
  const syncArrows = () => {
    let x = 0, y = 0;
    for (const k of arrowsDown) { x += ARROW[k][0]; y += ARROW[k][1]; }
    const m = Math.hypot(x, y) || 1;
    arrows.x = x / m * (shiftDown ? 1 : 0.5); arrows.y = y / m * (shiftDown ? 1 : 0.5);
  };
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    shiftDown = e.shiftKey;
    if (ARROW[e.code]) { e.preventDefault(); arrowsDown.add(e.code); }
    syncArrows();
  });
  window.addEventListener('keyup', (e) => { shiftDown = e.shiftKey; arrowsDown.delete(e.code); syncArrows(); });
  window.addEventListener('blur', () => { arrowsDown.clear(); shiftDown = false; syncArrows(); pad.x = pad.y = 0; });
  {
    const stick = $('stick'), knob = $('knob');
    let id = null;
    const aim = (e) => {
      const r = stick.getBoundingClientRect(), radius = r.width / 2;
      let dx = (e.clientX - r.left - radius) / radius, dy = (r.top + radius - e.clientY) / radius;
      const m = Math.hypot(dx, dy);
      if (m > 1) { dx /= m; dy /= m; }
      const full = Math.min(1, m * 1.15);                        // a full push is a little short of the rim
      pad.x = m > 0 ? dx / Math.min(1, m) * full : 0; pad.y = m > 0 ? dy / Math.min(1, m) * full : 0;
      knob.style.transform = `translate(${dx * radius * 0.5}px, ${-dy * radius * 0.5}px)`;
    };
    const let_go = () => { id = null; pad.x = pad.y = 0; knob.style.transform = ''; };
    stick.addEventListener('pointerdown', (e) => { e.preventDefault(); id = e.pointerId; stick.setPointerCapture(id); $('hint').hidden = true; aim(e); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) aim(e); });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) stick.addEventListener(type, (e) => { if (e.pointerId === id || type === 'lostpointercapture') let_go(); });
    stick.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  $('lock').addEventListener('click', () => {
    const locked = $('lock').getAttribute('aria-pressed') !== 'true';
    $('lock').setAttribute('aria-pressed', String(locked));
    $('lock').textContent = locked ? 'Camera Locked' : 'Lock Camera';
    controls.enableRotate = !locked; controls.enableZoom = !locked;
  });
  $('spot').addEventListener('click', () => {
    if (mode !== 'ground' || charging || takeoffAt !== Infinity) return;
    spot = (spot + 1) % SPOTS.length;
    place(spot);
  });

  // ------------------------------------------------------------ leaving the floor and meeting it again
  function takeoff() {
    mode = 'air'; takeoffAt = Infinity;
    tucked = stalled = planned = hang = false; stallRate = 0; landing = 'land_rise'; twist = 0; twistFrom = null;
    balance(com);
    turn = -leanNow();                                           // the little he is leaning back as the feet leave
    const back = tmpV.set(0, 0, -1).applyQuaternion(root.quaternion);
    // On the roof a jump goes nearly straight up and comes down a foot's length behind. Off a ledge,
    // the longer Jump was held the harder it throws him back and the further he leans: a tap hops on
    // the spot, a full crouch carries him well clear of the edge. (Krishna, 10 November)
    const onLedge = root.position.y > 0.05;
    plainLean = onLedge ? 8 + 14 * charge : 9;
    vel.copy(back).multiplyScalar(onLedge ? 0.2 + 1.1 * charge : 0.45);
    vel.y = (2.45 + 0.95 * charge) * jumpPower;
    if (held.stall || wantStall) { startStall(); if (!held.stall) stallUntil = now + 0.22; }
    else if (held.tuck) startTuck();
    else line.plan(now, [[0.14, 'layout']]);                     // rise in a long line until a button says otherwise
  }

  // ------------------------------------------------------------ falls
  // A landing that is too far out is a fall, and he gets up from it. Which fall depends on how he
  // meets the floor. Too much turn: the feet are down but he keeps going back, so he sits, and
  // with a lot too much he goes on to his back. Short: he pitches forward onto hands and knees,
  // and well short, down on his front. Barely turned, or over on his back: flat on the back.
  const GET_UP = {
    fall_sit: [[0.50, 'land_squat'], [0.06, 'land_squat'], [0.56, 'stand']],
    fall_back: [[0.55, 'fall_sit'], [0.52, 'land_squat'], [0.06, 'land_squat'], [0.56, 'stand']],
    fall_hands: [[0.50, 'land_squat'], [0.06, 'land_squat'], [0.56, 'stand']],
    fall_front: [[0.50, 'fall_hands'], [0.52, 'land_squat'], [0.06, 'land_squat'], [0.56, 'stand']],
  };
  function fallPlan(feetFirst, off, lean) {
    let down;
    if (feetFirst && off > 0) down = off <= 100 ? [[0.30, 'fall_sit']] : [[0.24, 'fall_sit'], [0.26, 'fall_back']];
    else if (feetFirst && lean > 0) down = off >= -70 ? [[0.26, 'fall_hands']] : [[0.20, 'fall_hands'], [0.24, 'fall_front']];
    else if (lean <= (feetFirst ? 0 : -35)) down = [[0.22, 'fall_back']];        // on his back, or coming down head first
    else if (lean < 25) down = [[0.26, 'fall_sit']];                             // upright, but the seat got there first
    else down = lean <= 125 && off >= -70 ? [[0.24, 'fall_hands']] : [[0.22, 'fall_front']];
    // feet that are down stay where they are; otherwise he lies where his hips came down
    const anchor = feetFirst && (down[0][1] === 'fall_sit' || down[0][1] === 'fall_hands') ? 'toes' : 'hips';
    const lie = down[down.length - 1][1];
    const some = () => 0.9 + 0.2 * Math.random();                // no two falls quite alike
    const still = (lie === 'fall_back' || lie === 'fall_front' ? 0.60 : 0.32) * (0.8 + 0.5 * Math.random());
    return { down, rest: [[still, lie], ...GET_UP[lie]].map(([seconds, name]) => [seconds * some(), name]), lie, anchor };
  }

  // He cannot end up inside a platform he came down beside: he is slid out of it, the short way.
  function clearOfPlatforms(dt, rate = 6) {
    hips.getWorldPosition(tmpV);
    const hx = tmpV.x, hz = tmpV.z;
    for (const b of ALL_BLOCKS) {
      if (hx < b.minX - 1.5 || hx > b.maxX + 1.5 || hz < b.minZ - 1.5 || hz > b.maxZ + 1.5) continue;     // nowhere near it
      // he is on top of this one (his weight over it, his feet at its height): nothing to clear
      if (root.position.y > b.top - 0.25 && weight.x > b.minX && weight.x < b.maxX && weight.z > b.minZ && weight.z < b.maxZ) continue;
      const ways = [[hx - b.minX, -1, 0], [b.maxX - hx, 1, 0], [hz - b.minZ, 0, -1], [b.maxZ - hz, 0, 1]];
      const [, wx, wz] = ways.reduce((best, way) => (way[0] < best[0] ? way : best));
      let need = 0;
      for (const p of SKIN) {
        p.mesh.getVertexPosition(p.i, skinV).applyMatrix4(p.mesh.matrixWorld);
        if (skinV.y > b.top - 0.02 || skinV.x <= b.minX || skinV.x >= b.maxX || skinV.z <= b.minZ || skinV.z >= b.maxZ) continue;
        need = Math.max(need, wx < 0 ? skinV.x - b.minX : wx > 0 ? b.maxX - skinV.x : wz < 0 ? skinV.z - b.minZ : b.maxZ - skinV.z);
      }
      if (need > 0) {
        const go = Math.min(need + 0.01, rate * dt);
        root.position.x += wx * go; root.position.z += wz * go;
        toesAt.x += wx * go; toesAt.z += wz * go;                // (his feet go with him: they are not pinned inside the block)
        pin.at.x += wx * go; pin.at.z += wz * go;
      }
    }
  }

  // A step. The poses are all written about one spot on the floor; a step moves that spot. When the
  // stepping foot comes down, the spot goes under that foot and everything already said about the
  // old spot is said again about the new one, so nothing of him moves on the screen and the
  // movement runs on through the step without stopping. That foot is then the one that stays put
  // while the other follows it.
  function stepDown() {
    const { foot } = stepQueue.shift();
    root.updateMatrixWorld(true);
    const footAt = bones[foot].getWorldPosition(new THREE.Vector3());
    const rest = toeRestOf[foot].clone().applyQuaternion(root.quaternion);
    const shift = new THREE.Vector3(footAt.x - rest.x - root.position.x, 0, footAt.z - rest.z - root.position.z);
    root.position.add(shift);
    const local = shift.clone().applyQuaternion(tmpQ2.copy(root.quaternion).multiply(hipsParentQ).invert());
    for (const key of line.keys) if (key.t <= now + 1e-6) key.hips = [key.hips[0] - local.x, key.hips[1] - local.y, key.hips[2] - local.z];
    line.set(line.keys);
    pin.foot = foot; pin.at.copy(footAt);
    stepAt = stepQueue.length ? stepQueue[0].at : Infinity;
    root.updateMatrixWorld(true);
  }

  function touchdown(feetFirst, handsFirst = false) {
    const lean = ((((360 - turn) % 360) + 540) % 360) - 180;     // what is left of the turn, as a forward lean
    const off = turn - wanted(landing);                          // degrees past (or short of) the turn this landing wants
    // How it went. A flip that comes round close enough is stuck; a little out, he fights for it;
    // further, a foot has to step out to catch him (back if he has turned too far, forward if not
    // far enough); further still he stumbles (two steps back, or his hands go down); past that he
    // falls. A plain jump has no flip to judge.
    const miss = Math.abs(off);
    grade = !feetFirst ? 'fall' : landing === 'land_rise' ? (miss <= 45 ? 'stick' : 'fall')
      : miss <= 14 ? 'stick' : miss <= 26 ? 'fought' : miss <= 44 ? 'step' : miss <= 60 ? 'stumble' : 'fall';
    if (handsFirst && grade !== 'fall' && off < 0) grade = 'stumble';   // hands down before the feet is a stumble, however little he was short
    const clean = grade !== 'fall';
    const leftOver = ((lean - line.mix(now).lean + 540) % 360) - 180;
    const hipsWas = hips.getWorldPosition(new THREE.Vector3());
    const fall = clean ? null : fallPlan(feetFirst, off, lean);
    if (!fall || fall.anchor === 'toes') {
      // stand the root under the feet where they came down
      const toes = bones.LeftToeBase.getWorldPosition(new THREE.Vector3()).add(bones.RightToeBase.getWorldPosition(tmpV)).multiplyScalar(0.5);
      tmpV.copy(toeRest).applyQuaternion(root.quaternion);
      root.position.set(toes.x - tmpV.x, floorUnder(toes), toes.z - tmpV.z);
      toesAt.copy(toes);
      if (feetFirst && !handsFirst && contact.floor > 0.01) {
        // His feet came down on a platform. Then that is where he stands, all of him: with his toes on
        // its very edge the middle of his feet was just off it, the roof below was taken for his floor,
        // and he dropped to it in one frame. He is stood on the platform, a foot's breadth in from its edge.
        const b = BOXES.find((box) => Math.abs(box.top - contact.floor) < 1e-6 && contact.x > box.minX - 0.02 && contact.x < box.maxX + 0.02 && contact.z > box.minZ - 0.02 && contact.z < box.maxZ + 0.02);
        if (b) {
          const x = clamp(root.position.x, b.minX + 0.08, b.maxX - 0.08), z = clamp(root.position.z, b.minZ + 0.08, b.maxZ - 0.08);
          toesAt.x += x - root.position.x; toesAt.z += z - root.position.z;
          root.position.set(x, b.top, z);
        }
      }
    } else {
      // he lies where he came down, carried on a hand's breadth by what speed he had
      root.position.set(0, 0, 0); root.updateMatrixWorld(true);
      const lying = hips.parent.localToWorld(new THREE.Vector3(...poses[fall.lie].hips));
      const x = hipsWas.x + vel.x * 0.15, z = hipsWas.z + vel.z * 0.15;
      root.position.set(x - lying.x, floorUnder(hipsWas), z - lying.z);
    }
    root.updateMatrixWorld(true);
    touchdownAt = now;
    if (fall) {
      mode = 'fall'; lastFall = fall.lie; drop = Math.max(0, -vel.y);
      // he goes down as fast as he is falling: the time it takes his hips to drop to where they will lie
      const lieY = hips.parent.localToWorld(new THREE.Vector3(...poses[fall.down[0][1]].hips)).y;
      const h = Math.max(0, hipsWas.y - lieY);
      const fallTime = clamp((-drop + Math.sqrt(drop * drop + 2 * G * h)) / G * 1.25, 0.16, fall.down[0][0]);
      const steps = [...fall.down.map(([seconds, name], k) => [k ? seconds : fallTime, name]), ...fall.rest];
      const back = tmpQ2.copy(root.quaternion).multiply(hipsParentQ).invert();
      line.plan(now, steps, {
        q: hips.quaternion.toArray(), qDot: hipsQDot.map((v) => v * 0.5),          // the floor takes half the turn out of him
        hips: hips.parent.worldToLocal(hipsWas.clone()).toArray(),
        hipsDot: tmpV.set(vel.x * 0.5, 0, vel.z * 0.5).applyQuaternion(back).toArray(),
        lean,
      });
      hips.position.copy(hips.parent.worldToLocal(hipsWas.clone()));   // the floor under him moved, he did not: for this frame he is exactly where he was
      root.updateMatrixWorld(true);
      const under = bodyLow(true);                               // ...less whatever of him had gone into the floor: that is the floor stopping him
      if (under < 0) { root.position.y -= under; root.updateMatrixWorld(true); }
      say(landing === 'land_rise' ? 'No tuck, no flip' : off < 0 ? 'Short of the turn' : 'Too much turn', true);
      return;
    }
    mode = 'landing';
    settle.lean = clamp(leftOver, -80, 80);
    settle.twist = twist > 0.01 && twist < 359.99 ? (twist > 180 ? twist - 360 : twist) : 0;   // a full not quite twisted round: he finishes turning on his feet, as in the clip
    pin.foot = null; stepAt = Infinity; stepQueue = [];
    const some = () => 0.92 + 0.16 * Math.random();              // no two recoveries quite alike
    const vary = (steps) => steps.map(([seconds, name]) => [seconds * some(), name]);
    const squat = landing === 'squat_reach';
    // (turned too far, he is more upright than the landing's own fold: he does not bow forward into
    // it first, he goes straight to taking his weight)
    const over = off > 14;
    // (Krishna, 11 November, on the layout clip: "when the person is landing, he squats a bit first, and
    // then his torso and legs ... goes right back to standing, like with his torso and his knees and
    // everything getting straight together. And in our game, as soon as the character's toes touch the
    // ground, the back goes straight. Do not do that." So every flip's landing goes down into a squat
    // with the chest still forward, waits a moment, and comes up in one movement.)
    const down = squat ? [[0.05, 'squat_reach'], [0.14, 'land_squat']] : over ? [] : [[0.05, 'land_reach']];
    const up = [[0.26, 'land_rise'], [0.28, 'stand']];
    let stepping = [];                                           // [pose, the foot that steps in it]
    if (grade === 'step' || grade === 'stumble') {
      if (off > 0) {
        // still going backward: the right foot steps back to catch him; in a stumble the left follows
        stepping = grade === 'stumble' ? [['step_back_r', 'RightToeBase'], ['step_back_l', 'LeftToeBase']] : [['step_back_r', 'RightToeBase']];
        line.plan(now, vary([...down, ...(squat ? [] : [[0.16, 'land_sink']]), [0.20, 'step_back_r'], ...(grade === 'stumble' ? [[0.24, 'step_back_l']] : []), ...up]));
      } else if (grade === 'step') {
        // pitching forward: the right foot steps forward under him
        stepping = [['step_fwd_r', 'RightToeBase']];
        line.plan(now, vary([...down, [0.22, 'step_fwd_r'], ...up]));
      } else {
        // further forward than a step can catch: both hands go down, and he pushes back up off them
        line.plan(now, vary([...down, [0.22, 'stumble_hands'], [0.12, 'stumble_hands'], [0.30, 'land_squat'], [0.08, 'land_squat'], [0.50, 'stand']]));
      }
      stepQueue = stepping.map(([name, foot]) => ({ foot, at: line.keys.find((key) => key.name === name && key.t > now).t }));
    } else {
      line.plan(now, squat
        ? [[0.05, 'squat_reach'], [0.14, 'land_squat'], [0.12, 'land_squat'], [0.50, 'stand']]
        : landing === 'land_rise'
          ? [[0.04, 'land_rise'], [0.15, 'land_sink'], [0.05, 'land_sink'], [0.40, 'stand']]   // a plain jump: the knees give, then he stands
          : over || landing === 'land_sink' ? [[0.20, 'land_sink'], [0.08, 'land_sink'], [0.42, 'stand']]   // (turned too far, or laid out to the floor: he comes down more upright, so the squat is a shallow one)
            : [[0.05, 'land_reach'], [0.17, 'land_deep'], [0.18, 'land_deep'], [0.50, 'stand']]);   // (the clip: down in 0.13 s, low for about 0.2 s, up in 0.5 s)
    }
    // (a plain jump is not a trick: nothing is said about it)
    if (landing !== 'land_rise') say({ stick: 'Clean landing', fought: 'Landed', step: 'Stepped out', stumble: 'Stumbled' }[grade]);
    {
      // What is left of the turn is measured against the pose he is really in at this instant (the
      // poses' own leans, joined in a straight line, were a few degrees out, and his whole body
      // jumped by that much on the next frame).
      const airQ = hips.quaternion.clone();
      line.bone('Hips', now, arr4);
      hips.quaternion.set(arr4[0], arr4[1], arr4[2], arr4[3]);
      settle.lean = clamp(((lean - leanNow() + 540) % 360) - 180, -80, 80);
      hips.quaternion.copy(airQ);
    }
    // keep the hips where they were for this frame, and let the difference melt away
    line.hips(now, arr3);
    hips.position.set(arr3[0], arr3[1], arr3[2]);
    hips.updateWorldMatrix(true, false);
    settle.at.copy(hipsWas).sub(hips.getWorldPosition(tmpV));
    // for this frame he is exactly where he was, less whatever of his feet had gone into the floor
    const toLocal = tmpQ2.copy(root.quaternion).multiply(hipsParentQ).invert();
    hips.position.add(tmpV.copy(settle.at).applyQuaternion(toLocal));
    root.updateMatrixWorld(true);
    const low = feetLow();
    if (low < 0) { settle.at.y -= low; hips.position.add(tmpV.set(0, -low, 0).applyQuaternion(toLocal)); }
    if (stepQueue.length) {
      // the first step: the other foot is the one that stays where it came down
      root.updateMatrixWorld(true);
      pin.foot = stepQueue[0].foot === 'RightToeBase' ? 'LeftToeBase' : 'RightToeBase';
      bones[pin.foot].getWorldPosition(pin.at);
      stepAt = stepQueue[0].at;
    }
  }

  // ------------------------------------------------------------ every frame
  let lastTime = performance.now();
  const follow = new THREE.Vector3(0, 1.0, 0.4), lead = new THREE.Vector3();
  const turnQ = new THREE.Quaternion(), worldQ = new THREE.Quaternion();

  function frame(_time, _xr, fixed) {
    const stamp = performance.now();
    const dt = fixed ?? clamp((stamp - lastTime) / 1000, 1 / 240, 1 / 30);   // never zero: the cloth divides by it
    lastTime = stamp;
    now += dt;

    onFoot = mode === 'ground' || mode === 'climb';
    if (mode === 'ground' && now >= takeoffAt) { root.updateMatrixWorld(true); takeoff(); }
    if (mode === 'ground' && !charging && takeoffAt === Infinity) walkStep(dt);
    if (mode === 'landing' && now >= stepAt) stepDown();
    if (mode === 'climb' && now > line.end + 0.02) endClimb();
    if ((mode === 'landing' || mode === 'fall') && now > line.end + 0.05) { mode = 'ground'; pin.foot = null; }
    if (mode !== 'ground') wantStall = false;

    // where his weight is: over his balance point in the air, over his hips in a fall, over his feet otherwise
    if (mode === 'air') weight.copy(com); else if (mode === 'fall') hips.getWorldPosition(weight); else weight.copy(root.position);
    const sinceLanding = now - touchdownAt;
    const trail = mode === 'air' ? 0 : ramp(sinceLanding / 0.28) * ((mode === 'ground' || mode === 'climb') && sinceLanding >= 2 ? 0 : 1);
    airBlend = clamp(airBlend + (mode === 'air' ? dt : -dt) / 0.08, 0, 1);    // what only happens in the air comes and goes over a moment
    const inAir = airBlend;
    pose(inAir, trail);
    alive(inAir, sinceLanding);

    if (mode === 'air') {
      // gravity, and a turn as fast as the body's shape allows
      if (hang && !held.stall && now >= stallUntil) endStall();
      vel.y -= G * (hang && held.stall ? FLOAT : 1) * dt;      // (the float: gravity is eased only while Stall is held)
      com.addScaledVector(vel, dt);
      const m = line.mix(now);
      let rate = spinPush * spinPower * (m.gain / m.inertia);
      const plain = !tucked && !stalled;
      if (plain) {
        // A jump with no flip in it: he leans back a little as he rises and comes upright again for
        // his feet. It is Tuck (or Stall) that adds the turn.
        const left = vel.y < 0 ? timeToFloor('land_rise') : Infinity;
        const upright = left < 0.28;
        rate = ((upright ? 2 : plainLean) - turn) * 7;
        // and his arms come down from overhead in good time, not in the last instant
        if (upright && !planned) { planned = true; landing = 'land_rise'; line.plan(now, [[Math.max(left, 0.2), 'land_rise']]); }
      }
      if (stalled && !tucked) {
        // The stall leans him backward slowly, toward flat, and never past it. It does not flip him:
        // only Tuck does that.
        if (hang) stallRate = STALL_LEAN * ramp((now - stallAt) / 0.3) * clamp((92 - turn) / 30, 0, 1);
        else stallRate *= Math.exp(-dt / 0.15);                  // let go, the lean dies away: he stays as far over as he had got
        rate = stallRate;
        // Let go in time (not yet 40 degrees over), he gets his feet back under him as in a plain
        // jump, arms coming down in good time. Further over than that there is no saving it.
        const left = vel.y < 0 ? timeToFloor('land_rise') : Infinity;
        if (!hang && left < 0.28 && turn <= 40) {
          rate = (4 - turn) * 6;
          if (!planned) { planned = true; landing = 'land_rise'; line.plan(now, [[Math.max(left, 0.2), 'land_rise']]); }
        }
      }
      turn += rate * dt;
      // A full: he twists once round his own length while he goes over. Read off the clip: the twist
      // starts as his feet leave, is half done by a quarter of the way over and all but done before he
      // opens for the floor. Here it runs from the moment the button goes down to 280 degrees of turn
      // (or a third of a turn later, if the button came late), fast first and easing to its end.
      if (flip.twist && tucked) {
        if (twistFrom === null) twistFrom = turn;
        const part = clamp((turn - twistFrom) / Math.max(280 - twistFrom, 120), 0, 1);
        const want = 360 * (1 - (1 - part) * (1 - part));
        twist = Math.max(twist, twist + (want - twist) * (1 - Math.exp(-dt / 0.05)));     // (it winds up over a moment: no jump when the button goes down)
      }
      turnQ.setFromAxisAngle(X_AXIS, -turn * DEG);
      worldQ.copy(root.quaternion).multiply(turnQ);              // the whole body, turned backward about its own middle
      if (twist > 0.01 && twist < 359.99) worldQ.multiply(tmpQ.setFromAxisAngle(UP, twist * DEG));
      tmpV.set(m.centre[0], m.centre[1], m.centre[2]).applyQuaternion(worldQ);
      const hipsWorld = com.clone().sub(tmpV);
      hips.parent.worldToLocal(hipsWorld);
      hips.position.copy(hipsWorld);
      hips.quaternion.toArray(hipsQBefore);
      hips.quaternion.copy(tmpQ.copy(root.quaternion).multiply(hipsParentQ).invert()).multiply(worldQ).multiply(bind.world.Hips);
      {
        const q = hips.quaternion, same = q.x * hipsQBefore[0] + q.y * hipsQBefore[1] + q.z * hipsQBefore[2] + q.w * hipsQBefore[3] < 0 ? -1 : 1;
        [q.x, q.y, q.z, q.w].forEach((v, i) => { hipsQDot[i] = (v - same * hipsQBefore[i]) / dt; });
      }

      // get ready for the floor a moment before it arrives
      // (a tucked body meets the floor lower down, in a squat, so it has longer left than an open one)
      const toFloor = vel.y < 0 ? timeToFloor(tucked && held.tuck ? flip.held : tucked ? 'land_reach' : 'land_rise') : Infinity;
      if (!planned && toFloor < 0.26) {
        // a quarter of a second out he can see whether he is anywhere near his feet; if not, he braces
        // for the floor in good time instead of snapping into it at the last instant
        const hope = tucked && held.tuck ? flip.held : tucked ? landing : 'land_rise';
        // (He only gives up this early if it cannot be saved: short even if he keeps turning as fast
        // as he is, or too far round even if he opened out this instant. Otherwise he carries on,
        // and the last tenth of a second decides. Guessing a fall from the tucked speed alone made
        // him brace for one he then did not have, and snap back.)
        const slow = spinPush * spinPower * (GAIN.land_reach / poses.land_reach.inertia);
        const fast = tucked && held.tuck ? Math.max(rate, tuckRate()) : rate;   // (a tuck still coming in will be at full speed)
        const most = plain ? turn : turn + fast * toFloor, least = plain ? turn : turn + Math.min(rate, slow) * toFloor;
        const limit = tucked ? 100 : 45;                         // (with no tuck there is no coming round: leaning back past 45 degrees he is going down)
        const short = most - wanted(hope) < -limit, far = least - wanted(hope) > limit;
        const turnThen = short ? most : least;
        const offThen = turnThen - wanted(hope);
        const leanThen = ((((360 - turnThen) % 360) + 540) % 360) - 180;
        if (short || far) {
          planned = true; landing = hope;
          line.plan(now, [[Math.max(toFloor, 0.16), offThen > 0 || leanThen <= 0 ? 'fall_back' : 'fall_front']]);
        }
      }
      if (!planned && toFloor < 0.10) {
        planned = true;
        if (tucked && held.tuck) landing = flip.held;           // still tucked: it can only land in a squat (still laid out: on straight legs)
        if (!tucked) landing = 'land_rise';
        // if he can see he is nowhere near his feet, he braces for the floor instead of reaching for it
        const turnThen = plain ? turn : turn + rate * toFloor;
        const offThen = turnThen - wanted(landing);
        const leanThen = ((((360 - turnThen) % 360) + 540) % 360) - 180;
        // (coming round too far he does not fold forward for the floor: he reaches for it more upright,
        // which is also the shape his landing goes on from)
        const reach = offThen > 14 && landing === 'land_reach' ? 'land_sink' : landing;
        const brace = Math.abs(offThen) <= (tucked ? 100 : 45) ? reach : (offThen > 0 || leanThen <= 0 ? 'fall_back' : 'fall_front');
        line.plan(now, [[Math.max(toFloor, 0.04), brace]]);
      }
      root.updateMatrixWorld(true);
      // A block's side is solid in the air too. (Now that he can walk anywhere, he can flip with a ledge
      // close behind him: he went into it and came out of its side.) Whatever part of him is inside a
      // block, well below its top, is put back out the way he came, and he loses his speed that way.
      for (const b of ALL_BLOCKS) {
        if (com.x < b.minX - 1.6 || com.x > b.maxX + 1.6 || com.z < b.minZ - 1.6 || com.z > b.maxZ + 1.6) continue;
        // (over the block, he is coming down on it or leaving it: its top is a floor, which the landing sees to)
        const overIt = com.x > b.minX && com.x < b.maxX && com.z > b.minZ && com.z < b.maxZ;
        const ways = [[com.x - b.minX, -1, 0], [b.maxX - com.x, 1, 0], [com.z - b.minZ, 0, -1], [b.maxZ - com.z, 0, 1]];
        const [, wx, wz] = ways.reduce((best, way) => (way[0] < best[0] ? way : best));
        let need = 0;
        for (const p of SKIN) {
          p.mesh.getVertexPosition(p.i, skinV).applyMatrix4(p.mesh.matrixWorld);
          if (skinV.y > b.top - (overIt ? 0.25 : 0.03) || skinV.x <= b.minX || skinV.x >= b.maxX || skinV.z <= b.minZ || skinV.z >= b.maxZ) continue;
          need = Math.max(need, wx < 0 ? skinV.x - b.minX : wx > 0 ? b.maxX - skinV.x : wz < 0 ? skinV.z - b.minZ : b.maxZ - skinV.z);
        }
        if (need > 0) {
          const go = Math.min(need + 0.005, 9 * dt);
          com.x += wx * go; com.z += wz * go;
          hips.position.add(tmpV.set(wx * go, 0, wz * go).applyQuaternion(tmpQ2.copy(root.quaternion).multiply(hipsParentQ).invert()));
          const inward = -(vel.x * wx + vel.z * wz);
          if (inward > 0) { vel.x += wx * inward; vel.z += wz * inward; }
          root.updateMatrixWorld(true);
        }
      }
      if (vel.y < 0 && now >= dropGrace) {
        // Coming down a little short, chest toward the floor, his hands reach it a moment before his
        // feet. That is a stumble on to the hands, not a fall, so while his feet are nearly down the
        // hands do not count as landing on something else.
        const leanDown = ((((360 - turn) % 360) + 540) % 360) - 180;
        const handsLead = tucked && leanDown > 0 && leanDown < 132 && feetLow() < 0.3;
        if (feetLow() <= 0) touchdown(true);
        else if (handsLead && bodyLow(false) <= 0 && bodyLow(false, false) > 0) touchdown(true, true);   // his hands are down first, his feet a moment behind
        else if (bodyLow(false) <= 0) touchdown(false);          // something other than the feet got there first
      }
    } else {
      line.hips(now, arr3);
      if (mode === 'ground' && loco.blend > 0.002) {
        walkLoop.hips(loco.phase, hipsA);
        if (loco.jog > 0.002) { jogLoop.hips(loco.phase, hipsB); for (let i = 0; i < 3; i++) hipsA[i] += (hipsB[i] - hipsA[i]) * loco.jog; }
        for (let i = 0; i < 3; i++) arr3[i] += (hipsA[i] - arr3[i]) * loco.blend;
      }
      hips.position.set(arr3[0], arr3[1], arr3[2]);
      if (mode === 'landing') {
        // melt away what was left over at touchdown: the lean and the small jump in place
        // what was left of the turn rocks out of him: quickly after a good landing; after a rough one
        // he sways past upright once before he has it
        // (deep in a squat there is no room to sway, and a step takes the place of one)
        const rough = landing === 'squat_reach' || grade === 'step' || grade === 'stumble' ? 0 : Math.min(1, Math.abs(settle.lean) / 40);
        const fade = Math.exp(-sinceLanding / (0.11 + 0.16 * rough)) * Math.cos(Math.PI * Math.min(sinceLanding, 0.84) / 0.42 * rough);
        if (Math.abs(settle.lean * fade) > 0.05) {
          tmpQ.setFromAxisAngle(X_AXIS, settle.lean * fade * DEG);
          hips.quaternion.premultiply(tmpQ2.copy(hipsParentQ).invert().multiply(tmpQ).multiply(hipsParentQ));
        }
        if (Math.abs(settle.twist) > 0.05) {
          // (about his own length: in the hips' own frame, as the twist was in the air)
          tmpQ.setFromAxisAngle(UP, settle.twist * Math.exp(-sinceLanding / 0.09) * DEG);
          hips.quaternion.multiply(tmpQ2.copy(bind.world.Hips).invert().multiply(tmpQ).multiply(bind.world.Hips));
        }
        tmpV.copy(settle.at).multiplyScalar(Math.exp(-sinceLanding / 0.06));
        hips.position.add(tmpV.applyQuaternion(tmpQ2.copy(root.quaternion).multiply(hipsParentQ).invert()));
        // his feet stay where they came down: he sways over them, they do not slide under him
        root.updateMatrixWorld(true);
        // (during a step it is the one planted foot that stays; the other is on its way)
        const stay = pin.foot ? pin.at : toesAt;
        if (pin.foot) bones[pin.foot].getWorldPosition(tmpV);
        else bones.LeftToeBase.getWorldPosition(tmpV).add(bones.RightToeBase.getWorldPosition(skinV)).multiplyScalar(0.5);
        hips.position.add(tmpV.set(stay.x - tmpV.x, 0, stay.z - tmpV.z).applyQuaternion(tmpQ2.copy(root.quaternion).multiply(hipsParentQ).invert()));
      }
      // keep the lower foot exactly on the floor while the poses blend
      root.updateMatrixWorld(true);
      // no part of him inside a block: on landing and in a fall, and standing too (a crouch beside a wall put his head and hands in it)
      if (mode !== 'climb') { clearOfPlatforms(dt, mode === 'ground' ? 2.5 : 6); root.updateMatrixWorld(true); }
      if (mode === 'climb') {
        placeClimb(dt);                                          // (a climb is held by what is planted, not by the floor)
      } else if (mode === 'fall') {
        // in a fall, whatever part of him is lowest rests on the floor; over nothing, he drops to it
        const low = bodyLow(true);
        if (low > 0.004) { drop += G * dt; root.position.y -= Math.min(low, drop * dt); }
        else { drop = 0; root.position.y -= Math.max(low, -7.0 * dt); }   // pressed into the floor, he comes out of it over a frame or two: no jump
      } else {
        let low = feetLow();
        if (mode === 'landing' || loco.blend > 0.002) low = Math.min(low, bodyLow(false));   // and no other part of him goes into the floor either (hands that came down first hold him up until his feet arrive; a trouser cuff when a heel kicks up)
        if (Math.abs(low) > 0.002) hips.position.add(tmpV.set(0, -low, 0).applyQuaternion(tmpQ2.copy(root.quaternion).multiply(hipsParentQ).invert()));
      }
    }

    root.updateMatrixWorld(true);
    // the shirt rides up in the air; on the floor it sits at the waist
    cloth.rise += ((mode === 'air' ? 1 : 0.25) - cloth.rise) * (1 - Math.exp(-dt / (mode === 'air' ? 0.12 : 0.25)));
    {
      // Folded at the waist (a crouch, a squat, a tuck) the trousers are drawn down over the seat and
      // the lower back would show in a ragged strip. A shirt has slack: its hem comes down with them.
      hips.getWorldQuaternion(tmpQ);
      const down = tmpV.set(0, -1, 0).applyQuaternion(tmpQ.multiply(tmpQ2.copy(bind.world.Hips).invert()));
      let fold = 0;
      for (const side of ['Left', 'Right']) {
        const thigh = bones[`${side}Leg`].getWorldPosition(lead).sub(bones[`${side}UpLeg`].getWorldPosition(skinV)).normalize();
        fold += Math.acos(clamp(thigh.dot(down), -1, 1)) / DEG / 2;
      }
      cloth.tug += (0.10 * ramp((fold - 45) / 70) - cloth.tug) * (1 - Math.exp(-dt / 0.05));
    }
    cloth.step(dt);
    underShown.value = ramp((cloth.slide - 0.03) / 0.05);        // skin shows only where the shirt has slid up off it
    root.updateMatrixWorld(true);

    // the camera stays on him
    // (over his feet on the ground, so a crouch does not sway the picture; on his balance point in the air)
    hips.getWorldPosition(lead);
    const eye = Math.max(lead.y, root.position.y + 0.9);
    if (mode === 'air') lead.copy(com); else if (mode !== 'fall') lead.copy(root.position);
    lead.y = eye + aimLift;
    const move = lead.sub(follow).multiplyScalar(snapCamera ? 1 : 1 - Math.exp(-dt / 0.12));
    snapCamera = false;
    follow.add(move);
    camera.position.add(move);
    controls.target.copy(follow);
    controls.update();
    sun.target.position.copy(follow);
    sun.position.set(follow.x - 7, follow.y + 4.6, follow.z + 4);
    // A block between the camera and him would hide him. It turns to glass while it is in the way, so
    // he is always in view and the camera never has to jump. (Bringing the camera in instead gave a
    // close-up of his arm whenever he stood by a wall.)
    {
      const dx = camera.position.x - follow.x, dy = camera.position.y - follow.y, dz = camera.position.z - follow.z;
      for (const b of ALL_BLOCKS) {
        let enter = 0, leave = 1;
        for (const [o, d, lo, hi] of [[follow.x, dx, b.minX - 0.1, b.maxX + 0.1], [follow.y, dy, -1, b.top + 0.1], [follow.z, dz, b.minZ - 0.1, b.maxZ + 0.1]]) {
          if (Math.abs(d) < 1e-9) { if (o <= lo || o >= hi) { enter = 2; break; } continue; }
          const t1 = (lo - o) / d, t2 = (hi - o) / d;
          enter = Math.max(enter, Math.min(t1, t2)); leave = Math.min(leave, Math.max(t1, t2));
        }
        b.seen += ((enter < leave ? 0.22 : 1) - b.seen) * (1 - Math.exp(-dt / 0.14));
        const glass = b.seen < 0.985;
        if (b.mesh.material.transparent !== glass) { b.mesh.material.transparent = glass; b.mesh.material.depthWrite = !glass; b.mesh.material.needsUpdate = true; }
        b.mesh.material.opacity = glass ? b.seen : 1;
      }
    }
    renderer.render(scene, camera);
  }

  // let the clothes settle before the first picture
  root.updateMatrixWorld(true);
  pose(0, 0);
  line.hips(now, arr3); hips.position.set(arr3[0], arr3[1], arr3[2]);
  root.updateMatrixWorld(true);
  for (let i = 0; i < 30; i++) cloth.step(1 / 30);

  renderer.setAnimationLoop(frame);
  $('cover').classList.add('gone');
  window.__game = { get mode() { return mode; }, get turn() { return turn; }, get slide() { return cloth.slide; }, get height() { return hips.getWorldPosition(new THREE.Vector3()).y; }, get low() { return feetLow(); }, get lean() { return leanNow(); }, get fall() { return lastFall; }, get samples() { return SKIN.length; }, get at() { return root.position.toArray().map((v) => +v.toFixed(2)); }, bodyLow, landHeight, set lift(v) { aimLift = v; }, set pose(name) { line.plan(now, [[0.3, name], [1000, name]]); }, get state() { return { tucked, stalled, hang, planned, landing, grade, held: { ...held }, now: +now.toFixed(3) }; }, lowest: () => { let best = null; for (const p of SKIN) { p.mesh.getVertexPosition(p.i, skinV).applyMatrix4(p.mesh.matrixWorld); const h = skinV.y - floorUnder(skinV); if (!best || h < best[0]) best = [+h.toFixed(3), p.name]; } return best; },
    step: (dt = 1 / 60) => frame(0, null, dt), press, release, poses, line, bones, loco, pad, arrows, walkLoop, jogLoop, STEP, move: (v) => { pad.x = v[0]; pad.y = v[1]; }, put: ([x, z]) => { root.position.set(x, groundAt(x, z), z); loco.yaw = 0; loco.speed = 0; loco.blend = 0; root.quaternion.identity(); cloth.reset(); }, walk: ([yaw, mag]) => { aimYaw = yaw === null ? null : yaw * DEG; pad.x = 0; pad.y = mag; }, contact: () => { let best = null; for (const p of FEET) { p.mesh.getVertexPosition(p.i, skinV).applyMatrix4(p.mesh.matrixWorld); if (!best || skinV.y < best.y) best = { x: skinV.x, y: skinV.y, z: skinV.z, name: p.name }; } return best; }, get yaw() { return loco.yaw; }, get climbing() { return !!climb; }, set flip(id) { chooseFlip(id); }, pick: (id) => chooseFlip(id), get flip() { return flip.id; }, get twist() { return twist; }, tuckRate,
    // how deep the deepest part of him is inside a block or the roof, which part, and what it is in
    inside: () => { let worst = [0, '', '']; root.updateMatrixWorld(true); for (const p of SKIN) { p.mesh.getVertexPosition(p.i, skinV).applyMatrix4(p.mesh.matrixWorld); if (-skinV.y > worst[0]) worst = [-skinV.y, p.name, 'roof']; for (const b of ALL_BLOCKS) { if (skinV.y >= b.top || skinV.x <= b.minX || skinV.x >= b.maxX || skinV.z <= b.minZ || skinV.z >= b.maxZ) continue; const d = Math.min(skinV.x - b.minX, b.maxX - skinV.x, skinV.z - b.minZ, b.maxZ - skinV.z, b.top - skinV.y); if (d > worst[0]) worst = [d, p.name, `block ${b.top}`]; } } return [+worst[0].toFixed(3), worst[1], worst[2]]; },
    render: () => renderer.render(scene, camera), blocks: ALL_BLOCKS, camera, controls, root, scene, cloth };
}

main().catch((error) => {
  console.error(error);
  $('coverText').textContent = 'The rooftop could not load. Reload the page to try again.';
});
