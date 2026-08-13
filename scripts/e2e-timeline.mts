// 织卷 · 端到端完整链路验证（覆盖「完整的单侧」）
// 从老数据建项目出发，走完：写正文 → 组配 → 审计 → 草稿 → 确认 → 新切片 → 下一章正确取用 → 沉淀为条目。
// 用法：node --experimental-strip-types scripts/e2e-timeline.mts
import assert from 'node:assert'
import { normalizeProject, sliceAt } from '../src/shared/setting.ts'
import { buildAssembledContext } from '../src/shared/composer.ts'
import { parseAudit, inferChangeCandidates, toSweepDrafts, applySweeps, rejectSweeps } from '../src/shared/sweeper.ts'
import { parseElementMelt, toCreateDrafts } from '../src/shared/melt.ts'
import type { Project, Chapter, Character, SweepDraft } from '../src/shared/types.ts'

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

function ch(num: number, elements = '', premise = ''): Chapter {
  return { id: 'ch' + num, num, title: 't', status: 'done', elements, premise, curves: [], beats: [], content: '', updatedAt: 1 }
}

/** 老式项目（无任何新字段）——真实世界里可能是旧版本建的 */
let project: Project = {
  id: 'e2e',
  name: '端到端测试',
  description: '',
  worldview: { name: '岚州', city: '岚州', era: '当代', themes: ['校园'], rules: ['主角可出入各校'], background: '封闭式高中。' },
  characters: [
    {
      id: 'c1', name: '许晴', role: '女主', age: 18, isProtagonist: true, tags: ['校花', '学生'], fields: [{ key: '皮肤', value: '很白' }], background: '高三级花', relation: '学生'
    } as unknown as Character,
    {
      id: 'c2', name: '陈默', role: '男主', age: 28, isProtagonist: true, tags: ['维修工'], fields: [], background: '', relation: ''
    } as unknown as Character
  ],
  chapters: [ch(1), ch(2), ch(3), ch(4), ch(5)],
  elements: undefined as never,
  records: undefined as never,
  foreshadows: undefined as never,
  sweepDrafts: undefined as never,
  updatedAt: 1
}

console.log('== 起点：老数据 → 归一化 ==')
check('老项目归一会补全集合字段并给人物建立初始切片', () => {
  project = normalizeProject(project)
  assert.ok(Array.isArray(project.elements))
  assert.ok(project.characters.every((c) => (c.slices ?? []).length >= 1))
})

console.log('== 第一回合：写第四章 → 组配（防未来泄） → 审计 → 确认 ==')
let p = buildAssembledContext(project, ch(4, '许晴和他在琴房'))
check('组配只带主角，且许晴此刻仍是初始状态（第六七章的事不在场）', () => {
  const xu = p.chars.find((i) => i.target.name === '许晴')!
  assert.ok(xu, '许晴应在场')
  assert.ok(xu.excerpt.includes('高三级花'), '应是初始状态')
})

const fakeAudit = `好的，第四章她发生了变化：
{"chapterNum":4,"summary":"琴房里她第一次主动抱住了他。","characterStates":[{"name":"许晴","state":"身体彻底放开，开始主动回应"}],"resolved":[],"sown":["她身体深处藏着秘密"],"standingChanges":[]} `
const { record } = parseAudit(fakeAudit)
assert.ok(record)
const cands = inferChangeCandidates(project, record)
const drafts = toSweepDrafts(project, ch(4), record, cands)
check('审计产出记录草稿 + 人物变化草稿', () => {
  assert.ok(drafts.length >= 2, '草稿数 ' + drafts.length)
})
project.sweepDrafts = drafts

check('确认前：时间线仍只有初始切片', () => {
  assert.strictEqual(project.characters.find((c) => c.id === 'c1')!.slices.length, 1)
})

const r = applySweeps(project, drafts.map((d) => d.id))
project = { ...project, characters: r.characters, elements: r.elements, records: r.records, foreshadows: r.foreshadows, sweepDrafts: r.drafts }

check('确认后：许晴时间线多了 sweep 切片（第 4 章起）', () => {
  const xu = project.characters.find((c) => c.id === 'c1')!
  assert.strictEqual(xu.slices.length, 2)
  assert.strictEqual(xu.slices[1].atChapter, 4)
  assert.strictEqual(xu.slices[1].source, 'sweep')
  assert.ok(xu.slices[1].content.includes('主动回应'))
})
check('伏笔台账：新埋的成为 open', () => {
  assert.ok(project.foreshadows.some((f) => f.desc.includes('秘密') && f.status === 'open'))
})
check('章节记录已落库', () => {
  assert.ok(project.records.some((rec) => rec.chapterNum === 4))
})

console.log('== 第二回合：写第五章 → 组配必须用到第四章后的新状态 ==')
p = buildAssembledContext(project, ch(5, '许晴'))
check('第五章组配带上的是第四章后的最新状态（不再啃第一章的旧设定）', () => {
  const xu = p.chars.find((i) => i.target.name === '许晴')!
  assert.ok(xu.excerpt.includes('主动回应'), '应取到新状态，实际: ' + xu.excerpt)
  assert.ok(!xu.excerpt.includes('只是高三级花后续'), '不应退回初始')
})
check('未兑现伏笔随组配常驻', () => {
  assert.ok(p.openForeshadows.some((f) => f.includes('秘密')))
})

console.log('== 第三回合：沉淀为条目（模型拆设定 → 草稿 → 确认 → 建条目） ==')
const fakeMelt = `拆好了：
[{"kind":"rule","name":"异能档位","tags":["异能"],"content":"每15人解锁一档：时间停止→隐身→心灵控制"},{"kind":"scene","name":"琴房","tags":["学校"],"content":"三楼西侧，隔音好"}] `
const { elements } = parseElementMelt(fakeMelt)
assert.ok(elements.length === 2)
const meltDrafts: SweepDraft[] = toCreateDrafts(elements, 5, '设定稿')
project.sweepDrafts = [...project.sweepDrafts, ...meltDrafts]
check('确认前：设定库还没有这些条目', () => {
  assert.strictEqual(project.elements.length, 0)
})
const r2 = applySweeps(project, meltDrafts.map((d) => d.id))
project = { ...project, characters: r2.characters, elements: r2.elements, records: r2.records, foreshadows: r2.foreshadows, sweepDrafts: r2.drafts }
check('确认后：两条新条目进入设定库，带初始切片', () => {
  assert.strictEqual(project.elements.length, 2)
  assert.ok(project.elements.some((e) => e.name === '异能档位'))
})

const p2 = buildAssembledContext(project, ch(6, '琴房里的异能档位'))
check('新条目可被后续章节召回', () => {
  assert.ok(p2.elements.length >= 1, '应召回条目')
  assert.ok(p2.elements.some((i) => i.target.name === '琴房'))
})

console.log(`\n结果：通过 ${passed}，失败 ${failed}${failed ? '（有失败！）' : '（全部通过 ✅）'}`)
process.exit(failed ? 1 : 0)
