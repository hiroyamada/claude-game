import * as THREE from 'three';

let gradient: THREE.DataTexture | null = null;
export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  // soft 3-band ramp (painterly)
  const w = 64; const d = new Uint8Array(w * 4);
  for (let i = 0; i < w; i++) {
    const t = i / (w - 1);
    const band = (x: number, c: number, s: number) => 1 / (1 + Math.exp(-(x - c) / s));
    const v = 0.42 + 0.3 * band(t, 0.32, 0.035) + 0.28 * band(t, 0.62, 0.04);
    const c = Math.round(Math.min(1, v) * 255);
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = c; d[i * 4 + 3] = 255;
  }
  gradient = new THREE.DataTexture(d, w, 1, THREE.RGBAFormat);
  gradient.minFilter = gradient.magFilter = THREE.LinearFilter;
  gradient.needsUpdate = true;
  return gradient;
}

export const globalUniforms = {
  uTime: { value: 0 },
  uWind: { value: 1 },
  uPlayerPos: { value: new THREE.Vector3() },
};

let noiseTex: THREE.DataTexture | null = null;
export function valueNoiseTexture(): THREE.DataTexture {
  if (noiseTex) return noiseTex;
  const s = 128; const d = new Uint8Array(s * s * 4);
  const rnd = (x: number, y: number) => { const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); };
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    // smooth tiled value noise, 2 octaves
    let v = 0, a = 0.6, f = 8;
    for (let o = 0; o < 3; o++) {
      const fx = (x / s) * f, fy = (y / s) * f;
      const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      const w = (i: number, j: number) => rnd(((ix + i) % f + f) % f, ((iy + j) % f + f) % f);
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const n = (w(0, 0) * (1 - sx) + w(1, 0) * sx) * (1 - sy) + (w(0, 1) * (1 - sx) + w(1, 1) * sx) * sy;
      v += n * a; a *= 0.5; f *= 2;
    }
    const c = Math.round(Math.min(1, v / 1.05) * 255);
    d[(y * s + x) * 4] = c; d[(y * s + x) * 4 + 1] = c; d[(y * s + x) * 4 + 2] = c; d[(y * s + x) * 4 + 3] = 255;
  }
  noiseTex = new THREE.DataTexture(d, s, s, THREE.RGBAFormat);
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
  noiseTex.minFilter = THREE.LinearMipmapLinearFilter; noiseTex.magFilter = THREE.LinearFilter;
  noiseTex.generateMipmaps = true;
  noiseTex.needsUpdate = true;
  return noiseTex;
}

export interface ToonOpts {
  color?: THREE.ColorRepresentation;
  vertexColors?: boolean;
  map?: THREE.Texture | null;
  worldNoise?: boolean; // break up flat colors with world-space noise
  wind?: number; // sway amount (scaled by local y)
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  rim?: number;
}

export function makeToonMaterial(o: ToonOpts = {}): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({
    color: o.color ?? 0xffffff,
    vertexColors: !!o.vertexColors,
    map: o.map ?? null,
    gradientMap: toonGradient(),
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.emissiveIntensity ?? 1,
    transparent: !!o.transparent,
    opacity: o.opacity ?? 1,
    side: o.side ?? THREE.FrontSide,
  });
  const rim = o.rim ?? 0.25;
  if (o.worldNoise || o.wind || rim > 0) {
    const tex = o.worldNoise ? valueNoiseTexture() : null;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = globalUniforms.uTime;
      sh.uniforms.uWind = globalUniforms.uWind;
      if (tex) sh.uniforms.uNoise = { value: tex };
      sh.uniforms.uRim = { value: rim };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\nuniform float uTime; uniform float uWind; varying vec3 vWPos;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${o.wind ? `{
          #ifdef USE_INSTANCING
            vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          #else
            vec3 ip = vec3(modelMatrix[3][0], modelMatrix[3][1], modelMatrix[3][2]);
          #endif
          float hh = max(0.0, transformed.y);
          float sw = sin(uTime * 1.3 + ip.x * 0.15 + ip.z * 0.11) * 0.6 + sin(uTime * 2.7 + ip.x * 0.4) * 0.25;
          transformed.x += sw * ${o.wind.toFixed(3)} * hh * hh * 0.02 * uWind;
          transformed.z += cos(uTime * 1.1 + ip.z * 0.13) * ${o.wind.toFixed(3)} * hh * hh * 0.012 * uWind;
        }` : ''}`)
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          vec4 wpx = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wpx = instanceMatrix * wpx;
          #endif
          vWPos = (modelMatrix * wpx).xyz;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vWPos; uniform float uRim; ${tex ? 'uniform sampler2D uNoise;' : ''}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          ${tex ? `{
            float n1 = texture2D(uNoise, vWPos.xz * 0.013).r;
            float n2 = texture2D(uNoise, vWPos.xz * 0.11).r;
            diffuseColor.rgb *= 0.82 + n1 * 0.28 + (n2 - 0.5) * 0.12;
          }` : ''}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          {
            float r = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
            totalEmissiveRadiance += diffuseColor.rgb * r * uRim;
          }`);
    };
    m.customProgramCacheKey = () => `toon_${!!tex}_${o.wind || 0}_${rim}`;
  }
  return m;
}

/** Convert a loaded GLTF scene's materials into toon materials (keeps texture maps). */
export function toonify(root: THREE.Object3D, rim = 0.3) {
  const cache = new Map<THREE.Material, THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const conv = (mat: THREE.Material) => {
      if (cache.has(mat)) return cache.get(mat)!;
      const sm = mat as THREE.MeshStandardMaterial;
      const t = makeToonMaterial({ color: sm.color ? sm.color.getHex() : 0xffffff, map: sm.map || null, rim });
      if (sm.map) sm.map.colorSpace = THREE.SRGBColorSpace;
      cache.set(mat, t);
      return t;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(conv) : conv(mesh.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
}
