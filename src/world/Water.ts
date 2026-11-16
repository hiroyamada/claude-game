import * as THREE from 'three';
import { HALF, WORLD_SIZE, GRID } from './WorldData';
import { globalUniforms } from '../engine/Materials';

export class Water {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, heightTex: THREE.DataTexture, sky: { sunDir: THREE.Vector3 }) {
    const geo = new THREE.PlaneGeometry(2400, 2400, 120, 120);
    geo.rotateX(-Math.PI / 2);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, fog: true, depthWrite: false,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: globalUniforms.uTime,
        uHeight: { value: heightTex },
        uSunDir: { value: sky.sunDir },
        uSunCol: { value: new THREE.Color(1, 1, 1) },
        uSkyCol: { value: new THREE.Color(0x9fd0f0) },
        uDeep: { value: new THREE.Color(0x1d5f8a) },
        uShallow: { value: new THREE.Color(0x4fc7c0) },
        uLevel: { value: 0 },
        uLight: { value: 1 },
      }]),
      vertexShader: `
        uniform float uTime; uniform float uLevel;
        varying vec3 vW; varying float vWave;
        #include <fog_pars_vertex>
        void main(){
          vec3 p = position;
          vec4 wp = modelMatrix * vec4(p,1.0);
          float w = sin(wp.x*0.08 + uTime*1.2)*0.12 + sin(wp.z*0.11 - uTime*0.9)*0.1 + sin((wp.x+wp.z)*0.21 + uTime*2.0)*0.05;
          wp.y = uLevel + w;
          vWave = w;
          vW = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D uHeight; uniform float uTime; uniform vec3 uSunDir, uSunCol, uSkyCol, uDeep, uShallow; uniform float uLight;
        varying vec3 vW; varying float vWave;
        #include <fog_pars_fragment>
        float terrainH(vec2 xz){
          vec2 uv = (xz + ${HALF.toFixed(1)}) / ${WORLD_SIZE.toFixed(1)};
          if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -24.0;
          ivec2 ip = ivec2(uv * ${GRID.toFixed(1)});
          return texelFetch(uHeight, ip, 0).r;
        }
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
        void main(){
          float depth = vW.y - terrainH(vW.xz);
          vec2 q = vW.xz*0.35;
          float n1 = vn(q + vec2(uTime*0.4, uTime*0.3));
          float n2 = vn(q*1.7 - vec2(uTime*0.3, -uTime*0.5));
          vec3 N = normalize(vec3((n1-0.5)*0.5, 1.0, (n2-0.5)*0.5));
          vec3 V = normalize(cameraPosition - vW);
          float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
          vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 7.0, depth));
          col = mix(col, uSkyCol, fres*0.6);
          vec3 H = normalize(uSunDir + V);
          float spec = pow(max(dot(N, H), 0.0), 180.0);
          col *= uLight;
          col += uSunCol * spec * 1.6;
          // toon sparkles
          float sp = step(0.93, vn(vW.xz*1.6 + uTime*0.8) * vn(vW.xz*2.3 - uTime*0.6) * 1.9);
          col += sp * 0.35 * uLight;
          // shore foam
          float foam = smoothstep(0.9, 0.0, depth + vWave*1.5 + (n1-0.5)*0.6);
          col = mix(col, vec3(0.95,0.98,1.0)*max(uLight,0.35), foam*0.85);
          float alpha = clamp(0.55 + depth*0.08 + fres*0.3, 0.55, 0.92);
          alpha = max(alpha, foam);
          gl_FragColor = vec4(col, alpha);
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }

  update(camPos: THREE.Vector3, sunCol: THREE.Color, skyCol: THREE.Color, light: number) {
    // snap to grid so wave pattern stays world-anchored
    this.mesh.position.set(Math.round(camPos.x / 20) * 20, 0, Math.round(camPos.z / 20) * 20);
    this.mat.uniforms.uSunCol.value.copy(sunCol);
    this.mat.uniforms.uSkyCol.value.copy(skyCol);
    this.mat.uniforms.uLight.value = light;
  }
}

/** simple flat water for shrine pools */
export function makePoolWater(w: number, d: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshToonMaterial({ color: 0x3fa9c9, transparent: true, opacity: 0.75 }));
  m.rotation.x = -Math.PI / 2;
  return m;
}
