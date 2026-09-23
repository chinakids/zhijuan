// 织卷 · 行为轴（axes）· 自动化验证（M2.3 多轴曲线语义）
// 用法：node --experimental-strip-types scripts/verify-axes.mts
import assert from 'node:assert'
import type { SeriesCurve, AxisBand, CurveAxis } from '../src/shared/types.ts'
import { AXIS_LIBRARY, resolveAxis, axisDemand, pivotAxes, bandAt, generalBands, translateAxisCurve } from '../src/shared/axes.ts'
import { makeDirectorBoard, renderDirectorBoard, renderShotRow } from '../src/shared/director.ts'

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

function curve(name: string, kind: SeriesCurve['kind'], points: SeriesCurve['points'], axes?: CurveAxis[]): SeriesCurve {
  return { id: name + Math.random(), kind, name, color: '#fff', points: points as never, axes } as SeriesCurve
}

const shyBands = AXIS_LIBRARY['shyness'].bands as AxisBand[]

console.log('== legacy 兼容（单轴） ==')
check('resolveAxis / axisDemand 仍然可用', () => {
  const d0 = axisDemand('initiative', 5)
  assert.ok(d0 && d0.label.includes('被牵着走'))
  assert.strictEqual(axisDemand(undefined, 80), undefined)
})
check('旧曲线（axis+points）能被 pivotAxes 合成为一根轴', () => {
  const c = curve('沈若汐·防线', 'character', [{ x: 0, y: 20 }, { x: 100, y: 90 }], undefined)
  ;(c as { axis?: string }).axis = 'shyness'
  const axs = pivotAxes(c)
  assert.strictEqual(axs.length, 1)
  assert.strictEqual(axs[0].name, '羞耻防线')
  assert.ok(axs[0].bands && axs[0].bands.length >= 3)
})

console.log('== 多轴自由曲线 ==')
check('带 axes 时用 axes（忽略 legacy axis）', () => {
  const c = curve('许晴', 'character', [], [
    { id: 'a1', name: '她的主动权', points: [{ x: 0, y: 20 }, { x: 100, y: 95 }], bands: undefined },
    { id: 'a2', name: '两人距离', points: [{ x: 0, y: 60 }, { x: 100, y: 30 }], bands: shyBands }
  ])
  ;(c as { axis?: string }).axis = 'shyness' // 应被忽略
  const axs = pivotAxes(c)
  assert.strictEqual(axs.length, 2)
  assert.ok(axs.every((a) => a.name !== '羞耻防线'), 'legacy axis 不应再产生轴')
})
check('bandAt：自带档优先，没有则用通用三档', () => {
  assert.strictEqual(bandAt(undefined, 5).label, '被动·生涩')
  assert.strictEqual(bandAt(undefined, 95).label, '主导·放开')
  assert.strictEqual(bandAt(shyBands, 90).label, '羞到骨里')
  assert.strictEqual(bandAt(generalBands(), 40).label, '拉锯·试探')
})
check('translateAxisCurve：把档位写成段级动作命令', () => {
  const lines = translateAxisCurve(
    { id: 'a', name: '她的主动权', points: [{ x: 0, y: 10 }, { x: 100, y: 90 }], bands: undefined },
    4
  )
  assert.ok(lines.length === 4)
  assert.ok(lines[0].includes('被动·生涩'), '开头应是被动档')
  assert.ok(lines[lines.length - 1].includes('主导·放开'), '结尾应是主导档')
})
check('档位跨段跳变时给到硬提示', () => {
  const lines = translateAxisCurve(
    { id: 'a', name: '她的主动权', points: [{ x: 0, y: 15 }, { x: 30, y: 20 }, { x: 60, y: 85 }, { x: 100, y: 90 }], bands: undefined },
    4
  )
  assert.ok(lines.some((l) => l.includes('必须用一件具体事件或转折接住这一跃')), '跳变段要显式要求事件承载')
})

console.log('== 导演板接入 ==')
check('带轴人物曲线：每段曲线信息里携带动作要求（acts）', () => {
  const shi = curve('沈若汐·防线', 'character', [{ x: 0, y: 20 }, { x: 40, y: 25 }, { x: 60, y: 95 }, { x: 100, y: 30 }], [
    { id: 'ax', name: '羞耻防线', points: [{ x: 0, y: 10 }, { x: 50, y: 30 }, { x: 60, y: 95 }, { x: 100, y: 20 }], bands: shyBands }
  ])
  const emo = curve('整体张力', 'emotion', [{ x: 0, y: 40 }, { x: 100, y: 60 }])
  const plans = makeDirectorBoard([emo, shi], [])
  const withAct = plans.filter((p) => p.curves.some((c) => c.acts?.length))
  assert.ok(withAct.length >= 2, '应有段带着行为轴指令')
  const high = plans.find((p) => p.curves.find((c) => c.name === '沈若汐·防线')?.acts?.some((a) => a.value >= 70))!
  const highAct = high.curves.find((c) => c.name === '沈若汐·防线')!.acts!.find((a) => a.value >= 70)!
  assert.ok(highAct.band.includes('羞到骨里'), '峰值段应落到最高档，实际 ' + highAct.band)
})
check('渲染里出现行为轴硬命令与具体动作要求，并带档位跳变提醒', () => {
  const shi = curve('沈若汐·防线', 'character', [{ x: 0, y: 50 }, { x: 100, y: 50 }], [
    { id: 'ax', name: '她的主动权', points: [{ x: 0, y: 20 }, { x: 10, y: 25 }, { x: 55, y: 90 }, { x: 100, y: 85 }], bands: undefined }
  ])
  const emo = curve('整体张力', 'emotion', [{ x: 0, y: 30 }, { x: 100, y: 70 }])
  const board = renderDirectorBoard('测试', makeDirectorBoard([emo, shi], []))
  assert.ok(board.includes('行为轴「她的主动权」'), '应有自由命名的行为轴标记')
  assert.ok(board.includes('档位跳变'), '应有跳变提醒')
})
check('renderShotRow（兑现检查用）同样带着轴指令', () => {
  const shi = curve('沈若汐', 'character', [], [
    { id: 'ax', name: '两人距离', points: [{ x: 0, y: 80 }, { x: 100, y: 20 }], bands: shyBands }
  ])
  const plans = makeDirectorBoard([shi], [])
  const row = renderShotRow(plans[0])
  assert.ok(row.includes('两人距离'), '兑现清单要求里应见到轴名')
})

console.log(`\n结果：通过 ${passed}，失败 ${failed}${failed ? '（有失败！）' : '（全部通过 ✅）'}`)
process.exit(failed ? 1 : 0)
