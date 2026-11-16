import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export type Quality = 0 | 1 | 2; // low (phone), medium, high

export function detectQuality(): Quality {
  const ua = navigator.userAgent;
  const mobile = /iPhone|iPad|Android|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  if (mobile) return 0;
  return 2;
}

const InkShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uNear: { value: 0.1 }, uFar: { value: 1500 },
    uInk: { value: 1 },
    uVignette: { value: 0.35 },
    uSat: { value: 1.12 },
    uHurt: { value: 0 },
    uSlowmo: { value: 0 },
    uCold: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse, tDepth; uniform vec2 uRes; uniform float uNear, uFar, uInk, uVignette, uSat, uHurt, uSlowmo, uCold;
    varying vec2 vUv;
    float lin(float d){ float z = d * 2.0 - 1.0; return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear)); }
    void main(){
      vec4 col = texture2D(tDiffuse, vUv);
      if (uInk > 0.0) {
        vec2 px = 1.0 / uRes;
        float d0 = lin(texture2D(tDepth, vUv).r);
        float d1 = lin(texture2D(tDepth, vUv + vec2(px.x, 0.0)).r);
        float d2 = lin(texture2D(tDepth, vUv - vec2(px.x, 0.0)).r);
        float d3 = lin(texture2D(tDepth, vUv + vec2(0.0, px.y)).r);
        float d4 = lin(texture2D(tDepth, vUv - vec2(0.0, px.y)).r);
        float lap = abs(d1 + d2 + d3 + d4 - 4.0 * d0);
        float edge = smoothstep(0.08, 0.25, lap / max(d0, 1.0) * 6.0);
        edge *= 1.0 - smoothstep(60.0, 220.0, d0);
        col.rgb = mix(col.rgb, col.rgb * 0.35, edge * 0.75 * uInk);
      }
      // saturation / grade
      float l = dot(col.rgb, vec3(0.299, 0.587, 0.114));
      col.rgb = mix(vec3(l), col.rgb, uSat);
      col.rgb = mix(col.rgb, col.rgb * vec3(0.85, 0.95, 1.2), clamp(uCold, 0.0, 1.0) * 0.5);
      if (uSlowmo > 0.0) { col.rgb = mix(col.rgb, vec3(l) * vec3(0.8, 0.95, 1.15), clamp(uSlowmo, 0.0, 1.0) * 0.55); }
      vec2 c = vUv - 0.5;
      float v = 1.0 - dot(c, c) * uVignette * 2.2;
      col.rgb *= v;
      col.rgb = mix(col.rgb, vec3(0.8, 0.05, 0.05), clamp(uHurt, 0.0, 1.0) * smoothstep(0.15, 0.6, length(c)) * 0.7);
      gl_FragColor = col;
    }`,
};

export class Renderer {
  renderer: THREE.WebGLRenderer;
  composer!: EffectComposer;
  ink!: ShaderPass;
  bloom!: UnrealBloomPass;
  quality: Quality;
  usePost = true;
  private rts: THREE.WebGLRenderTarget[] = [];

  constructor(public canvas: HTMLCanvasElement, quality: Quality) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality === 0, powerPreference: 'high-performance' });
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      try { (window as any).game?.save?.(); } catch {}
      const d = document.createElement('div');
      d.style.cssText = 'position:fixed;inset:0;z-index:99;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0b1020;color:#f4efe2;font-family:sans-serif;gap:12px;text-align:center;padding:20px';
      d.innerHTML = '<h2>The graphics driver reset.</h2><p>Your progress was saved. Lowering graphics quality in System settings can help.</p><button style="padding:10px 20px;font-size:16px">Reload</button>';
      d.querySelector('button')!.onclick = () => location.reload();
      document.body.appendChild(d);
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = quality > 0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.setQuality(quality);
  }

  setQuality(q: Quality) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === 2 ? Math.min(dpr, 2) : q === 1 ? Math.min(dpr, 1.5) : Math.min(dpr, 1.5));
    this.usePost = q > 0;
    this.renderer.shadowMap.enabled = q > 0;
  }

  setupComposer(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const mk = () => {
      const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: this.quality === 2 ? 4 : 0 });
      rt.depthTexture = new THREE.DepthTexture(size.x, size.y);
      rt.depthTexture.type = THREE.UnsignedIntType;
      return rt;
    };
    const rt = mk();
    this.rts = [rt];
    this.composer = new EffectComposer(this.renderer, rt);
    // composer clones rt for renderTarget2; give it its own depth texture
    const rt2 = this.composer.renderTarget2;
    rt2.depthTexture = new THREE.DepthTexture(size.x, size.y);
    rt2.depthTexture.type = THREE.UnsignedIntType;
    this.composer.addPass(new RenderPass(scene, camera));
    this.ink = new ShaderPass(InkShader);
    this.ink.uniforms.uNear.value = camera.near; this.ink.uniforms.uFar.value = camera.far;
    this.composer.addPass(this.ink);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.35, 0.5, 0.88);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  resize(camera: THREE.PerspectiveCamera) {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    camera.aspect = w / h; camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
      const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      this.ink.uniforms.uRes.value.set(s.x, s.y);
    }
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    if (this.usePost && this.composer) {
      this.ink.uniforms.tDepth.value = this.composer.readBuffer.depthTexture;
      this.composer.render();
    } else {
      this.renderer.render(scene, camera);
    }
  }
}
