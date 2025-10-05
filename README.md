## Candy Crash — Match-3 (Phaser + Vite + TypeScript)

A polished, responsive Match-3 game inspired by Candy Crush. Supports photo uploads to replace tiles, smooth animations, lightweight synth sounds, and score/move UI.

### Run locally

```bash
npm install
npm run dev
```
Then open the URL shown (usually `http://localhost:5173`).

### Build

```bash
npm run build
npm run preview
```

### Features
- 8x8 grid with swap, match, clear, drop, and refill
- Score and move counter (30 moves/start)
- Upload your own images to become tiles (up to 6)
- Responsive scaling for desktop and mobile
- Synth beeps for swap/match/drop

### Controls
- Click/tap two adjacent tiles to swap. If no match, swap reverts.
- Use the Add Photos button to select custom images.
- Reset to restart moves and score.

### Tech
- Phaser 3
- Vite + TypeScript

### Notes
- Uploaded images are used via object URLs in-browser; nothing is uploaded externally.
- Sound uses WebAudio buffers for tiny footprint.

