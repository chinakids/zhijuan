// 织卷 · 组配器（composer）· 自动化验证脚本
// 用法：node --experimental-strip-types scripts/verify-composer.mts
import assert from 'node:assert'
import { buildAssembledContext, BUDGET, describeComposition } from '../src/shared/composer.ts'
import type { Project, Chapter } from '../src/shared/types.ts'

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

function ch(num: number, elements = '', beats = [] as { at: number; label: string; note: string }[]): Chapter {
  return { id: 'ch' + num, num, title: 't', status: 'plan', elements, premise: '', curves: [], beats, content: '', updatedAt: 1 }
}

const base: Project = {
  id: 'p',
  name: '测试',
  description: '',
  worldview: { name: '岚州', city: '岚州', era: '当代', themes: ['x'], rules: ['r'], background: '一个很长的背景'.repeat(200) },
  characters: [
    {
      id: 'c1', name: '林知秋', role: '女主', age: 18, isProtagonist: true, tags: ['校花', '学生'], fields: [], background: '', relation: '', active: true,
      slices: [
        { atChapter: 1, content: '初始状态：清冷校花', source: 'initial', confirmed: true },
        { atChapter: 3, content: '第三章起：身体变得敏感', source: 'sweep', confirmed: true, changeLog: '第三章后变化' },
        { atChapter: 6, content: '第六章起：彻底臣服', source: 'sweep', confirmed: true }
      ]
    },
    {
      id: 'c2', name: '李老师', role: '配角', age: 35, isProtagonist: false, tags: ['老师'], fields: [], background: '', relation: '', active: true,
      slices: [{ atChapter: 1, content: '数学老师，温和', source: 'initial', confirmed: true }]
    },
    {
      id: 'c3', name: '韩青', role: '男主', age: 28, isProtagonist: true, tags: ['维修工'], fields: [], background: '', relation: '', active: true,
      slices: [{ atChapter: 1, content: '校工，可出入各学校', source: 'initial', confirmed: true }]
    }
  ],
  chapters: [ch(1), ch(2), ch(3), ch(4), ch(5)],
  records: [
    { chapterNum: 1, summary: '第一章：更衣室初遇。'.repeat(10), characterStates: [], resolved: [], sown: ['异能的事'], standingChanges: [] },
    { chapterNum: 2, summary: '第二章：夜自习撩拨。'.repeat(10), characterStates: [], resolved: [], sown: [], standingChanges: [] },
    { chapterNum: 3, summary: '第三章：琴房突破。'.repeat(10), characterStates: [], resolved: [], sown: [], standingChanges: [] },
    { chapterNum: 4, summary: '第四章：关系加深。'.repeat(10), characterStates: [], resolved: [], sown: [], standingChanges: [] }
  ],
  foreshadows: [
    { id: 'f1', desc: '异能档位会随着人数解锁', sownChapter: 1, status: 'open' },
    { id: 'f2', desc: '玻璃杯的用途', sownChapter: 2, status: 'resolved' }
  ],
  elements: [],
  updatedAt: 1
}

// 重新整理：直接用干净的项目核，再在测试里分别构造
function makeProject(over: Partial<Project>): Project {
  return { ...base, ...over, worldview: base.worldview, characters: base.characters, chapters: base.chapters, records: base.records, foreshadows: base.foreshadows }
}

console.log('== 召回 ==')
check('要素提到名字 → 对应人物被选中', () => {
  const p = makeProject({ elements: [] })
  const c = buildAssembledContext(p, ch(5, '林知秋在琴房'))
  const names = c.chars.map((i) => i.target.name)
  assert.ok(names.includes('林知秋'), '应选中林知秋，实际: ' + names.join(','))
})
check('主角恒在（即使无命中）', () => {
  const p = makeProject({})
  const c = buildAssembledContext(p, ch(5, '某件无关的事'))
  assert.ok(c.chars.some((i) => i.target.isProtagonist), '两个主角都应保留')
  assert.ok(c.chars.every((i) => i.target.isProtagonist), '未命中时只带主角，实际: ' + c.chars.map((i) => i.target.name).join(','))
})
check('要素提到场景名 → 场景条目被召回；停用条目不进', () => {
  const p = makeProject({ elements: [
    { id: 'e1', kind: 'scene', name: '学校琴房', tags: ['学校'], active: true, slices: [{ atChapter: 1, content: '三楼西侧', source: 'initial', confirmed: true }], createdAt: 1, updatedAt: 1 },
    { id: 'e3', kind: 'rule', name: '异能档位', tags: ['异能'], active: false, slices: [{ atChapter: 1, content: '15人一档', source: 'initial', confirmed: true }], createdAt: 1, updatedAt: 1 }
  ] })
  const c = buildAssembledContext(p, ch(5, '琴房'))
  assert.ok(c.elements.some((i) => i.target.name === '学校琴房'))
  assert.ok(!c.elements.some((i) => i.target.name === '异能档位'), '停用条目不进')
})

console.log('== 时间旅行（防啃书啃错） ==')
check('写第 5 章时用第 3 章起的切片（未来第 6 章起的不提前出现）', () => {
  const p = makeProject({})
  const c = buildAssembledContext(p, ch(5, '林知秋'))
  const xu = c.chars.find((i) => i.target.name === '林知秋')!
  assert.ok(xu.excerpt.includes('身体变得敏感'), '应取第三章状态，实际: ' + xu.excerpt)
  assert.ok(!xu.excerpt.includes('彻底臣服'), '第六章状态不得提前出现')
})

console.log('== 预算 ==')
check('人物数上限 ' + BUDGET.charsMax + '，单份档案 ≤' + BUDGET.perCharMax + ' 字', () => {
  const many = Array.from({ length: 20 }, (_, k) => ({
    id: 'x' + k, name: '路人' + k, role: '配角', age: 20, isProtagonist: false, tags: ['路人'], fields: [], background: '很长的身世'.repeat(100), relation: '', active: true,
    slices: [{ atChapter: 1, content: '路人' + k + '的设定'.repeat(300), source: 'initial', confirmed: true }]
  }))
  const p = makeProject({ characters: [...base.characters, ...many] })
  const c = buildAssembledContext(p, ch(5, '林知秋'))
  assert.ok(c.chars.length <= BUDGET.charsMax, '人物数 ' + c.chars.length)
  for (const i of c.chars) assert.ok(i.excerpt.length <= BUDGET.perCharMax + 20, '档案超长: ' + i.target.name + ' ' + i.excerpt.length)
})
check('未兑现伏笔常驻，已兑现的不出现', () => {
  const p = makeProject({})
  const c = buildAssembledContext(p, ch(5, '林知秋'))
  assert.ok(c.openForeshadows.some((f) => f.includes('异能档位')))
  assert.ok(!c.openForeshadows.some((f) => f.includes('玻璃杯')))
})
check('前情只带本章之前的（第 5 章时不带第 5 章前情本身的 future）', () => {
  const p = makeProject({})
  const c = buildAssembledContext(p, ch(5, '林知秋'))
  assert.ok(c.recent.every((r) => r.chapterNum < 5), '前情章号应都小于 5: ' + c.recent.map((r) => r.chapterNum).join(','))
  assert.ok(c.recent.some((r) => r.chapterNum === 4), '最近的第四章应在场')
})
check('较早前情被衰减（占位更少）', () => {
  const p = makeProject({})
  const c = buildAssembledContext(p, ch(5, '林知秋'))
  const r1 = c.recent.find((r) => r.chapterNum === 1)!
  const r4 = c.recent.find((r) => r.chapterNum === 4)!
  assert.ok(r1.summary.length < r4.summary.length, '第一章应比第四章短')
})
check('composition 可读且显示预算', () => {
  const p = makeProject({})
  const c = buildAssembledContext(p, ch(5, '林知秋'))
  const d = describeComposition(c)
  assert.ok(d.includes('预算'))
  console.log('  --- 示例组合诊断 ---')
  console.log(d.split('\n').map((s) => '  ' + s).join('\n'))
})

console.log(`\n结果：通过 ${passed}，失败 ${failed}${failed ? '（有失败！）' : '（全部通过 ✅）'}`)
process.exit(failed ? 1 : 0)
