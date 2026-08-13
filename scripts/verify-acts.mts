// 织卷 · 分幕（M2.2）· 自动化验证
// 用法：node --experimental-strip-types scripts/verify-acts.mts
import assert from 'node:assert'
import { makeDirectorBoard, DIRECTOR } from '../src/shared/director.ts'
import { planActs, renderActDirective, joinActs, truncateActs, prevActState, beatsInAct, ACTS } from '../src/shared/acts.ts'
import { normalizeProject } from '../src/shared/setting.ts'
import type { SeriesCurve, PlotBeat, Project, Chapter } from '../src/shared/types.ts'

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

/** 高戏份曲线：大起大落，有明确波峰波谷与落差 */
function dramaCurve(): SeriesCurve {
  return curve('整体张力', 'emotion', [
    { x: 0, y: 18 }, { x: 28, y: 22 }, { x: 55, y: 96 }, { x: 80, y: 58 }, { x: 100, y: 10 }
  ])
}

function flatPlans() {
  return makeDirectorBoard([curve('张力', 'emotion', [{ x: 0, y: 50 }, { x: 100, y: 50 }])], [])
}

console.log('== 分幕基本性质 ==')
check('平坦导演板 → 3 幕（最少幕）', () => {
  const acts = planActs(flatPlans())
  assert.strictEqual(acts.length, ACTS.min, '应有 ' + ACTS.min + ' 幕，实际 ' + acts.length)
})
check('高戏份板 → 幕数在 3..6 之间（骰子得自己滚）', () => {
  const acts = planActs(makeDirectorBoard([dramaCurve()], []))
  assert.ok(acts.length >= ACTS.min && acts.length <= ACTS.max, '幕数 ' + acts.length + ' 应在 [' + ACTS.min + ',' + ACTS.max + ']')
})
check('所有段按序完整覆盖，无空洞无重叠，每幕至少一段', () => {
  const acts = planActs(makeDirectorBoard([dramaCurve()], []))
  let expect = 1
  for (const a of acts) {
    assert.ok(a.segs.length >= 1, '每幕至少一段')
    for (const s of a.segs) {
      assert.strictEqual(s.seg, expect, '段序号应连续（期望 ' + expect + ' 得 ' + s.seg + '）')
      expect++
    }
  }
  assert.strictEqual(expect, DIRECTOR.segs + 1, '应覆盖全部 ' + DIRECTOR.segs + ' 段')
})
check('分幕确定性：同一输入两次结果一致', () => {
  const input = makeDirectorBoard([dramaCurve()], [])
  const a1 = planActs(input)
  const a2 = planActs(input)
  assert.deepStrictEqual(
    a1.map((x) => [x.segStart, x.segEnd, x.tone]),
    a2.map((x) => [x.segStart, x.segEnd, x.tone])
  )
})
check('波峰段只属于一幕，且该幕带 climax 标记', () => {
  const acts = planActs(makeDirectorBoard([dramaCurve()], []))
  const climActs = acts.filter((a) => a.climax)
  assert.strictEqual(climActs.length, 1, 'climax 应恰好一幕')
  const pieces = acts.reduce((n, a) => n + a.segs.filter((s) => s.climax).length, 0)
  assert.strictEqual(pieces, 1, '波峰段应只出现一次')
})
check('低谷幕带 nadir 标记且强度够低', () => {
  const acts = planActs(makeDirectorBoard([dramaCurve()], []))
  const nad = acts.find((a) => a.nadir)
  assert.ok(nad, '应有低谷幕')
  assert.ok(nad.segs.every((s) => s.intensity <= 30), '低谷幕段强度应低')
})

console.log('== 幕的导演指令 ==')
check('渲染只含本幕的段号，且带本幕任务', () => {
  const acts = planActs(makeDirectorBoard([dramaCurve()], []))
  const target = acts[1]
  const text = renderActDirective('测试', target)
  assert.ok(text.includes(`第 ${target.index + 1} 幕`), '应有幕号')
  assert.ok(text.includes(`段${target.segStart}`), '应含本幕起始段')
  assert.ok(!text.includes(`段${target.segEnd + 1}`), '不应含下一幕的段')
  assert.ok(!text.includes('段1') || target.segStart === 1, '不应含前一幕的段')
})
check('落差段所在幕：渲染必须要求事件承载', () => {
  const acts = planActs(makeDirectorBoard([dramaCurve()], []))
  const jumpAct = acts.find((a) => a.hasJump)!
  assert.ok(jumpAct, '应有含落差的幕')
  const text = renderActDirective('测试', jumpAct)
  assert.ok(text.includes('必须用一件具体事件撑起'), '应强调事件承载，实际:\n' + text)
})
check('第一幕 prompt 有“铺场”约定；后续幕有“承接上一幕”约定', () => {
  const acts = planActs(makeDirectorBoard([dramaCurve()], []))
  assert.ok(renderActDirective('测试', acts[0]).includes('本章第一幕'), '首幕应提示布场')
  const text = renderActDirective('测试', acts[1], { prevState: '…她靠在他怀里发抖。' })
  assert.ok(text.includes('紧接上一幕的结尾继续'), '后续幕应提示承接')
  assert.ok(text.includes('不要复述'), '应禁止复述上一幕')
})
check('情节点按进度归到对应幕', () => {
  const beats: PlotBeat[] = [{ id: 'b1', at: 12, label: '进门', note: '' }, { id: 'b2', at: 88, label: '离开', note: '' }]
  const acts = planActs(makeDirectorBoard([dramaCurve()], beats))
  const have = acts.filter((a) => beatsInAct(a, beats).length > 0)
  assert.ok(have.length >= 1, '应至少一幕命中情节点')
  const lastB = acts.find((a) => a.segs.some((s) => s.fromPct >= 80))
  assert.ok(lastB && beatsInAct(lastB, beats).some((b) => b.label === '离开'), '偏后的情节点应落在偏后幕')
})

console.log('== 幕的拼接与回滚 ==')
check('joinActs：把各幕拼成一章正文，过滤空块', () => {
  assert.strictEqual(joinActs(['幕一', '', '幕二']), '幕一\n\n幕二')
  assert.strictEqual(joinActs([]), '')
})
check('truncateActs：保留前 fromAct 幕，丢弃其后', () => {
  const acts = ['a', 'b', 'c', 'd']
  assert.deepStrictEqual(truncateActs(acts, 2), ['a', 'b'])
  assert.deepStrictEqual(truncateActs(acts, 0), [])
  assert.deepStrictEqual(truncateActs(acts, 99), acts)
})
check('prevActState：取上一幕结尾，含结尾关键词、不含开头', () => {
  const acts = ['她推开门走进琴房。\n屋里有旧钢琴的霉味。', '她们到了白热阶段。']
  // 第 3 幕（idx=2）承接的是第 2 幕（acts[1]）的结尾；第 2 幕（idx=1）承接第 1 幕（acts[0]）的结尾
  const tail1 = prevActState(acts, 2)
  assert.ok(tail1.includes('白热阶段'), '应含上一幕结尾内容')
  assert.ok(!tail1.includes('她推开门'), '不应从更早一幕的开头截')
  const tail2 = prevActState(acts, 1)
  assert.ok(!tail2.includes('白热阶段'), '前面幕不该看到更后面的内容')
  assert.ok(tail2.includes('霉味') || tail2.includes('屋里有'), '应含它上一幕的结尾')
})
check('回滚重演（e2e 通路）：前几幕保留，重写从目标幕起', () => {
  const acts = planActs(makeDirectorBoard([dramaCurve()], []))
  assert.ok(acts.length >= 3, '需要至少 3 幕来演回滚')
  const fake = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'].slice(0, acts.length) // 模拟已生成的各幕
  // 主人觉得第 3 幕不好 → 回滚到第 3 幕（fromAct=2）重写
  const kept = truncateActs(fake, 2)
  const rewritten = [...kept, 'N2', 'N3', 'N4', 'N5'].slice(0, acts.length)
  // 前面幕的内容与顺序保持，后面的被新内容替换
  assert.deepStrictEqual(rewritten.slice(0, 2), ['A0', 'A1'])
  assert.strictEqual(rewritten[2], 'N2')
  assert.strictEqual(joinActs(rewritten), rewritten.join('\n\n'))
  // 承接：回滚后重写的新一幕，其上一幕仍是 A1 的结尾
  const continued = prevActState(kept, 2)
  assert.ok(continued.includes('A1'), '重写幕应能承接保留的上一幕末状态')
})

console.log('== 迁移兼容 ==')
check('旧章节无 acts → normalize 回填为整幕', () => {
  const old: Project = {
    id: 'old', name: '旧项目', description: '',
    worldview: { name: '', city: '', era: '', themes: [], rules: [], background: '' },
    characters: [],
    chapters: [{ id: 'c1', num: 1, title: 't', status: 'done', elements: '', premise: '', curves: [], beats: [], content: '一整段老正文', updatedAt: 1 } as Chapter],
    elements: [], records: [], foreshadows: [], sweepDrafts: [], updatedAt: 1
  }
  normalizeProject(old)
  assert.ok(old.chapters[0].acts && old.chapters[0].acts.length === 1 && old.chapters[0].acts[0] === '一整段老正文')
})
check('已有 acts 的章节不被回填覆盖', () => {
  const p: Project = {
    id: 'x', name: 'x', description: '',
    worldview: { name: '', city: '', era: '', themes: [], rules: [], background: '' },
    characters: [],
    chapters: [{ id: 'c2', num: 1, title: 't', status: 'draft', elements: '', premise: '', curves: [], beats: [], content: '幕一幕二', acts: ['幕一', '幕二'], updatedAt: 1 }],
    elements: [], records: [], foreshadows: [], sweepDrafts: [], updatedAt: 1
  }
  normalizeProject(p)
  assert.deepStrictEqual(p.chapters[0].acts, ['幕一', '幕二'])
})

console.log(`\n结果：通过 ${passed}，失败 ${failed}${failed ? '（有失败！）' : '（全部通过 ✅）'}`)
process.exit(failed ? 1 : 0)
