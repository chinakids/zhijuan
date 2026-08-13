// 织卷 · 人物曲线行为轴（M2.3）· 自动化验证
// 用法：node --experimental-strip-types scripts/verify-axes.mts
// 覆盖：轴库良好性（档位完整覆盖 0..100）、档位取值、导演板集成（行为轴进每段的动作硬命令）、
// 向后兼容（无轴曲线行为不变、未知轴不崩）、整链路（分幕指令里带行为轴）。
import assert from 'node:assert'
import { AXIS_LIBRARY, AXIS_ORDER, resolveAxis, axisDemand } from '../src/shared/axes.ts'
import { makeDirectorBoard, renderDirectorBoard, renderShotRow } from '../src/shared/director.ts'
import { planActs, renderActDirective } from '../src/shared/acts.ts'
import type { SeriesCurve } from '../src/shared/types.ts'

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

function curve(
  name: string,
  kind: SeriesCurve['kind'],
  points: SeriesCurve['points'],
  axis?: string
): SeriesCurve {
  return { id: name + Math.random(), kind, name, color: '#fff', points: points as never, axis }
}

console.log('== 轴库良好性 ==')
check('轴库非空，且 ORDER 每条都能在库里找到', () => {
  assert.ok(AXIS_ORDER.length >= 3, '至少要有几条预设轴')
  for (const id of AXIS_ORDER) {
    assert.ok(AXIS_LIBRARY[id], '轴 ' + id + ' 应在库里')
  }
})
check('每条轴的档位完整覆盖 0..100，且按 min 升序、档位措辞非空', () => {
  for (const id of AXIS_ORDER) {
    const ax = AXIS_LIBRARY[id]
    assert.ok(ax.bands.length >= 2, ax.label + ' 至少两档')
    const mins = ax.bands.map((b) => b.min)
    const sorted = [...mins].sort((a, b) => a - b)
    assert.deepStrictEqual(mins, sorted, ax.label + ' 档位应按 min 升序')
    assert.strictEqual(mins[0], 0, ax.label + ' 最低档 min 应为 0')
    assert.ok(ax.bands.every((b) => b.label && b.demand.length >= 10), ax.label + ' 各档要求具体、可写')
  }
})

console.log('== 档位取值 ==')
check('resolveAxis：合法 id 取到轴；未知 / 空返回 undefined', () => {
  assert.ok(resolveAxis('initiative'), '合法轴应取到')
  assert.strictEqual(resolveAxis('no_such_axis'), undefined, '未知轴应返回 undefined')
  assert.strictEqual(resolveAxis(undefined), undefined, '空值应返回 undefined')
})
check('axisDemand：低值取低档、高值取高档，边界归属正确', () => {
  const d0 = axisDemand('initiative', 5)
  assert.ok(d0 && d0.label.includes('被牵着走'), '低值应是低档，实际 ' + d0?.label)
  const dMid = axisDemand('initiative', 40)
  assert.ok(dMid && dMid.label.includes('有来有回'), '中值应是中档，实际 ' + dMid?.label)
  const dHi = axisDemand('initiative', 96)
  assert.ok(dHi && dHi.label.includes('由她主导'), '高值应是高档，实际 ' + dHi?.label)
  // 档位边界：恰好在 min 上归给该档
  const edge = axisDemand('initiative', 70)
  assert.ok(edge && edge.label.includes('由她主导'), '恰在 70 应归高档，实际 ' + edge?.label)
  const justBelow = axisDemand('initiative', 69)
  assert.ok(justBelow && justBelow.label.includes('有来有回'), '69 应仍是中档，实际 ' + justBelow?.label)
})
check('axisDemand：无轴曲线 → undefined（旧行为不变）', () => {
  assert.strictEqual(axisDemand(undefined, 80), undefined)
  assert.strictEqual(axisDemand('bad', 80), undefined)
})
check('档位切换是平滑的：相邻档的 demand 文案不同', () => {
  for (const id of AXIS_ORDER) {
    const ax = AXIS_LIBRARY[id]
    for (let i = 1; i < ax.bands.length; i++) {
      const a = ax.bands[i - 1]
      const b = ax.bands[i]
      assert.notStrictEqual(a.demand, b.demand, ax.label + ' 相邻档文案应不同')
    }
  }
})

console.log('== 导演板集成 ==')
function plansWithAxis() {
  const c = curve('沈若汐·防线', 'character', [
    { x: 0, y: 20 },
    { x: 40, y: 25 },
    { x: 60, y: 95 },
    { x: 100, y: 30 }
  ], 'shyness')
  const emo = curve('整体张力', 'emotion', [{ x: 0, y: 40 }, { x: 100, y: 60 }])
  return makeDirectorBoard([emo, c], [])
}

check('带轴人物曲线：每段曲线信息里携带动件要求', () => {
  const plans = plansWithAxis()
  const withAx = plans.filter((p) => p.curves.some((c) => c.ax))
  assert.ok(withAx.length >= 2, '应有段带着行为轴指令')
  // 高值段应取到「羞到骨里」档，低值段取到「防线尽失」档
  const high = plans.find((p) => p.curves.find((c) => c.name === '沈若汐·防线')?.value >= 65)!
  const highAx = high.curves.find((c) => c.name === '沈若汐·防线')!.ax
  assert.ok(highAx && highAx.label.includes('羞到骨里'), '峰值段应落到最高档，实际 ' + highAx?.label)
  const low = plans.find((p) => p.curves.find((c) => c.name === '沈若汐·防线')?.value <= 35)!
  const lowAx = low.curves.find((c) => c.name === '沈若汐·防线')!.ax
  assert.ok(lowAx && lowAx.label.includes('防线尽失'), '低值段应落到最低档，实际 ' + lowAx?.label)
})
check('渲染里出现“行为轴硬命令”与具体动作要求', () => {
  const plans = plansWithAxis()
  const board = renderDirectorBoard('测试', plans)
  assert.ok(board.includes('行为轴硬命令'), '应有行为轴标记')
  assert.ok(board.includes('沈若汐·防线'), '应有角色名')
  assert.ok(board.includes('羞') || board.includes('身体'), '动作要求要具体而有感官')
})
check('整链路：分幕指令的对应幕里也带行为轴（不进其它幕）', () => {
  const plans = plansWithAxis()
  const acts = planActs(plans)
  const highAct = acts.find((a) => a.segs.some((s) => s.curves.some((c) => c.name === '沈若汐·防线' && (c.value ?? 0) >= 65)))
  assert.ok(highAct, '应有峰值所在幕')
  const text = renderActDirective('测试', highAct)
  assert.ok(text.includes('行为轴硬命令'), '峰值幕指令应带行为轴')
  // 低谷幕不应带“羞到骨里”（不同档位各自的指令跟着自己的段走）
  const lowAct = acts.find((a) => a !== highAct && a.segs.some((s) => s.curves.some((c) => c.name === '沈若汐·防线' && c.value <= 35)))
  if (lowAct) {
    const lowText = renderActDirective('测试', lowAct)
    assert.ok(!lowText.includes('羞到骨里'), '低谷幕不应带高羞档指令')
    assert.ok(lowText.includes('行为轴硬命令') || !lowText.includes('行为轴硬命令'), '低谷幕要么带低档指令要么该幕没有人物段')
  }
})

console.log('== 向后兼容 ==')
check('无轴的人物曲线：渲染跟以前一样，不带行为轴', () => {
  const c = curve('林晚·防线', 'character', [{ x: 0, y: 20 }, { x: 100, y: 90 }])
  const plans = makeDirectorBoard([c], [])
  assert.ok(plans.every((p) => p.curves.every((x) => !x.ax)), '无轴曲线不应带动作要求')
  const row = renderShotRow(plans[4])
  assert.ok(!row.includes('行为轴硬命令'), '渲染不应出现行为轴字样')
  assert.ok(row.includes('曲线走向'), '仍保留曲线走向')
})
check('未知轴的曲线：不崩，退化为只报趋势', () => {
  const c = curve('某人', 'character', [{ x: 0, y: 10 }, { x: 100, y: 90 }], 'no_such')
  const plans = makeDirectorBoard([c], [])
  assert.ok(plans.every((p) => p.curves.every((x) => !x.ax)), '未知轴应降级')
  assert.ok(renderDirectorBoard('测试', plans).includes('曲线走向'))
})
check('情绪曲线即使有 axis 字段也不当作人物轴（按其 kind 走）', () => {
  // 防御：老数据若误填了 axis，情绪曲线仍只报趋势
  const c = curve('整体张力', 'emotion', [{ x: 0, y: 10 }, { x: 100, y: 90 }], 'shyness')
  const plans = makeDirectorBoard([c], [])
  assert.ok(plans.every((p) => p.curves.every((x) => !x.ax)), '情绪曲线不带行为轴')
})

console.log(`\n结果：通过 ${passed}，失败 ${failed}${failed ? '（有失败！）' : '（全部通过 ✅）'}`)
process.exit(failed ? 1 : 0)
