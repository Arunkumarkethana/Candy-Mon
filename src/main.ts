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
// Stats sheet elements
const sheet = document.getElementById('stats-sheet') as HTMLDivElement | null
const sheetBackdrop = sheet?.querySelector('.sheet-backdrop') as HTMLDivElement | null
const sheetLevel = document.getElementById('sheet-level') as HTMLDivElement | null
const sheetGoal = document.getElementById('sheet-goal') as HTMLDivElement | null
const sheetBest = document.getElementById('sheet-best') as HTMLDivElement | null
const sheetDaily = document.getElementById('sheet-daily') as HTMLButtonElement | null
const sheetFx = document.getElementById('sheet-fx') as HTMLButtonElement | null
const sheetMute = document.getElementById('sheet-mute') as HTMLButtonElement | null
const sheetReset = document.getElementById('sheet-reset') as HTMLButtonElement | null
const sheetVol = document.getElementById('sheet-volume') as HTMLInputElement | null
const sheetColorBlind = document.getElementById('sheet-colorblind') as HTMLInputElement | null
const sheetChill = document.getElementById('sheet-chill') as HTMLInputElement | null
const sheetInstall = document.getElementById('sheet-install') as HTMLButtonElement | null
const sheetReminder = document.getElementById('sheet-reminder') as HTMLInputElement | null
const sheetMissions = document.getElementById('sheet-missions') as HTMLDivElement | null

// Global audio state
let muted = false

resetBtn?.addEventListener('click', () => {
  getGameScene()?.resetBoard()
})

// Initialize mute labels on load
try {
  const dockLabel = dockMute?.querySelector('span')
  if (dockLabel) dockLabel.textContent = muted ? 'Unmute' : 'Mute'
  if (sheetMute) sheetMute.textContent = muted ? 'Unmute' : 'Mute'
} catch {}

// iOS audio unlock on first user gesture
try {
  const unlock = () => { getGameScene()?.warmAudio() }
  window.addEventListener('pointerdown', unlock, { once: true })
  window.addEventListener('touchend', unlock, { once: true, passive: true } as any)
} catch {}

// Initialize color-blind from persistence
try {
  const cb = localStorage.getItem('cc_color_blind') === '1'
  sheetColorBlind && (sheetColorBlind.checked = cb)
  getGameScene()?.setColorBlind(cb)
} catch {}

// Initialize Chill Mode and Reminder from persistence
try {
  const chill = localStorage.getItem('cc_chill') === '1'
  sheetChill && (sheetChill.checked = chill)
  getGameScene()?.setChillMode(chill)
  const rem = localStorage.getItem('cc_daily_rem') === '1'
  sheetReminder && (sheetReminder.checked = rem)
} catch {}

// HUD collapse toggle for mobile
let collapsed = false
const setCollapsed = (v: boolean) => {
  collapsed = v
  if (!uiRoot) return
  if (collapsed) uiRoot.classList.add('collapsed')
  else uiRoot.classList.remove('collapsed')
  try {
    if (!collapsed) document.body.classList.add('hud-open')
    else document.body.classList.remove('hud-open')
  } catch {}
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
    if (sheetBest) sheetBest.textContent = String(best)
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
  if (sheetLevel) sheetLevel.textContent = String(ev.detail.level)
  if (sheetGoal) sheetGoal.textContent = String(ev.detail.goal)
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
muteBtn?.addEventListener('click', () => {
  muted = !muted
  getGameScene()?.setMuted(muted)
  muteBtn.textContent = muted ? 'Unmute' : 'Mute'
  // Reflect across dock and sheet
  try {
    const dockLabel = dockMute?.querySelector('span')
    if (dockLabel) dockLabel.textContent = muted ? 'Unmute' : 'Mute'
    if (sheetMute) sheetMute.textContent = muted ? 'Unmute' : 'Mute'
  } catch {}
  if (!muted) getGameScene()?.warmAudio()
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

// Open stats sheet from mini-strip (tap either number)
miniScore?.addEventListener('click', () => sheet?.classList.add('open'))
miniMoves?.addEventListener('click', () => sheet?.classList.add('open'))
sheetBackdrop?.addEventListener('click', () => sheet?.classList.remove('open'))

// Wire sheet controls to existing ones
sheetDaily?.addEventListener('click', () => dockDaily?.click())
sheetFx?.addEventListener('click', () => dockFx?.click())
sheetMute?.addEventListener('click', () => dockMute?.click())
sheetReset?.addEventListener('click', () => dockReset?.click())
sheetVol?.addEventListener('input', () => {
  const v = (parseInt(sheetVol.value, 10) || 0) / 100
  getGameScene()?.setVolume(v)
  if (volumeSlider) volumeSlider.value = String(Math.round(v * 100))
})

sheetColorBlind?.addEventListener('change', () => {
  const v = !!sheetColorBlind.checked
  try { localStorage.setItem('cc_color_blind', v ? '1' : '0') } catch {}
  getGameScene()?.setColorBlind(v)
})

sheetChill?.addEventListener('change', () => {
  const v = !!sheetChill.checked
  try { localStorage.setItem('cc_chill', v ? '1' : '0') } catch {}
  getGameScene()?.setChillMode(v)
})

sheetReminder?.addEventListener('change', () => {
  const v = !!sheetReminder.checked
  try { localStorage.setItem('cc_daily_rem', v ? '1' : '0') } catch {}
})

// Missions rendering
window.addEventListener('MissionsUpdate', (ev: any) => {
  if (!sheetMissions) return
  const list = ev.detail as Array<{ id: string, label: string, progress: number, target: number, done: boolean }>
  sheetMissions.innerHTML = ''
  list.forEach(m => {
    const wrap = document.createElement('div')
    wrap.className = 'mission-item'
    const label = document.createElement('div')
    label.className = 'mission-label'
    label.textContent = m.label
    const status = document.createElement('div')
    status.className = 'mission-done'
    status.textContent = m.done ? 'Done' : `${m.progress}/${m.target}`
    const bar = document.createElement('div')
    bar.className = 'mission-bar'
    const fill = document.createElement('i')
    const pct = Math.min(100, Math.floor((m.progress / m.target) * 100))
    fill.style.width = pct + '%'
    bar.appendChild(fill)
    wrap.appendChild(label)
    wrap.appendChild(status)
    wrap.appendChild(bar)
    sheetMissions.appendChild(wrap)
  })
})

// PWA install prompt handling
let deferredPrompt: any
window.addEventListener('beforeinstallprompt', (e: any) => {
  e.preventDefault()
  deferredPrompt = e
  if (sheetInstall) sheetInstall.style.display = 'inline-flex'
})
sheetInstall?.addEventListener('click', async () => {
  try {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    await deferredPrompt.userChoice
    deferredPrompt = null
    if (sheetInstall) sheetInstall.style.display = 'none'
  } catch {}
})


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
