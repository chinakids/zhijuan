// 织卷 · 导演板（M2 曲线硬约束）· 自动化验证
// 用法：node --experimental-strip-types scripts/verify-director.mts
import assert from 'node:assert'
import { makeDirectorBoard, renderDirectorBoard, DIRECTOR } from '../src/shared/director.ts'
import type { SeriesCurve, PlotBeat } from '../src/shared/types.ts'

let passed = 0
let failed = 0
function check(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log('  ✓', name)
  } catch (e) {
    failed++
    console.log('  ✗', name, '->', (e as Error).message)
  }
}

function curve(name: string, kind: SeriesCurve['kind'], points: SeriesCurve['points']): SeriesCurve {
  return { id: name + Math.random(), kind, name, color: '#fff', points: points as never }
}

console.log('== 波峰波谷定位 ==')
check('先升后回的曲线：最高峰标在中间段，用作本章高潮', () => {
  // 0-37% 爬升到 90，然后 62-100% 回落
  const c = curve('整体张力', 'emotion', [
    { x: 0, y: 88 },
    { x: 40, y: 92 },
    { x: 62, y: 90 },
    { x: 100, y: 12 }
  ])
  const plans = makeDirectorBoard([c], [])
  const climax = plans.find((p) => p.climax)!
  assert.ok(climax, '要有最高潮段')
  assert.ok(climax.intensity >= 80, '最高潮段的强度应高，实际 ' + climax.intensity)
  const nadir = plans.find((p) => p.nadir)!
  assert.ok(nadir.intensity <= 25, '最低谷段强度够低，实际 ' + nadir.intensity)
})

console.log('== 落差检测 ==')
check('把骤升段标记出，并提示必须用事件承载', () => {
  // 前四段平稳 20，然后陡然升到 90（第四段 ~37-50% 内跨过 threshold）
  const c = curve('整体张力', 'emotion', [
    { x: 0, y: 20 },
    { x: 30, y: 22 },
    { x: 62, y: 90 },
    { x: 100, y: 90 }
  ])
  const plans = makeDirectorBoard([c], [])
  const jumpy = plans.filter((p) => p.jumps.length > 0)
  assert.ok(jumpy.length >= 1, '应有落差段')
  const board = renderDirectorBoard('测试', plans)
  assert.ok(board.includes('必须用一件具体事件撑起这个变化'), '渲染应强调事件承载，实际:\n' + board)
  assert.ok(board.includes('导演板'), '要有导演板标记')
  assert.ok(board.includes('硬指令'), '要有硬指令标记')
})

console.log('== 情节点归位 ==')
check('情节点被归入正确的进度段', () => {
  const beats: PlotBeat[] = [
    { id: 'b1', at: 10, label: '进门', note: '破门而入' },
    { id: 'b2', at: 75, label: '落地', note: '她从巅峰回落' }
  ]
  const c = curve('张力', 'emotion', [{ x: 0, y: 30 }, { x: 100, y: 90 }])
  const plans = makeDirectorBoard([c], beats)
  const b1 = plans.find((p) => p.beats.some((b) => b.startsWith('进门')))
  const b2 = plans.find((p) => p.beats.some((b) => b.startsWith('落地')))
  assert.ok(b1 && (b1.fromPct ?? 0) <= 20, '进门应在开头段')
  assert.ok(b2 && b2.seg >= Math.ceil(75 / (100 / DIRECTOR.segs)), '落地应落在偏后段，实际段 ' + (b2?.seg ?? -1))
})

console.log('== 边界 ==')
check('无曲线时也能生成导演板（全部平缓）', () => {
  const plans = makeDirectorBoard([], [])
  assert.strictEqual(plans.length, DIRECTOR.segs)
  assert.ok(plans.every((p) => p.intensity === 50))
})
check('平缓直线：不误报剧烈落差', () => {
  const c = curve('张力', 'emotion', [{ x: 0, y: 45 }, { x: 100, y: 55 }])
  const plans = makeDirectorBoard([c], [])
  assert.ok(plans.every((p) => p.jumps.length === 0), '不应该有落差标记')
})

console.log('== 分段任务文案 ==')
check('不同强度段给出节奏不同的任务（避免平淡的关键）', () => {
  const c = curve('整体张力', 'emotion', [{ x: 0, y: 10 }, { x: 50, y: 90 }, { x: 100, y: 20 }])
  const board = renderDirectorBoard('测试', makeDirectorBoard([c], []))
  assert.ok(board.includes('低谷：留白与伏笔'), '应有低谷段指令')
  assert.ok(board.includes('白热化'), '应有白热化指令')
})

console.log(`\n结果：通过 ${passed}，失败 ${failed}${failed ? '（有失败！）' : '（全部通过 ✅）'}`)
process.exit(failed ? 1 : 0)
