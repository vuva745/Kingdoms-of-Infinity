import * as THREE from 'three';

export const rand = (a: number, b: number): number => a + Math.random() * (b - a);
export const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

const tmpColor = new THREE.Color();

/** Lightweight GPU point-sprite particle pool with additive blending and colour fade-out. */
export class Particles {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly base: Float32Array;
  private readonly life: Float32Array;
  private readonly max: Float32Array;
  private next = 0;

  constructor(
    scene: THREE.Object3D,
    private readonly count = 600,
    size = 0.3,
    private readonly gravity = 0,
  ) {
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.base = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.max = new Float32Array(count);
    for (let i = 0; i < count; i++) this.pos[i * 3 + 1] = -9999;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const material = new THREE.PointsMaterial({
      size,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: THREE.Color, life: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.count;
    const j = i * 3;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z;
    this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
    this.base[j] = color.r; this.base[j + 1] = color.g; this.base[j + 2] = color.b;
    this.col[j] = color.r; this.col[j + 1] = color.g; this.col[j + 2] = color.b;
    this.life[i] = life;
    this.max[i] = life;
  }

  burst(origin: THREE.Vector3, n: number, color: THREE.ColorRepresentation, speed = 6, life = 0.7, spread = 0.3): void {
    const c = tmpColor.set(color);
    for (let k = 0; k < n; k++) {
      const dx = rand(-1, 1), dy = rand(-1, 1), dz = rand(-1, 1);
      const len = Math.hypot(dx, dy, dz) || 1;
      const s = (speed * rand(0.3, 1)) / len;
      this.emit(origin.x + rand(-spread, spread), origin.y + rand(-spread, spread), origin.z + rand(-spread, spread), dx * s, dy * s, dz * s, c, life * rand(0.5, 1));
    }
  }

  /** Directed stream (exhaust, jets): velocity around `dir` with jitter. */
  stream(origin: THREE.Vector3, n: number, color: THREE.ColorRepresentation, dir: THREE.Vector3, jitter = 1, life = 0.4, spread = 0.15): void {
    const c = tmpColor.set(color);
    for (let k = 0; k < n; k++) {
      this.emit(
        origin.x + rand(-spread, spread), origin.y + rand(-spread, spread), origin.z + rand(-spread, spread),
        dir.x + rand(-jitter, jitter), dir.y + rand(-jitter, jitter), dir.z + rand(-jitter, jitter),
        c, life * rand(0.6, 1),
      );
    }
  }

  update(dt: number): void {
    let dirty = false;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      dirty = true;
      this.life[i] -= dt;
      const j = i * 3;
      if (this.life[i] <= 0) {
        this.pos[j + 1] = -9999;
        this.col[j] = this.col[j + 1] = this.col[j + 2] = 0;
        continue;
      }
      this.vel[j + 1] -= this.gravity * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      const f = this.life[i] / this.max[i];
      this.col[j] = this.base[j] * f;
      this.col[j + 1] = this.base[j + 1] * f;
      this.col[j + 2] = this.base[j + 2] * f;
    }
    if (dirty) {
      const g = this.points.geometry;
      (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (g.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    }
  }
}

/** Decaying random camera offset, applied after the camera has been positioned each frame. */
export class Shake {
  private amount = 0;
  add(strength: number): void {
    this.amount = Math.min(1.2, this.amount + strength);
  }
  apply(camera: THREE.Camera, dt: number): void {
    if (this.amount <= 0) return;
    camera.position.x += rand(-1, 1) * this.amount * 0.45;
    camera.position.y += rand(-1, 1) * this.amount * 0.45;
    this.amount = Math.max(0, this.amount - dt * 2.8);
  }
}

/** Full-screen colour flash (hit feedback). Needs a `#flash` element. */
export function flash(color = '#ff3344', strength = 0.5): void {
  const el = document.getElementById('flash');
  if (!el) return;
  el.style.transition = 'none';
  el.style.background = color;
  el.style.opacity = String(strength);
  requestAnimationFrame(() => {
    el.style.transition = 'opacity .45s ease-out';
    el.style.opacity = '0';
  });
}

export function makeCanvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d')!, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Vertical gradient sky dome rendered from the inside. */
export function makeSkyDome(radius: number, top: string, horizon: string, bottom: string): THREE.Mesh {
  const texture = makeCanvasTexture(256, (ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, top);
    g.addColorStop(0.55, horizon);
    g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16), new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, fog: false, depthWrite: false }));
  mesh.renderOrder = -10;
  return mesh;
}

/** Random star field on a sphere shell. */
export function makeStars(count: number, radius: number, size = 1.1, color: THREE.ColorRepresentation = 0xffffff, hemisphere = false): THREE.Points {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const theta = rand(0, Math.PI * 2);
    const phi = hemisphere ? rand(0, Math.PI * 0.52) : Math.acos(rand(-1, 1));
    const r = radius * rand(0.85, 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color, size, sizeAttenuation: true, fog: false, transparent: true, opacity: 0.9 }));
  points.frustumCulled = false;
  return points;
}

export const std = (color: THREE.ColorRepresentation, params: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2, ...params });

export const glow = (color: THREE.ColorRepresentation, intensity = 2, params: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4, metalness: 0, ...params });

export function mesh<G extends THREE.BufferGeometry>(geometry: G, material: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0, shadows = true): THREE.Mesh<G, THREE.Material> {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = shadows;
  m.receiveShadow = shadows;
  parent.add(m);
  return m;
}

export const box = (w: number, h: number, d: number, material: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0, shadows = true) =>
  mesh(new THREE.BoxGeometry(w, h, d), material, parent, x, y, z, shadows);

export function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------- Easing & tweens ----------
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t: number): number => t * t * t;
export const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeOutBack = (t: number): number => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const easeOutElastic = (t: number): number =>
  t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;

interface Tween { duration: number; elapsed: number; update: (t: number) => void; done?: () => void; ease: (t: number) => number }

/** Minimal frame-driven tween list: `add(duration, t => ...)`, call `update(dt)` each frame. */
export class Tweens {
  private list: Tween[] = [];
  add(duration: number, update: (t: number) => void, opts: { ease?: (t: number) => number; done?: () => void; delay?: number } = {}): void {
    this.list.push({ duration, elapsed: -(opts.delay ?? 0), update, done: opts.done, ease: opts.ease ?? easeOutCubic });
  }
  update(dt: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const tw = this.list[i];
      tw.elapsed += dt;
      if (tw.elapsed < 0) continue;
      const t = Math.min(1, tw.elapsed / tw.duration);
      tw.update(tw.ease(t));
      if (t >= 1) {
        this.list.splice(i, 1);
        tw.done?.();
      }
    }
  }
}

/** Pool of expanding, fading rings for impacts, spawns and pickups. */
export class Shockwaves {
  private readonly pool: { mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>; life: number; max: number; size: number }[] = [];
  constructor(scene: THREE.Object3D, count = 10) {
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.82, 1, 48),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push({ mesh, life: 0, max: 1, size: 1 });
    }
  }
  spawn(position: THREE.Vector3, color: THREE.ColorRepresentation, size = 4, duration = 0.5, vertical = false): void {
    const item = this.pool.find((p) => p.life <= 0) ?? this.pool[0];
    item.mesh.position.copy(position);
    item.mesh.rotation.set(vertical ? 0 : -Math.PI / 2, 0, 0);
    item.mesh.material.color.set(color);
    item.mesh.scale.setScalar(0.1);
    item.life = item.max = duration;
    item.size = size;
    item.mesh.visible = true;
  }
  update(dt: number): void {
    for (const item of this.pool) {
      if (item.life <= 0) continue;
      item.life -= dt;
      const t = 1 - Math.max(0, item.life) / item.max;
      item.mesh.scale.setScalar(0.1 + item.size * easeOutCubic(t));
      item.mesh.material.opacity = (1 - t) * 0.9;
      if (item.life <= 0) item.mesh.visible = false;
    }
  }
}
