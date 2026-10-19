import { useCallback, useEffect, useRef, useState } from 'react'
import { createGame, takeTurn, type Direction, type GameState, pointEquals } from './game'

type RecordEntry = { status: 'won' | 'lost'; floor: number; turns: number; kills: number; hp: number; date: string }
type SavedHistory = { bestTurns?: number; results: RecordEntry[] }
const STORAGE_KEY = 'ember-depths-history-v1'
const directionFromKey: Record<string, Direction | undefined> = { w: 'up', a: 'left', s: 'down', d: 'right', ArrowUp: 'up', ArrowRight: 'right', ArrowDown: 'down', ArrowLeft: 'left' }
const directions: { direction: Direction; icon: string; label: string }[] = [
  { direction: 'up', icon: '▲', label: '上へ' }, { direction: 'left', icon: '◀', label: '左へ' }, { direction: 'down', icon: '▼', label: '下へ' }, { direction: 'right', icon: '▶', label: '右へ' },
]

function readHistory(): SavedHistory {
  try { const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as SavedHistory | null; return parsed && Array.isArray(parsed.results) ? parsed : { results: [] } } catch { return { results: [] } }
}
function formatSeed(value: string) { const number = Number(value); return value.trim() !== '' && Number.isFinite(number) ? number : undefined }

function App() {
  const [screen, setScreen] = useState<'title' | 'game' | 'result'>('title')
  const [seedText, setSeedText] = useState('')
  const [game, setGame] = useState<GameState | null>(null)
  const [history, setHistory] = useState<SavedHistory>(() => readHistory())
  const busy = useRef(false); const savedRun = useRef<string | null>(null)

  const start = useCallback((seed?: number) => { savedRun.current = null; setGame(createGame(seed)); setScreen('game') }, [])
  const act = useCallback((direction: Direction) => {
    if (busy.current) return
    busy.current = true
    setGame((current) => current ? takeTurn(current, direction) : current)
    window.setTimeout(() => { busy.current = false }, 115)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const direction = directionFromKey[event.key]
      if (!direction || screen !== 'game' || event.repeat) return
      event.preventDefault(); act(direction)
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [act, screen])

  useEffect(() => {
    if (!game || (game.status !== 'won' && game.status !== 'lost')) return
    const runKey = `${game.seed}:${game.status}:${game.stats.turns}`
    if (savedRun.current === runKey) return
    savedRun.current = runKey
    const entry: RecordEntry = { status: game.status, floor: game.floor, turns: game.stats.turns, kills: game.stats.kills, hp: game.hp, date: new Date().toLocaleDateString('ja-JP') }
    const next: SavedHistory = { results: [entry, ...history.results].slice(0, 5), bestTurns: game.status === 'won' ? Math.min(history.bestTurns ?? Infinity, game.stats.turns) : history.bestTurns }
    setHistory(next); localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); setScreen('result')
  }, [game, history])

  if (screen === 'title') return <Title history={history} seedText={seedText} setSeedText={setSeedText} onStart={() => start(formatSeed(seedText))} />
  if (!game) return null
  if (screen === 'result') return <Result game={game} onRetry={() => start(game.seed)} onTitle={() => setScreen('title')} />
  return <GameView game={game} onMove={act} onTitle={() => setScreen('title')} />
}

function Title({ history, seedText, setSeedText, onStart }: { history: SavedHistory; seedText: string; setSeedText: (value: string) => void; onStart: () => void }) {
  return <main className="title-screen"><div className="mist mist-one"/><div className="mist mist-two"/><section className="title-card panel">
    <p className="eyebrow">TURN-BASED DUNGEON EXPEDITION</p><h1>EMBER<br/><span>DEPTHS</span></h1><p className="title-copy">燃え残る灯を頼りに、三層の深淵を踏破せよ。</p>
    <label className="seed-field">遠征シード <input value={seedText} inputMode="numeric" placeholder="未指定ならランダム" onChange={(e) => setSeedText(e.target.value)} /></label>
    <button className="primary" onClick={onStart}>深淵へ降りる <span>→</span></button>
    <div className="how-to"><b>遊び方</b><span>WASD / 矢印キーで移動</span><span>影にぶつかると攻撃。影を全て倒し、封印された階段を解放しよう。</span></div>
    <div className="best-record"><span>BEST CLEAR</span><strong>{history.bestTurns ? `${history.bestTurns} turns` : '—'}</strong></div>
  </section></main>
}

function GameView({ game, onMove, onTitle }: { game: GameState; onMove: (direction: Direction) => void; onTitle: () => void }) {
  const locked = game.dungeon.enemies.length > 0
  return <main className="game-shell"><header className="game-header"><div className="brand">EMBER <i>DEPTHS</i></div><button className="quiet" onClick={onTitle}>TITLE</button></header>
    <section className="status-row panel"><div className="vital"><span className="label">VITAL</span><div className="bar"><i style={{ width: `${game.hp / game.maxHp * 100}%` }}/></div><b>{game.hp}<small> / {game.maxHp}</small></b></div><Metric label="FLOOR" value={`0${game.floor} / 03`}/><Metric label="TURN" value={String(game.stats.turns).padStart(3, '0')}/><Metric label="VANQUISHED" value={`${game.stats.kills} / 6`}/></section>
    <section className="dungeon-layout"><div className="map-panel panel"><div className="map-topline"><span>SEED · {game.seed}</span><span className={locked ? 'seal sealed' : 'seal'}>{locked ? `SEAL · ${game.dungeon.enemies.length} SHADOWS` : 'STAIRS UNSEALED'}</span></div><Dungeon game={game}/><div className="message" key={`${game.stats.turns}-${game.log[0]}`}>{game.log[0]}</div></div>
      <aside className="side-panel"><div className="panel legend"><h2>FIELD NOTES</h2><p><em className="mark player"/>あなた <em className="mark scout"/>スカウト <em className="mark warden"/>ウォーデン</p><p><em className="mark potion"/>緋色の雫：HP +8</p><p><em className="mark stairs"/>階段：影を全滅させると解放</p></div><div className="panel log"><h2>EXPEDITION LOG</h2>{game.log.map((line, i) => <p className={i === 0 ? 'latest' : ''} key={`${line}-${i}`}>{line}</p>)}</div></aside>
    </section><div className="controls" aria-label="移動操作">{directions.map(({ direction, icon, label }) => <button key={direction} className={`control ${direction}`} onClick={() => onMove(direction)} aria-label={label}>{icon}</button>)}</div><p className="keyboard">W A S D &nbsp; / &nbsp; ARROW KEYS TO MOVE</p>
  </main>
}
function Metric({ label, value }: { label: string; value: string }) { return <div className="metric"><span>{label}</span><b>{value}</b></div> }
function Dungeon({ game }: { game: GameState }) {
  return <div className={`dungeon event-${game.event ?? 'none'}`} role="grid" aria-label="11 x 11 ダンジョン">{game.dungeon.tiles.map((row, y) => row.map((tile, x) => {
    const point = { x, y }; const enemy = game.dungeon.enemies.find((item) => pointEquals(item.pos, point)); const player = pointEquals(game.dungeon.player, point); const potion = pointEquals(game.dungeon.potion, point); const stairs = pointEquals(game.dungeon.stairs, point)
    return <div className={`cell ${tile}`} role="gridcell" key={`${x}-${y}`}>{stairs && <span className={`entity stairs ${game.dungeon.enemies.length ? 'locked' : ''}`}>⌄</span>}{potion && <span className="entity potion">✦</span>}{enemy && <span className={`entity enemy ${enemy.kind}`} title={`${enemy.kind} HP ${enemy.hp}/${enemy.maxHp}`}>{enemy.kind === 'scout' ? '◈' : '◆'}<small>{enemy.hp}</small></span>}{player && <span className="entity hero">✦</span>}</div>
  }))}</div>
}
function Result({ game, onRetry, onTitle }: { game: GameState; onRetry: () => void; onTitle: () => void }) {
  const won = game.status === 'won'; const s = game.stats
  const rows = [['到達階層', `${game.floor} / 3`], ['合計ターン', `${s.turns}`], ['移動回数', `${s.moves}`], ['攻撃回数', `${s.attacks}`], ['撃破数', `${s.kills}`], ['受けたダメージ', `${s.damageTaken}`], ['回復したHP', `${s.healed}`], ['残りHP', `${game.hp} / ${game.maxHp}`]]
  return <main className={`result-screen ${won ? 'victory' : 'defeat'}`}><section className="result-card panel"><p className="eyebrow">{won ? 'THE LAST SEAL HAS BROKEN' : 'THE EMBER FADES'}</p><h1>{won ? 'DEPTHS<br/><span>CLEARED</span>' : 'EXPEDITION<br/><span>ENDED</span>'}</h1><p>{won ? '深淵の底で、灯はなお燃えている。' : '冒険者は影に飲まれた。次の遠征に備えよう。'}</p><div className="results">{rows.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</div><button className="primary" onClick={onRetry}>同じ深淵に再挑戦 <span>↻</span></button><button className="secondary" onClick={onTitle}>タイトルへ戻る</button></section></main>
}
export default App
