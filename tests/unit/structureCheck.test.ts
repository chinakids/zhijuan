import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { rmSync } from 'fs'
import { join } from 'path'

const holder = vi.hoisted(() => {
  const os = require('node:os') as { tmpdir(): string }
  const path = require('node:path') as { join(...a: string[]): string }
  const fs = require('node:fs') as { mkdtempSync(p: string): string }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-scheck-'))
  return { tmp, userData: path.join(tmp, 'userData'), documents: path.join(tmp, 'doc') }
})

vi.mock('electron', () => ({
  app: { getPath: (n: string) => (n === 'userData' ? holder.userData : holder.documents) },
  shell: {}
}))
vi.mock('../../src/main/store', () => ({
  readDoc: vi.fn(),
  listChapters: vi.fn(),
  writeDoc: vi.fn(),
  listDocs: vi.fn(),
  projectDir: vi.fn(() => '/tmp/zj-项目')
}))
vi.mock('../../src/main/agent/runtime', () => ({ driveSession: vi.fn() }))

import { extractStructureCheck, runStructureCheck } from '../../src/main/agent/structure-check'
import { driveSession } from '../../src/main/agent/runtime'
import { listCapabilities } from '../../src/main/agent/subtask'
import { setSettings } from '../../src/main/settings'
import { readDoc, listChapters, listDocs } from '../../src/main/store'

const cardDoc = (line?: string) =>
  '---\n章号: 1\n题名: 夜航\n切片: 今_夜航' +
  (line ? `\n时间线: ${line}` : '') +
  '\n状态: 已回建\n---\n> 对应正文：正文/第01章_夜航.md\n' +
  '# 章卡 · 第1章\n\n## 一句话定位\n把旧灯与船票焊进主线。\n\n## 关键事件\n- 阿七提旧灯出现\n- 沈藏点破灯是阿七自己熄的\n\n## 人物进展\n沈藏从漠然到动摇。\n\n## 钩子 / 要还的债\n- 十年前船票的来历\n'

afterAll(() => {
  rmSync(holder.tmp, { recursive: true, force: true })
})

const driveMock = vi.mocked(driveSession)
const readMock = vi.mocked(readDoc)
const listChaptersMock = vi.mocked(listChapters)
const listDocsMock = vi.mocked(listDocs)

beforeEach(() => {
  vi.clearAllMocks()
  setSettings({ capabilities: {}, workspace: '', libraryRoot: '' })
  listChaptersMock.mockReturnValue([{ file: '第01章_夜航.md', name: '第01章_夜航', fm: { 章号: 1 }, wordCount: 0, mtime: 0, hasPendingProposal: false }] as never)
  listDocsMock.mockReturnValue([{ file: '第01章_夜航.md' }] as never)
  readMock.mockImplementation((_pid: string, rel: string) => {
    if (rel === '大纲/第01章_夜航.md') return cardDoc()
    if (rel === '大纲/第01章_夜航_导演.md') return '---\n章号: 1\n---\n# 导演板\n\n## 本章戏剧任务\n推进。\n\n## 波峰\n第 1 段 · 灯灭。\n'
    return null
  })
})

const goodJson = {
  summary: '主线三点结构清楚，过去线的收束略迟。',
  lines: [
    {
      name: '主线',
      points: [
        { chapter: '第1章', role: '开局', note: '旧灯登场建立悬念' },
        { chapter: '第3章', role: '中点', note: '灯塔真相揭一半' },
        { chapter: '第5章', role: '高潮', note: '灯灭看清航线' }
      ],
      pacingNote: '主线段落均匀。'
    },
    {
      name: '过去线',
      points: [{ chapter: '第2章', role: '转折', note: '旧信改写动机' }]
    }
  ],
  ends: [
    { line: '过去线', status: 'settled', evidence: '第4章钩子已还（雨夜长堤）+ 波峰在导演板第 2 段', note: '收束发生在晚线高潮前，符合 Weiland⑥' }
  ],
  notes: ['主线第4章承压不足']
}

describe('extractStructureCheck', () => {
  it('解析标准 JSON 全字段', () => {
    const r = extractStructureCheck(JSON.stringify(goodJson), new Set(['主线', '过去线']))
    expect(r.summary).toContain('三点结构')
    expect(r.lines).toHaveLength(2)
    expect(r.lines[0].points).toHaveLength(3)
    expect(r.lines[0].pacingNote).toBe('主线段落均匀。')
    expect(r.ends).toHaveLength(1)
    expect(r.ends[0].status).toBe('settled')
    expect(r.notes).toHaveLength(1)
  })

  it('线名不在已知清单 → 该线报告丢弃', () => {
    const r = extractStructureCheck(JSON.stringify(goodJson), new Set(['主线']))
    expect(r.lines.map((l) => l.name)).toEqual(['主线'])
  })

  it('不传已知清单 → 不白名单（单线/旧项目兼容）', () => {
    const r = extractStructureCheck(JSON.stringify(goodJson))
    expect(r.lines.map((l) => l.name)).toEqual(['主线', '过去线'])
  })

  it('points 超过 8 条截断', () => {
    const pts = Array.from({ length: 12 }, (_, i) => ({ chapter: `第${i}章`, role: '转折', note: `n${i}` }))
    const r = extractStructureCheck(JSON.stringify({ summary: 's', lines: [{ name: '主线', points: pts }], ends: [] }), new Set(['主线']))
    expect(r.lines[0].points).toHaveLength(8)
  })

  it('ends 状态白名单（非 settled/loose 丢弃）', () => {
    const j = {
      summary: 's',
      lines: [],
      ends: [
        { line: '过去线', status: 'settled', evidence: 'e' },
        { line: '过去线', status: 'unknown', evidence: 'e' },
        { line: '过去线', status: 'LOOSE', evidence: 'e' }
      ]
    }
    const r = extractStructureCheck(JSON.stringify(j), new Set(['过去线']))
    expect(r.ends.map((e) => e.status)).toEqual(['settled'])
  })

  it('ends 线名白名单 + 字段截断', () => {
    const j = {
      summary: 's',
      lines: [],
      ends: [{ line: '幽灵线', status: 'loose', evidence: 'x'.repeat(500), note: 'y'.repeat(500) }]
    }
    const r = extractStructureCheck(JSON.stringify(j), new Set(['过去线']))
    expect(r.ends).toHaveLength(0)
    const ok = { summary: 's', lines: [], ends: [{ line: '过去线', status: 'loose', evidence: 'x'.repeat(500), note: 'y'.repeat(500) }] }
    const r2 = extractStructureCheck(JSON.stringify(ok), new Set(['过去线']))
    expect(r2.ends[0].evidence).toHaveLength(300)
    expect(r2.ends[0].note).toHaveLength(160)
  })

  it('notes 超 8 条截断 + 空串过滤', () => {
    const j = { summary: 's', lines: [], ends: [], notes: ['', ...Array.from({ length: 12 }, (_, i) => `n${i}`)] }
    const r = extractStructureCheck(JSON.stringify(j))
    expect(r.notes?.length).toBe(8)
    expect(r.notes?.[0]).toBe('n0')
  })

  it('markdown 围栏与前后缀文字容错', () => {
    const r = extractStructureCheck('好的，结果如下：\n```json\n' + JSON.stringify(goodJson) + '\n```\n以上。', new Set(['主线', '过去线']))
    expect(r.lines).toHaveLength(2)
    const r2 = extractStructureCheck('前缀 ' + JSON.stringify(goodJson) + ' 后缀', new Set(['主线', '过去线']))
    expect(r2.summary).toContain('三点结构')
  })

  it('字段截断（chapter/role/note/pacingNote）', () => {
    const j = {
      summary: 's',
      lines: [
        {
          name: '主线',
          points: [{ chapter: 'c'.repeat(200), role: 'r'.repeat(200), note: 'n'.repeat(200) }],
          pacingNote: 'p'.repeat(500)
        }
      ],
      ends: []
    }
    const r = extractStructureCheck(JSON.stringify(j), new Set(['主线']))
    expect(r.lines[0].points[0].chapter).toHaveLength(80)
    expect(r.lines[0].points[0].role).toHaveLength(60)
    expect(r.lines[0].points[0].note).toHaveLength(140)
    expect(r.lines[0].pacingNote).toHaveLength(160)
  })

  it('合法空结构（真零发现）原样返回', () => {
    const r = extractStructureCheck(JSON.stringify({ summary: '这一遍结构平顺', lines: [], ends: [] }), new Set(['主线']))
    expect(r.summary).toContain('平顺')
    expect(r.lines).toHaveLength(0)
    expect(r.ends).toHaveLength(0)
    expect('notes' in r).toBe(false)
  })

  it('非 JSON 回复 → 空结构（弱结果，由 retry 判据接管）', () => {
    const r = extractStructureCheck('模型没有按格式输出，写了散文。', new Set(['主线']))
    expect(r.summary).toBe('')
    expect(r.lines).toHaveLength(0)
    expect(r.ends).toHaveLength(0)
  })
})

describe('runStructureCheck', () => {
  it('材料收集：章卡+导演板组装、按章序调用 driveSession、结果透传', async () => {
    driveMock.mockResolvedValueOnce(JSON.stringify(goodJson))
    const r = await runStructureCheck('proj')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // 已知线=从章卡提取（单章 mock 只有主线）→ 模型报的「过去线」被白名单滤除（这正是清洗承诺）
    expect(r.result.lines).toHaveLength(1)
    expect(r.result.lines[0].name).toBe('主线')
    const prompt = driveMock.mock.calls[0][1] as string
    expect(prompt).toContain('时间线清单')
    expect(prompt).toContain('主线')
    expect(prompt).toContain('【第1章 · 夜航】')
    expect(prompt).toContain('导演板')
  })

  it('无章卡 → 明确错误', async () => {
    listDocsMock.mockReturnValue([] as never)
    const r = await runStructureCheck('proj')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('章卡')
    expect(driveMock).not.toHaveBeenCalled()
  })

  it('能力注册表包含 structure-check', () => {
    const caps = listCapabilities()
    expect(caps.some((c) => c.id === 'structure-check')).toBe(true)
  })

  it('部分章缺导演板 → 材料注明且不报错', async () => {
    readMock.mockImplementation((_pid: string, rel: string) => {
      if (rel === '大纲/第01章_夜航.md') return cardDoc()
      return null
    })
    driveMock.mockResolvedValueOnce(JSON.stringify({ summary: 's', lines: [], ends: [] }))
    const r = await runStructureCheck('proj')
    expect(r.ok).toBe(true)
    const prompt = driveMock.mock.calls[0][1] as string
    expect(prompt).toContain('以下章节没有导演板')
  })
})
