import Phaser from 'phaser'
// Eagerly import candy images from src/candy; Vite replaces with built URLs
const CANDY_URLS = (Object.values(import.meta.glob('../candy/*.{png,jpg,jpeg,webp}', { eager: true, import: 'default', query: '?url' })) as string[])
  .slice(0, 8)

// Eagerly import optional background images from src/background
const BG_URLS = (Object.values(import.meta.glob('../background/*.{png,jpg,jpeg,webp}', { eager: true, import: 'default', query: '?url' })) as string[])

type GridCell = {
  row: number
  col: number
  sprite?: Phaser.GameObjects.Sprite
  kind: number // index into textures
  special?: 'line_h' | 'line_v' | 'bomb' // special piece types
}

const GRID_SIZE = 8
const CELL_PX = 86
const GRID_TOP = 220
const GRID_LEFT = (720 - GRID_SIZE * CELL_PX) / 2
const MOVE_LIMIT = 30
const START_GOAL = 500

export class GameScene extends Phaser.Scene {
  public static readonly KEY = 'GameScene'

  private grid: GridCell[][] = []
  private selected?: GridCell
  private score = 0
  private movesLeft = MOVE_LIMIT
  private level = 1
  private goal = START_GOAL
  private textureKeys: string[] = []

  private sounds!: {
    swap: () => void
    match: () => void
    drop: () => void
    line?: () => void
    bomb?: () => void
  }

  private getEmitter(): Phaser.GameObjects.Particles.ParticleEmitter | undefined {
    if (!this.sparkMgr) return undefined
    const e = this.emitterPool.pop() || this.sparkMgr.createEmitter({
      speed: 120,
      lifespan: 600,
      quantity: 0,
      scale: { start: 1.0, end: 0 },
      angle: { min: 0, max: 360 },
      alpha: { start: 1, end: 0 },
      on: false,
      blendMode: 'ADD'
    })
    return e
  }

  private explodeSpark(x: number, y: number) {
    const e = this.getEmitter()
    if (!e) return
    const qty = this.reducedFx ? 8 : 16
    e.explode(qty, x, y)
    this.time.delayedCall(800, () => { try { e.stop(); this.emitterPool.push(e) } catch {} })
  }

  private gridTop() { return GRID_TOP + this.gridYOffset }
  private recomputeBoardTop() {
    // Only adjust on wider screens (desktop). Mobile layout uses CSS transforms already.
    const isMobile = window.innerWidth <= 720
    if (isMobile) { this.gridYOffset = 0; return }
    const canvasH = this.scale.height || 1280
    const gridH = GRID_SIZE * CELL_PX
    const minTop = 150 // space for title/progress/combo
    const idealTop = Math.max(minTop, Math.floor((canvasH - gridH) / 2))
    this.gridYOffset = idealTop - GRID_TOP
    // Update mask if exists
    if (this.maskGfxRef) {
      this.maskGfxRef.clear()
      this.maskGfxRef.fillStyle(0xffffff, 1)
      this.maskGfxRef.fillRect(GRID_LEFT, this.gridTop(), GRID_SIZE * CELL_PX, GRID_SIZE * CELL_PX)
      this.boardMask = this.maskGfxRef.createGeometryMask()
      // Re-apply new mask to existing sprites
      for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
          const cell = this.grid?.[r]?.[c]
          if (cell?.sprite && this.boardMask) cell.sprite.setMask(this.boardMask)
        }
      }
    }
  }

  // --- Chill Mode and streaks ---
  setChillMode(v: boolean) {
    this.chillMode = v
    if (v) {
      // reflect UI immediately
      this.emitMoves()
    }
  }
  private updateStreak() {
    try {
      const today = new Date(); today.setHours(0,0,0,0)
      const key = 'cc_last_play'
      const raw = localStorage.getItem(key)
      const streakRaw = localStorage.getItem('cc_streak')
      let streak = streakRaw ? parseInt(streakRaw, 10) : 0
      if (!raw) {
        streak = 1
      } else {
        const last = new Date(raw)
        last.setHours(0,0,0,0)
        const diff = (today.getTime() - last.getTime()) / (1000*60*60*24)
        if (diff >= 1 && diff < 2) streak += 1
        else if (diff >= 2) streak = 1
      }
      localStorage.setItem(key, today.toISOString())
      localStorage.setItem('cc_streak', String(streak))
      this.streak = streak
      try { window.dispatchEvent(new CustomEvent('StreakUpdate', { detail: streak })) } catch {}
    } catch {}
  }
  // --- Missions ---
  private initMissions() {
    this.missionRewarded = false
    const kinds = this.getActiveKindCount()
    const pickKind = () => Math.floor(this.rand() * kinds)
    const m: { id: string, label: string, progress: number, target: number, done: boolean }[] = []
    m.push({ id: `clr_${Date.now()}`, label: `Clear 8 of kind ${pickKind()+1}`, progress: 0, target: 8, done: false })
    m.push({ id: `four_${Date.now()}`, label: 'Make one 4-match', progress: 0, target: 1, done: false })
    m.push({ id: `combo_${Date.now()}`, label: 'Hit a x2 combo', progress: 0, target: 1, done: false })
    this.missions = m
  }
  private emitMissions() {
    try { window.dispatchEvent(new CustomEvent('MissionsUpdate', { detail: this.missions.map(x => ({ id: x.id, label: x.label, progress: x.progress, target: x.target, done: x.done })) })) } catch {}
  }
  private missionComboTwo() {
    const m = this.missions.find(mm => mm.label.startsWith('Hit a x2'))
    if (m && !m.done) { m.progress = 1; m.done = true; this.checkMissionReward(); this.emitMissions() }
  }
  private updateMissionsFromClear(groups: GridCell[][]) {
    const byKind: Record<number, number> = {}
    let fourMade = false
    for (const g of groups) {
      if (g.length >= 4) fourMade = true
      for (const cell of g) {
        byKind[cell.kind] = (byKind[cell.kind] || 0) + 1
      }
    }
    // update clear-kind: choose the first clear-kind mission and advance with the most cleared color
    const clearM = this.missions.find(mm => mm.label.startsWith('Clear 8'))
    if (clearM && !clearM.done) {
      const gained = Object.values(byKind).reduce((a,b) => a + b, 0)
      clearM.progress = Math.min(clearM.target, clearM.progress + gained)
      if (clearM.progress >= clearM.target) clearM.done = true
    }
    if (fourMade) {
      const fm = this.missions.find(mm => mm.label.includes('4-match'))
      if (fm && !fm.done) { fm.progress = 1; fm.done = true }
    }
    this.checkMissionReward()
    this.emitMissions()
  }
  private checkMissionReward() {
    if (this.missionRewarded) return
    const doneCount = this.missions.filter(m => m.done).length
    if (doneCount >= 2) {
      this.missionRewarded = true
      this.movesLeft += 3
      this.emitMoves()
      const t = this.add.text(360, 200, '+3 Moves!', { fontFamily: 'Nunito', fontSize: '40px', color: '#8cff9a' }).setOrigin(0.5)
      this.tweens.add({ targets: t, y: 170, alpha: 0, duration: 900, onComplete: () => t.destroy() })
    }
  }

  // Explicitly resume AudioContext on first gesture for mobile autoplay policies
  warmAudio() {
    try {
      const audioManager = this.sound as any
      const ctx = audioManager?.context || audioManager?.audioContext
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {})
      }
      // Play a near-silent blip to fully unlock on iOS
      if (!ctx) return
      const osc = ctx.createOscillator(); const gain = ctx.createGain()
      osc.type = 'sine'; osc.frequency.value = 440
      gain.gain.value = 0.0001
      osc.connect(gain).connect(ctx.destination)
      osc.start(); setTimeout(() => { try { osc.stop(); osc.disconnect(); gain.disconnect() } catch {} }, 60)
      // Start BGM if applicable
      if (!this.muted && !this.bgmTimer) {
        this.startBgm()
      }
      try { window.dispatchEvent(new CustomEvent('AudioUnlocked')) } catch {}
    } catch {}
  }
  // Smooth frequency sweep tone for line clears etc.
  private playToneSweep(start: number, end: number, duration = 0.20, volume = 0.35) {
    try {
      if (this.muted) return
      if (this.toneActive >= 3) return
      const audioManager = this.sound as any
      const ctx = audioManager?.context || audioManager?.audioContext
      if (!ctx) return
      this.toneActive++
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(start, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(end, ctx.currentTime + duration)
      const t = ctx.currentTime
      osc.frequency.setValueAtTime(start, t)
      osc.frequency.linearRampToValueAtTime(end, t + duration)
      gain.gain.value = volume * this.volume
      osc.connect(gain).connect(ctx.destination)
      osc.start()
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration)
      const stopAt = t + duration + 0.02
      osc.stop(stopAt)
      setTimeout(() => { this.toneActive = Math.max(0, this.toneActive - 1) }, duration * 1000 + 80)
    } catch {}
  }
  // Short noise burst for impact (bomb/line)
  private playNoiseBurst(duration = 0.10, volume = 0.25) {
    try {
      if (this.muted) return
      if (this.toneActive >= 3) return
      const audioManager = this.sound as any
      const ctx = audioManager?.context || audioManager?.audioContext
      if (!ctx) return
      this.toneActive++
      const bufferSize = 2 * ctx.sampleRate * duration
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1
      const noise = ctx.createBufferSource()
      noise.buffer = buffer
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 1200
      const gain = ctx.createGain(); gain.gain.value = volume * this.volume
      noise.connect(filter).connect(gain).connect(ctx.destination)
      noise.start()
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration)
      setTimeout(() => { this.toneActive = Math.max(0, this.toneActive - 1) }, duration * 1000 + 80)
    } catch {}
  }

  private camZoomPulse() {
    const cam = this.cameras.main
    this.tweens.add({ targets: cam, zoom: 1.05, duration: 140, yoyo: true, ease: 'Sine.easeOut' })
  }

  // API from UI: reduce heavy VFX
  setReducedEffects(v: boolean) { this.reducedFx = v }

  private confettiBurst() {
    if (this.reducedFx) return
    const colors = [0xff7ab6, 0x6b46c1, 0xffd166, 0x66e3ff, 0x8cff9a]
    const emitter = this.add.particles(360, 0, 'spark', {
      speed: 240,
      gravityY: 600,
      lifespan: 1200,
      quantity: 0,
      scale: { start: 1.2, end: 0 },
      tint: colors,
      angle: { min: 240, max: 300 }
    })
    emitter.explode(this.reducedFx ? 24 : 48, 360, 40)
    this.time.delayedCall(1500, () => emitter.destroy())
  }
  private boardMask?: Phaser.Display.Masks.GeometryMask
  private maskGfxRef?: Phaser.GameObjects.Graphics
  private bgImage?: Phaser.GameObjects.Image
  private progressBar?: Phaser.GameObjects.Graphics

  private idleTimer?: Phaser.Time.TimerEvent
  private hintSprites: Phaser.GameObjects.Sprite[] = []
  private gameOverShown = false
  // boosters removed; keep placeholder to avoid refactors
  private muted = false
  private bgmGain?: GainNode
  private bgmOsc?: OscillatorNode
  private bgmTimer?: Phaser.Time.TimerEvent
  // FX and performance helpers
  private sparkMgr?: any
  private emitterPool: any[] = []
  private toneActive = 0
  private fpsMonitor?: Phaser.Time.TimerEvent
  private dragStart?: { x: number, y: number }
  private isSwapping = false
  private reducedFx = false
  private volume = 0.6
  private rng?: () => number
  // Combo/Fever
  private comboValue = 0 // 0..100
  private fever = false
  private comboBar?: Phaser.GameObjects.Graphics
  private comboDecay?: Phaser.Time.TimerEvent
  // Accessibility
  private colorBlind = false
  // Missions
  private missions: { id: string, label: string, progress: number, target: number, done: boolean }[] = []
  private missionRewarded = false
  // Chill Mode and streaks
  private chillMode = false
  private streak = 0
  // Desktop centering offset
  private gridYOffset = 0

  constructor() {
    super(GameScene.KEY)
  }

  preload() {
    // Load permanent candy images bundled by Vite via import.meta.glob from src/candy
    CANDY_URLS.forEach((url, idx) => {
      const key = `candy_${idx}`
      this.load.image(key, url)
    })

    // Load first background if available
    if (BG_URLS.length) {
      this.load.image('bg_photo', BG_URLS[0])
    }

    // No asset sounds; we use WebAudio oscillators at runtime

    // Create a soft round particle texture to avoid sharp corners at edges
    const psize = 28
    const pg = this.make.graphics({ x: 0, y: 0 })
    pg.clear()
    const gradColor = 0xffffff
    pg.fillStyle(gradColor, 0.9)
    pg.fillCircle(psize / 2, psize / 2, psize / 2)
    pg.fillStyle(gradColor, 0.4)
    pg.fillCircle(psize / 2, psize / 2, psize * 0.35)
    pg.fillStyle(gradColor, 0.15)
    pg.fillCircle(psize / 2, psize / 2, psize * 0.2)
    pg.generateTexture('spark', psize, psize)
    pg.destroy()

    // when images finish loading, convert them to round glossy candies (good for Twitter PFPs)
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      // collect only successfully loaded textures
      const loadedKeys: string[] = []
      for (let i = 0; i < 8; i++) {
        const k = `candy_${i}`
        if (this.textures.exists(k)) loadedKeys.push(k)
      }
      if (loadedKeys.length > 0) {
        // process images into round glossy candies
        loadedKeys.forEach((key) => {
          const tex = this.textures.get(key)
          const src = tex.getSourceImage() as HTMLImageElement | HTMLCanvasElement
          if (src && src instanceof HTMLImageElement) {
            try {
              const canvas = this.makeCandyFromImage(src)
              this.textures.remove(key)
              // add canvas as a texture (method availability depends on Phaser version)
              // @ts-ignore
              this.textures.addCanvas(key, canvas as any)
            } catch {}
          }
        })
        this.textureKeys = loadedKeys
      } else {
        // fallback: generate default candies (6 types)
        this.textureKeys = []
        const defaults = [0xff6ec7, 0xffd166, 0x8cff9a, 0x6ecbff, 0xd66bff, 0xff8fa3]
        defaults.forEach((color, i) => {
          const g = this.make.graphics({ x: 0, y: 0 })
          const r = CELL_PX * 0.42
          const cx = CELL_PX / 2
          const cy = CELL_PX / 2
          const lighter = Phaser.Display.Color.IntegerToColor(color).clone().lighten(22).color
          g.fillStyle(0x000000, 0.25)
          g.fillCircle(cx + 2, cy + 4, r)
          g.fillGradientStyle(lighter, lighter, color, color, 1, 1, 1, 1)
          g.fillCircle(cx, cy, r)
          g.fillStyle(0xffffff, 0.25)
          g.fillEllipse(cx - r * 0.3, cy - r * 0.35, r * 1.2, r * 0.6)
          g.lineStyle(3, 0xffffff, 0.12)
          g.strokeCircle(cx, cy, r)
          const key = `candy_${i}`
          g.generateTexture(key, CELL_PX, CELL_PX)
          this.textureKeys.push(key)
          g.destroy()
        })
      }
    })

    // Loader will start automatically after preload finishes
  }

  create() {
    // Ensure iOS audio unlock even if main.ts listener missed scene init timing
    this.input.once('pointerdown', () => this.warmAudio())
    const onVis = () => { if (document.visibilityState === 'visible' && !this.muted) this.warmAudio() }
    document.addEventListener('visibilitychange', onVis)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      try { document.removeEventListener('visibilitychange', onVis) } catch {}
      try { this.fpsMonitor?.remove() } catch {}
    })
    // Background photo (cover)
    // Background photo (rotates by level if multiple are available)
    const bgKey = BG_URLS.length ? 'bg_photo' : '__MISSING'
    const bg = this.add.image(360, 640, bgKey)
    this.bgImage = bg
    if (bg.texture.key !== '__MISSING') {
      const w = 720, h = 1280
      const bw = bg.width, bh = bg.height
      const scale = Math.max(w / bw, h / bh)
      bg.setScale(scale).setScrollFactor(0).setDepth(-10)
      // No dim overlay; keep board fully transparent
      // Also set the entire page background (outside canvas)
      try {
        const url = BG_URLS[0]
        if (url) {
          document.body.style.backgroundImage = `url('${url}')`
          document.body.style.backgroundSize = 'cover'
          document.body.style.backgroundPosition = 'center'
          document.body.style.backgroundRepeat = 'no-repeat'
          document.body.style.backgroundAttachment = 'fixed'
          // Notify UI to adapt contrast
          window.dispatchEvent(new CustomEvent('UiBackground', { detail: { url } }))
        }
      } catch {}
    } else {
      bg.destroy()
      // Clear page background if no bg
      document.body.style.backgroundImage = ''
      try { window.dispatchEvent(new CustomEvent('UiBackground', { detail: { url: undefined } })) } catch {}
    }

    // Title with glowing highlight
    const title = this.add.text(360, 80, 'Candy Mon', {
      fontFamily: 'Nunito', fontSize: '44px', color: '#ffffff', fontStyle: 'bold'
    }).setOrigin(0.5)
    title.setStroke('#7c3aed', 4)
    title.setShadow(0, 0, '#7c3aed', 20, true, true)
    this.tweens.add({ targets: title, scale: { from: 1.0, to: 1.03 }, alpha: { from: 0.95, to: 1 }, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
    // Underline shimmer
    const u = this.add.graphics()
    u.fillStyle(0x7c3aed, 0.6)
    u.fillRoundedRect(360 - 70, 108, 140, 4, 2)
    this.tweens.add({ targets: u, alpha: { from: 0.35, to: 0.9 }, duration: 1200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })

    // Combo meter UI under title
    this.drawCombo()
    // Start combo decay timer
    this.comboDecay?.remove()
    this.comboDecay = this.time.addEvent({ delay: 350, loop: true, callback: () => {
      if (this.fever) return
      if (this.comboValue > 0) { this.comboValue = Math.max(0, this.comboValue - 3); this.drawCombo() }
    }})

    this.sounds = {
      swap: () => this.playTone(420, 0.08, 0.30),
      match: () => { this.playTone(720, 0.08, 0.40); this.playTone(860, 0.08, 0.24) },
      drop: () => this.playTone(300, 0.06, 0.22),
      line: () => { this.playToneSweep(520, 920, 0.18, 0.32); this.playNoiseBurst(0.10, 0.10) },
      bomb: () => { this.playTone(220, 0.18, 0.45); this.playNoiseBurst(0.18, 0.22) }
    }

    // Simple background tone using an oscillator; start after user gesture/unlock
    if (!this.muted) {
      if (this.sound.locked) {
        this.sound.once(Phaser.Sound.Events.UNLOCKED, () => this.startBgm())
      } else {
        this.input.once('pointerdown', () => this.startBgm())
      }
    }

    // Daily mode RNG setup from localStorage
    try {
      const on = localStorage.getItem('cc_daily_on') === '1'
      const seedStr = localStorage.getItem('cc_daily_seed') || ''
      if (on && seedStr) {
        const seed = parseInt(seedStr, 10) >>> 0
        this.rng = this.makeRng(seed)
      } else {
        this.rng = undefined
      }
    } catch {}

    // Always start fresh on load; do not auto-load previous saved games
    try { localStorage.removeItem('cc_save') } catch {}
    // Compute vertical centering offset for desktop (mobile handled by CSS)
    this.recomputeBoardTop()
    this.scale.on('resize', () => this.recomputeBoardTop())
    if (this.textureKeys.length === 0) {
      this.time.delayedCall(0, () => this.createBoard())
    } else {
      this.createBoard()
    }

    // Particle manager for sparkle effects (pooled emitters)
    try {
      this.sparkMgr = this.add.particles(0, 0, 'spark', {})
      this.sparkMgr.setDepth(12)
      if (this.boardMask) this.sparkMgr.setMask(this.boardMask)
    } catch {}

    // FPS-aware reduced effects with hysteresis
    this.fpsMonitor?.remove()
    this.fpsMonitor = this.time.addEvent({ delay: 1500, loop: true, callback: () => {
      const fps = this.game?.loop?.actualFps || 60
      if (fps < 50 && !this.reducedFx) this.setReducedEffects(true)
      else if (fps > 56 && this.reducedFx) this.setReducedEffects(false)
    }})

    // Initialize missions for this session
    this.initMissions()
    this.emitMissions()

    // Guarantee playable state
    if (this.movesLeft <= 0) this.movesLeft = MOVE_LIMIT
    this.updateUi()

    // Daily streaks
    this.updateStreak()

    // Create and apply board clipping mask
    const maskGfx = this.add.graphics()
    maskGfx.fillStyle(0xffffff, 1)
    maskGfx.fillRect(GRID_LEFT, this.gridTop(), GRID_SIZE * CELL_PX, GRID_SIZE * CELL_PX)
    this.boardMask = maskGfx.createGeometryMask()
    this.maskGfxRef = maskGfx
    maskGfx.setVisible(false)

    // Apply mask to any sprites already created by createBoard/drawGrid
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const cell = this.grid?.[r]?.[c]
        if (cell?.sprite && this.boardMask) cell.sprite.setMask(this.boardMask)
      }
    }
    // Use pointerdown for more reliable detection
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const worldX = pointer.worldX
      const worldY = pointer.worldY
      
      // Find the cell that was clicked
      const col = Math.floor((worldX - GRID_LEFT) / CELL_PX)
      const row = Math.floor((worldY - this.gridTop()) / CELL_PX)
      
      if (row >= 0 && row < GRID_SIZE && col >= 0 && col < GRID_SIZE) {
        const cell = this.grid[row][col]
        if (cell && cell.sprite && cell.kind !== -1) {
          console.log('Clicked cell:', row, col, 'kind:', cell.kind)
          this.dragStart = { x: worldX, y: worldY }
          this.handleSelect(cell)
        } else {
          console.log('Invalid cell at:', row, col, 'sprite:', !!cell?.sprite, 'kind:', cell?.kind)
        }
      }
    })
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.selected || this.isSwapping || !this.dragStart) return
      const dx = pointer.worldX - this.dragStart.x
      const dy = pointer.worldY - this.dragStart.y
      const threshold = 22
      if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return
      
      let target: GridCell | undefined
      if (Math.abs(dx) > Math.abs(dy)) {
        // horizontal drag
        const dir = dx > 0 ? 1 : -1
        const nc = this.selected.col + dir
        if (nc >= 0 && nc < GRID_SIZE) {
          target = this.grid[this.selected.row][nc]
        }
      } else {
        // vertical drag
        const dir = dy > 0 ? 1 : -1
        const nr = this.selected.row + dir
        if (nr >= 0 && nr < GRID_SIZE) {
          target = this.grid[nr][this.selected.col]
        }
      }
      
      if (target && target.sprite) {
        this.isSwapping = true
        const from = this.selected
        this.highlight(from, false)
        this.selected = undefined
        this.trySwap(from, target)
        this.dragStart = undefined
        this.time.delayedCall(200, () => { this.isSwapping = false })
      }
    })
    this.input.on('pointerup', () => { this.dragStart = undefined })

    // Parallax tilt using camera rotation
    const cam = this.cameras.main
    const center = { x: 360, y: 640 }
    const maxRot = (window.innerWidth < 800) ? 0.02 : 0.035 // smaller tilt on small screens
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const nx = Phaser.Math.Clamp((p.worldX - center.x) / 360, -1, 1)
      const ny = Phaser.Math.Clamp((p.worldY - center.y) / 640, -1, 1)
      const rot = Phaser.Math.Clamp((nx - ny) * 0.02, -maxRot, maxRot)
      this.tweens.add({ targets: cam, rotation: rot, duration: 120, ease: 'Sine.easeOut' })
    })
    this.input.on('pointerup', () => {
      this.tweens.add({ targets: cam, rotation: 0, duration: 220, ease: 'Sine.easeOut' })
    })

    this.updateUi()

    this.resetIdleTimer()

    // Auto FX off on low FPS devices
    this.time.delayedCall(3200, () => {
      const fps = (this.game.loop as any)?.actualFps || 60
      if (fps < 40) this.reducedFx = true
    })
  }

  async setCustomImages(objectUrls: string[]) {
    // Replace texture keys with processed uploaded images (center-crop, circle mask, shadow, gloss)
    this.textureKeys = []
    const urls = objectUrls.slice(0, 6)
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i]
      const key = `user_${i}_${Date.now()}`
      try {
        const img = await this.loadHtmlImage(url)
        const canvas = this.makeCandyFromImage(img)
        this.textures.remove(key)
        // @ts-ignore addCanvas may not be typed in some Phaser defs
        this.textures.addCanvas(key, canvas as any)
        this.textureKeys.push(key)
      } catch {}
    }
    this.resetBoard()
  }

  private loadHtmlImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = src
    })
  }

  private makeCandyFromImage(img: HTMLImageElement): HTMLCanvasElement {
    const size = CELL_PX
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    // center-crop to square
    const s = Math.min(img.width, img.height)
    const sx = (img.width - s) / 2
    const sy = (img.height - s) / 2

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)'
    ctx.beginPath()
    ctx.arc(size/2 + 2, size/2 + 4, size*0.42, 0, Math.PI*2)
    ctx.fill()

    // mask circle
    ctx.save()
    ctx.beginPath()
    ctx.arc(size/2, size/2, size*0.42, 0, Math.PI*2)
    ctx.closePath()
    ctx.clip()
    ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size)
    ctx.restore()

    // rim
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(size/2, size/2, size*0.42, 0, Math.PI*2)
    ctx.stroke()

    // gloss
    const grad = ctx.createLinearGradient(0, 0, 0, size)
    grad.addColorStop(0, 'rgba(255,255,255,0.35)')
    grad.addColorStop(0.4, 'rgba(255,255,255,0.0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.ellipse(size/2 - size*0.12, size/2 - size*0.16, size*0.36, size*0.18, -0.5, 0, Math.PI*2)
    ctx.fill()

    return canvas
  }

  resetBoard() {
    try { localStorage.removeItem('cc_save') } catch {}
    // Restart the scene to fully reset state and visuals cleanly
    this.scene.restart()
  }

  private emitScore() {
    window.dispatchEvent(new CustomEvent('GameScore', { detail: this.score }))
  }
  private emitMoves() {
    window.dispatchEvent(new CustomEvent('GameMoves', { detail: this.movesLeft }))
  }
  private emitLevel() {
    window.dispatchEvent(new CustomEvent('GameLevel', { detail: { level: this.level, goal: this.goal } }))
  }
  private updateUi() {
    this.emitScore(); this.emitMoves(); this.emitLevel()
    this.drawProgress()
  }

  private createBoard() {
    // initialize grid avoiding starting matches
    this.grid = []
    for (let r = 0; r < GRID_SIZE; r++) {
      const row: GridCell[] = []
      for (let c = 0; c < GRID_SIZE; c++) {
        let kind = this.randomKind()
        while (this.causesMatchAt(row, r, c, kind)) {
          kind = this.randomKind()
        }
        row.push({ row: r, col: c, kind })
      }
      this.grid.push(row)
    }
    
    // Validate all cells have valid kinds
    let validCells = 0
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const cell = this.grid[r][c]
        if (cell && cell.kind >= 0 && cell.kind < this.getActiveKindCount()) {
          validCells++
        } else {
          console.error('Invalid cell at', r, c, 'kind:', cell?.kind, 'active count:', this.getActiveKindCount())
        }
      }
    }
    console.log('Created board with', validCells, 'valid cells out of', GRID_SIZE * GRID_SIZE)
    
    this.drawGrid(true)
    this.validateAllCells()
    if (!this.hasAnyMoves()) this.shuffleBoard()
    this.drawProgress()
  }

  private drawProgress() {
    const w = 400
    const h = 14
    const x = 360 - w / 2
    const y = 120
    if (!this.progressBar) this.progressBar = this.add.graphics().setDepth(5)
    const g = this.progressBar
    g.clear()
    // background
    g.fillStyle(0x000000, 0.18); g.fillRoundedRect(x, y, w, h, 7)
    // thresholds
    const one = this.goal * 0.33, two = this.goal * 0.66
    const pct = Phaser.Math.Clamp(this.score / this.goal, 0, 1)
    const fill = Math.floor(w * pct)
    g.fillStyle(0xffffff, 0.85); g.fillRoundedRect(x, y, fill, h, 7)
    // star ticks
    g.fillStyle(0xffff66, 1); g.fillCircle(x + (w * one / this.goal), y + h / 2, 3)
    g.fillStyle(0xffd700, 1); g.fillCircle(x + (w * two / this.goal), y + h / 2, 3)
  }
  
  private validateAllCells() {
    console.log('Validating all cells...')
    let validCells = 0
    let invalidCells = 0
    
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const cell = this.grid[r][c]
        if (!cell) {
          console.error('Missing cell at', r, c)
          invalidCells++
          continue
        }
        
        if (cell.kind === -1) {
          console.warn('Empty cell at', r, c)
          invalidCells++
          continue
        }
        
        if (!cell.sprite) {
          console.error('Missing sprite at', r, c, 'kind:', cell.kind)
          invalidCells++
          continue
        }
        
        const key = this.textureForKind(cell.kind)
        if (!this.textures.exists(key)) {
          console.error('Invalid texture key at', r, c, 'key:', key, 'kind:', cell.kind)
          invalidCells++
          continue
        }
        
        validCells++
      }
    }
    
    console.log('Cell validation complete:', validCells, 'valid,', invalidCells, 'invalid')
    return invalidCells === 0
  }

  private getActiveKindCount(): number {
    const available = Math.min(8, this.textureKeys.length || 6)
    // Auto choose a pleasant difficulty: 5 kinds at level 1, ramp to 8
    const desired = Math.min(8, Math.max(5, 4 + this.level))
    return Math.min(available, desired)
  }

  private randomKind(): number {
    const r = this.rand()
    return Math.floor(r * this.getActiveKindCount())
  }

  private rand(): number {
    if (this.rng) return this.rng()
    return Math.random()
  }

  private textureForKind(kind: number) {
    if (this.textureKeys.length) return this.textureKeys[kind % this.textureKeys.length]
    return `candy_${kind}`
  }

  private drawGrid(initial = false) {
    let createdSprites = 0
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const cell = this.grid[r][c]
        if (!cell || cell.kind === -1) {
          console.warn('Skipping empty cell at', r, c)
          continue
        }
        
        const x = GRID_LEFT + c * CELL_PX + CELL_PX / 2
        const y = this.gridTop() + r * CELL_PX + CELL_PX / 2
        const key = this.textureForKind(cell.kind)
        
        // Check if texture exists
        if (!this.textures.exists(key)) {
          console.error('Texture not found for key:', key, 'at cell', r, c)
          continue
        }
        
        // Soft shadow tile for professional look
        const tile = this.add.rectangle(x, y, CELL_PX - 6, CELL_PX - 6, 0x000000, 0.04)
        tile.setStrokeStyle(1, 0x000000, 0.06)
        tile.setDepth(0)
        const sprite = this.add.sprite(x, y, key)
        // Larger circular hit area for easier touches
        sprite.setInteractive(new Phaser.Geom.Circle(0, 0, CELL_PX * 0.55), Phaser.Geom.Circle.Contains)
        sprite.setData('cell', cell)
        sprite.setScale(0.95)
        sprite.setDepth(1)
        if (this.boardMask) sprite.setMask(this.boardMask)
        // Apply accessibility tint if enabled
        this.applyTintForKind(sprite, cell.kind)
        
        if (initial) {
          sprite.setAlpha(0)
          this.tweens.add({ targets: sprite, alpha: 1, duration: 250, delay: (r + c) * 15, ease: 'Back.easeOut' })
        }
        cell.sprite = sprite
        createdSprites++
      }
    }
    console.log('Created', createdSprites, 'sprites out of', GRID_SIZE * GRID_SIZE, 'cells')
  }

  

  private highlight(cell: GridCell, on: boolean) {
    if (!cell.sprite) return
    this.tweens.add({ targets: cell.sprite, scale: on ? 1.05 : 0.9, duration: 120, ease: 'Back.easeOut' })
  }

  private isAdjacent(a: GridCell, b: GridCell): boolean {
    return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1
  }

  private trySwap(a: GridCell, b: GridCell) {
    if (!a.sprite || !b.sprite) return
    this.sounds.swap()
    this.swapCells(a, b)
    this.animateSwap(a, b, async () => {
      const matches = this.findAllMatches()
      if (matches.length === 0) {
        // swap back
        this.swapCells(a, b)
        this.animateSwap(a, b, () => {
          if (a.sprite) this.shake(a.sprite)
          if (b.sprite) this.shake(b.sprite)
        })
        return
      }
      if (!this.chillMode) this.movesLeft -= 1
      this.updateUi()
      await this.resolveMatchesLoop()
      if (!this.chillMode && this.movesLeft <= 0) this.showGameOver()
      else if (!this.hasAnyMoves()) this.shuffleBoard()
    })
  }

  private swapCells(a: GridCell, b: GridCell) {
    const ar = a.row, ac = a.col
    a.row = b.row; a.col = b.col
    b.row = ar; b.col = ac
    this.grid[a.row][a.col] = a
    this.grid[b.row][b.col] = b
  }

  private animateSwap(a: GridCell, b: GridCell, onComplete?: () => void) {
    const ta = this.cellCenter(a)
    const tb = this.cellCenter(b)
    // Squash & stretch during movement
    this.tweens.add({ targets: [a.sprite, b.sprite], scaleX: 1.08, scaleY: 0.88, duration: 90, yoyo: true, ease: 'Sine.easeInOut' })
    // Trails that follow sprites briefly
    if (a.sprite) this.attachTrail(a.sprite, 160)
    if (b.sprite) this.attachTrail(b.sprite, 160)
    this.tweens.add({ targets: a.sprite, x: ta.x, y: ta.y, duration: 160, ease: 'Quart.easeInOut' })
    this.tweens.add({ targets: b.sprite, x: tb.x, y: tb.y, duration: 160, ease: 'Quart.easeInOut', onComplete })
  }

  private shake(sprite: Phaser.GameObjects.Sprite) {
    const ox = sprite.x
    this.tweens.add({
      targets: sprite,
      x: { from: ox - 8, to: ox + 8 },
      duration: 60,
      yoyo: true,
      repeat: 1,
      ease: 'Sine.easeInOut',
      onComplete: () => sprite.setX(ox)
    })
  }

  // Create a short-lived particle trail following a sprite
  private attachTrail(sprite: Phaser.GameObjects.Sprite, lifeMs = 180) {
    const emitter = this.add.particles(0, 0, 'spark', {
      lifespan: 450,
      speed: 40,
      quantity: 2,
      scale: { start: 0.6, end: 0 },
      alpha: { start: 0.9, end: 0 },
      frequency: 18,
      follow: sprite
    })
    if (this.boardMask) emitter.setMask(this.boardMask)
    this.time.delayedCall(lifeMs, () => emitter.destroy())
  }

  // Show a combo popup near the top of the board
  private comboPopup(combo: number) {
    const words = ['Nice!', 'Sweet!', 'Epic!', 'Legend!']
    const msg = words[Math.min(words.length - 1, combo - 2)]
    const t = this.add.text(360, 110, `${msg} x${combo}`, { fontFamily: 'Nunito', fontSize: '32px', color: '#ffd166' })
      .setOrigin(0.5)
    t.setAlpha(0)
    this.tweens.add({ targets: t, alpha: 1, y: 96, duration: 220, ease: 'Back.easeOut' })
    this.tweens.add({ targets: t, alpha: 0, y: 80, delay: 700, duration: 280, onComplete: () => t.destroy() })
  }

  // Light beam sweeping across a cleared row
  private sweepBeamRow(r: number) {
    const y = this.gridTop() + r * CELL_PX + CELL_PX / 2
    const g = this.add.graphics()
    g.fillStyle(0xffffff, 0.14)
    g.fillRect(GRID_LEFT - 40, y - CELL_PX / 2, GRID_SIZE * CELL_PX + 80, CELL_PX)
    if (this.boardMask) g.setMask(this.boardMask)
    g.setAlpha(0)
    this.tweens.add({ targets: g, alpha: 0.35, duration: 80, yoyo: true, onComplete: () => g.destroy() })
  }

  // Light beam sweeping across a cleared column
  private sweepBeamCol(c: number) {
    const x = GRID_LEFT + c * CELL_PX + CELL_PX / 2
    const g = this.add.graphics()
    g.fillStyle(0xffffff, 0.18)
    g.fillRect(x - CELL_PX / 2, this.gridTop() - 40, CELL_PX, GRID_SIZE * CELL_PX + 80)
    if (this.boardMask) g.setMask(this.boardMask)
    g.setAlpha(0)
    this.tweens.add({ targets: g, alpha: 0.35, duration: 80, yoyo: true, onComplete: () => g.destroy() })
  }

  // Expanding shockwave circle for bomb clears
  private shockwave(cell: GridCell) {
    const p = this.cellCenter(cell)
    const g = this.add.graphics()
    g.lineStyle(4, 0xffffff, 0.5)
    g.strokeCircle(p.x, p.y, 1)
    if (this.boardMask) g.setMask(this.boardMask)
    this.tweens.add({
      targets: g,
      alpha: 0,
      duration: 420,
      onUpdate: (tw) => {
        const v = 1 + tw.progress * CELL_PX * 2
        g.clear(); g.lineStyle(6, 0xffffff, 0.5); g.strokeCircle(p.x, p.y, v)
      },
      onComplete: () => g.destroy()
    })
  }

  private cellCenter(cell: GridCell) {
    return {
      x: GRID_LEFT + cell.col * CELL_PX + CELL_PX / 2,
      y: this.gridTop() + cell.row * CELL_PX + CELL_PX / 2
    }
  }

  private causesMatchAt(currentRow: GridCell[], r: number, c: number, kind: number) {
    // horizontal
    if (c >= 2 && currentRow[c - 1]?.kind === kind && currentRow[c - 2]?.kind === kind) return true
    // vertical
    if (r >= 2 && this.grid[r - 1]?.[c]?.kind === kind && this.grid[r - 2]?.[c]?.kind === kind) return true
    return false
  }

  private async resolveMatchesLoop() {
    let combo = 1
    while (true) {
      this.ensureGridIndices()
      const matches = this.findAllMatches()
      if (!matches.length) break
      await this.clearMatches(matches, combo)
      await this.dropAndRefill()
      if (combo >= 2) this.comboPopup(combo)
      if (combo === 2) this.missionComboTwo()
      combo += 1
    }
    this.saveState()
  }

  private findAllMatches(): GridCell[][] {
    const visited = new Set<string>()
    const groups: GridCell[][] = []
    const mark = (r: number, c: number) => `${r},${c}`

    // horizontal matches
    for (let r = 0; r < GRID_SIZE; r++) {
      let run: GridCell[] = []
      for (let c = 0; c < GRID_SIZE; c++) {
        const cell = this.grid[r][c]
        if (!run.length || cell.kind === run[run.length - 1].kind) run.push(cell)
        else {
          if (run.length >= 3) {
            groups.push(run)
            // mark 4+ as line clear
            if (run.length >= 4) run.forEach(c => c.special = 'line_h')
          }
          run = [cell]
        }
      }
      if (run.length >= 3) {
        groups.push(run)
        if (run.length >= 4) run.forEach(c => c.special = 'line_h')
      }
    }

    // vertical matches
    for (let c = 0; c < GRID_SIZE; c++) {
      let run: GridCell[] = []
      for (let r = 0; r < GRID_SIZE; r++) {
        const cell = this.grid[r][c]
        if (!run.length || cell.kind === run[run.length - 1].kind) run.push(cell)
        else {
          if (run.length >= 3) {
            groups.push(run)
            if (run.length >= 4) run.forEach(c => c.special = 'line_v')
          }
          run = [cell]
        }
      }
      if (run.length >= 3) {
        groups.push(run)
        if (run.length >= 4) run.forEach(c => c.special = 'line_v')
      }
    }

    // T/L shape detection for bomb creation
    this.detectTandLShapes()

    // merge groups to unique cells
    const result: GridCell[][] = []
    groups.forEach(g => {
      const unique: GridCell[] = []
      g.forEach(cell => {
        const key = mark(cell.row, cell.col)
        if (!visited.has(key)) {
          visited.add(key)
          unique.push(cell)
        }
      })
      if (unique.length >= 3) result.push(unique)
    })
    return result
  }

  private detectTandLShapes() {
    for (let r = 1; r < GRID_SIZE - 1; r++) {
      for (let c = 1; c < GRID_SIZE - 1; c++) {
        const center = this.grid[r][c]
        if (!center || center.kind === -1) continue

        // T-shape (horizontal line with center)
        const h = this.grid[r][c-1]?.kind === center.kind && 
                  this.grid[r][c+1]?.kind === center.kind
        const v = this.grid[r-1][c]?.kind === center.kind && 
                  this.grid[r+1][c]?.kind === center.kind
        if (h && v) {
          center.special = 'bomb'
          return
        }

        // L-shape (3 horizontal + 2 vertical at one end)
        const l1 = this.grid[r][c-1]?.kind === center.kind && 
                   this.grid[r][c+1]?.kind === center.kind &&
                   this.grid[r+1][c]?.kind === center.kind &&
                   this.grid[r+1][c+1]?.kind === center.kind
        const l2 = this.grid[r][c-1]?.kind === center.kind && 
                   this.grid[r][c+1]?.kind === center.kind &&
                   this.grid[r-1][c]?.kind === center.kind &&
                   this.grid[r-1][c+1]?.kind === center.kind
        if (l1 || l2) {
          center.special = 'bomb'
          return
        }
      }
    }
  }

  private async clearMatches(groups: GridCell[][], combo: number) {
    let cleared = 0
    this.sounds.match()
    
    // Handle special pieces first
    const specialPieces: GridCell[] = []
    for (const group of groups) {
      for (const cell of group) {
        if (cell.special) specialPieces.push(cell)
      }
    }
    
    for (const special of specialPieces) {
      if (special.special === 'line_h') this.clearRow(special.row)
      else if (special.special === 'line_v') this.clearCol(special.col)
      else if (special.special === 'bomb') this.clearBomb(special)
      special.special = undefined
    }
    
    // Clear regular matches with enhanced animations
    for (const group of groups) {
      cleared += group.length
      for (const cell of group) {
        if (!cell.sprite) continue
        
        // Enhanced particle effects (pooled emitter)
        this.explodeSpark(cell.sprite.x, cell.sprite.y)
        
        // Enhanced pop animation with easing
        const sprite = cell.sprite
        this.tweens.add({ 
          targets: sprite, 
          scale: 1.3, 
          duration: 100, 
          ease: 'Back.easeOut',
          yoyo: true,
          onComplete: () => {
            if (sprite && sprite.scene) {
              this.tweens.add({ 
                targets: sprite, 
                scale: 0, 
                alpha: 0, 
                duration: 150, 
                ease: 'Back.easeIn',
                onComplete: () => sprite.destroy() 
              })
            }
          }
        })
        cell.sprite = undefined
        cell.kind = -1
      }
    }
    
    // Mission progress from this clear
    this.updateMissionsFromClear(groups)
    // Increase combo meter and handle Fever
    this.addCombo(Math.min(40, cleared * 6 + (combo - 1) * 4))
    const mult = this.fever ? 2 : 1
    this.score += Math.floor(cleared * 10 * combo * mult)
    this.updateUi()
    this.updateBest()
    if (this.score >= this.goal) {
      // Goal reached celebration: UI shimmer + quick camera zoom pulse
      try { window.dispatchEvent(new CustomEvent('UiShimmer')) } catch {}
      this.camZoomPulse()
      this.level += 1
      this.goal = Math.floor(this.goal * 1.7)
      this.movesLeft += 10
      this.flashLevelUp()
    }
    await this.wait(280)
  }

  private async dropAndRefill() {
    // drop
    let anyDrop = false
    for (let c = 0; c < GRID_SIZE; c++) {
      for (let r = GRID_SIZE - 1; r >= 0; r--) {
        if (this.grid[r][c].kind === -1) {
          // find above
          for (let rr = r - 1; rr >= 0; rr--) {
            if (this.grid[rr][c].kind !== -1) {
              anyDrop = true
              const above = this.grid[rr][c]
              this.grid[r][c].kind = above.kind
              this.grid[r][c].sprite = above.sprite
              if (above.sprite) {
                const to = this.cellCenter({ row: r, col: c, kind: above.kind })
                this.tweens.add({ targets: above.sprite, x: to.x, y: to.y, duration: 180, ease: 'Cubic.easeIn',
                  onComplete: () => {
                    if (above.sprite) this.tweens.add({ targets: above.sprite, scale: 0.96, yoyo: true, duration: 80 })
                  }
                })
              }
              above.kind = -1
              above.sprite = undefined
              break
            }
          }
        }
      }
    }
    if (anyDrop) this.sounds.drop()

    // refill
    for (let c = 0; c < GRID_SIZE; c++) {
      for (let r = 0; r < GRID_SIZE; r++) {
        const cell = this.grid[r][c]
        if (cell.kind === -1) {
          cell.kind = this.randomKind()
          const pos = this.cellCenter(cell)
          const key = this.textureForKind(cell.kind)
          const sprite = this.add.sprite(pos.x, pos.y - CELL_PX * 1.5, key)
          sprite.setScale(0.8)
          sprite.setAlpha(0.85)
          sprite.setInteractive(new Phaser.Geom.Circle(0, 0, CELL_PX * 0.55), Phaser.Geom.Circle.Contains)
          if (this.boardMask) sprite.setMask(this.boardMask)
          cell.sprite = sprite
          this.applyTintForKind(sprite, cell.kind)
          this.tweens.add({ targets: sprite, y: pos.y, scale: 0.95, alpha: 1, duration: 220, ease: 'Back.easeOut' })
        }
      }
    }
    await this.wait(200)
    // Safety pass: ensure every filled cell has a sprite at the exact cell center
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const cell = this.grid[r][c]
        if (cell.kind === -1) continue
        const pos = this.cellCenter(cell)
        if (!cell.sprite || !cell.sprite.scene) {
          const key = this.textureForKind(cell.kind)
          const sp = this.add.sprite(pos.x, pos.y, key).setScale(0.95)
          sp.setInteractive(new Phaser.Geom.Circle(0, 0, CELL_PX * 0.55), Phaser.Geom.Circle.Contains)
          if (this.boardMask) sp.setMask(this.boardMask)
          this.applyTintForKind(sp, cell.kind)
          cell.sprite = sp
        } else {
          // Clamp any drift
          cell.sprite.setPosition(pos.x, pos.y)
        }
      }
    }
    this.ensureGridIndices()
  }

  private hasAnyMoves(): boolean {
    // Try swapping each adjacent pair to see if we create a match
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const cell = this.grid[r][c]
        const neighbors = [ [r, c+1], [r+1, c] ]
        for (const [rr, cc] of neighbors) {
          if (rr >= GRID_SIZE || cc >= GRID_SIZE) continue
          const other = this.grid[rr][cc]
          this.swapKinds(cell, other)
          const has = this.findAllMatches().length > 0
          this.swapKinds(cell, other)
          if (has) return true
        }
      }
    }
    return false
  }

  private swapKinds(a: GridCell, b: GridCell) {
    const k = a.kind; a.kind = b.kind; b.kind = k
  }

  private shuffleBoard() {
    // Randomize kinds and update sprites textures accordingly
    const kinds: number[] = []
    for (let r = 0; r < GRID_SIZE; r++) for (let c = 0; c < GRID_SIZE; c++) kinds.push(this.grid[r][c].kind)
    Phaser.Utils.Array.Shuffle(kinds)
    let idx = 0
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const cell = this.grid[r][c]
        cell.kind = kinds[idx++]
        const key = this.textureForKind(cell.kind)
        if (cell.sprite) cell.sprite.setTexture(key)
      }
    }
    if (!this.hasAnyMoves()) this.shuffleBoard()
    const flash = this.add.rectangle(360, 640, 720, 1280, 0xffffff, 0.0).setDepth(20)
    this.tweens.add({ targets: flash, alpha: 0.18, duration: 80, yoyo: true, onComplete: () => flash.destroy() })
    this.ensureGridIndices(); this.saveState()
  }

  private resetIdleTimer() {
    this.idleTimer?.remove()
    this.idleTimer = this.time.addEvent({ delay: 4000, callback: () => this.showHint(), loop: false })
  }

  private showHint() {
    this.clearHint()
    // find a valid move and pulse it
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const cell = this.grid[r][c]
        const dirs = [ [0,1], [1,0], [0,-1], [-1,0] ]
        for (const [dr, dc] of dirs) {
          const rr = r + dr, cc = c + dc
          if (rr < 0 || rr >= GRID_SIZE || cc < 0 || cc >= GRID_SIZE) continue
          const other = this.grid[rr][cc]
          this.swapKinds(cell, other)
          const ok = this.findAllMatches().length > 0
          this.swapKinds(cell, other)
          if (ok) {
            if (cell.sprite) this.hintSprites.push(cell.sprite)
            if (other.sprite) this.hintSprites.push(other.sprite)
            this.tweens.add({ targets: this.hintSprites, scale: 1.08, yoyo: true, duration: 400, repeat: 5 })
            return
          }
        }
      }
    }
    // if none found, shuffle
    this.shuffleBoard()
  }

  private clearHint() {
    if (this.hintSprites.length) this.tweens.killTweensOf(this.hintSprites)
    this.hintSprites.forEach(s => s.setScale(0.9))
    this.hintSprites = []
  }

  private ensureGridIndices() {
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const cell = this.grid[r][c]
        cell.row = r
        cell.col = c
      }
    }
  }

  private showGameOver() {
    if (this.gameOverShown) return
    this.gameOverShown = true
    const cx = 360, cy = 640
    try { document.body.classList.add('modal-open') } catch {}
    // Dim backdrop that captures input so clicks don't hit the board
    const backdrop = this.add.rectangle(360, 640, 720, 1280, 0x000000, 0.45)
      .setDepth(90)
      .setInteractive({ useHandCursor: false })
    // Tap anywhere on backdrop to reset
    backdrop.on('pointerdown', () => this.resetBoard())

    // Rounded panel via graphics for a premium look
    const w = 520, h = 260
    const gfx = this.add.graphics({ x: cx - w/2, y: cy - h/2 }).setDepth(100)
    gfx.fillStyle(0x111111, 0.92)
    gfx.fillRoundedRect(0, 0, w, h, 18)
    gfx.lineStyle(2, 0xffffff, 0.12)
    gfx.strokeRoundedRect(0, 0, w, h, 18)

    const title = this.add.text(cx, cy - 40, 'Out of moves!', { fontFamily: 'Nunito', fontSize: '42px', color: '#ffffff' })
      .setOrigin(0.5).setDepth(101)

    // Reset button
    const btnBg = this.add.graphics({ x: cx - 80, y: cy + 10 }).setDepth(101)
    btnBg.fillStyle(0x2e2a7e, 1).fillRoundedRect(0, 0, 160, 46, 12)
    btnBg.lineStyle(2, 0x5e55ea, 1).strokeRoundedRect(0, 0, 160, 46, 12)
    const btnLabel = this.add.text(cx, cy + 33, 'Reset', { fontFamily: 'Nunito', fontSize: '24px', color: '#ffd166' })
      .setOrigin(0.5).setDepth(102)
    const btnHit = this.add.rectangle(cx, cy + 33, 160, 46, 0x000000, 0).setInteractive({ useHandCursor: true }).setDepth(103)
    btnHit.on('pointerdown', () => this.resetBoard())

    // Share button (text-based Web Share)
    const canShare = (navigator as any)?.share
    if (canShare) {
      const sbg = this.add.graphics({ x: cx - 240, y: cy + 10 }).setDepth(101)
      sbg.fillStyle(0x223, 1).fillRoundedRect(0, 0, 140, 46, 12)
      sbg.lineStyle(2, 0x556, 1).strokeRoundedRect(0, 0, 140, 46, 12)
      this.add.text(cx - 170, cy + 33, 'Share', { fontFamily: 'Nunito', fontSize: '22px', color: '#ffffff' }).setOrigin(0.5).setDepth(102)
      const sHit = this.add.rectangle(cx - 170, cy + 33, 140, 46, 0x000000, 0).setInteractive({ useHandCursor: true }).setDepth(103)
      sHit.on('pointerdown', async () => {
        try {
          await (navigator as any).share({ title: 'Candy Mon — Score', text: `I scored ${this.score} on level ${this.level}!`, url: location.href })
        } catch {}
      })
    }

    // Subtle scale-in
    gfx.setScale(0.9).setAlpha(0)
    this.tweens.add({ targets: [gfx, title, btnBg, btnLabel, btnHit], alpha: 1, duration: 180 })
    this.tweens.add({ targets: gfx, scale: 1, duration: 220, ease: 'Back.easeOut' })

    // Cleanup on scene shutdown
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      backdrop.destroy(); gfx.destroy(); title.destroy(); btnBg.destroy(); btnLabel.destroy(); btnHit.destroy()
      try { document.body.classList.remove('modal-open') } catch {}
    })
  }

  private flashLevelUp() {
    const t = this.add.text(360, 160, `Level ${this.level}!`, { fontFamily: 'Nunito', fontSize: '46px', color: '#ffd166' }).setOrigin(0.5)
    t.setAlpha(0)
    this.tweens.add({ targets: t, alpha: 1, y: 140, duration: 250, yoyo: true, hold: 300, onComplete: () => t.destroy() })
    // Rotate background per level if multiple images exist
    if (this.bgImage && BG_URLS.length > 1) {
      const idx = (this.level - 1) % BG_URLS.length
      const key = `bg_${idx}`
      if (!this.textures.exists(key)) this.load.image(key, BG_URLS[idx])
      // Update body background and notify UI as well
      try {
        const url = BG_URLS[idx]
        if (url) {
          document.body.style.backgroundImage = `url('${url}')`
          document.body.style.backgroundSize = 'cover'
          document.body.style.backgroundPosition = 'center'
          document.body.style.backgroundRepeat = 'no-repeat'
          document.body.style.backgroundAttachment = 'fixed'
          window.dispatchEvent(new CustomEvent('UiBackground', { detail: { url } }))
        }
      } catch {}
    }

    // Confetti burst and top-bar shimmer
    this.confettiBurst()
    try { window.dispatchEvent(new CustomEvent('UiShimmer')) } catch {}
  }

  // Boosters removed
  setMuted(m: boolean) {
    this.muted = m
    if (this.bgmGain) this.bgmGain.gain.value = this.muted ? 0 : 0.03
    if (!this.muted) this.warmAudio()
    if (!this.muted && !this.bgmOsc) {
      if (this.sound.locked) this.sound.once(Phaser.Sound.Events.UNLOCKED, () => this.startBgm())
      else this.startBgm()
    }
  }

  private handleSelect(cell: GridCell) {
    if (this.movesLeft <= 0) return
    if (!cell.sprite) return // Ensure cell has a sprite
    
    if (this.selected === cell) {
      this.highlight(cell, false)
      this.selected = undefined
      return
    }
    
    if (this.selected && this.isAdjacent(this.selected, cell)) {
      this.isSwapping = true
      const from = this.selected
      this.highlight(from, false)
      this.selected = undefined
      this.trySwap(from, cell)
      this.time.delayedCall(200, () => { this.isSwapping = false })
      return
    }
    
    if (this.selected) this.highlight(this.selected, false)
    this.selected = cell
    this.highlight(cell, true)
  }

  private clearRow(r: number) {
    const group: GridCell[] = []
    for (let c = 0; c < GRID_SIZE; c++) group.push(this.grid[r][c])
    this.sweepBeamRow(r)
    this.clearCellsImmediate(group, 'line_h')
    this.sounds.line?.()
  }
  private clearCol(c: number) {
    const group: GridCell[] = []
    for (let r = 0; r < GRID_SIZE; r++) group.push(this.grid[r][c])
    this.sweepBeamCol(c)
    this.clearCellsImmediate(group, 'line_v')
    this.sounds.line?.()
  }
  private clearBomb(cell: GridCell) {
    const group: GridCell[] = []
    for (let r = Math.max(0, cell.row - 1); r <= Math.min(GRID_SIZE - 1, cell.row + 1); r++) {
      for (let c = Math.max(0, cell.col - 1); c <= Math.min(GRID_SIZE - 1, cell.col + 1); c++) {
        group.push(this.grid[r][c])
      }
    }
    this.shockwave(cell)
    this.clearCellsImmediate(group, 'bomb')
    this.sounds.bomb?.()
  }
  private clearCellsImmediate(cells: GridCell[], effectType?: string) {
    for (const cell of cells) {
      if (!cell.sprite) continue
      
      // Special effects based on type
      let particles = { speed: 120, lifespan: 450, quantity: 14, scale: { start: 0.8, end: 0 } }
      if (effectType === 'bomb') {
        particles = { speed: 150, lifespan: 700, quantity: 24, scale: { start: 1.2, end: 0 } }
      } else if (effectType === 'line_h' || effectType === 'line_v') {
        particles = { speed: 140, lifespan: 600, quantity: 20, scale: { start: 1.0, end: 0 } }
      }
      
      const emitter = this.add.particles(0, 0, 'spark', {
        ...particles,
        blendMode: Phaser.BlendModes.ADD
      })
      if (this.boardMask) emitter.setMask(this.boardMask)
      emitter.emitParticleAt(cell.sprite.x, cell.sprite.y)
      this.time.delayedCall(750, () => emitter.destroy())
      
      // Enhanced pop with trail effect
      const sprite = cell.sprite
      this.tweens.add({ 
        targets: sprite, 
        scale: effectType === 'bomb' ? 1.5 : 1.2, 
        duration: 120, 
        ease: 'Back.easeOut',
        yoyo: true,
        onComplete: () => {
          if (sprite && sprite.scene) {
            this.tweens.add({ 
              targets: sprite, 
              scale: 0, 
              alpha: 0, 
              duration: 150, 
              ease: 'Back.easeIn',
              onComplete: () => sprite.destroy() 
            })
          }
        }
      })
      cell.sprite = undefined
      cell.kind = -1
    }
    this.time.delayedCall(300, () => this.saveState())
  }

  // Persistence
  private saveState() {
    try {
      const gridKinds = this.grid.map(row => row.map(c => c.kind))
      const payload = { gridKinds, score: this.score, movesLeft: this.movesLeft, level: this.level, goal: this.goal }
      localStorage.setItem('cc_save', JSON.stringify(payload))
    } catch {}
  }

  // --- UI API and helpers added ---
  setVolume(v: number) {
    this.volume = Phaser.Math.Clamp(v, 0, 1)
    // adjust bgm if playing
    try {
      if (this.bgmGain) this.bgmGain.gain.value = this.muted ? 0 : 0.03 * this.volume
    } catch {}
  }

  startDaily() {
    try {
      const today = new Date()
      const y = today.getFullYear()
      const m = (today.getMonth() + 1).toString().padStart(2, '0')
      const d = today.getDate().toString().padStart(2, '0')
      const seedStr = `${y}${m}${d}`
      localStorage.setItem('cc_daily_on', '1')
      localStorage.setItem('cc_daily_seed', seedStr)
    } catch {}
    this.resetBoard()
  }

  private updateBest() {
    try {
      const raw = localStorage.getItem('cc_best')
      const best = raw ? parseInt(raw, 10) : 0
      if (this.score > best) localStorage.setItem('cc_best', String(this.score))
    } catch {}
  }

  private makeRng(seed: number) {
    // mulberry32 PRNG
    let t = seed >>> 0
    return function() {
      t += 0x6D2B79F5
      let x = Math.imul(t ^ (t >>> 15), 1 | t)
      x ^= x + Math.imul(x ^ (x >>> 7), 61 | x)
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296
    }
  }
  private loadState(): boolean {
    try {
      const raw = localStorage.getItem('cc_save')
      if (!raw) return false
      const data = JSON.parse(raw) as { gridKinds: number[][], score: number, movesLeft: number, level: number, goal: number }
      if (!Array.isArray(data.gridKinds) || data.gridKinds.length !== GRID_SIZE) return false
      this.score = data.score ?? 0
      this.movesLeft = data.movesLeft ?? MOVE_LIMIT
      if (this.movesLeft <= 0) this.movesLeft = MOVE_LIMIT
      this.level = data.level ?? 1
      this.goal = data.goal ?? START_GOAL
      this.grid = []
      for (let r = 0; r < GRID_SIZE; r++) {
        const rowKinds = data.gridKinds[r]
        if (!Array.isArray(rowKinds) || rowKinds.length !== GRID_SIZE) return false
        const row: GridCell[] = []
        for (let c = 0; c < GRID_SIZE; c++) {
          row.push({ row: r, col: c, kind: rowKinds[c] })
        }
        this.grid.push(row)
      }
      this.drawGrid(false)
      this.updateUi()
      return true
    } catch { return false }
  }

  private wait(ms: number) {
    return new Promise<void>(resolve => this.time.delayedCall(ms, () => resolve()))
  }

  // --- Combo/Fever ---
  private drawCombo() {
    const w = 400, h = 8
    const x = 360 - w/2, y = 138
    if (!this.comboBar) this.comboBar = this.add.graphics().setDepth(6)
    const g = this.comboBar
    g.clear()
    g.fillStyle(0x000000, 0.22); g.fillRoundedRect(x, y, w, h, 5)
    const pct = Phaser.Math.Clamp(this.comboValue / 100, 0, 1)
    const fill = Math.max(0, Math.floor(pct * w))
    const color = this.fever ? 0xff7ab6 : 0x7c3aed
    g.fillStyle(color, this.fever ? 1.0 : 0.9); g.fillRoundedRect(x, y, fill, h, 5)
  }
  private addCombo(v: number) {
    this.comboValue = Phaser.Math.Clamp(this.comboValue + v, 0, 100)
    if (!this.fever && this.comboValue >= 100) this.startFever()
    this.drawCombo()
  }
  private startFever() {
    if (this.fever) return
    this.fever = true
    this.comboValue = 100
    this.drawCombo()
    this.camZoomPulse()
    // Stronger effects briefly
    const cam = this.cameras.main
    this.tweens.add({ targets: cam, zoom: 1.04, duration: 200, yoyo: true })
    this.time.delayedCall(8000, () => this.endFever())
  }
  private endFever() {
    this.fever = false
    this.comboValue = 35
    this.drawCombo()
  }

  // --- Accessibility: color-blind palette ---
  setColorBlind(v: boolean) {
    this.colorBlind = v
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const cell = this.grid[r][c]
        if (cell?.sprite && cell.kind >= 0) this.applyTintForKind(cell.sprite, cell.kind)
      }
    }
  }
  private applyTintForKind(sprite: Phaser.GameObjects.Sprite, kind: number) {
    if (!this.colorBlind) { sprite.clearTint(); return }
    const palette = [0x1f77b4, 0xff7f0e, 0x2ca02c, 0xd62728, 0x9467bd, 0x8c564b, 0xe377c2, 0x17becf]
    const tint = palette[kind % palette.length]
    sprite.setTint(tint)
  }

  private playTone(freq: number, duration = 0.12, volume = 0.4) {
    try {
      if (this.muted) return
      if (this.toneActive >= 3) return
      const audioManager = this.sound as any
      const ctx = audioManager?.context || audioManager?.audioContext
      if (!ctx) return
      this.toneActive++
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.value = volume * this.volume
      osc.connect(gain).connect(ctx.destination)
      osc.start()
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration)
      const stopAt = ctx.currentTime + duration + 0.02
      osc.stop(stopAt)
      setTimeout(() => { this.toneActive = Math.max(0, this.toneActive - 1) }, duration * 1000 + 80)
    } catch {}
  }
  private startBgm() {
    try {
      const audioManager = this.sound as any
      const ctx = audioManager?.context || audioManager?.audioContext
      if (!ctx || ctx.state === 'suspended') return
      this.bgmOsc?.stop(); this.bgmGain?.disconnect(); this.bgmTimer?.remove()
      // Airy pad: triangle wave through a gentle lowpass with slow attack
      const osc = ctx.createOscillator()
      osc.type = 'triangle'
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 1200
      filter.Q.value = 0.5
      const gain = ctx.createGain()
      gain.gain.value = 0
      osc.connect(filter).connect(gain).connect(ctx.destination)
      osc.start()
      // Fade in pad
      const targetGain = this.muted ? 0 : 0.03 * this.volume
      gain.gain.linearRampToValueAtTime(targetGain, ctx.currentTime + 0.4)
      // Gentle 8-note loop with smooth glides
      const notes = [196, 233, 220, 262, 196, 233, 220, 294] // airy minor feel
      let i = 0
      const step = () => {
        const t = ctx.currentTime
        const next = notes[i % notes.length]
        // Smooth glide to new pitch to avoid clicks
        osc.frequency.cancelScheduledValues(t)
        osc.frequency.linearRampToValueAtTime(next, t + 0.25)
        i++
      }
      step()
      this.bgmTimer = this.time.addEvent({ delay: 600, callback: step, loop: true })
      this.bgmOsc = osc
      this.bgmGain = gain
    } catch {}
  }
}


