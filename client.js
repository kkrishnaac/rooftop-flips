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
const VERSION = 3;

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
sun.shadow.camera.left = -6; sun.shadow.camera.right = 6; sun.shadow.camera.top = 6; sun.shadow.camera.bottom = -6;
sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 30;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const rim = new THREE.DirectionalLight(0xa9c2ff, 1.1);          // so black clothes keep an edge against the sky
rim.position.set(5, 3, -6);
scene.add(rim);

// ---------------------------------------------------------------- the rooftop
const concrete = new THREE.MeshStandardMaterial({ color: 0x8f8b86, roughness: 0.95 });
const pale = new THREE.MeshStandardMaterial({ color: 0xb9b3ab, roughness: 0.9 });
const dark = new THREE.MeshStandardMaterial({ color: 0x4b4d57, roughness: 1.0 });
const BOXES = [];                                               // things to stand on: {minX, maxX, minZ, maxZ, top}
function block(x, z, w, d, h, material, standOn = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, h / 2, z);
  m.castShadow = true; m.receiveShadow = true;
  scene.add(m);
  if (standOn) BOXES.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: h });
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
function floorUnder(p) {
  let top = 0;
  for (const b of BOXES) {
    if (weight.x <= b.minX || weight.x >= b.maxX || weight.z <= b.minZ || weight.z >= b.maxZ) continue;
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
      if (s.rides) pivot.addScaledVector(axis, slide);
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
      this.slide = clamp(pull.copy(this.slideAt).sub(base).dot(sl.axis), 0, this.data.slide.limit);
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
    slideBone.position.copy(this.bind.position[this.data.slide.bone]).add(new THREE.Vector3(0, this.slide, 0).applyQuaternion(this.bind.local[this.data.slide.bone]));
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
  $('version').textContent = `Version ${VERSION}`;
  const data = await (await fetch(`./flip_data.json?v=${VERSION}`)).json();
  const gltf = await new GLTFLoader().loadAsync(`./character.glb?v=${VERSION}`, (e) => {
    if (e.total) $('coverBar').style.width = `${Math.min(100, Math.round((e.loaded / e.total) * 100))}%`;
  });

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

  // the rest pose, as loaded
  const bind = { local: {}, position: {}, world: {}, inverse: {} };
  for (const [name, bone] of Object.entries(bones)) {
    bind.local[name] = bone.quaternion.clone();
    bind.position[name] = bone.position.clone();
    bind.world[name] = bone.getWorldQuaternion(new THREE.Quaternion());
  }
  skinned.skeleton.bones.forEach((bone, i) => { bind.inverse[bone.name] = skinned.skeleton.boneInverses[i].clone(); });
  const hips = bones.Hips;
  const hipsParentQ = hips.parent.getWorldQuaternion(new THREE.Quaternion());      // with the root unturned
  const toeRest = bones.LeftToeBase.getWorldPosition(new THREE.Vector3()).add(bones.RightToeBase.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
  const SOLES = ['LeftToeBase', 'RightToeBase', 'LeftFoot', 'RightFoot'].map((name) => [name, bones[name].getWorldPosition(new THREE.Vector3()).y]);

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
        SKIN.push({ mesh, i, limb: /Hand|Fingers|ForeArm|Foot|ToeBase/.test(name) });   // hands reach for the floor, and the feet are judged on their own
      }
    });
  }
  const skinV = new THREE.Vector3();
  function bodyLow(limbs) {                                      // how high his lowest point is above whatever is under it
    let low = Infinity;
    for (const p of SKIN) {
      if (p.limb && !limbs) continue;
      p.mesh.getVertexPosition(p.i, skinV).applyMatrix4(p.mesh.matrixWorld);
      low = Math.min(low, skinV.y - floorUnder(skinV));
    }
    return low;
  }

  const line = new Timeline(poses, bodyBones);
  line.set([line.poseKey('stand', -1), line.poseKey('stand', 0)]);
  const cloth = new Cloth(data.cloth, bones, bind);

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

  // ------------------------------------------------------------ state
  const G = data.gravity;
  let now = 0, mode = 'ground', spot = 0;
  let charging = false, chargeAt = 0, takeoffAt = Infinity, charge = 0;
  let turn = 0, landing = 'land_reach', planned = false, tucked = false, stalled = false, touchdownAt = -10;
  let lastFall = null;                                          // which fall he took last, for looking at
  let drop = 0;                                                 // how fast he is dropping when a fall leaves him over nothing
  const hipsQBefore = [0, 0, 0, 1], hipsQDot = [0, 0, 0, 0];    // how the hips were turning as he came down
  const com = new THREE.Vector3(), vel = new THREE.Vector3();
  const settle = { lean: 0, at: new THREE.Vector3() };          // what is left to blend away after touchdown
  const held = { jump: false, tuck: false, stall: false };
  let jumpPower = 1, spinPower = 1;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function place(index) {
    const s = SPOTS[index];
    root.position.set(s.x, groundAt(s.x, s.z), s.z);
    root.quaternion.identity();
    cloth.reset();
    $('spot').textContent = `Spot: ${s.label}`;
  }
  place(0);

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

  function pose(inAir, trail) {
    for (const b of bodyBones) {
      if (b === 'Hips' && mode === 'air') continue;
      const late = (data.always_late[b] || 0) + (data.late_in_air[b] || 0) * inAir + (data.trail_after_landing[b] || 0) * trail;
      line.bone(b, now - late, arr4);
      const bone = bones[b];
      bone.quaternion.set(arr4[0], arr4[1], arr4[2], arr4[3]);
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
  function feetLow() {                                           // how high the lowest part of either foot is
    let low = Infinity;
    for (const [name, sole] of SOLES) {
      bones[name].getWorldPosition(tmpV);
      low = Math.min(low, tmpV.y - sole - floorUnder(tmpV));
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
      charging = true; chargeAt = now;
      line.plan(now, [[0.18, 'reach'], [0.30, 'charge_full']]);
    }
    if (mode !== 'air') return;
    if (which === 'tuck' && !tucked) {
      tucked = true; landing = 'land_reach'; planned = false;
      line.plan(now, [[0.22, 'tuck'], [0.08, 'tuck_spot']]);
    }
    if (which === 'stall' && !stalled && !tucked) {
      stalled = true; planned = false;
      line.plan(now, [[0.11, 'layout'], [0.13, 'hang']]);
    }
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
    if (which === 'tuck' && tucked && !planned) line.plan(now, [[0.14, 'open']]);
    if (which === 'stall' && stalled && !tucked) {
      tucked = true; landing = 'squat_reach';
      line.plan(now, [[0.16, 'tuck'], [0.07, 'tuck_spot']]);
    }
  }
  for (const which of ['jump', 'tuck', 'stall']) {
    const el = $(which);
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); press(which); });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(type, () => release(which));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  const KEYS = { Space: 'jump', KeyJ: 'jump', KeyT: 'tuck', KeyF: 'tuck', KeyS: 'stall', KeyG: 'stall' };
  window.addEventListener('keydown', (e) => { if (KEYS[e.code] && !e.repeat) { e.preventDefault(); press(KEYS[e.code]); } });
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
  const LOOK = { ArrowLeft: [-6, 0], ArrowRight: [6, 0], ArrowUp: [0, -5], ArrowDown: [0, 5] };
  window.addEventListener('keydown', (e) => {
    if (!LOOK[e.code] || !controls.enableRotate || e.target.tagName === 'INPUT') return;
    e.preventDefault();
    const ball = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    ball.theta += LOOK[e.code][0] * DEG;
    ball.phi = clamp(ball.phi + LOOK[e.code][1] * DEG, controls.minPolarAngle, controls.maxPolarAngle);
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(ball));
  });
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
    tucked = stalled = planned = false; landing = 'land_reach';
    balance(com);
    turn = -leanNow();                                           // already falling backward as the feet leave
    const back = tmpV.set(0, 0, -1).applyQuaternion(root.quaternion);
    vel.copy(back).multiplyScalar(0.52);
    vel.y = (2.45 + 0.95 * charge) * jumpPower;
    line.plan(now, [[0.14, 'layout']]);                          // rise in a long line until a button says otherwise
  }

  // ------------------------------------------------------------ falls
  // A landing that is too far out is a fall, and he gets up from it. Which fall depends on how he
  // meets the floor. Too much turn: the feet are down but he keeps going back, so he sits, and
  // with a lot too much he goes on to his back. Short: he pitches forward onto hands and knees,
  // and well short, down on his front. Barely turned, or over on his back: flat on the back.
  const GET_UP = {
    fall_sit: [[0.50, 'land_squat'], [0.60, 'stand']],
    fall_back: [[0.55, 'fall_sit'], [0.52, 'land_squat'], [0.60, 'stand']],
    fall_hands: [[0.50, 'land_squat'], [0.60, 'stand']],
    fall_front: [[0.50, 'fall_hands'], [0.52, 'land_squat'], [0.60, 'stand']],
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
    const steps = [...down, [still, lie], ...GET_UP[lie]].map(([seconds, name]) => [seconds * some(), name]);
    return { steps, lie, anchor };
  }

  // He cannot end up inside a platform he came down beside: he is slid out of it, the short way.
  function clearOfPlatforms(dt) {
    for (const b of BOXES) {
      if (root.position.y > b.top - 0.25) continue;              // he is on top of this one
      hips.getWorldPosition(tmpV);
      const ways = [[tmpV.x - b.minX, -1, 0], [b.maxX - tmpV.x, 1, 0], [tmpV.z - b.minZ, 0, -1], [b.maxZ - tmpV.z, 0, 1]];
      const [, wx, wz] = ways.reduce((best, way) => (way[0] < best[0] ? way : best));
      let need = 0;
      for (const p of SKIN) {
        p.mesh.getVertexPosition(p.i, skinV).applyMatrix4(p.mesh.matrixWorld);
        if (skinV.y > b.top - 0.02 || skinV.x <= b.minX || skinV.x >= b.maxX || skinV.z <= b.minZ || skinV.z >= b.maxZ) continue;
        need = Math.max(need, wx < 0 ? skinV.x - b.minX : wx > 0 ? b.maxX - skinV.x : wz < 0 ? skinV.z - b.minZ : b.maxZ - skinV.z);
      }
      if (need > 0) { const go = Math.min(need + 0.01, 3.5 * dt); root.position.x += wx * go; root.position.z += wz * go; }
    }
  }

  function touchdown(feetFirst) {
    const lean = ((((360 - turn) % 360) + 540) % 360) - 180;     // what is left of the turn, as a forward lean
    const off = turn - (360 - poses[landing].lean);              // degrees past (or short of) the turn this landing wants
    const clean = feetFirst && Math.abs(off) <= 45;
    const leftOver = ((lean - line.mix(now).lean + 540) % 360) - 180;
    const hipsWas = hips.getWorldPosition(new THREE.Vector3());
    const fall = clean ? null : fallPlan(feetFirst, off, lean);
    if (!fall || fall.anchor === 'toes') {
      // stand the root under the feet where they came down
      const toes = bones.LeftToeBase.getWorldPosition(new THREE.Vector3()).add(bones.RightToeBase.getWorldPosition(tmpV)).multiplyScalar(0.5);
      tmpV.copy(toeRest).applyQuaternion(root.quaternion);
      root.position.set(toes.x - tmpV.x, floorUnder(toes), toes.z - tmpV.z);
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
      const back = tmpQ2.copy(root.quaternion).multiply(hipsParentQ).invert();
      line.plan(now, fall.steps, {
        q: hips.quaternion.toArray(), qDot: hipsQDot.map((v) => v * 0.5),          // the floor takes half the turn out of him
        hips: hips.parent.worldToLocal(hipsWas.clone()).toArray(),
        hipsDot: tmpV.set(vel.x * 0.5, 0, vel.z * 0.5).applyQuaternion(back).toArray(),
        lean,
      });
      say(off < 0 ? 'Short of the turn' : 'Too much turn', true);
      return;
    }
    mode = 'landing';
    settle.lean = clamp(leftOver, -80, 80);
    line.plan(now, landing === 'squat_reach'
      ? [[0.05, 'squat_reach'], [0.14, 'land_squat'], [0.06, 'land_squat'], [0.50, 'stand']]
      : [[0.05, 'land_reach'], [0.20, 'land_sink'], [0.12, 'land_sink'], [0.38, 'stand']]);
    say(Math.abs(off) < 14 ? 'Clean landing' : 'Landed');
    // keep the hips where they were for this frame, and let the difference melt away
    line.hips(now, arr3);
    hips.position.set(arr3[0], arr3[1], arr3[2]);
    hips.updateWorldMatrix(true, false);
    settle.at.copy(hipsWas).sub(hips.getWorldPosition(tmpV));
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

    if (mode === 'ground' && now >= takeoffAt) { root.updateMatrixWorld(true); takeoff(); }
    if ((mode === 'landing' || mode === 'fall') && now > line.end + 0.05) mode = 'ground';

    // where his weight is: over his balance point in the air, over his hips in a fall, over his feet otherwise
    if (mode === 'air') weight.copy(com); else if (mode === 'fall') hips.getWorldPosition(weight); else weight.copy(root.position);
    const sinceLanding = now - touchdownAt;
    const trail = mode === 'air' ? 0 : ramp(sinceLanding / 0.12) * (mode === 'ground' && sinceLanding >= 2 ? 0 : 1);
    const inAir = mode === 'air' ? 1 : 0;
    pose(inAir, trail);

    if (mode === 'air') {
      // gravity, and a turn as fast as the body's shape allows
      vel.y -= G * (stalled && held.stall ? FLOAT : 1) * dt;
      com.addScaledVector(vel, dt);
      const m = line.mix(now);
      turn += spinPush * spinPower * (m.gain / m.inertia) * dt;
      turnQ.setFromAxisAngle(X_AXIS, -turn * DEG);
      worldQ.copy(root.quaternion).multiply(turnQ);              // the whole body, turned backward about its own middle
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
      const height = com.y - floorUnder(com) - 0.78;
      const toFloor = vel.y < 0 ? (vel.y + Math.sqrt(vel.y * vel.y + 2 * G * Math.max(height, 0))) / G : Infinity;
      if (!planned && toFloor < 0.10) {
        planned = true;
        if (tucked && held.tuck) landing = 'squat_reach';       // still tucked: it can only land in a squat
        if (!tucked) landing = 'land_reach';
        // if he can see he is nowhere near his feet, he braces for the floor instead of reaching for it
        const turnThen = turn + spinPush * spinPower * (m.gain / m.inertia) * toFloor;
        const offThen = turnThen - (360 - poses[landing].lean);
        const leanThen = ((((360 - turnThen) % 360) + 540) % 360) - 180;
        const brace = Math.abs(offThen) <= 100 ? landing : (offThen > 0 || leanThen <= 0 ? 'fall_back' : 'fall_front');
        line.plan(now, [[Math.max(toFloor, 0.04), brace]]);
      }
      root.updateMatrixWorld(true);
      if (vel.y < 0) {
        if (feetLow() <= 0) touchdown(true);
        else if (bodyLow(false) <= 0) touchdown(false);          // something other than the feet got there first
      }
    } else {
      line.hips(now, arr3);
      hips.position.set(arr3[0], arr3[1], arr3[2]);
      if (mode === 'landing') {
        // melt away what was left over at touchdown: the lean and the small jump in place
        const fade = Math.exp(-sinceLanding / 0.11);
        if (Math.abs(settle.lean) * fade > 0.05) {
          tmpQ.setFromAxisAngle(X_AXIS, settle.lean * fade * DEG);
          hips.quaternion.premultiply(tmpQ2.copy(hipsParentQ).invert().multiply(tmpQ).multiply(hipsParentQ));
        }
        tmpV.copy(settle.at).multiplyScalar(Math.exp(-sinceLanding / 0.06));
        hips.position.add(tmpV.applyQuaternion(tmpQ2.copy(root.quaternion).multiply(hipsParentQ).invert()));
      }
      // keep the lower foot exactly on the floor while the poses blend
      root.updateMatrixWorld(true);
      if (mode !== 'ground') { clearOfPlatforms(dt); root.updateMatrixWorld(true); }
      if (mode === 'fall') {
        // in a fall, whatever part of him is lowest rests on the floor; over nothing, he drops to it
        const low = bodyLow(true);
        if (low > 0.004) { drop += G * dt; root.position.y -= Math.min(low, drop * dt); }
        else { drop = 0; root.position.y -= low; }
      } else {
        const low = feetLow();
        if (Math.abs(low) > 0.002) hips.position.add(tmpV.set(0, -low, 0).applyQuaternion(tmpQ2.copy(root.quaternion).multiply(hipsParentQ).invert()));
      }
    }

    root.updateMatrixWorld(true);
    cloth.step(dt);
    root.updateMatrixWorld(true);

    // the camera stays on him
    hips.getWorldPosition(lead);
    lead.y = Math.max(lead.y, root.position.y + 0.9);
    const move = lead.sub(follow).multiplyScalar(1 - Math.exp(-dt / 0.12));
    follow.add(move);
    camera.position.add(move);
    controls.target.copy(follow);
    controls.update();
    sun.target.position.copy(follow);
    sun.position.set(follow.x - 7, follow.y + 4.6, follow.z + 4);
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
  window.__game = { get mode() { return mode; }, get turn() { return turn; }, get slide() { return cloth.slide; }, get height() { return hips.getWorldPosition(new THREE.Vector3()).y; }, get low() { return feetLow(); }, get lean() { return leanNow(); }, get fall() { return lastFall; }, get samples() { return SKIN.length; }, get at() { return root.position.toArray().map((v) => +v.toFixed(2)); }, bodyLow,
    step: (dt = 1 / 60) => frame(0, null, dt), press, release, poses, line, bones, camera, controls };
}

main().catch((error) => {
  console.error(error);
  $('coverText').textContent = 'The rooftop could not load. Reload the page to try again.';
});
