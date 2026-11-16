# Wildreach — Echoes of the Sundered Isle

An open-world action-adventure in the browser, inspired by the mechanics of
modern open-air adventure games: climb almost anything, glide from great
heights, cook, fight skeleton camps, solve rune puzzles in sanctums, climb
towers to reveal the map, and face the Hollow King.

Built with **three.js** + **Vite** + TypeScript. Runs on desktop (keyboard/mouse or
Bluetooth controller — tuned for the Nintendo Switch Pro Controller) and on phones
(touch controls; add to home screen for fullscreen).

## Play locally

```bash
npm install
npm run dev          # http://localhost:5173 (also printed: a LAN URL for your phone)
```

`npm run build` produces a static site in `dist/`.

## Deploy (GitHub Pages)

1. Repo **Settings → Pages → Source: GitHub Actions**.
2. Push to `main` (or run the *Deploy to GitHub Pages* workflow manually).
3. The game is served at `https://<user>.github.io/<repo>/`.

## Controls

| Action | Switch Pro | Keyboard / Mouse | Touch |
|---|---|---|---|
| Move / Camera | Left / Right stick | WASD / Mouse (click to capture) | Left / right side drag |
| Jump · Glide · Climb-jump | X | Space | ⤒ |
| Attack (hold for spin) | Y | Left click | ⚔ |
| Interact | A | E | ✋ |
| Sprint · Swim dash | B | Shift | » |
| Shield + lock-on (hold) | ZL | Right click | 🛡 |
| Dodge / backflip | ZL + X | Right click + Space | 🛡 + ⤒ |
| Aim crossbow (release to fire) | ZR | Q (click to fire) | 🏹 |
| Use rune / switch rune | L / D-pad ↑ | F / 1–4 | ✦ / ⟳ |
| Throw weapon | R | R | ↗ |
| Cycle weapon · shield · crossbow | D-pad → ← ↓ | 5 · 6 | menu |
| Crouch (sneak) | L-stick click | C | ⇩ |
| Menu · Map | + · − | Esc · M | ☰ · 🗺 |

If your controller's A/B and X/Y feel swapped (browser-dependent), toggle
**System → Controller face buttons**.

Graphics quality (Low / Medium / High) is in **System**; phones default to Low.
You can also force it with `?q=0|1|2` in the URL.

## Credits

- Characters, weapons & props: [KayKit Adventurers & Skeletons](https://kaylousberg.itch.io/) by Kay Lousberg — CC0.
- Everything else (terrain, vegetation, sky, water, audio, music) is procedural.
