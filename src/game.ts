export type Point = { x: number; y: number }
export type Direction = 'up' | 'right' | 'down' | 'left'
export type Tile = 'floor' | 'wall'
export type EnemyKind = 'scout' | 'warden'
export type Status = 'playing' | 'won' | 'lost'

export const SIZE = 11
export const DIRECTIONS: Record<Direction, Point> = {
  up: { x: 0, y: -1 }, right: { x: 1, y: 0 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 },
}
const PATH_ORDER: Direction[] = ['up', 'right', 'down', 'left']

export type Enemy = { id: number; kind: EnemyKind; pos: Point; hp: number; maxHp: number; attack: number }
export type Stats = { turns: number; moves: number; attacks: number; kills: number; damageTaken: number; healed: number; reachedFloor: number }
export type Dungeon = { tiles: Tile[][]; player: Point; enemies: Enemy[]; potion: Point; stairs: Point }
export type GameState = { seed: number; floor: number; dungeon: Dungeon; hp: number; maxHp: number; attack: number; stats: Stats; status: Status; log: string[]; event: 'move' | 'attack' | 'hurt' | 'heal' | 'floor' | null }

export class Rng {
  private value: number
  constructor(seed: number) { this.value = seed >>> 0 || 0x9e3779b9 }
  next(): number { let t = (this.value += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  int(max: number): number { return Math.floor(this.next() * max) }
}

const key = (p: Point) => `${p.x},${p.y}`
const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y
const inside = (p: Point) => p.x > 0 && p.x < SIZE - 1 && p.y > 0 && p.y < SIZE - 1
const clonePoint = (p: Point): Point => ({ ...p })
export const floorSeed = (seed: number, floor: number) => (seed + floor * 0x9e3779b9) >>> 0
export const normalizeSeed = (value?: number) => Number.isFinite(value) ? Math.floor(value as number) >>> 0 : (Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0

function reachable(tiles: Tile[][], start: Point): Set<string> {
  const seen = new Set<string>([key(start)]); const queue = [start]
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!
    for (const delta of Object.values(DIRECTIONS)) {
      const next = { x: current.x + delta.x, y: current.y + delta.y }
      if (inside(next) && tiles[next.y]![next.x] === 'floor' && !seen.has(key(next))) { seen.add(key(next)); queue.push(next) }
    }
  }
  return seen
}

function shuffledFloor(rng: Rng, tiles: Tile[][]): Point[] {
  const points: Point[] = []
  for (let y = 1; y < SIZE - 1; y += 1) for (let x = 1; x < SIZE - 1; x += 1) if (tiles[y]![x] === 'floor') points.push({ x, y })
  for (let i = points.length - 1; i > 0; i -= 1) { const j = rng.int(i + 1); [points[i], points[j]] = [points[j]!, points[i]!] }
  return points
}

const enemyPlan: Record<number, EnemyKind[]> = { 1: ['scout', 'scout'], 2: ['scout', 'warden'], 3: ['warden', 'warden'] }
function makeEnemy(id: number, kind: EnemyKind, pos: Point): Enemy { return kind === 'scout' ? { id, kind, pos, hp: 8, maxHp: 8, attack: 2 } : { id, kind, pos, hp: 12, maxHp: 12, attack: 3 } }

export function generateDungeon(seed: number, floor: number): Dungeon {
  const rng = new Rng(floorSeed(seed, floor)); const required = 4 + enemyPlan[floor]!.length
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const tiles: Tile[][] = Array.from({ length: SIZE }, (_, y) => Array.from({ length: SIZE }, (_, x): Tile => x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 || rng.next() < 0.24 ? 'wall' : 'floor'))
    const candidates = shuffledFloor(rng, tiles)
    if (candidates.length < required) continue
    const player = candidates[0]!, access = reachable(tiles, player)
    if (access.size !== candidates.length) continue
    const stairs = candidates[1]!, potion = candidates[2]!
    const enemies = enemyPlan[floor]!.map((kind, index) => makeEnemy(index + 1, kind, candidates[index + 3]!))
    return { tiles, player, stairs, potion, enemies }
  }
  // Deterministic open-floor fallback: never compromises reachability.
  const tiles = Array.from({ length: SIZE }, (_, y) => Array.from({ length: SIZE }, (_, x): Tile => x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  const candidates = shuffledFloor(rng, tiles)
  return { tiles, player: candidates[0]!, stairs: candidates[1]!, potion: candidates[2]!, enemies: enemyPlan[floor]!.map((kind, index) => makeEnemy(index + 1, kind, candidates[index + 3]!)) }
}

export function createGame(seed?: number): GameState {
  const actualSeed = normalizeSeed(seed)
  return { seed: actualSeed, floor: 1, dungeon: generateDungeon(actualSeed, 1), hp: 30, maxHp: 30, attack: 5, stats: { turns: 0, moves: 0, attacks: 0, kills: 0, damageTaken: 0, healed: 0, reachedFloor: 1 }, status: 'playing', log: ['深淵へようこそ。全ての影を倒し、出口を探せ。'], event: null }
}

const withLog = (state: GameState, message: string, event: GameState['event']): GameState => ({ ...state, log: [message, ...state.log].slice(0, 5), event })
const isWalkable = (dungeon: Dungeon, pos: Point) => inside(pos) && dungeon.tiles[pos.y]![pos.x] === 'floor'

function enemyStep(dungeon: Dungeon, enemy: Enemy, player: Point): Point | null {
  const occupied = new Set(dungeon.enemies.filter((other) => other.id !== enemy.id).map((other) => key(other.pos)))
  const queue: Point[] = [enemy.pos]; const previous = new Map<string, Point | null>([[key(enemy.pos), null]])
  let found: Point | null = null
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!
    if (same(current, player)) { found = current; break }
    for (const direction of PATH_ORDER) {
      const delta = DIRECTIONS[direction], next = { x: current.x + delta.x, y: current.y + delta.y }
      if (!isWalkable(dungeon, next) || occupied.has(key(next)) || previous.has(key(next))) continue
      previous.set(key(next), current); queue.push(next)
    }
  }
  if (!found) return null
  let step = found; let parent = previous.get(key(step))
  while (parent && !same(parent, enemy.pos)) { step = parent; parent = previous.get(key(step)) }
  return same(step, player) ? null : step
}

function runEnemies(state: GameState): GameState {
  let next = state
  for (const enemy of [...next.dungeon.enemies].sort((a, b) => a.id - b.id)) {
    if (next.status !== 'playing') break
    const distance = Math.abs(enemy.pos.x - next.dungeon.player.x) + Math.abs(enemy.pos.y - next.dungeon.player.y)
    if (distance === 1) {
      const actual = Math.min(next.hp, enemy.attack); const hp = next.hp - actual
      next = { ...next, hp, stats: { ...next.stats, damageTaken: next.stats.damageTaken + actual }, status: hp <= 0 ? 'lost' : 'playing' }
      next = withLog(next, `${enemy.kind === 'scout' ? 'スカウト' : 'ウォーデン'}の一撃。-${actual} HP`, 'hurt')
      continue
    }
    const destination = enemyStep(next.dungeon, enemy, next.dungeon.player)
    if (destination) next = { ...next, dungeon: { ...next.dungeon, enemies: next.dungeon.enemies.map((item) => item.id === enemy.id ? { ...item, pos: destination } : item) } }
  }
  return next
}

function advanceFloor(state: GameState): GameState {
  if (state.floor === 3) return { ...state, status: 'won', stats: { ...state.stats, reachedFloor: 3 }, log: ['EMBER DEPTHS を踏破した。'], event: 'floor' }
  const floor = state.floor + 1
  return { ...state, floor, dungeon: generateDungeon(state.seed, floor), stats: { ...state.stats, reachedFloor: floor }, log: [`第${floor}層へ降りた。空気が冷たい。`], event: 'floor' }
}

/** Pure, atomic player action. Invalid actions return the original state. */
export function takeTurn(state: GameState, direction: Direction): GameState {
  if (state.status !== 'playing') return state
  const delta = DIRECTIONS[direction], target = { x: state.dungeon.player.x + delta.x, y: state.dungeon.player.y + delta.y }
  if (!isWalkable(state.dungeon, target)) return state
  const enemy = state.dungeon.enemies.find((item) => same(item.pos, target))
  let next: GameState
  if (enemy) {
    const newHp = enemy.hp - state.attack; const dead = newHp <= 0
    next = { ...state, stats: { ...state.stats, turns: state.stats.turns + 1, attacks: state.stats.attacks + 1, kills: state.stats.kills + (dead ? 1 : 0) }, dungeon: { ...state.dungeon, enemies: dead ? state.dungeon.enemies.filter((item) => item.id !== enemy.id) : state.dungeon.enemies.map((item) => item.id === enemy.id ? { ...item, hp: newHp } : item) } }
    next = withLog(next, dead ? `${enemy.kind === 'scout' ? 'スカウト' : 'ウォーデン'}を倒した。` : `影を斬る。-${state.attack} HP`, 'attack')
  } else if (same(target, state.dungeon.stairs)) {
    if (state.dungeon.enemies.length > 0) return withLog(state, '階段は影に封じられている。', null)
    next = { ...state, stats: { ...state.stats, turns: state.stats.turns + 1 } }
    return advanceFloor(next)
  } else {
    const gained = same(target, state.dungeon.potion) ? Math.min(8, state.maxHp - state.hp) : 0
    next = { ...state, hp: state.hp + gained, stats: { ...state.stats, turns: state.stats.turns + 1, moves: state.stats.moves + 1, healed: state.stats.healed + gained }, dungeon: { ...state.dungeon, player: target, potion: same(target, state.dungeon.potion) ? { x: -1, y: -1 } : state.dungeon.potion } }
    next = withLog(next, gained > 0 ? `緋色の雫を飲んだ。+${gained} HP` : '足音が石床に消える。', gained > 0 ? 'heal' : 'move')
  }
  return runEnemies(next)
}

export const canReachAll = (dungeon: Dungeon) => { const cells = reachable(dungeon.tiles, dungeon.player); return [dungeon.stairs, dungeon.potion, ...dungeon.enemies.map((enemy) => enemy.pos)].every((point) => cells.has(key(point))) }
export const pointEquals = same
export const copyPoint = clonePoint
