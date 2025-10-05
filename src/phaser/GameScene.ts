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
  // default colors used when generating fallback candies
  private defaultColors = [
    0xff6ec7, 0xffd166, 0x8cff9a, 0x6ecbff, 0xd66bff, 0xff8fa3
  ]

  private sounds!: {
    swap: () => void
    match: () => void
    drop: () => void
    line?: () => void
    bomb?: () => void
  }
  private boardMask?: Phaser.Display.Masks.GeometryMask
  private bgImage?: Phaser.GameObjects.Image
  private progressBar?: Phaser.GameObjects.Graphics
  private starTexts: Phaser.GameObjects.Text[] = []

  private idleTimer?: Phaser.Time.TimerEvent
  private hintSprites: Phaser.GameObjects.Sprite[] = []
  private gameOverShown = false
  // boosters removed; keep placeholder to avoid refactors
  private booster: null = null
  private muted = false
  private bgmGain?: GainNode
  private bgmOsc?: OscillatorNode
  private bgmTimer?: Phaser.Time.TimerEvent
  private dragStart?: { x: number, y: number }
  private isSwapping = false

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
        }
      } catch {}
    } else {
      bg.destroy()
      // Clear page background if no bg
      document.body.style.backgroundImage = ''
    }

    // Minimal title centered
    this.add.text(360, 80, 'Candy Mon', {
      fontFamily: 'Nunito', fontSize: '40px', color: '#1e1e1e', fontStyle: 'bold'
    }).setOrigin(0.5)

    this.sounds = {
      swap: () => this.playTone(360, 0.08, 0.3),
      match: () => this.playTone(720, 0.12, 0.4),
      drop: () => this.playTone(280, 0.06, 0.25),
      line: () => this.playTone(540, 0.1, 0.35),
      bomb: () => this.playTone(220, 0.16, 0.5)
    }

    // Simple background tone using an oscillator; start after user gesture/unlock
    if (!this.muted) {
      if (this.sound.locked) {
        this.sound.once(Phaser.Sound.Events.UNLOCKED, () => this.startBgm())
      } else {
        this.input.once('pointerdown', () => this.startBgm())
      }
    }

    if (!this.loadState()) {
      // ensure image keys are available (wait for texture load if needed)
      if (this.textureKeys.length === 0) {
        // Fallback: proceed immediately since textures are already processed
        this.time.delayedCall(0, () => this.createBoard())
      } else {
        this.createBoard()
      }
    }
    // Guarantee playable state
    if (this.movesLeft <= 0) this.movesLeft = MOVE_LIMIT
    this.updateUi()

    // Create and apply board clipping mask
    const maskGfx = this.add.graphics()
    maskGfx.fillStyle(0xffffff, 1)
    maskGfx.fillRect(GRID_LEFT, GRID_TOP, GRID_SIZE * CELL_PX, GRID_SIZE * CELL_PX)
    this.boardMask = maskGfx.createGeometryMask()
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
      const row = Math.floor((worldY - GRID_TOP) / CELL_PX)
      
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

    this.updateUi()

    this.resetIdleTimer()
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
    this.children.removeAll()
    this.score = 0
    this.movesLeft = MOVE_LIMIT
    this.level = 1
    this.goal = START_GOAL
    this.gameOverShown = false
    this.create()
    this.saveState()
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
    return Math.floor(Math.random() * this.getActiveKindCount())
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
        const y = GRID_TOP + r * CELL_PX + CELL_PX / 2
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
        sprite.setInteractive()
        sprite.setData('cell', cell)
        sprite.setScale(0.95)
        sprite.setDepth(1)
        if (this.boardMask) sprite.setMask(this.boardMask)
        
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
        this.animateSwap(a, b)
        return
      }
      this.movesLeft -= 1
      this.updateUi()
      await this.resolveMatchesLoop()
      if (this.movesLeft <= 0) this.showGameOver()
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
    this.tweens.add({ targets: a.sprite, x: ta.x, y: ta.y, duration: 140, ease: 'Sine.easeInOut' })
    this.tweens.add({ targets: b.sprite, x: tb.x, y: tb.y, duration: 140, ease: 'Sine.easeInOut', onComplete })
  }

  private cellCenter(cell: GridCell) {
    return {
      x: GRID_LEFT + cell.col * CELL_PX + CELL_PX / 2,
      y: GRID_TOP + cell.row * CELL_PX + CELL_PX / 2
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
      const matches = this.findAllMatches()
      if (!matches.length) break
      await this.clearMatches(matches, combo)
      await this.dropAndRefill()
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
        
        // Enhanced particle effects
        const emitter = this.add.particles(0, 0, 'spark', {
          speed: 120,
          lifespan: 600,
          quantity: 16,
          scale: { start: 1.0, end: 0 },
          angle: { min: 0, max: 360 },
          alpha: { start: 1, end: 0 }
        })
        if (this.boardMask) emitter.setMask(this.boardMask)
        emitter.emitParticleAt(cell.sprite.x, cell.sprite.y)
        this.time.delayedCall(700, () => emitter.destroy())
        
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
    
    this.score += Math.floor(cleared * 10 * combo)
    this.updateUi()
    if (this.score >= this.goal) {
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
                this.tweens.add({ targets: above.sprite, x: to.x, y: to.y, duration: 160 })
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
          sprite.setScale(0.9)
          if (this.boardMask) sprite.setMask(this.boardMask)
          cell.sprite = sprite
          this.tweens.add({ targets: sprite, y: pos.y, duration: 180 })
        }
      }
    }
    await this.wait(200)
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
    this.saveState()
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

  private showGameOver() {
    if (this.gameOverShown) return
    this.gameOverShown = true
    const w = 520, h = 260
    const cx = 360, cy = 640
    const panel = this.add.rectangle(cx, cy, w, h, 0x000000, 0.6).setStrokeStyle(2, 0xffffff, 0.4)
    const title = this.add.text(cx, cy - 40, 'Out of moves!', { fontFamily: 'Nunito', fontSize: '42px', color: '#ffffff' }).setOrigin(0.5)
    const btn = this.add.text(cx, cy + 40, 'Tap to Reset', { fontFamily: 'Nunito', fontSize: '28px', color: '#ffd166', backgroundColor: '#2e2a7e' })
      .setPadding(10, 8, 10, 8).setOrigin(0.5).setInteractive({ useHandCursor: true })
    btn.on('pointerdown', () => this.resetBoard())
    // auto-hide when reset
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { panel.destroy(); title.destroy(); btn.destroy() })

    // no leaderboard
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
      const finish = () => {
        this.bgImage!.setTexture(key)
        const w = 720, h = 1280
        const bw = this.bgImage!.width, bh = this.bgImage!.height
        const scale = Math.max(w / bw, h / bh)
        this.bgImage!.setScale(scale)
      }
      if (this.textures.exists(key)) finish()
      else this.load.once(Phaser.Loader.Events.COMPLETE, finish).start()
    }
  }

  // Boosters removed
  setMuted(m: boolean) {
    this.muted = m
    if (this.bgmGain) this.bgmGain.gain.value = this.muted ? 0 : 0.03
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
    this.clearCellsImmediate(group, 'line_h')
    this.sounds.line?.()
  }
  private clearCol(c: number) {
    const group: GridCell[] = []
    for (let r = 0; r < GRID_SIZE; r++) group.push(this.grid[r][c])
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

  private playTone(freq: number, duration = 0.12, volume = 0.4) {
    try {
      if (this.muted) return
      const audioManager = this.sound as any
      const ctx = audioManager.context || audioManager.audioContext || (window as any).AudioContext && new (window as any).AudioContext()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.value = volume
      osc.connect(gain).connect(ctx.destination)
      osc.start()
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration)
      osc.stop(ctx.currentTime + duration + 0.02)
    } catch {}
  }
  private startBgm() {
    try {
      const audioManager = this.sound as any
      const ctx = audioManager.context || audioManager.audioContext || (window as any).AudioContext && new (window as any).AudioContext()
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
      const targetGain = this.muted ? 0 : 0.03
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


