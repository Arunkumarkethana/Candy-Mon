import './style.css'
import Phaser from 'phaser'
import { GameScene } from './phaser/GameScene'

const parent = document.getElementById('app')!

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 720,
  height: 1280,
  parent,
  backgroundColor: '#ffffff',
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

resetBtn?.addEventListener('click', () => {
  getGameScene()?.resetBoard()
})

// Listen to scene events for UI updates
window.addEventListener('GameScore', (ev: any) => {
  if (scoreEl) scoreEl.textContent = `Score: ${ev.detail}`
})
window.addEventListener('GameMoves', (ev: any) => {
  if (movesEl) movesEl.textContent = `Moves: ${ev.detail}`
})
window.addEventListener('GameLevel', (ev: any) => {
  if (levelEl) levelEl.textContent = `Level: ${ev.detail.level}`
  if (goalEl) goalEl.textContent = `Goal: ${ev.detail.goal}`
})

//

// Mute
let muted = false
muteBtn?.addEventListener('click', () => {
  muted = !muted
  getGameScene()?.setMuted(muted)
  muteBtn.textContent = muted ? 'Unmute' : 'Mute'
})
