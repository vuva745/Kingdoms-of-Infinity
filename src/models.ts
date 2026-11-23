import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Models are authored procedurally in Blender (see blender/build_models.py) and
// shipped as GLB files under public/models/. Every game keeps simple primitive
// placeholders so it still runs if a model is missing or slow to load.

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();

const MAX_EMISSIVE = 2.2; // Blender emission strengths are tuned for Cycles; bloom needs less.

function prepare(model: THREE.Object3D): void {
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      const std = mat as THREE.MeshStandardMaterial;
      if (std.emissiveIntensity > MAX_EMISSIVE) std.emissiveIntensity = MAX_EMISSIVE;
    }
  });
}

/** Loads (and caches) a GLB. Each call returns a fresh clone sharing geometry/materials. */
export function loadModel(name: string): Promise<THREE.Group> {
  const url = `${import.meta.env.BASE_URL}models/${name}.glb`;
  let pending = cache.get(url);
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      loader.load(
        url,
        (gltf) => {
          prepare(gltf.scene);
          resolve(gltf.scene);
        },
        undefined,
        reject,
      );
    });
    cache.set(url, pending);
  }
  return pending.then((template) => template.clone(true));
}

/**
 * Replace the primitive placeholder inside `parent` with the loaded model.
 * Lights and effects attached directly to `parent` are kept.
 */
export function swapModel(parent: THREE.Object3D, placeholder: THREE.Object3D, name: string, onReady?: (model: THREE.Group) => void): void {
  loadModel(name)
    .then((model) => {
      parent.remove(placeholder);
      parent.add(model);
      onReady?.(model);
    })
    .catch((err: unknown) => console.warn(`[models] ${name} unavailable, keeping primitives`, err));
}

/** Clone a material on the meshes that use `materialName` and recolour it. */
export function recolor(model: THREE.Object3D, materialName: string, color: THREE.ColorRepresentation, emissive?: THREE.ColorRepresentation): void {
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const next = mats.map((mat) => {
      if (mat.name !== materialName) return mat;
      const copy = (mat as THREE.MeshStandardMaterial).clone();
      copy.color.set(color);
      if (emissive !== undefined) copy.emissive.set(emissive);
      return copy;
    });
    m.material = Array.isArray(m.material) ? next : next[0];
  });
}

/** Multiply emissive intensity of every material in a model (useful for bloom tuning). */
export function setEmissive(model: THREE.Object3D, materialName: string, intensity: number): void {
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) if (mat.name === materialName) (mat as THREE.MeshStandardMaterial).emissiveIntensity = intensity;
  });
}
