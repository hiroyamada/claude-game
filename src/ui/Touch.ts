import type { Game } from '../Game';
import type { Action } from '../engine/Input';

// On-screen controls: floating left stick, right-side camera drag, action buttons.

export class TouchControls {
  root = document.createElement('div');
  private stick = document.createElement('div');
  private knob = document.createElement('i');
  private moveId: number | null = null;
  private moveOrigin = { x: 0, y: 0 };
  private lookTouches = new Map<number, { x: number; y: number }>();
  visible = false;

  constructor(private g: Game) {
    this.root.id = 'touch';
    const moveZone = document.createElement('div'); moveZone.id = 'movezone';
    const lookZone = document.createElement('div'); lookZone.id = 'lookzone';
    this.root.append(moveZone, lookZone);
    this.stick.id = 'stick'; this.stick.appendChild(this.knob); this.stick.style.display = 'none';
    this.root.appendChild(this.stick);

    moveZone.addEventListener('pointerdown', (e) => {
      if (this.moveId !== null) return;
      this.moveId = e.pointerId; moveZone.setPointerCapture(e.pointerId);
      this.moveOrigin = { x: e.clientX, y: e.clientY };
      this.stick.style.display = 'block';
      this.stick.style.left = e.clientX + 'px'; this.stick.style.top = e.clientY + 'px';
      this.knob.style.transform = '';
      g.audioUnlock();
    });
    moveZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.moveId) return;
      let dx = e.clientX - this.moveOrigin.x, dy = e.clientY - this.moveOrigin.y;
      const R = 50; const len = Math.hypot(dx, dy);
      if (len > R) { dx = (dx / len) * R; dy = (dy / len) * R; }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const mx = dx / R, my = -dy / R;
      g.input.setTouchMove(mx, my);
      g.input.setTouchAction('sprint', len > R * 1.6 && false);
    });
    const endMove = (e: PointerEvent) => {
      if (e.pointerId !== this.moveId) return;
      this.moveId = null; this.stick.style.display = 'none'; g.input.setTouchMove(0, 0);
    };
    moveZone.addEventListener('pointerup', endMove); moveZone.addEventListener('pointercancel', endMove);

    lookZone.addEventListener('pointerdown', (e) => { lookZone.setPointerCapture(e.pointerId); this.lookTouches.set(e.pointerId, { x: e.clientX, y: e.clientY }); g.audioUnlock(); });
    lookZone.addEventListener('pointermove', (e) => {
      const p = this.lookTouches.get(e.pointerId); if (!p) return;
      g.input.addTouchLook(e.clientX - p.x, e.clientY - p.y);
      p.x = e.clientX; p.y = e.clientY;
    });
    const endLook = (e: PointerEvent) => this.lookTouches.delete(e.pointerId);
    lookZone.addEventListener('pointerup', endLook); lookZone.addEventListener('pointercancel', endLook);

    // buttons: [action, label, right, bottom, size, caption, toggle?]
    const R = (v: number) => `calc(${v}px + env(safe-area-inset-right))`;
    const B = (v: number) => `calc(${v}px + env(safe-area-inset-bottom))`;
    const btns: [Action, string, number, number, number, string][] = [
      ['attack', '⚔', 40, 40, 78, 'Attack'],
      ['jump', '⤒', 130, 20, 62, 'Jump'],
      ['interact', '✋', 30, 136, 58, 'Use'],
      ['sprint', '»', 210, 22, 54, 'Sprint'],
      ['shield', '🛡', 122, 110, 54, 'Guard'],
      ['aim', '🏹', 200, 100, 52, 'Aim'],
      ['rune', '✦', 110, 190, 50, 'Rune'],
      ['throw', '↗', 30, 220, 44, 'Throw'],
      ['crouch', '⇩', 280, 22, 44, 'Sneak'],
    ];
    for (const [a, label, r, b, size, cap] of btns) {
      const el = document.createElement('div'); el.className = 'tbtn'; el.innerHTML = `${label}<small>${cap}</small>`;
      Object.assign(el.style, { right: R(r), bottom: B(b), width: size + 'px', height: size + 'px', fontSize: size * 0.4 + 'px' });
      const down = (e: PointerEvent) => { e.preventDefault(); e.stopPropagation(); el.setPointerCapture(e.pointerId); el.classList.add('on'); g.input.setTouchAction(a, true); if (a === 'interact') g.input.setTouchAction('confirm', true); g.audioUnlock(); };
      const up = (e: PointerEvent) => { e.preventDefault(); el.classList.remove('on'); g.input.setTouchAction(a, false); if (a === 'interact') g.input.setTouchAction('confirm', false); };
      el.addEventListener('pointerdown', down); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
      this.root.appendChild(el);
    }
    // top buttons
    const top: [Action | 'runeCycle', string, number][] = [['menu', '☰', 16], ['map', '🗺', 76], ['runeCycle', '⟳✦', 136]];
    for (const [a, label, l] of top) {
      const el = document.createElement('div'); el.className = 'tbtn'; el.textContent = label;
      Object.assign(el.style, { right: `calc(${l}px + env(safe-area-inset-right))`, top: `calc(${a === 'menu' ? 84 : 84}px + env(safe-area-inset-top))`, width: '48px', height: '48px', fontSize: '18px' });
      el.style.right = `calc(${l}px + env(safe-area-inset-right))`;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (a === 'runeCycle') { g.runes.cycle(); return; }
        g.input.setTouchAction(a as Action, true); setTimeout(() => g.input.setTouchAction(a as Action, false), 80);
      });
      this.root.appendChild(el);
    }
    document.getElementById('ui')!.appendChild(this.root);
    this.setVisible(false);
  }

  setVisible(v: boolean) {
    this.visible = v;
    this.root.style.display = v ? 'block' : 'none';
    document.body.classList.toggle('touch', v);
  }
}
