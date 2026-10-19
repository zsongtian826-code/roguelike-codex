import { describe, expect, it } from 'vitest'
import { canReachAll, createGame, generateDungeon, takeTurn, type GameState } from '../src/game'

function openState(): GameState {
  const state = createGame(9001)
  const tiles = Array.from({ length: 11 }, (_, y) => Array.from({ length: 11 }, (_, x) => x === 0 || y === 0 || x === 10 || y === 10 ? 'wall' as const : 'floor' as const))
  return { ...state, dungeon: { ...state.dungeon, tiles, player: { x: 5, y: 5 }, potion: { x: 8, y: 8 }, stairs: { x: 9, y: 9 }, enemies: [] }, log: [], event: null }
}

describe('deterministic safe dungeon generation', () => {
  it('makes identical maps from the same seed', () => expect(generateDungeon(123456, 2)).toEqual(generateDungeon(123456, 2)))
  it('keeps every objective reachable over a spread of seeds', () => {
    for (let seed = 0; seed < 40; seed += 1) for (let floor = 1; floor <= 3; floor += 1) expect(canReachAll(generateDungeon(seed, floor))).toBe(true)
  })
  it('uses the required enemy composition', () => {
    expect(generateDungeon(7, 1).enemies.map((e) => [e.kind, e.hp, e.attack])).toEqual([['scout', 8, 2], ['scout', 8, 2]])
    expect(generateDungeon(7, 2).enemies.map((e) => e.kind)).toEqual(['scout', 'warden'])
    expect(generateDungeon(7, 3).enemies.map((e) => e.kind)).toEqual(['warden', 'warden'])
  })
})

describe('atomic turn rules', () => {
  it('does not spend a turn or wake enemies when walking into a wall', () => {
    const state = openState(); state.dungeon.tiles[4]![5] = 'wall'; state.dungeon.enemies = [{ id: 1, kind: 'scout', pos: { x: 7, y: 5 }, hp: 8, maxHp: 8, attack: 2 }]
    expect(takeTurn(state, 'up')).toBe(state)
  })
  it('attacks instead of moving and applies exactly five damage', () => {
    const state = openState(); state.dungeon.enemies = [{ id: 1, kind: 'scout', pos: { x: 5, y: 4 }, hp: 8, maxHp: 8, attack: 2 }]
    const next = takeTurn(state, 'up')
    expect(next.dungeon.player).toEqual({ x: 5, y: 5 }); expect(next.dungeon.enemies[0]!.hp).toBe(3); expect(next.stats.attacks).toBe(1); expect(next.stats.turns).toBe(1)
  })
  it('removes a defeated enemy before it can act', () => {
    const state = openState(); state.dungeon.enemies = [{ id: 1, kind: 'scout', pos: { x: 5, y: 4 }, hp: 5, maxHp: 8, attack: 2 }]
    const next = takeTurn(state, 'up')
    expect(next.dungeon.enemies).toHaveLength(0); expect(next.stats.kills).toBe(1); expect(next.hp).toBe(30)
  })
  it('uses obstacle-aware BFS and fixed movement ordering', () => {
    const state = openState(); state.dungeon.player = { x: 3, y: 3 }; state.dungeon.enemies = [{ id: 1, kind: 'scout', pos: { x: 5, y: 3 }, hp: 8, maxHp: 8, attack: 2 }]
    state.dungeon.tiles[3]![4] = 'wall'
    const next = takeTurn(state, 'down')
    // The direct left route is blocked, so its shortest route begins downward.
    expect(next.dungeon.enemies[0]!.pos).toEqual({ x: 5, y: 4 })
  })
  it('never lets enemies overlap during their fixed ID turn order', () => {
    const state = openState(); state.dungeon.enemies = [{ id: 1, kind: 'scout', pos: { x: 3, y: 5 }, hp: 8, maxHp: 8, attack: 2 }, { id: 2, kind: 'warden', pos: { x: 2, y: 5 }, hp: 12, maxHp: 12, attack: 3 }]
    const next = takeTurn(state, 'down'); const [a, b] = next.dungeon.enemies
    expect(a!.pos).not.toEqual(b!.pos)
  })
  it('stops enemy processing immediately on player death', () => {
    const state = openState(); state.hp = 2; state.dungeon.enemies = [{ id: 1, kind: 'scout', pos: { x: 5, y: 4 }, hp: 8, maxHp: 8, attack: 2 }, { id: 2, kind: 'warden', pos: { x: 6, y: 5 }, hp: 12, maxHp: 12, attack: 3 }]
    const next = takeTurn(state, 'up')
    expect(next.status).toBe('lost'); expect(next.hp).toBe(0); expect(next.stats.damageTaken).toBe(2)
  })
  it('heals automatically without exceeding max health', () => {
    const state = openState(); state.hp = 28; state.dungeon.potion = { x: 5, y: 4 }
    const next = takeTurn(state, 'up')
    expect(next.hp).toBe(30); expect(next.stats.healed).toBe(2); expect(next.dungeon.potion).toEqual({ x: -1, y: -1 })
  })
  it('keeps a sealed stair invalid without spending a turn', () => {
    const state = openState(); state.dungeon.stairs = { x: 5, y: 4 }; state.dungeon.enemies = [{ id: 1, kind: 'scout', pos: { x: 8, y: 8 }, hp: 8, maxHp: 8, attack: 2 }]
    const next = takeTurn(state, 'up')
    expect(next.floor).toBe(1); expect(next.stats.turns).toBe(0); expect(next.dungeon.enemies[0]!.pos).toEqual({ x: 8, y: 8 })
  })
  it('preserves HP and creates the next floor when using an unlocked stair', () => {
    const state = openState(); state.hp = 17; state.dungeon.stairs = { x: 5, y: 4 }
    const next = takeTurn(state, 'up')
    expect(next.floor).toBe(2); expect(next.hp).toBe(17); expect(next.stats.turns).toBe(1); expect(next.stats.reachedFloor).toBe(2)
  })
  it('wins after using the third floor stair', () => {
    const state = openState(); state.floor = 3; state.dungeon.stairs = { x: 5, y: 4 }
    expect(takeTurn(state, 'up').status).toBe('won')
  })
  it('creates a clean initial state for a retry', () => {
    const state = createGame(55); state.hp = 1; state.stats.turns = 99
    const retry = createGame(55)
    expect(retry.hp).toBe(30); expect(retry.stats.turns).toBe(0); expect(retry.dungeon).toEqual(createGame(55).dungeon)
  })
})
