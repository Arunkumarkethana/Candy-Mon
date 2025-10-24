import './style.css'
import Phaser from 'phaser'
import { GameScene } from './phaser/GameScene'

const parent = document.getElementById('app')!

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 720,
  height: 1280,
  parent,
  transparent: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 720,
    height: 1280
  },
  physics: {
    default: 'arcade',
    arcade: { gravity: { x: 0, y: 0 } }
  },
  scene: [GameScene]
}

const game = new Phaser.Game(config)

// Wire UI controls to the scene once ready
function getGameScene(): GameScene | undefined {
  return game.scene.keys['GameScene'] as GameScene | undefined
}

const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement | null
const scoreEl = document.getElementById('score') as HTMLSpanElement | null
const movesEl = document.getElementById('moves') as HTMLSpanElement | null
const goalEl = document.getElementById('goal') as HTMLSpanElement | null
const levelEl = document.getElementById('level') as HTMLSpanElement | null
const muteBtn = document.getElementById('mute-btn') as HTMLButtonElement | null
const brandBar = document.querySelector('.brand-progress-bar') as HTMLDivElement | null
const fxToggle = document.getElementById('fx-toggle') as HTMLButtonElement | null
const volumeSlider = document.getElementById('volume') as HTMLInputElement | null
const dailyBtn = document.getElementById('daily-btn') as HTMLButtonElement | null
const bestEl = document.getElementById('best') as HTMLSpanElement | null
const barToggle = document.getElementById('bar-toggle') as HTMLButtonElement | null
const uiRoot = document.getElementById('ui-root') as HTMLDivElement | null
// Bottom dock elements
const dockDaily = document.getElementById('dock-daily') as HTMLButtonElement | null
const dockFx = document.getElementById('dock-fx') as HTMLButtonElement | null
const dockMute = document.getElementById('dock-mute') as HTMLButtonElement | null
const dockReset = document.getElementById('dock-reset') as HTMLButtonElement | null
// Mini-strip values
const miniScore = document.getElementById('mini-score') as HTMLSpanElement | null
const miniMoves = document.getElementById('mini-moves') as HTMLSpanElement | null

resetBtn?.addEventListener('click', () => {
  getGameScene()?.resetBoard()
})

// HUD collapse toggle for mobile
let collapsed = false
const setCollapsed = (v: boolean) => {
  collapsed = v
  if (!uiRoot) return
  if (collapsed) uiRoot.classList.add('collapsed')
  else uiRoot.classList.remove('collapsed')
}
barToggle?.addEventListener('click', () => setCollapsed(!collapsed))

// Auto-collapse after idle on mobile
let idleTimer: any
const touchEvents = ['touchstart','touchend','pointerdown','pointerup']
const resetIdle = () => {
  clearTimeout(idleTimer)
  if (window.innerWidth <= 720) {
    // Keep focus on board: default collapsed on mobile
    setCollapsed(true)
    idleTimer = setTimeout(() => setCollapsed(true), 2500)
  }
}
touchEvents.forEach(e => window.addEventListener(e, resetIdle, { passive: true }))
resetIdle()

// Volume slider -> scene volume
volumeSlider?.addEventListener('input', () => {
  const v = (parseInt(volumeSlider.value, 10) || 0) / 100
  getGameScene()?.setVolume(v)
})

// Daily challenge
dailyBtn?.addEventListener('click', () => {
  getGameScene()?.startDaily()
  // reset UI best to daily session start (best remains all-time)
})
// Bottom dock bindings (with haptic taps)
const tap = () => { try { (navigator as any).vibrate?.(8) } catch {} }
dockDaily?.addEventListener('click', () => { tap(); getGameScene()?.startDaily() })
dockFx?.addEventListener('click', () => { tap(); fxToggle?.click() })
dockMute?.addEventListener('click', () => { tap(); muteBtn?.click() })
dockReset?.addEventListener('click', () => { tap(); resetBtn?.click() })

// Listen to scene events for UI updates
window.addEventListener('GameScore', (ev: any) => {
  const score = ev.detail as number
  if (scoreEl) {
    scoreEl.textContent = `Score: ${score}`
    pulse(scoreEl)
  }
  if (miniScore) miniScore.textContent = String(score)
  updateBrandProgress(score)
  // Update best from localStorage if improved by scene
  try {
    const raw = localStorage.getItem('cc_best')
    const best = raw ? parseInt(raw, 10) : 0
    if (bestEl) bestEl.textContent = `Best: ${best}`
  } catch {}
})
window.addEventListener('GameMoves', (ev: any) => {
  if (movesEl) {
    movesEl.textContent = `Moves: ${ev.detail}`
    pulse(movesEl)
  }
  if (miniMoves) miniMoves.textContent = String(ev.detail)
})
window.addEventListener('GameLevel', (ev: any) => {
  if (levelEl) levelEl.textContent = `Level: ${ev.detail.level}`
  if (goalEl) goalEl.textContent = `Goal: ${ev.detail.goal}`
  // Recompute progress with new goal
  const scoreText = scoreEl?.textContent?.match(/\d+/)?.[0]
  const currentScore = scoreText ? parseInt(scoreText, 10) : 0
  updateBrandProgress(currentScore, ev.detail.goal)
})
window.addEventListener('GameLevel', (ev: any) => {
  if (levelEl) levelEl.textContent = `Level: ${ev.detail.level}`
  if (goalEl) goalEl.textContent = `Goal: ${ev.detail.goal}`
  // Recompute progress with new goal
  const scoreText = scoreEl?.textContent?.match(/\d+/)?.[0]
  const currentScore = scoreText ? parseInt(scoreText, 10) : 0
  updateBrandProgress(currentScore, ev.detail.goal)
})

function pulse(el: Element) {
  el.classList.remove('pulse')
  // Force reflow to restart animation
  void (el as HTMLElement).offsetWidth
  el.classList.add('pulse')
}

function updateBrandProgress(score: number, goal?: number) {
  if (!brandBar) return
  const goalText = goal ?? (goalEl?.textContent?.match(/\d+/)?.[0] ? parseInt(goalEl!.textContent!.match(/\d+/)![0], 10) : 0)
  const denom = goalText > 0 ? goalText : 1
  const pct = Math.max(0, Math.min(1, score / denom))
  brandBar.style.width = `${Math.floor(pct * 100)}%`
  // Toggle near-goal glow
  if (goalEl) {
    if (pct >= 0.8) goalEl.classList.add('goal-hot')
    else goalEl.classList.remove('goal-hot')
  }
}

//

// Mute
let muted = false
muteBtn?.addEventListener('click', () => {
  muted = !muted
  getGameScene()?.setMuted(muted)
  muteBtn.textContent = muted ? 'Unmute' : 'Mute'
})

// Reduced effects toggle
let reducedFx = false
fxToggle?.addEventListener('click', () => {
  reducedFx = !reducedFx
  fxToggle.textContent = reducedFx ? 'FX: Off' : 'FX: On'
  getGameScene()?.setReducedEffects(reducedFx)
})

// Listen for UI shimmer trigger
window.addEventListener('UiShimmer', () => {
  const bar = document.querySelector('.top-bar') as HTMLElement | null
  if (!bar) return
  bar.classList.add('shimmer-on')
  setTimeout(() => bar.classList.remove('shimmer-on'), 1200)
})

// Register service worker (PWA)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

// Light haptics where supported
function vibrate(ms: number) {
  try { (navigator as any).vibrate?.(ms) } catch {}
}
window.addEventListener('GameMatch', () => vibrate(10))
window.addEventListener('GameLevel', () => vibrate(20))


// Dynamic contrast for UI based on background brightness
function setUiThemeForBackground(url?: string) {
  const root = document.getElementById('ui-root')
  if (!root) return
  const imgUrl = url || extractBodyBgUrl()
  if (!imgUrl) { root.classList.remove('ui-light'); return }
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas')
      const size = 48
      canvas.width = size; canvas.height = size
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, size, size)
      const data = ctx.getImageData(0, 0, size, size).data
      let sum = 0, n = data.length / 4
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i+1], b = data[i+2]
        // Perceived luminance
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
        sum += l
      }
      const avg = (sum / n) / 255
      if (avg > 0.55) root.classList.add('ui-light')
      else root.classList.remove('ui-light')
    } catch {}
  }
  img.src = imgUrl.replace(/^url\(["']?/, '').replace(/["']?\)$/, '')
}

function extractBodyBgUrl(): string | undefined {
  const bg = getComputedStyle(document.body).backgroundImage
  if (!bg || bg === 'none') return undefined
  const m = bg.match(/url\((.*)\)/)
  return m ? m[1].replace(/^["']|["']$/g, '') : undefined
}

window.addEventListener('UiBackground', (ev: any) => {
  setUiThemeForBackground(ev?.detail?.url)
})

// Run once on startup in case a background is already set
setUiThemeForBackground()
// Initialize best pill from storage on load
try {
  const raw = localStorage.getItem('cc_best')
  const best = raw ? parseInt(raw, 10) : 0
  if (bestEl) bestEl.textContent = `Best: ${best}`
} catch {}

// No background video; backgrounds can be set by scene when available
