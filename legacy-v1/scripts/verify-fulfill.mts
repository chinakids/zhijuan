// 织卷 · 曲线兑现检查（M2.4）· 自动化验证
// 用法：node --experimental-strip-types scripts/verify-fulfill.mts
// 覆盖：检查清单构建（段任务/行为轴/情节点）、正文分块、行式协议解析（含杂音容忍）、
// 报告渲染（未兑现最优先）、预算硬控、以及「清单→模拟模型→parse→render」全链路。
import assert from 'node:assert'
import type { Chapter, SeriesCurve, FulfillVerdict } from '../src/shared/types.ts'
import {
  buildFulfillChecklist,
  segmentText,
  parseFulfillReport,
  renderFulfillPrompt,
  renderFulfillReport,
  buildFulfillReport,
  FULFILL
} from '../src/shared/fulfill.ts'

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

function chap(over: Partial<Chapter> = {}): Chapter {
  const base: Chapter = {
    id: 'c1',
    num: 1,
    title: '第一章',
    status: 'plan',
    elements: '',
    premise: '',
    curves: [],
    beats: [],
    content: '',
    updatedAt: 0
  }
  return { ...base, ...over }
}

function emo(): SeriesCurve {
  return {
    id: 'em1',
    kind: 'emotion',
    name: '整体张力',
    color: '#f00',
    points: [
      { x: 0, y: 40 },
      { x: 45, y: 30 },
      { x: 60, y: 95 },
      { x: 100, y: 25 }
    ]
  }
}

function charCurve(name = '沈若汐·防线', axis = 'shyness'): SeriesCurve {
  return {
    id: 'ch-' + name,
    kind: 'character',
    name,
    color: '#ff0',
    points: [
      { x: 0, y: 20 },
      { x: 55, y: 15 },
      { x: 70, y: 95 },
      { x: 100, y: 30 }
    ],
    axis
  }
}

console.log('== 检查清单构建 ==')
check('有曲线：清单含段落任务（D1 起）与情节点与行为轴条目，id 稳定唯一', () => {
  const c = chap({
    curves: [emo(), charCurve()],
    beats: [{ id: 'b1', at: 60, label: '破门而入', note: '他推门进来' }],
    content: '正文……'
  })
  const cl = buildFulfillChecklist(c)
  assert.strictEqual(cl.source, 'board')
  const ids = cl.items.map((i) => i.id)
  assert.ok(ids.includes('D1') && ids.includes('D8'), '应有段任务 D1..D8')
  assert.ok(ids.some((x) => x === 'B-破门而入'), '应有情节点条目')
  assert.ok(ids.some((x) => x.startsWith('A-沈若汐·防线-')), '应有行为轴条目')
  assert.strictEqual(new Set(ids).size, ids.length, 'id 必须唯一')
})
check('带轴人物的高值段：要求要达到「羞到骨里」档的动作', () => {
  const c = chap({ curves: [emo(), charCurve()], beats: [], content: 'x' })
  const cl = buildFulfillChecklist(c)
  const hi = cl.items.find((i) => i.kind === 'axis' && i.requirement.includes('羞到骨里'))
  assert.ok(hi, '峰值段应有高档动作要求')
  assert.ok(hi.requirement.includes('沈若汐·防线'), '要求里应点名人物')
})
check('无曲线 → source=empty，不产生任何条目', () => {
  const cl = buildFulfillChecklist(chap({ curves: [] }))
  assert.strictEqual(cl.source, 'empty')
  assert.strictEqual(cl.items.length, 0)
})
check('只有一条曲线但点数不构成形状 → 视为无可用曲线', () => {
  const c = chap({ curves: [{ ...emo(), points: [{ x: 0, y: 50 }] }] })
  assert.strictEqual(buildFulfillChecklist(c).source, 'empty')
})
check('预算硬控：条目超上限时被砍到上限，且优先保段任务', () => {
  const many: SeriesCurve[] = [emo()]
  for (let i = 0; i < 10; i++) many.push(charCurve('角色' + i))
  const c = chap({ curves: many, beats: [], content: 'x' })
  const cl = buildFulfillChecklist(c)
  assert.ok(cl.items.length <= FULFILL.maxItems, '条目数应被压到上限内')
  assert.ok(cl.items.some((i) => i.id === 'D1'), '段任务应保留')
})

console.log('== 正文分块 ==')
check('空正文 → 无块', () => {
  assert.deepStrictEqual(segmentText(''), [])
  assert.deepStrictEqual(segmentText('   '), [])
})
check('按块数切分，块号从 1 起、内容拼接可还原', () => {
  const text = '字'.repeat(1200)
  const blocks = segmentText(text, 500)
  assert.strictEqual(blocks.length, 3)
  assert.strictEqual(blocks[0].index, 1)
  assert.strictEqual(blocks[2].index, 3)
  assert.strictEqual(blocks.map((b) => b.text).join(''), text, '分块应无损拼接')
})
check('块数封顶：超长正文在末块吸收剩余', () => {
  const text = '字'.repeat(FULFILL.blockChars * FULFILL.maxBlocks + 500)
  const blocks = segmentText(text)
  assert.ok(blocks.length <= FULFILL.maxBlocks, '块数不应超过上限')
  assert.strictEqual(blocks[blocks.length - 1].text.length >= FULFILL.blockChars, true, '末块吸收剩余')
})

console.log('== 行式协议解析 ==')
function mkChecklist() {
  const c = chap({ curves: [emo()], beats: [{ id: 'b1', at: 60, label: '破门而入', note: '他推门进来' }], content: 'x' })
  return buildFulfillChecklist(c)
}
check('正常回报：三种判定都能解析，块号被提取', () => {
  const cl = mkChecklist()
  const raw = [
    'D1: 已兑现 — 1,2: 铺垫到位',
    'D5: 部分兑现 — 3: 到了但没写满',
    'D8: 未兑现 — 0: 结尾只有内心话，没有事件',
    'B-破门而入: 已兑现 — 4: 有进门动作'
  ].join('\n')
  const r = parseFulfillReport(raw, cl)
  assert.strictEqual(r.met, 2)
  assert.strictEqual(r.partial, 1)
  assert.strictEqual(r.miss, 1)
  const d8 = r.verdicts.find((v) => v.id === 'D8')!
  assert.strictEqual(d8.result, 'miss')
  assert.strictEqual(d8.blocks, '0')
  const d1 = r.verdicts.find((v) => v.id === 'D1')!
  assert.strictEqual(d1.blocks, '1,2')
})
check('带 emoji / 全角冒号 / 前后空白的回报也能解析', () => {
  const cl = mkChecklist()
  const raw = [
    '✅ D1: 已兑现 — 1: ok',
    '  D5：部分兑现 — 3: 差一口气',
    '❌ D8: 未兑现 - 5: 没有事件'
  ].join('\n')
  const r = parseFulfillReport(raw, cl)
  assert.strictEqual(r.met, 1)
  assert.strictEqual(r.partial, 1)
  assert.strictEqual(r.miss, 1)
})
check('乱行被跳过；清单里有但模型没报的 → unknown 补齐', () => {
  const cl = mkChecklist()
  const raw = '这是一段解释文字，不是回报。\nD1: 已兑现 — 1: ok\n随便的标题行'
  const r = parseFulfillReport(raw, cl)
  const totalItems = cl.items.length
  assert.strictEqual(r.total, totalItems, 'total 应对齐清单条目数')
  assert.strictEqual(r.met, 1)
  assert.strictEqual(r.unknown, totalItems - 1, '未报的条目应记 unknown')
})
check('未知判定词 / 未知 id 的一行被跳过，不产生脏记录', () => {
  const cl = mkChecklist()
  const raw = 'D1: 还不错 — 1: 还行\nZ9: 已兑现 — 1: x'
  const r = parseFulfillReport(raw, cl)
  assert.strictEqual(r.met, 0, '“还不错”不是合法判定，不应算已兑现')
  assert.strictEqual(r.verdicts.some((v) => v.id === 'Z9'), false, '未知 id 不应出现')
})
check('null / 空原文 → 全 unknown，不崩', () => {
  const cl = mkChecklist()
  const r = parseFulfillReport(null as never, cl)
  assert.strictEqual(r.unknown, cl.items.length)
})

console.log('== 报告渲染 ==')
function mkReport(verdicts: FulfillVerdict[]) {
  return buildFulfillReport(verdicts)
}
check('全兑现 → 一句全绿文案，无缺漏清单', () => {
  const cl = mkChecklist()
  const md = renderFulfillReport('测试作', chap({ curves: [emo()], beats: [], content: 'x' }), cl, mkReport(
    cl.items.map((i) => ({ id: i.id, result: 'met' as const, blocks: '1', note: 'ok' }))
  ))
  assert.ok(md.includes('全部兑现'), '应有全兑现字样')
  assert.ok(!md.includes('## 未兑现'), '不应有未兑现小节')
})
check('有未兑现 → 未兑现最优先（置顶）、含要求与理由与块号', () => {
  const cl = mkChecklist()
  const md = renderFulfillReport('测试作', chap({ curves: [emo()], beats: [], content: 'x' }), cl, mkReport([
    { id: 'D1', result: 'met', blocks: '1', note: 'ok' },
    { id: 'D5', result: 'partial', blocks: '3', note: '到了但没写满' },
    { id: 'D8', result: 'miss', blocks: '5', note: '没有具体事件' }
  ]))
  assert.ok(md.includes('## 未兑现'), '应有未兑现小节')
  assert.ok(md.indexOf('## 未兑现') < md.indexOf('## 部分兑现'), '未兑现应排在部分之前')
  assert.ok(md.includes('D8'), '未兑现条目应列出 id')
  assert.ok(md.includes('没有具体事件'), '应含理由')
  assert.ok(md.includes('块 5'), '应含块号定位')
})
check('报告头部有统计', () => {
  const cl = mkChecklist()
  const md = renderFulfillReport('测试作', chap({ curves: [emo()], beats: [], content: 'x' }), cl, mkReport([
    { id: 'D1', result: 'met', blocks: '1', note: 'ok' },
    { id: 'D5', result: 'miss', blocks: '3', note: '缺' }
  ]))
  assert.ok(/已兑现 1/.test(md), '应统计已兑现数')
  assert.ok(/未兑现 1/.test(md), '应统计未兑现数')
})

console.log('== 检查 prompt ==')
check('prompt 含条目清单与带块号的正文', () => {
  const cl = mkChecklist()
  const blocks = segmentText('一二三四五六七八九十一二三四五', 10)
  const p = renderFulfillPrompt('测试作', 1, '第一章', cl, blocks)
  assert.ok(p.includes('D1'), '应有条目 id')
  assert.ok(p.includes('【正文块1】'), '应有正文块标记')
  assert.ok(p.includes('已兑现 / 部分兑现 / 未兑现'), '应把判定枚举写清楚')
})

console.log('== 全链路（清单 → 模拟模型 → parse → render） ==')
check('e2e：真实形状的章走通整条链', () => {
  const c = chap({
    curves: [emo(), charCurve()],
    beats: [{ id: 'b1', at: 62, label: '破门而入', note: '他推门进来' }],
    content: '她是少女。'.repeat(80)
  })
  const cl = buildFulfillChecklist(c)
  const blocks = segmentText(c.content)
  const prompt = renderFulfillPrompt('测试作', 1, '第一章', cl, blocks)
  // 模拟模型：对 D 段只报前 4 段 + 有未兑现，轴条目与情节点部分不报 → unknown
  const fakeRaw = [
    'D1: 已兑现 — 1: 起笔平稳',
    'D2: 部分兑现 — 2: 铺垫略拖',
    'D3: 未兑现 — 3: 该有的动作没有',
    'D4: 已兑现 — 4: 到位'
  ].join('\n')
  const report = parseFulfillReport(fakeRaw, cl)
  const md = renderFulfillReport('测试作', c, cl, report)
  assert.ok(report.miss >= 1, '应有未兑现')
  assert.ok(md.includes('D3'), '报告应点名未兑现条目')
  assert.ok(prompt.length > 100, 'prompt 应有实质内容')
})

console.log(`\n结果：通过 ${passed}，失败 ${failed}${failed ? '（有失败！）' : '（全部通过 ✅）'}`)
process.exit(failed ? 1 : 0)
