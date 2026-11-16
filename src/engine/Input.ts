// Unified input: keyboard+mouse, gamepad (Switch Pro / any standard pad), touch.

export type Action =
  | 'jump' | 'attack' | 'interact' | 'sprint' | 'shield' | 'aim' | 'rune' | 'throw'
  | 'crouch' | 'camReset' | 'menu' | 'map'
  | 'up' | 'down' | 'left' | 'right' | 'sUp' | 'sDown' | 'sLeft' | 'sRight' | 'confirm' | 'back' | 'tabL' | 'tabR'
  | 'rune1' | 'rune2' | 'rune3' | 'rune4' | 'cycleWeapon' | 'cycleShield' | 'zoomIn' | 'zoomOut';

export type Device = 'kbm' | 'pad' | 'touch';

const KEYMAP: Record<string, Action[]> = {
  Space: ['jump'], ShiftLeft: ['sprint'], ShiftRight: ['sprint'],
  KeyE: ['interact', 'confirm'], Enter: ['confirm', 'interact'], KeyF: ['rune'], KeyR: ['throw'],
  KeyC: ['crouch'], ControlLeft: ['crouch'], KeyQ: ['aim'], Tab: ['shield'],
  Escape: ['menu', 'back'], KeyI: ['menu'], KeyM: ['map'], Backspace: ['back'],
  ArrowUp: ['up'], ArrowDown: ['down'], ArrowLeft: ['left'], ArrowRight: ['right'],
  Digit1: ['rune1'], Digit2: ['rune2'], Digit3: ['rune3'], Digit4: ['rune4'],
  Digit5: ['cycleWeapon'], Digit6: ['cycleShield'], KeyV: ['camReset'],
  BracketLeft: ['tabL'], BracketRight: ['tabR'], KeyZ: ['tabL'], KeyX: ['tabR'],
};

const STICK = { up: 'sUp', down: 'sDown', left: 'sLeft', right: 'sRight' } as const;

export class Input {
  private keys = new Set<string>();
  private mouseButtons = new Set<number>();
  private touchActions = new Set<Action>();
  private cur = new Set<Action>();
  private prev = new Set<Action>();
  move = { x: 0, y: 0 };
  look = { x: 0, y: 0 }; // radians this frame
  private mouseDX = 0; private mouseDY = 0; private wheel = 0;
  private touchMove = { x: 0, y: 0 };
  private touchLookDX = 0; private touchLookDY = 0;
  device: Device = 'kbm';
  pointerLocked = false;
  sensitivity = 1;
  invertY = false;
  swapFaceButtons = false; // for controllers that report Nintendo-labelled positions
  padConnected = false;
  padName = '';
  private navRepeat: Record<string, number> = {};
  private canvas: HTMLElement;
  enabledPointerLock = true;
  onDeviceChange?: (d: Device) => void;

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      this.keys.add(e.code); this.setDevice('kbm');
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseButtons.clear(); });
    canvas.addEventListener('mousedown', (e) => {
      this.setDevice('kbm');
      if (this.enabledPointerLock && !this.pointerLocked && canvas.requestPointerLock) {
        try { const p: any = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch {}
      }
      this.mouseButtons.add(e.button);
    });
    window.addEventListener('mouseup', (e) => this.mouseButtons.delete(e.button));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => { this.pointerLocked = document.pointerLockElement === canvas; });
    window.addEventListener('mousemove', (e) => {
      if (this.pointerLocked) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; }
    });
    window.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    window.addEventListener('gamepadconnected', (e: GamepadEvent) => { this.padConnected = true; this.padName = e.gamepad.id; this.setDevice('pad'); });
    window.addEventListener('gamepaddisconnected', () => { this.padConnected = !!this.getPad(); });
  }

  private setDevice(d: Device) { if (this.device !== d) { this.device = d; this.onDeviceChange?.(d); } }

  releasePointer() { if (document.pointerLockElement) document.exitPointerLock(); }

  getPad(): Gamepad | null {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  // touch API
  setTouchAction(a: Action, on: boolean) { if (on) { this.touchActions.add(a); this.setDevice('touch'); } else this.touchActions.delete(a); }
  setTouchMove(x: number, y: number) { this.touchMove.x = x; this.touchMove.y = y; if (x || y) this.setDevice('touch'); }
  addTouchLook(dx: number, dy: number) { this.touchLookDX += dx; this.touchLookDY += dy; }

  rumble(strength = 0.5, ms = 120) {
    const p: any = this.getPad();
    if (p && p.vibrationActuator && p.vibrationActuator.playEffect) {
      try { p.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 }).catch(() => {}); } catch {}
    } else if (this.device === 'touch' && navigator.vibrate) { try { navigator.vibrate(Math.min(ms, 60)); } catch {} }
  }

  update(dt: number) {
    const tmp = this.prev; this.prev = this.cur; this.cur = tmp; this.cur.clear();
    // keyboard
    for (const k of this.keys) { const acts = KEYMAP[k]; if (acts) for (const a of acts) this.cur.add(a); }
    if (this.mouseButtons.has(0)) this.cur.add('attack');
    if (this.mouseButtons.has(2)) this.cur.add('shield');
    if (this.mouseButtons.has(1)) this.cur.add('aim');
    if (this.wheel > 0) this.cur.add('zoomOut'); if (this.wheel < 0) this.cur.add('zoomIn');
    this.wheel = 0;
    let mx = 0, my = 0;
    if (this.keys.has('KeyW')) my += 1; if (this.keys.has('KeyS')) my -= 1;
    if (this.keys.has('KeyD')) mx += 1; if (this.keys.has('KeyA')) mx -= 1;
    let lx = this.mouseDX * 0.0024 * this.sensitivity, ly = this.mouseDY * 0.0024 * this.sensitivity;
    this.mouseDX = this.mouseDY = 0;
    // touch
    for (const a of this.touchActions) this.cur.add(a);
    mx += this.touchMove.x; my += this.touchMove.y;
    lx += this.touchLookDX * 0.006 * this.sensitivity; ly += this.touchLookDY * 0.006 * this.sensitivity;
    this.touchLookDX = this.touchLookDY = 0;
    // gamepad
    const pad = this.getPad();
    if (pad) {
      this.padConnected = true; this.padName = pad.id;
      const b = (i: number) => !!pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.4);
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
      const ax = dz(pad.axes[0] || 0), ay = dz(pad.axes[1] || 0);
      const rx = dz(pad.axes[2] || 0), ry = dz(pad.axes[3] || 0);
      // positions: 0 bottom, 1 right, 2 left, 3 top
      let bottom = b(0), right = b(1), left = b(2), top = b(3);
      if (this.swapFaceButtons) { [bottom, right] = [right, bottom]; [left, top] = [top, left]; }
      const any = bottom || right || left || top || pad.buttons.some((x) => x && x.pressed) || Math.abs(ax) + Math.abs(ay) + Math.abs(rx) + Math.abs(ry) > 0.2;
      if (any) this.setDevice('pad');
      if (right) { this.cur.add('interact'); this.cur.add('confirm'); }
      if (bottom) { this.cur.add('sprint'); this.cur.add('back'); }
      if (top) this.cur.add('jump');
      if (left) this.cur.add('attack');
      if (b(4)) { this.cur.add('rune'); this.cur.add('tabL'); }
      if (b(5)) { this.cur.add('throw'); this.cur.add('tabR'); }
      if (b(6)) this.cur.add('shield');
      if (b(7)) this.cur.add('aim');
      if (b(8)) this.cur.add('map');
      if (b(9)) this.cur.add('menu');
      if (b(10)) this.cur.add('crouch');
      if (b(11)) this.cur.add('camReset');
      if (b(12)) this.cur.add('up'); if (b(13)) this.cur.add('down');
      if (b(14)) this.cur.add('left'); if (b(15)) this.cur.add('right');
      mx += ax; my -= ay;
      lx += rx * 3.2 * dt * this.sensitivity; ly += ry * 2.4 * dt * this.sensitivity;
      // left stick also drives menu nav
      if (ay < -0.6) this.cur.add('sUp'); if (ay > 0.6) this.cur.add('sDown');
      if (ax < -0.6) this.cur.add('sLeft'); if (ax > 0.6) this.cur.add('sRight');
    } else this.padConnected = false;
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    this.move.x = mx; this.move.y = my;
    this.look.x = lx; this.look.y = this.invertY ? -ly : ly;
    // nav repeat bookkeeping
    for (const a of ['up', 'down', 'left', 'right'] as const) {
      if (this.cur.has(a) || this.cur.has(STICK[a])) this.navRepeat[a] = (this.navRepeat[a] ?? -0.35) + dt; else this.navRepeat[a] = -0.35;
    }
  }

  down(a: Action) { return this.cur.has(a); }
  pressed(a: Action) { return this.cur.has(a) && !this.prev.has(a); }
  released(a: Action) { return !this.cur.has(a) && this.prev.has(a); }
  /** pressed with key-repeat, for menus */
  nav(a: 'up' | 'down' | 'left' | 'right') {
    if (this.pressed(a) || this.pressed(STICK[a])) return true;
    const t = this.navRepeat[a];
    if (t !== undefined && t > 0) { this.navRepeat[a] = t - 0.11; return true; }
    return false;
  }
  consume(a: Action) { this.prev.add(a); }
}
