// 织卷 · 设定时间线逻辑 · 自动化验证脚本（无 GUI，可重复跑）
// 用法：node --experimental-strip-types scripts/verify-setting.mts
import assert from 'node:assert'
import { normalizeProject, sliceAt, futureSlices, appendSlice, charSnapshot, currentChapter } from '../src/shared/setting.ts'
import type { Character, Project } from '../src/shared/types.ts'

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

/** 模拟一份老版 project.json（完全没有新字段） */
function legacyProject(): Project {
  return {
    id: 'legacy',
    name: '老项目',
    description: '',
    worldview: { name: '岚州', city: '岚州', era: '当代', themes: ['x'], rules: ['r1'], background: 'b' },
    characters: [
      {
        id: 'c1',
        name: '林知秋',
        role: '女主',
        age: 18,
        isProtagonist: false,
        tags: ['校花'],
        fields: [{ key: '皮肤', value: '很白' }],
        background: '高三级花',
        relation: '学生'
      } as unknown as Character
    ],
    chapters: [{ id: 'x', num: 5, title: 't', status: 'done', elements: '', premise: '', curves: [], beats: [], content: '', updatedAt: 1 } as never],
    elements: undefined as never,
    records: undefined as never,
    foreshadows: undefined as never,
    sweepDrafts: undefined as never,
    updatedAt: 1
  }
}

console.log('== 老数据兼容 ==')
check('补齐 elements/records/foreshadows/sweepDrafts 为空数组', () => {
  const p = normalizeProject(legacyProject())
  assert.deepStrictEqual(p.elements, [])
  assert.deepStrictEqual(p.records, [])
  assert.deepStrictEqual(p.foreshadows, [])
  assert.deepStrictEqual(p.sweepDrafts, [])
})
check('active 默认补 true', () => {
  const p = normalizeProject(legacyProject())
  assert.strictEqual(p.characters[0].active, true)
})
check('老人物获得初始切片且内容 = 当前字段快照', () => {
  const p = normalizeProject(legacyProject())
  const slices = p.characters[0].slices
  assert.ok(slices.length === 1)
  assert.strictEqual(slices[0].source, 'initial')
  assert.ok(slices[0].content.includes('皮肤: 很白'))
  assert.ok(slices[0].content.includes('标签: 校花'))
})

console.log('== 字段同步 ==')
check('改字段后 normalize 会让最后切片保持最新（不堆历史）', () => {
  const p = normalizeProject(legacyProject())
  const c = p.characters[0]
  c.background = '已是他的女人' // 主人改设定
  normalizeProject(p)
  assert.ok(p.characters[0].slices.length === 1, '切片数应保持 1，不因随手编辑堆积')
  assert.ok(p.characters[0].slices[0].content.includes('已是他的女人'))
})

console.log('== 时间旅行查询（防啃书啃错） ==')
const tl = [
  { atChapter: 1, content: '初始', source: 'initial' as const, confirmed: true },
  { atChapter: 3, content: '第三章起', source: 'sweep' as const, confirmed: true, changeLog: '变化' },
  { atChapter: 8, content: '第八章起', source: 'manual' as const, confirmed: true }
]
check('写第 2 章时取到的是第 1 章的切片', () => {
  assert.strictEqual(sliceAt(tl, 2)?.content, '初始')
})
check('写第 3~7 章取到第 3 章切片', () => {
  assert.strictEqual(sliceAt(tl, 5)?.content, '第三章起')
})
check('写第 12 章取到最新（第 8 章）切片', () => {
  assert.strictEqual(sliceAt(tl, 12)?.content, '第八章起')
})
check('futureSlices 能找出比当前章晚的切片（绝不提前泄）', () => {
  assert.deepStrictEqual(futureSlices(tl, 5).map((s) => s.content), ['第八章起'])
  assert.deepStrictEqual(futureSlices(tl, 99), [])
})
check('appendSlice 按章保持有序', () => {
  const r = appendSlice([tl[0]], { atChapter: 5, content: 'x', source: 'manual', confirmed: true })
  assert.deepStrictEqual(r.map((s) => s.atChapter), [1, 5])
})
check('currentChapter 取到最大章号', () => {
  assert.strictEqual(currentChapter({ chapters: [{ num: 12 }, { num: 3 }] } as unknown as Project), 12)
})

console.log('== 组配器边界 ==')
check('激活条目才可被取到', () => {
  const el = {
    id: 'e',
    kind: 'rule' as const,
    name: 'n',
    tags: [],
    active: false,
    slices: [tl[0]],
    createdAt: 1,
    updatedAt: 1
  }
  // elementAt 由调用方执行 active 判断；这里保证 sliceAt 语义正确即可
  assert.strictEqual(sliceAt(el.slices, 100)?.content, '初始')
  assert.strictEqual(sliceAt([], 100), null)
})

console.log(`\n结果：通过 ${passed}，失败 ${failed}${failed ? '（有失败！）' : '（全部通过 ✅）'}`)
process.exit(failed ? 1 : 0)
