import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** Renderer with shadows, filmic tone mapping and a mobile-friendly pixel-ratio cap. */
export function createRenderer(): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  return renderer;
}

export interface Pipeline {
  render: () => void;
  resize: () => void;
}

/** Render pass + bloom + output (tone mapping / colour space). Add `?nofx` to the URL to disable bloom. */
export function createPipeline(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  { bloom = 0.8, threshold = 0.7, radius = 0.4 } = {},
): Pipeline {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), bloom, radius, threshold);
  const noFx = new URLSearchParams(location.search).has('nofx');
  if (!noFx) composer.addPass(bloomPass);
  composer.addPass(new OutputPass());

  const resize = () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    bloomPass.resolution.set(innerWidth, innerHeight);
  };
  window.addEventListener('resize', resize);
  return { render: () => composer.render(), resize };
}
