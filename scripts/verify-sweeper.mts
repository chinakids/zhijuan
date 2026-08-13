// 织卷 · 章节审计（sweeper）· 自动化验证脚本
// 用法：node --experimental-strip-types scripts/verify-sweeper.mts
import assert from 'node:assert'
import { parseAudit, inferChangeCandidates, toSweepDrafts, applySweeps, rejectSweeps, syncForeshadows } from '../src/shared/sweeper.ts'
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

function makeChapter(num: number, content: string): Chapter {
  return { id: 'ch' + num, num, title: 't', status: 'done', elements: '', premise: '', curves: [], beats: [], content, updatedAt: 1 }
}

function makeProject(): Project {
  return {
    id: 'p',
    name: 't',
    description: '',
    worldview: { name: '', city: '', era: '', themes: [], rules: [], background: '' },
    characters: [
      {
        id: 'c1', name: '许晴', role: '女主', age: 18, isProtagonist: true, tags: ['校花'], fields: [], background: '', relation: '', active: true,
        slices: [
          { atChapter: 1, content: '初始：清冷校花', source: 'initial', confirmed: true },
          { atChapter: 3, content: '第三章起：身体变得敏感', source: 'sweep', confirmed: true }
        ]
      }
    ],
    chapters: [makeChapter(3, '正文'), makeChapter(4, '第四章正文')],
    elements: [],
    records: [],
    foreshadows: [],
    sweepDrafts: [],
    updatedAt: 1
  }
}

console.log('== 解析 ==')
check('从 LLM 输出解析出记录（容忍前后文字）', () => {
  const r = parseAudit('好的，以下是 JSON：\n{"chapterNum":4,"summary":"本章她慢慢接纳了他。","characterStates":[{"name":"许晴","state":"主动抱住了他，不再抗拒"}],"resolved":[],"sown":["下一章她会彻底放开"]}\n希望有帮助')
  assert.ok(r.record)
  assert.strictEqual(r.record!.summary, '本章她慢慢接纳了他。')
  assert.strictEqual(r.record!.characterStates[0].charId, '许晴')
})
check('无 JSON 时返回错误', () => {
  const r = parseAudit('模型没按要求输出')
  assert.strictEqual(r.record, null)
  assert.ok(r.error)
})

console.log('== 变化候选 ==')
check('有状态变化的人物产生候选', () => {
  const p = makeProject()
  const rec = { chapterNum: 4, summary: 's', characterStates: [{ charId: '许晴', state: '主动抱住了他，不再抗拒' }], resolved: [], sown: [], standingChanges: [] }
  const cands = inferChangeCandidates(p, rec)
  assert.ok(cands.length === 1)
  assert.strictEqual(cands[0].targetId, 'c1')
})
check('状态与最新切片一致时不产生候选', () => {
  const p = makeProject()
  const rec = { chapterNum: 4, summary: 's', characterStates: [{ charId: '许晴', state: '第三章起：身体变得敏感' }], resolved: [], sown: [], standingChanges: [] }
  assert.strictEqual(inferChangeCandidates(p, rec).length, 0)
})

console.log('== 草稿 ==')
check('toSweepDrafts 生成记录草稿 + 变化草稿，全 pending', () => {
  const p = makeProject()
  const rec = { chapterNum: 4, summary: 's', characterStates: [{ charId: '许晴', state: '彻底放开自己，不再生涩扭捏' }], resolved: [], sown: [], standingChanges: [] }
  const d = toSweepDrafts(p, makeChapter(4, ''), rec, inferChangeCandidates(p, rec))
  assert.ok(d.length >= 2)
  assert.ok(d.every((x) => x.status === 'pending'))
})

console.log('== 接受落库 ==')
check('接受记录草稿 → records 追加 + 伏笔同步', () => {
  const p = makeProject()
  const rec = { chapterNum: 4, summary: '本章确立关系', characterStates: [], resolved: ['旧伏笔'], sown: ['新伏笔A'], standingChanges: [] }
  const d = toSweepDrafts(p, makeChapter(4, ''), rec, [])
  p.sweepDrafts = d
  const r = applySweeps(p, [d[0].id])
  assert.strictEqual(r.records.length, 1)
  assert.strictEqual(r.records[0].summary, '本章确立关系')
  assert.ok(r.foreshadows.some((f) => f.desc === '新伏笔A' && f.status === 'open'))
})
check('接受人物切片草稿 → 时间线追加 sweep 切片', () => {
  const p = makeProject()
  const rec = { chapterNum: 4, summary: 's', characterStates: [{ charId: '许晴', state: '已属于他' }], resolved: [], sown: [], standingChanges: [] }
  const cands = inferChangeCandidates(p, rec)
  const d = toSweepDrafts(p, makeChapter(4, ''), rec, cands)
  p.sweepDrafts = d
  const personDraft = d.find((x) => !x.targetId.startsWith('record:'))!
  const r = applySweeps(p, [personDraft.id])
  const xu = r.characters.find((c) => c.id === 'c1')!
  assert.ok(xu.slices.length === 3, '应有 3 个切片，实际 ' + xu.slices.length)
  assert.strictEqual(xu.slices[2].source, 'sweep')
  assert.ok(xu.slices[2].content.includes('已属于他'))
  assert.strictEqual(xu.slices[2].atChapter, 4)
  assert.strictEqual(r.drafts.find((x) => x.id === personDraft.id)!.status, 'accepted')
})
check('拒绝草稿标记 rejected 且不动时间线', () => {
  const p = makeProject()
  const rec = { chapterNum: 4, summary: 's', characterStates: [{ charId: '许晴', state: '变成熟女' }], resolved: [], sown: [], standingChanges: [] }
  const d = toSweepDrafts(p, makeChapter(4, ''), rec, inferChangeCandidates(p, rec))
  p.sweepDrafts = d
  const personDraft = d.find((x) => !x.targetId.startsWith('record:'))!
  const newD = rejectSweeps(p, [personDraft.id])
  assert.strictEqual(newD.find((x) => x.id === personDraft.id)!.status, 'rejected')
  assert.strictEqual(p.characters[0].slices.length, 2)
})
check('伏笔台账：sown 进 open，resolved 对应项被 close', () => {
  const p = makeProject()
  p.foreshadows = [{ id: 'f1', desc: '旧谜团', sownChapter: 2, status: 'open' }]
  const rec = { chapterNum: 4, summary: 's', characterStates: [], resolved: ['旧谜团'], sown: [], standingChanges: [] }
  const fh = syncForeshadows(p, rec)
  assert.strictEqual(fh.find((f) => f.id === 'f1')!.status, 'resolved')
  assert.strictEqual(fh.find((f) => f.id === 'f1')!.resolvedChapter, 4)
})

console.log(`\n结果：通过 ${passed}，失败 ${failed}${failed ? '（有失败！）' : '（全部通过 ✅）'}`)
process.exit(failed ? 1 : 0)
