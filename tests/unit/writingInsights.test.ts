import { describe, expect, it } from 'vitest'
import {
  splitSentences,
  diffHunks,
  extractVersionRules,
  summarizeProposals,
  syntaxStats,
  buildSignals,
  draftSkillFromStats,
  reportFromStats,
  shouldRunInsights,
  evidenceOf,
  ruleLine,
  type VersionChange,
  type VersionRule
} from '../../src/shared/writingInsights'
import { parseSkillFile } from '../../src/shared/skills'
import type { Proposal, ProposalItem } from '../../src/shared/types'

const FM = '---\n章号: 1\n题名: 测试\n切片: 夜\n涉及人物: [林晓]\n---\n'

const P = (over: Partial<Proposal>): Proposal => ({
  id: 'p1',
  source: 'slice-sync',
  chapter: '第01章.md',
  slice: '夜',
  status: 'pending',
  createdAt: 1,
  items: [],
  ...over
})
const item = (over: Partial<ProposalItem> = {}): ProposalItem => ({
  target: '人物/林晓.md',
  anchor: '',
  kind: 'replace-text',
  before: '旧文',
  after: '新文',
  reason: 'r',
  ...over
})

describe('splitSentences（中文句子切分）', () => {
  it('按 。！？…（含连用）切分并滤空', () => {
    expect(splitSentences('他来了。她笑了！真的吗……完蛋了？')).toEqual(['他来了', '她笑了', '真的吗', '完蛋了'])
  })
  it('句首引号/空格剥掉', () => {
    expect(splitSentences('“别走。” 他喊。')).toEqual(['别走', '他喊'])
  })
})

describe('diffHunks（行级 LCS diff）', () => {
  it('单处替换：removed/added 各一行', () => {
    const h = diffHunks('甲\n乙\n丙', '甲\n乙改\n丙')
    expect(h).toHaveLength(1)
    expect(h[0].removed).toEqual(['乙'])
    expect(h[0].added).toEqual(['乙改'])
  })
  it('无变化 → 空数组', () => {
    expect(diffHunks('同行', '同行')).toEqual([])
  })
  it('纯新增一行 → added 含该行', () => {
    const h = diffHunks('甲\n乙', '甲\n新行\n乙')
    expect(h).toHaveLength(1)
    expect(h[0].removed).toEqual([])
    expect(h[0].added).toEqual(['新行'])
  })
})

describe('extractVersionRules（版本 diff 规则提取）', () => {
  it('删口头禅：removed-phrase + avoids 方向', () => {
    const changes: VersionChange[] = [
      { file: '正文/第01章.md', before: FM + '他点了点头，慢慢地说。', after: FM + '他点头，说。' }
    ]
    const rules = extractVersionRules(changes)
    const removed = rules.filter((r) => r.kind === 'removed-phrase')
    expect(removed.length).toBeGreaterThan(0)
    expect(removed.every((r) => r.direction === 'avoids')).toBe(true)
    // 「点了点头」在词表且被删；「慢慢地」同理
    expect(removed.map((r) => r.subject)).toContain('点了点头')
  })

  it('长句拆短：split-sentence + prefers 方向', () => {
    const long = '那天夜里他在雾港栈桥看见远处亮起一盏刺眼的白色航标灯，光柱缓慢扫过海面。'
    const short = '那天夜里他在雾港栈桥看见远处亮起一盏刺眼的白色航标灯。光柱缓慢扫过海面。'
    expect(splitSentences(long)).toHaveLength(1) // 前测：确实是那句
    const changes: VersionChange[] = [{ file: '正文/第02章.md', before: FM + long, after: FM + short }]
    const rules = extractVersionRules(changes)
    expect(rules.some((r) => r.kind === 'split-sentence' && r.direction === 'prefers')).toBe(true)
  })

  it('短句合并：merged-sentence', () => {
    const before = '他走了。她留下。'
    const after = '他走了，她留在原地，目送他的背影一点一点消失在海雾深处，很久都没有动。'
    expect(splitSentences(after)).toHaveLength(1)
    const changes: VersionChange[] = [{ file: '正文/第03章.md', before: FM + before, after: FM + after }]
    const rules = extractVersionRules(changes)
    expect(rules.some((r) => r.kind === 'merged-sentence')).toBe(true)
  })

  it('脱敏：非 正文/ 前缀不参与统计', () => {
    const changes: VersionChange[] = [
      { file: '人物/林晓.md', before: '他点了点头。', after: '他点头。' },
      { file: '大纲/索引.md', before: '他点了点头。', after: '他点头。' }
    ]
    expect(extractVersionRules(changes)).toEqual([])
  })

  it('个例上限：exampleLimit=1 时每条规则只有 1 个示例', () => {
    const changes: VersionChange[] = [
      { file: '正文/第01章.md', before: FM + '他点了点头。', after: FM + '他点头。' },
      { file: '正文/第02章.md', before: FM + '她点了点头。', after: FM + '她点头。' }
    ]
    const rules = extractVersionRules(changes, { exampleLimit: 1 })
    const removed = rules.find((r) => r.kind === 'removed-phrase' && r.subject === '点了点头')!
    expect(removed.count).toBe(2)
    expect(removed.examples.length).toBe(1)
  })

  it('同规则聚合 count + 出处 files 按章', () => {
    const changes: VersionChange[] = [
      { file: '正文/第01章.md', before: FM + '他点了点头。', after: FM + '他点头。' },
      { file: '正文/第01章.md', before: FM + '她也点了点头。', after: FM + '她也点头。' },
      { file: '正文/第02章.md', before: FM + '他们点了点头。', after: FM + '他们点头。' }
    ]
    const rules = extractVersionRules(changes)
    const removed = rules.find((r) => r.kind === 'removed-phrase' && r.subject === '点了点头')!
    expect(removed.count).toBe(3)
    expect(removed.files).toContainEqual({ file: '正文/第01章.md', count: 2 })
  })
})

describe('summarizeProposals（提案采纳统计）', () => {
  it('按 status/source/kind 聚合，acceptRate 只按可决样本', () => {
    const ps: Proposal[] = [
      P({ id: 'a', source: 'slice-sync', status: 'accepted', items: [item({ kind: 'upsert-section' })] }),
      P({ id: 'b', source: 'slice-sync', status: 'rejected', items: [item({ kind: 'replace-text' })] }),
      P({ id: 'c', source: 'agent-chat', status: 'pending', items: [item({ kind: 'append' })] }),
      P({ id: 'd', source: 'annotation-sync', status: 'stale', items: [item({ kind: 'replace-text' })] })
    ]
    const s = summarizeProposals(ps)
    expect(s.total).toBe(4)
    expect(s.byStatus).toEqual({ pending: 1, accepted: 1, rejected: 1, stale: 1 })
    const slice = s.bySource.find((x) => x.source === 'slice-sync')!
    expect(slice.total).toBe(2)
    expect(slice.acceptRate).toBe(50)
    const replace = s.byKind.find((x) => x.kind === 'replace-text')!
    expect(replace.acceptRate).toBe(0)
  })

  it('空库零崩溃：全零结构', () => {
    const s = summarizeProposals([])
    expect(s.total).toBe(0)
    expect(s.byStatus).toEqual({ pending: 0, accepted: 0, rejected: 0, stale: 0 })
    expect(s.bySource).toEqual([])
    expect(s.rejectedExamples).toEqual([])
  })

  it('被拒样例 ≤5 条且 before/after 截断', () => {
    const ps: Proposal[] = Array.from({ length: 7 }, (_, i) =>
      P({ id: 'r' + i, status: 'rejected', items: [item({ before: 'x'.repeat(200), after: 'y' })] })
    )
    const s = summarizeProposals(ps)
    expect(s.rejectedExamples).toHaveLength(5)
    expect(s.rejectedExamples[0].before.length).toBeLessThanOrEqual(121)
  })
})

describe('syntaxStats（用词句法聚合）', () => {
  const ch = (file: string, body: string) => ({ file, raw: FM + body })

  it('句长分档与平均/最长', () => {
    const text = '短句。' + '中长句，凑够一定长度再分号结尾。'.repeat(1) + '这是一个超过二十五个字的长句示例用来测分档的口径是否准确。'
    const s = syntaxStats([ch('正文/第01章.md', text)])
    expect(s.sentences.count).toBe(3)
    expect(s.sentences.max).toBeGreaterThan(20)
    const totalBucket = s.sentences.buckets.reduce((n, b) => n + b.count, 0)
    expect(totalBucket).toBe(3)
  })

  it('段落统计：按空行分段', () => {
    const s = syntaxStats([ch('正文/第01章.md', '第一段。\n\n第二段较长。')])
    expect(s.paragraphs.count).toBe(2)
  })

  it('口头禅 top（overuse 同口径：次数/每千字/severity）', () => {
    const s = syntaxStats([ch('正文/第01章.md', '他点了点头。他点了点头。')], { topPhrases: 3 })
    expect(s.topPhrases[0].phrase).toBe('点了点头')
    expect(s.topPhrases[0].count).toBe(2)
  })

  it('约定头不计入正文字符', () => {
    const s = syntaxStats([ch('正文/第01章.md', '正文。')])
    expect(s.chars).toBeLessThan(FM.length)
  })
})

describe('evidenceOf / draftSkillFromStats（草稿模板）', () => {
  const signals = buildSignals({
    changes: [
      { file: '正文/第01章.md', before: FM + '他点了点头，慢慢地说。', after: FM + '他点头，说。' },
      { file: '正文/第02章.md', before: FM + '她点了点头。', after: FM + '她点头。' }
    ],
    proposals: [
      P({ id: 'a', status: 'accepted', source: 'slice-sync', items: [item()] }),
      P({ id: 'b', status: 'rejected', source: 'annotation-sync', items: [item()] })
    ],
    chapters: [{ file: '正文/第01章.md', raw: FM + '他点了点头，慢慢地说。' }]
  })

  it('证据强度分档', () => {
    expect(evidenceOf(5)).toBe('强')
    expect(evidenceOf(3)).toBe('中')
    expect(evidenceOf(1)).toBe('弱')
  })

  it('front matter 五字段齐全且 disabled:true；可被 parseSkillFile 解析', () => {
    const draft = draftSkillFromStats(signals, { generatedAt: new Date(2026, 8, 22) })
    expect(draft).toContain('name: writing-habits')
    expect(draft).toContain('description: ')
    expect(draft).toContain('triggers: [写作习惯, 我的风格, 文风]')
    expect(draft).toContain('arguments: [用途]')
    expect(draft).toContain('disabled: true')
    const meta = parseSkillFile(draft)
    expect(meta).not.toBeNull()
    expect(meta!.disabled).toBe(true)
    expect(meta!.name).toBe('writing-habits')
    expect(meta!.description.length).toBeLessThanOrEqual(500)
  })

  it('证据强度标注 + 规则通用化（草稿不含具体章号）', () => {
    const strong = buildSignals({
      changes: Array.from({ length: 5 }, (_, i) => ({
        file: `正文/第0${i + 1}章.md`,
        before: FM + '他点了点头。',
        after: FM + '他点头。'
      })),
      proposals: [],
      chapters: []
    })
    const draft = draftSkillFromStats(strong, { generatedAt: new Date(2026, 8, 22) })
    expect(draft).toMatch(/\[强\]/)
    expect(draft).not.toMatch(/第\d+章/)
  })

  it('ruleLine 支持 whyOverride（模板句被替换，act 不变；增量 5 探针用）', () => {
    const rule: VersionRule = {
      kind: 'split-sentence',
      subject: '长句',
      direction: 'prefers',
      count: 5,
      files: [],
      examples: [{ before: 'a', after: 'b' }]
    }
    const tpl = ruleLine(rule)
    const refined = ruleLine(rule, '证据显示你总在一个长句内部打两个停顿，让紧张处换气。')
    expect(tpl).toContain('——长短句交替更有节奏、读者呼吸感更好')
    expect(refined).toContain('——证据显示你总在一个长句内部打两个停顿，让紧张处换气。')
    // act（为什么之前的部分）一致
    const head = (s: string) => s.split('——')[0]
    expect(head(refined)).toBe(head(tpl))
  })
})

describe('reportFromStats（三段结构）', () => {
  it('含 Executive summary / Key findings / Recommendations 且带出处', () => {
    const signals = buildSignals({
      changes: [
        { file: '正文/第01章.md', before: FM + '他点了点头。', after: FM + '他点头。' },
        { file: '正文/第02章.md', before: FM + '她点了点头。', after: FM + '她点头。' }
      ],
      proposals: [],
      chapters: [{ file: '正文/第01章.md', raw: FM + '他点了点头。' }]
    })
    const report = reportFromStats(signals, { generatedAt: new Date(2026, 8, 22) })
    expect(report).toContain('## Executive summary')
    expect(report).toContain('## Key findings')
    expect(report).toContain('## Recommendations')
    expect(report).toContain('正文/第01章.md')
    expect(report).toContain('观察 2 次')
  })

  it('空信号：不崩且给出样本不足建议', () => {
    const report = reportFromStats(
      buildSignals({ changes: [], proposals: [], chapters: [] }),
      { generatedAt: new Date(2026, 8, 22) }
    )
    expect(report).toContain('暂无足够样本')
    expect(report).toContain('样本量不足')
  })
})

describe('shouldRunInsights（门控）', () => {
  const NOW = 1_800_000_000_000
  it('开关 false → 否', () => {
    expect(shouldRunInsights({ enabled: false, now: NOW, hasAnySignal: true })).toBe(false)
  })
  it('距上次 <7 天 → 否', () => {
    expect(
      shouldRunInsights({ enabled: true, lastRunAt: NOW - 3 * 24 * 3600 * 1000, now: NOW, hasAnySignal: true })
    ).toBe(false)
  })
  it('无信号（空项目）→ 否', () => {
    expect(shouldRunInsights({ enabled: true, now: NOW, hasAnySignal: false })).toBe(false)
  })
  it('全满足 → 是；恰好 7 天 → 是', () => {
    expect(shouldRunInsights({ enabled: true, now: NOW, hasAnySignal: true })).toBe(true)
    expect(
      shouldRunInsights({ enabled: true, lastRunAt: NOW - 7 * 24 * 3600 * 1000, now: NOW, hasAnySignal: true })
    ).toBe(true)
  })
  it('自定义间隔', () => {
    expect(
      shouldRunInsights({
        enabled: true,
        lastRunAt: NOW - 24 * 3600 * 1000,
        now: NOW,
        hasAnySignal: true,
        intervalMs: 1000
      })
    ).toBe(true)
  })
})
