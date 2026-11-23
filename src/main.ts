import * as THREE from 'three';
import { canEnterPortal, clamp, near2d } from './logic';
import { showResults } from './leaderboard';
import { Particles, Shake, Shockwaves, Tweens, box, easeInOutSine, easeOutBack, flash, formatTime, glow, makeCanvasTexture, makeSkyDome, mesh, pick, rand, std } from './fx';
import { createPipeline, createRenderer } from './postfx';
import { loadModel, swapModel } from './models';
import { sfx } from './audio';
import { announce, bindMute, createInput, floatText, hearts, pulse, setBar, shakeEl, toScreen, waitForStart } from './screen';
import './style.css';

const TOTAL = 12;
const WORLD = 52;
const PORTAL = new THREE.Vector3(0, 0, -34);

// ---------- Scene ----------
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbfdcf5, 55, 180);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 500);
camera.position.set(0, 14, 17);
const renderer = createRenderer();
renderer.toneMappingExposure = 1.0;
document.querySelector('#app')!.appendChild(renderer.domElement);
const pipeline = createPipeline(renderer, scene, camera, { bloom: 0.45, threshold: 0.85, radius: 0.3 });

scene.add(makeSkyDome(220, '#2f6fd1', '#9ccbf5', '#dfeefb'));
scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x3b6a2a, 1.0));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.3);
sun.position.set(45, 70, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 10, far: 220 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0006;
scene.add(sun);
mesh(new THREE.SphereGeometry(7, 20, 12), new THREE.MeshBasicMaterial({ color: 0xfff3c4, fog: false }), scene, 135, 170, 60, false);

// ---------- Terrain ----------
function heightAt(x: number, z: number): number {
  const base = 0.9 * Math.sin(x * 0.11) * Math.cos(z * 0.09) + 0.55 * Math.sin(x * 0.23 + 1.3) * Math.sin(z * 0.19) + 0.35 * Math.sin((x + z) * 0.31);
  const d = Math.min(Math.hypot(x, z), Math.hypot(x - PORTAL.x, z - PORTAL.z));
  const flat = clamp((d - 5) / 6, 0, 1);
  return base * flat;
}
const terrainGeo = new THREE.PlaneGeometry(WORLD * 2 + 16, WORLD * 2 + 16, 110, 110);
terrainGeo.rotateX(-Math.PI / 2);
{
  const pos = terrainGeo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const low = new THREE.Color(0x3c8a37), high = new THREE.Color(0x8fcf5c), dirt = new THREE.Color(0x8a7a4a);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    const t = clamp((h + 1.2) / 2.6, 0, 1);
    c.copy(low).lerp(high, t);
    if (Math.abs(x) < 2.2 && z < 2 && z > PORTAL.z) c.lerp(dirt, 0.55); // worn path to the portal
    c.offsetHSL(0, 0, rand(-0.03, 0.03));
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeo.computeVertexNormals();
}
const terrain = mesh(terrainGeo, std(0xffffff, { vertexColors: true, roughness: 0.95, metalness: 0 }), scene, 0, 0, 0, false);
terrain.receiveShadow = true;

// Flowers (points)
{
  const n = 700;
  const positions = new Float32Array(n * 3), colors = new Float32Array(n * 3);
  const palette = [new THREE.Color(0xffffff), new THREE.Color(0xffd84d), new THREE.Color(0xff7eb6), new THREE.Color(0xb48cff)];
  for (let i = 0; i < n; i++) {
    const x = rand(-WORLD, WORLD), z = rand(-WORLD, WORLD);
    positions[i * 3] = x; positions[i * 3 + 1] = heightAt(x, z) + 0.18; positions[i * 3 + 2] = z;
    const c = pick(palette);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.28, vertexColors: true, sizeAttenuation: true })));
}

// ---------- Crystals, trees, rocks ----------
const crystalSpots: THREE.Vector3[] = [];
for (let i = 0; i < TOTAL; i++) {
  const a = (i * Math.PI * 2) / TOTAL, r = 9 + (i % 4) * 7;
  const x = Math.cos(a) * r, z = Math.sin(a) * r;
  crystalSpots.push(new THREE.Vector3(x, heightAt(x, z), z));
}
const trunkMat = std(0x6b4423, { roughness: 0.95 });
const leafMats = [0x2f8f3a, 0x3fa347, 0x2a7a46, 0x5fb24a].map((c) => std(c, { roughness: 0.9 }));
const obstacles: { x: number; z: number; r: number }[] = [];
function placeFree(minR: number, maxR: number): THREE.Vector2 | null {
  for (let tries = 0; tries < 20; tries++) {
    const a = rand(0, Math.PI * 2), r = rand(minR, maxR);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(x) < 5 && z < 3 && z > PORTAL.z - 6) continue;
    if (crystalSpots.some((c) => Math.hypot(c.x - x, c.z - z) < 3.5)) continue;
    if (obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 2.5)) continue;
    return new THREE.Vector2(x, z);
  }
  return null;
}
interface TreeSpec { x: number; z: number; s: number; rot: number; variant: number }
const treeSpecs: TreeSpec[] = [];
let treeObjects: THREE.Object3D[] = [];
for (let i = 0; i < 70; i++) {
  const p = placeFree(11, WORLD - 2);
  if (!p) continue;
  const spec: TreeSpec = { x: p.x, z: p.y, s: rand(0.8, 1.5), rot: rand(0, Math.PI * 2), variant: Math.random() < 0.6 ? 0 : 1 };
  treeSpecs.push(spec);
  const tree = new THREE.Group();
  mesh(new THREE.CylinderGeometry(0.22, 0.38, 2.4, 7), trunkMat, tree, 0, 1.2, 0);
  const leaf = pick(leafMats);
  mesh(new THREE.ConeGeometry(2.1, 2.8, 8), leaf, tree, 0, 3.2, 0);
  mesh(new THREE.ConeGeometry(1.6, 2.4, 8), leaf, tree, 0, 4.4, 0);
  mesh(new THREE.ConeGeometry(1.0, 2.0, 8), leaf, tree, 0, 5.5, 0);
  tree.scale.setScalar(spec.s);
  tree.rotation.y = spec.rot;
  tree.position.set(spec.x, heightAt(spec.x, spec.z) - 0.1, spec.z);
  scene.add(tree);
  treeObjects.push(tree);
  obstacles.push({ x: p.x, z: p.y, r: 0.9 * spec.s });
}
// Swap the primitive trees for the Blender-built ones once both variants have loaded.
Promise.all([loadModel('tree0'), loadModel('tree1')])
  .then((templates) => {
    for (const old of treeObjects) scene.remove(old);
    treeObjects = treeSpecs.map((spec) => {
      const tree = templates[spec.variant].clone(true);
      tree.scale.setScalar(spec.s);
      tree.rotation.y = spec.rot;
      tree.position.set(spec.x, heightAt(spec.x, spec.z) - 0.1, spec.z);
      scene.add(tree);
      return tree;
    });
  })
  .catch(() => undefined);
const rockMat = std(0x8b8f99, { roughness: 1, metalness: 0.05 });
for (let i = 0; i < 28; i++) {
  const p = placeFree(8, WORLD - 2);
  if (!p) continue;
  const r = rand(0.5, 1.4);
  const rock = mesh(new THREE.DodecahedronGeometry(r, 0), rockMat, scene, p.x, heightAt(p.x, p.y) + r * 0.35, p.y);
  rock.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
  obstacles.push({ x: p.x, z: p.y, r: r * 0.9 });
}
for (let i = 0; i < 40; i++) {
  const p = placeFree(6, WORLD - 2);
  if (!p) continue;
  const bush = mesh(new THREE.SphereGeometry(rand(0.6, 1.1), 8, 6), pick(leafMats), scene, p.x, heightAt(p.x, p.y) + 0.3, p.y);
  bush.scale.y = 0.7;
}

// Clouds
const clouds: THREE.Group[] = [];
const cloudMat = std(0xffffff, { roughness: 1, emissive: 0xffffff, emissiveIntensity: 0.15, transparent: true, opacity: 0.92 });
for (let i = 0; i < 12; i++) {
  const cloud = new THREE.Group();
  for (let k = 0; k < 4; k++) {
    const puff = mesh(new THREE.SphereGeometry(rand(2, 4), 10, 8), cloudMat, cloud, rand(-4, 4), rand(-0.5, 0.5), rand(-2, 2), false);
    puff.scale.y = 0.45;
  }
  cloud.position.set(rand(-110, 110), rand(28, 42), rand(-120, 60));
  scene.add(cloud);
  clouds.push(cloud);
}

// Crystals
const crystalMat = new THREE.MeshPhysicalMaterial({ color: 0x5ff1ff, emissive: 0x1aa8c8, emissiveIntensity: 1.0, metalness: 0.1, roughness: 0.12, clearcoat: 1, transparent: true, opacity: 0.95 });
const pedestalMat = std(0x9aa3b5, { roughness: 0.6, metalness: 0.4 });
const haloMat = glow(0x7ef3ff, 1.4, { transparent: true, opacity: 0.85 });
const halos: THREE.Mesh[] = [];
const crystals: THREE.Object3D[] = [];
for (const spot of crystalSpots) {
  mesh(new THREE.CylinderGeometry(0.9, 1.1, 0.35, 8), pedestalMat, scene, spot.x, spot.y + 0.15, spot.z);
  const crystal = new THREE.Group();
  crystal.position.set(spot.x, spot.y + 1.5, spot.z);
  const placeholder = mesh(new THREE.OctahedronGeometry(0.7, 0), crystalMat, crystal);
  placeholder.scale.y = 1.5;
  crystal.userData.phase = rand(0, 6);
  scene.add(crystal);
  crystals.push(crystal);
  swapModel(crystal, placeholder, 'crystal');
  // spinning halo ring on the pedestal
  const halo = mesh(new THREE.TorusGeometry(1.05, 0.045, 8, 40), haloMat, scene, spot.x, spot.y + 0.42, spot.z, false);
  halo.rotation.x = Math.PI / 2;
  crystal.userData.halo = halo;
  halos.push(halo);
}

// Portal
const portal = new THREE.Group();
portal.position.copy(PORTAL).setY(heightAt(PORTAL.x, PORTAL.z));
scene.add(portal);
const portalRingMat = glow(0xd45aff, 0.6, { metalness: 0.5 });
const ring = mesh(new THREE.TorusGeometry(2.5, 0.28, 14, 56), portalRingMat, portal, 0, 2.8, 0);
const swirlTex = makeCanvasTexture(256, (ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 4, s / 2, s / 2, s / 2);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.3, '#e59bff');
  g.addColorStop(0.7, '#7a2bd8');
  g.addColorStop(1, '#2a0a55');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = '#ffffffaa';
  ctx.lineWidth = 6;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    for (let t = 0; t < Math.PI * 2.5; t += 0.1) {
      const r = (t / (Math.PI * 2.5)) * s * 0.48;
      ctx.lineTo(s / 2 + Math.cos(t + (i * Math.PI) / 2) * r, s / 2 + Math.sin(t + (i * Math.PI) / 2) * r);
    }
    ctx.stroke();
  }
});
const swirl = mesh(new THREE.CircleGeometry(2.25, 48), new THREE.MeshBasicMaterial({ map: swirlTex, transparent: true, opacity: 0, side: THREE.DoubleSide }), portal, 0, 2.8, 0, false);
const stoneMat = std(0x8d93a3, { roughness: 0.85 });
for (const x of [-3.6, 3.6]) {
  box(1.2, 5.5, 1.2, stoneMat, portal, x, 2.7, 0);
  mesh(new THREE.OctahedronGeometry(0.45, 0), portalRingMat, portal, x, 5.9, 0, false);
}
const portalLight = new THREE.PointLight(0xd45aff, 0, 20, 2);
portalLight.position.set(0, 3, 1);
portal.add(portalLight);
let portalOpen = false;

// ---------- Player knight ----------
const player = new THREE.Group();
scene.add(player);
// Primitive placeholder, replaced by the Blender-built GLB once it loads.
const knightBody = new THREE.Group();
player.add(knightBody);
const armorMat = std(0x7a86ff, { metalness: 0.6, roughness: 0.35 });
const steelMat = std(0xdfe7f5, { metalness: 0.9, roughness: 0.25 });
const skinMat = std(0xf1c9a5, { roughness: 0.8 });
const capeMat = std(0xb3122d, { roughness: 0.9, side: THREE.DoubleSide });
const body = mesh(new THREE.CapsuleGeometry(0.42, 0.7, 4, 12), armorMat, knightBody, 0, 0.85, 0);
mesh(new THREE.SphereGeometry(0.32, 16, 16), skinMat, knightBody, 0, 1.6, 0);
const helmet = mesh(new THREE.SphereGeometry(0.36, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), steelMat, knightBody, 0, 1.62, 0);
mesh(new THREE.ConeGeometry(0.08, 0.5, 8), glow(0xff5577, 1.0), knightBody, 0, 2.1, 0, false);
for (const x of [-0.5, 0.5]) mesh(new THREE.SphereGeometry(0.2, 10, 8), steelMat, knightBody, x, 1.35, 0);
const cape = mesh(new THREE.BoxGeometry(0.75, 1.0, 0.06), capeMat, knightBody, 0, 0.9, 0.38);
cape.rotation.x = -0.15;
const sword = mesh(new THREE.BoxGeometry(0.08, 1.15, 0.08), steelMat, knightBody, 0.62, 1.0, -0.1);
box(0.3, 0.06, 0.08, std(0xc69a3a, { metalness: 0.8 }), knightBody, 0.62, 0.45, -0.1);
swapModel(player, knightBody, 'knight');
const playerLight = new THREE.PointLight(0x9fe8ff, 0, 6, 2);
playerLight.position.set(0, 1.5, 0);
player.add(playerLight);

// Slimes
interface Slime { group: THREE.Group; target: THREE.Vector2; speed: number; phase: number; stun: number; chasing: boolean }
const slimes: Slime[] = [];
const slimeMat = std(0x62d13a, { roughness: 0.3, metalness: 0.1, emissive: 0x2f7a16, emissiveIntensity: 0.35, transparent: true, opacity: 0.92 });
const eyeMat = std(0x111111, { roughness: 0.3 });
for (let i = 0; i < 6; i++) {
  const group = new THREE.Group();
  const slimeBody = new THREE.Group();
  group.add(slimeBody);
  const blob = mesh(new THREE.SphereGeometry(0.75, 16, 12), slimeMat, slimeBody, 0, 0.55, 0);
  blob.scale.y = 0.75;
  for (const x of [-0.25, 0.25]) mesh(new THREE.SphereGeometry(0.1, 8, 8), eyeMat, slimeBody, x, 0.75, -0.55, false);
  swapModel(group, slimeBody, 'slime');
  const a = (i / 6) * Math.PI * 2 + 0.4;
  group.position.set(Math.cos(a) * 24, 0, Math.sin(a) * 24);
  scene.add(group);
  slimes.push({ group, target: new THREE.Vector2(group.position.x, group.position.z), speed: 2.2, phase: rand(0, 6), stun: 0, chasing: false });
}

// Birds circling the sky
interface Bird { group: THREE.Group; wings: THREE.Mesh[]; center: THREE.Vector2; radius: number; angle: number; speed: number; height: number; phase: number }
const birds: Bird[] = [];
const birdMat = std(0x1d1a24, { roughness: 0.9, side: THREE.DoubleSide });
for (let i = 0; i < 7; i++) {
  const group = new THREE.Group();
  mesh(new THREE.CapsuleGeometry(0.1, 0.5, 3, 6), birdMat, group, 0, 0, 0, false).rotation.x = Math.PI / 2;
  const wings = [-1, 1].map((side) => {
    const wing = mesh(new THREE.PlaneGeometry(0.9, 0.35), birdMat, group, side * 0.45, 0, 0, false);
    wing.rotation.x = -Math.PI / 2;
    return wing;
  });
  scene.add(group);
  birds.push({ group, wings, center: new THREE.Vector2(rand(-30, 30), rand(-40, 20)), radius: rand(12, 28), angle: rand(0, 6), speed: rand(0.2, 0.4) * (Math.random() < 0.5 ? 1 : -1), height: rand(13, 20), phase: rand(0, 6) });
}

const sparkle = new Particles(scene, 600, 0.35, 2.5);
const motes = new Particles(scene, 400, 0.3, -1.2);
const shake = new Shake();
const tweens = new Tweens();
const waves = new Shockwaves(scene, 12);
let intro = 0, focusTimer = 0, wobble = 0, stretch = 1;
const INTRO_SECONDS = 2.8;
const knightVisual = (): THREE.Object3D | undefined => player.children.find((c) => c !== playerLight);

// ---------- State ----------
const held = createInput(['up', 'down', 'left', 'right', 'action'] as const, { ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down', ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ' ': 'action', Enter: 'action' });
bindMute();
let started = false, ended = false, startedAt = 0, elapsed = 0, last = performance.now();
let score = 0, hp = 3, invulnerable = 0, dash = 0, dashCooldown = 0, facing = Math.PI, notice = 0;
const hud = {
  hearts: document.getElementById('hearts')!,
  crystals: document.getElementById('crystals')!,
  timer: document.getElementById('timer')!,
  compass: document.getElementById('compass')!,
  hintText: document.getElementById('hint-text')!,
  message: document.getElementById('message')!,
};

function finish(won: boolean): void {
  ended = true;
  const durationMs = Math.round(performance.now() - startedAt);
  player.visible = true;
  if (won) {
    sfx.win();
    // the knight is drawn into the portal: glide to its centre, spin and shrink into the light
    const from = player.position.clone();
    const to = portal.position.clone().setY(portal.position.y + 1.2);
    const baseFacing = facing;
    waves.spawn(portal.position.clone().setY(portal.position.y + 0.1), 0xd45aff, 10, 1.2);
    tweens.add(1.8, (t) => {
      player.position.lerpVectors(from, to, t);
      player.position.y += Math.sin(t * Math.PI) * 1.5;
      player.rotation.y = baseFacing + t * Math.PI * 6;
      player.scale.setScalar(1 - t * 0.95);
      if (Math.random() < 0.8) motes.emit(player.position.x + rand(-0.6, 0.6), player.position.y + rand(0, 2), player.position.z + rand(-0.6, 0.6), 0, 2, 0, new THREE.Color(0xd45aff), 0.8);
    }, { ease: easeInOutSine, done: () => { flash('#ffffff', 0.9); sparkle.burst(to, 160, 0xd45aff, 9, 1.2, 0.8); waves.spawn(to, 0xffffff, 8, 0.8, true); } });
  } else {
    sfx.lose();
    // the knight topples backwards and the world dims
    const visual = knightVisual();
    tweens.add(1.0, (t) => {
      if (visual) visual.rotation.x = t * (Math.PI / 2);
      player.position.y = heightAt(player.position.x, player.position.z) - t * 0.4;
      sun.intensity = 2.3 - t * 1.4;
    }, { ease: easeOutBack });
  }
  setTimeout(() => showResults(hud.message, { won, score: Math.min(score, TOTAL), goal: TOTAL, scoreLabel: 'Crystals', durationMs, winTitle: '🏆 PORTAL CROSSED', loseTitle: '💀 FALLEN HERO' }), 2000);
}

function damage(from: THREE.Vector3): void {
  hp -= 1;
  invulnerable = 1.2;
  wobble = 1;
  shake.add(0.8);
  flash('#ff2a3a', 0.5);
  sfx.hit();
  const dx = player.position.x - from.x, dz = player.position.z - from.z, len = Math.hypot(dx, dz) || 1;
  const start = player.position.clone();
  const target = new THREE.Vector3(clamp(player.position.x + (dx / len) * 3.5, -WORLD, WORLD), 0, clamp(player.position.z + (dz / len) * 3.5, -WORLD, WORLD));
  tweens.add(0.35, (t) => {
    player.position.x = THREE.MathUtils.lerp(start.x, target.x, t);
    player.position.z = THREE.MathUtils.lerp(start.z, target.z, t);
  });
  waves.spawn(from.clone().setY(from.y + 0.1), 0xff3b4e, 4, 0.5);
  const at = toScreen(player.position, camera);
  floatText('-1 ❤️', '#ff5566', at.x, at.y - 12);
  hud.hearts.textContent = hearts(hp, 3);
  shakeEl(hud.hearts);
  if (hp <= 0) finish(false);
}

function openPortal(): void {
  portalOpen = true;
  sfx.portal();
  flash('#d45aff', 0.35);
  portalRingMat.emissiveIntensity = 2.2;
  portalLight.intensity = 12;
  hud.hintText.textContent = 'to the portal!';
  pulse(hud.hintText);
  announce('PORTAL AWAKENED', 'soft', 1800);
  focusTimer = 2.6; // cinematic look at the portal
  tweens.add(1.4, (t) => ring.scale.setScalar(1 + Math.sin(t * Math.PI) * 0.45), { ease: (t) => t });
  for (let i = 0; i < 4; i++) tweens.add(0.01, () => waves.spawn(portal.position.clone().setY(portal.position.y + 0.1), 0xd45aff, 6 + i * 2, 0.9), { delay: i * 0.3 });
}

const camTarget = new THREE.Vector3();
const tmp = new THREE.Vector3();

function update(dt: number): void {
  const dx = Number(held.right) - Number(held.left), dz = Number(held.down) - Number(held.up);
  const len = Math.hypot(dx, dz) || 1;
  const moving = dx !== 0 || dz !== 0;
  dashCooldown -= dt;
  if (held.action && dashCooldown <= 0 && moving) {
    dash = 0.22;
    dashCooldown = 1.1;
    sfx.jump();
    sparkle.burst(player.position, 30, 0x9fe8ff, 4, 0.4, 0.4);
  }
  dash -= dt;
  const speed = dash > 0 ? 24 : 9;
  const nx = clamp(player.position.x + (dx / len) * speed * dt, -WORLD, WORLD);
  const nz = clamp(player.position.z + (dz / len) * speed * dt, -WORLD, WORLD);
  let blocked = false;
  for (const o of obstacles) if (Math.hypot(nx - o.x, nz - o.z) < o.r + 0.5) { blocked = true; break; }
  if (!blocked) { player.position.x = nx; player.position.z = nz; }
  player.position.y = heightAt(player.position.x, player.position.z) + (moving ? Math.abs(Math.sin(elapsed * 11)) * 0.12 : 0);
  if (moving) {
    const desired = Math.atan2(dx, dz) + Math.PI;
    let delta = desired - facing;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    facing += delta * Math.min(1, dt * 10);
  }
  player.rotation.y = facing;
  // body language: lean into the run, stretch on dash, wobble when hit, sway while idle
  wobble = Math.max(0, wobble - dt * 1.8);
  stretch = THREE.MathUtils.lerp(stretch, dash > 0 ? 1.35 : 1, 0.2);
  const visual = knightVisual();
  if (visual) {
    visual.rotation.x = THREE.MathUtils.lerp(visual.rotation.x, moving ? -0.14 - (dash > 0 ? 0.2 : 0) : 0, 0.15);
    visual.rotation.z = Math.sin(elapsed * 30) * wobble * 0.25 + (moving ? Math.sin(elapsed * 11) * 0.04 : 0);
    visual.scale.set(1 / Math.sqrt(stretch), 1 / Math.sqrt(stretch), stretch);
    visual.position.y = moving ? 0 : Math.sin(elapsed * 2) * 0.03;
  }
  cape.rotation.x = -0.15 - (moving ? 0.5 + Math.sin(elapsed * 10) * 0.1 : 0) - (dash > 0 ? 0.6 : 0);
  sword.rotation.z = moving ? Math.sin(elapsed * 11) * 0.25 : 0;
  body.rotation.z = moving ? Math.sin(elapsed * 11) * 0.05 : 0;
  if (dash > 0) motes.stream(player.position, 3, 0x9fe8ff, tmp.set(-Math.sin(facing) * 3, 1, -Math.cos(facing) * 3), 1, 0.3, 0.3);

  // Crystals
  for (let i = crystals.length - 1; i >= 0; i--) {
    const c = crystals[i];
    c.rotation.y += dt * 1.5;
    const spot = c.userData.phase as number;
    c.position.y = heightAt(c.position.x, c.position.z) + 1.5 + Math.sin(elapsed * 2.5 + spot) * 0.2;
    c.scale.setScalar(1 + Math.sin(elapsed * 3 + spot) * 0.06);
    if (Math.random() < 0.06) motes.emit(c.position.x + rand(-0.6, 0.6), c.position.y + rand(-0.8, 0.8), c.position.z + rand(-0.6, 0.6), 0, 0.6, 0, new THREE.Color(0x9fe8ff), 1.2);
    if (c.position.distanceTo(player.position.clone().setY(c.position.y)) < 1.9) {
      crystals.splice(i, 1);
      score += 1;
      sfx.pickup();
      sparkle.burst(c.position, 80, 0x7ef3ff, 6, 0.9, 0.3);
      sparkle.burst(c.position, 30, 0xffffff, 3, 0.6, 0.2);
      waves.spawn(c.position.clone().setY(c.position.y - 1.1), 0x7ef3ff, 4, 0.6);
      const at = toScreen(c.position, camera);
      floatText(`💎 ${score} / ${TOTAL}`, '#7ef3ff', at.x, at.y - 8);
      const y0 = c.position.y;
      const halo = c.userData.halo as THREE.Mesh | undefined;
      tweens.add(0.5, (t) => {
        c.position.y = y0 + t * 3;
        c.rotation.y += 0.5;
        c.scale.setScalar(1 - t);
        if (halo) halo.scale.setScalar(1 + t * 2), ((halo.material as THREE.MeshStandardMaterial).opacity = 0.85 * (1 - t));
      }, { done: () => { scene.remove(c); if (halo) { scene.remove(halo); halos.splice(halos.indexOf(halo), 1); } } });
      playerLight.intensity = 10;
      hud.crystals.textContent = `💎 ${score} / ${TOTAL}`;
      pulse(hud.crystals);
      setBar('progress', score / TOTAL);
      if (canEnterPortal(score, TOTAL)) openPortal();
    }
  }
  playerLight.intensity = THREE.MathUtils.lerp(playerLight.intensity, 0, 0.05);

  // Portal
  ring.rotation.z += dt * (portalOpen ? 1.2 : 0.2);
  if (portalOpen) {
    swirl.rotation.z -= dt * 1.5;
    (swirl.material as THREE.MeshBasicMaterial).opacity = THREE.MathUtils.lerp((swirl.material as THREE.MeshBasicMaterial).opacity, 0.9, 0.04);
    portalLight.intensity = 10 + Math.sin(elapsed * 4) * 3;
    if (Math.random() < 0.5) motes.emit(portal.position.x + rand(-2.4, 2.4), portal.position.y + rand(0.5, 5), portal.position.z + rand(-0.5, 0.5), 0, 1.5, 0, new THREE.Color(0xd45aff), 1.4);
  }
  if (near2d(player.position.x, player.position.z, portal.position.x, portal.position.z, 2.6)) {
    if (portalOpen) finish(true);
    else notice = 2;
  }
  notice = Math.max(0, notice - dt);

  // Slimes
  for (const s of slimes) {
    const g = s.group;
    s.stun -= dt;
    const toPlayer = Math.hypot(player.position.x - g.position.x, player.position.z - g.position.z);
    if (s.stun <= 0) {
      const chasing = toPlayer < 13;
      if (chasing && !s.chasing) {
        // alert hop + "!" when a slime spots the knight
        const g0 = g;
        tweens.add(0.5, (t) => g0.position.y += Math.sin(t * Math.PI) * 0.08, { ease: (t) => t });
        const at = toScreen(g.position.clone().setY(g.position.y + 1.6), camera);
        floatText('!', '#9dff6a', at.x, at.y);
      }
      s.chasing = chasing;
      if (toPlayer < 13) s.target.set(player.position.x, player.position.z);
      else if (Math.hypot(s.target.x - g.position.x, s.target.y - g.position.z) < 1 || Math.random() < 0.004) s.target.set(rand(-WORLD + 5, WORLD - 5), rand(-WORLD + 5, WORLD - 5));
      const sp = toPlayer < 13 ? 4.6 : 2.2;
      const ddx = s.target.x - g.position.x, ddz = s.target.y - g.position.z, l = Math.hypot(ddx, ddz) || 1;
      g.position.x += (ddx / l) * sp * dt;
      g.position.z += (ddz / l) * sp * dt;
      g.rotation.y = Math.atan2(ddx, ddz) + Math.PI;
    }
    const hop = Math.abs(Math.sin(elapsed * 5 + s.phase));
    g.position.y = heightAt(g.position.x, g.position.z) + hop * 0.5;
    g.scale.set(1 + (1 - hop) * 0.18, 0.85 + hop * 0.3, 1 + (1 - hop) * 0.18);
    if (invulnerable <= 0 && toPlayer < 1.5) {
      damage(g.position);
      s.stun = 1.2;
      s.target.set(g.position.x + rand(-10, 10), g.position.z + rand(-10, 10));
      sparkle.burst(g.position, 30, 0x62d13a, 5, 0.5, 0.4);
    }
  }
  if (invulnerable > 0) {
    invulnerable -= dt;
    player.visible = Math.floor(invulnerable * 12) % 2 === 0;
  } else player.visible = true;

  // HUD
  hud.timer.textContent = formatTime(performance.now() - startedAt);
  let target: THREE.Vector3 | null = null;
  if (portalOpen) target = portal.position;
  else {
    let best = Infinity;
    for (const c of crystals) {
      const d = c.position.distanceTo(player.position);
      if (d < best) { best = d; target = c.position; }
    }
  }
  if (target) {
    const angle = Math.atan2(target.x - player.position.x, -(target.z - player.position.z));
    hud.compass.style.transform = `rotate(${(angle * 180) / Math.PI - 90}deg)`;
    const dist = Math.round(Math.hypot(target.x - player.position.x, target.z - player.position.z));
    hud.hintText.textContent = notice > 0 ? 'collect every crystal first!' : portalOpen ? `portal ${dist} m` : `crystal ${dist} m`;
    hud.hintText.classList.toggle('warn', notice > 0);
  }
}

function animate(now: number): void {
  requestAnimationFrame(animate);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  elapsed += dt;
  if (started && !ended) update(dt);
  else {
    for (const c of crystals) { c.rotation.y += dt; c.position.y = heightAt(c.position.x, c.position.z) + 1.5 + Math.sin(elapsed * 2.5 + (c.userData.phase as number)) * 0.2; }
    ring.rotation.z += dt * 0.2;
    if (!ended) player.position.y = heightAt(player.position.x, player.position.z);
  }
  for (const cloud of clouds) {
    cloud.position.x += dt * 1.2;
    if (cloud.position.x > 120) cloud.position.x = -120;
  }
  // ambient motion: wind in the trees, spinning halos, circling birds
  treeObjects.forEach((tree, i) => {
    tree.rotation.z = Math.sin(elapsed * 1.3 + i * 0.7) * 0.025;
    tree.rotation.x = Math.cos(elapsed * 1.1 + i * 1.3) * 0.018;
  });
  for (const halo of halos) halo.rotation.z += dt * 1.2;
  haloMat.emissiveIntensity = 1.2 + Math.sin(elapsed * 3) * 0.5;
  for (const b of birds) {
    b.angle += dt * b.speed;
    const x = b.center.x + Math.cos(b.angle) * b.radius, z = b.center.y + Math.sin(b.angle) * b.radius;
    const nx = b.center.x + Math.cos(b.angle + 0.05 * Math.sign(b.speed)) * b.radius, nz = b.center.y + Math.sin(b.angle + 0.05 * Math.sign(b.speed)) * b.radius;
    b.group.position.set(x, b.height + Math.sin(elapsed * 1.5 + b.phase) * 0.8, z);
    b.group.lookAt(nx, b.group.position.y, nz);
    const flap = Math.sin(elapsed * 9 + b.phase) * 0.7;
    b.wings[0].rotation.y = flap;
    b.wings[1].rotation.y = -flap;
  }
  helmet.rotation.y = elapsed * 0.1;
  sparkle.update(dt);
  motes.update(dt);
  waves.update(dt);
  tweens.update(dt);
  if (focusTimer > 0) {
    // cinematic: pan to the awakened portal, then return
    focusTimer -= dt;
    camTarget.set(portal.position.x, portal.position.y + 7, portal.position.z + 13);
    camera.position.lerp(camTarget, 0.08);
    camera.lookAt(portal.position.x, portal.position.y + 2.5, portal.position.z);
  } else if (ended) {
    camTarget.set(player.position.x + Math.sin(elapsed * 0.35) * 10, player.position.y + 6, player.position.z + Math.cos(elapsed * 0.35) * 10);
    camera.position.lerp(camTarget, 0.05);
    camera.lookAt(player.position.x, player.position.y + 1, player.position.z);
  } else {
    camTarget.set(player.position.x, player.position.y + 13, player.position.z + 16);
    if (intro > 0) {
      // sweep in over the forest towards the hero
      intro -= dt;
      const t = easeInOutSine(1 - Math.max(0, intro) / INTRO_SECONDS);
      camTarget.lerpVectors(new THREE.Vector3(-28, 24, 30), camTarget, t);
      camera.position.lerp(camTarget, 0.12);
    } else camera.position.lerp(camTarget, 0.1);
    camera.lookAt(player.position.x, player.position.y + 1, player.position.z - 2);
  }
  shake.apply(camera, dt);
  pipeline.render();
}

requestAnimationFrame(animate);
waitForStart(() => {
  intro = INTRO_SECONDS;
  announce('BEGIN!', 'go', 1200);
  setTimeout(() => {
    started = true;
    startedAt = performance.now();
  }, 900);
});
