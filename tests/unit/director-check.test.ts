import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { rmSync } from 'fs'
import { join } from 'path'

const holder = vi.hoisted(() => {
  const os = require('node:os') as { tmpdir(): string }
  const path = require('node:path') as { join(...a: string[]): string }
  const fs = require('node:fs') as { mkdtempSync(p: string): string }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-dcheck-'))
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

import { extractDirectorCheck, runDirectorCheck } from '../../src/main/agent/director-check'
import { driveSession } from '../../src/main/agent/runtime'
import { listCapabilities } from '../../src/main/agent/subtask'
import { setSettings } from '../../src/main/settings'
import { readDoc, listChapters } from '../../src/main/store'

const CH = '正文/第02章_灯塔.md'
const BOARD = '大纲/第02章_灯塔_导演.md'

const chapterDoc = (body: string) =>
  '---\n章号: 2\n题名: 灯塔\n切片: 第二幕\n涉及人物: [阿七, 守塔人]\n---\n' + body
const boardDoc = (body: string) => '---\n章号: 2\n题名: 灯塔\n切片: 第二幕\n状态: 已生成\n---\n' + body

afterAll(() => {
  rmSync(holder.tmp, { recursive: true, force: true })
})

const driveMock = vi.mocked(driveSession)
const readMock = vi.mocked(readDoc)
const listChaptersMock = vi.mocked(listChapters)

beforeEach(() => {
  vi.clearAllMocks()
  setSettings({ capabilities: {}, workspace: '', libraryRoot: '' })
  listChaptersMock.mockReturnValue([
    { file: '第02章_灯塔.md', name: '第02章_灯塔', fm: { 章号: 2 }, wordCount: 0, mtime: 0, hasPendingProposal: false }
  ] as never)
})

const goodBoard =
  boardDoc(
    '# 导演板 · 第2章 灯塔\n\n## 本章戏剧任务\n把阿七从被回忆咬住推到决定主动去查。\n\n## 情绪弧分段\n1. **推进**：阿七在候船厅翻到旧钥匙，认出是灯塔的\n2. **白热化**：守塔人当面灭灯，阿七当夜抢船出海\n\n## 波峰\n第 2 段 · 守塔人当面吹灭唯一的光\n\n## 人物行为轴\n- **阿七（试探）**：从被动被回忆咬住，转为主动抓旧钥匙不放\n- **守塔人（被压）**：继续用淡漠当壳，最后退让落在要不要灭灯上\n\n## 写作红线（不许破）\n- 不要把守塔人写成单纯的恶人\n\n## 钩子（要还的债 / 可新埋）\n- 灯芯带回来要呼应\n'
  )

const goodBody = chapterDoc(
  '阿七在候船厅的旧帆布袋里翻到一串钥匙，齿痕像极了灯塔那把。他攥着钥匙没撒手。\n守塔人当着他的面把灯又一次拧灭，整片海湾黑下来。阿七当夜就划船出了海。\n在塔底，两个人隔着一道铁门对峙，谁也不先开口。最后守塔人先退让：“灯芯，你带走。”\n'
)

const typicalResult = JSON.stringify({
  summary: '本章整体兑现得不错，但守塔人的行为轴有漂移，灯芯的钩子还没还。',
  arcs: [
    { ref: '阿七在候船厅翻到旧钥匙，认出是灯塔的', status: 'done', note: '开篇就写了钥匙手记' },
    { ref: '守塔人当面灭灯，阿七当夜抢船出海', status: 'partial', note: '灭灯写了但出海是次日' },
    { ref: '两人对峙各要对方先开口', status: 'done', note: '塔底对峙整段都在' }
  ],
  axes: [
    { character: '阿七', ref: '从被动转为主动抓钥匙', status: 'aligned', note: '摸到钥匙开始主动翻查' },
    { character: '守塔人', ref: '继续用淡漠当壳', status: 'drifted', note: '说了很多心里话，壳太少了' },
    { character: '路人甲', ref: '不相干的行为轴', status: 'absent', note: '不在清单里要被滤掉' }
  ],
  redlines: [{ ref: '不要把守塔人写成单纯的恶人', status: 'kept', note: '留了规矩的动机' }],
  hooks: [{ ref: '灯芯带回来要呼应', status: 'open', note: '提了但没让它起作用' }]
})

describe('extractDirectorCheck（兑现检查提取）', () => {
  it('各类状态白名单清洗；axes 人物只在涉事清单里留；各数组限量', () => {
    const out = extractDirectorCheck(typicalResult, ['阿七', '守塔人'])
    expect(out.arcs).toHaveLength(3)
    expect(out.arcs.map((a) => a.status)).toEqual(['done', 'partial', 'done'])
    expect(out.axes).toHaveLength(2)
    expect(out.axes.map((a) => a.status)).toEqual(['aligned', 'drifted']) // 路人甲被滤掉
    expect(out.redlines).toHaveLength(1)
    expect(out.redlines[0].status).toBe('kept')
    expect(out.hooks).toHaveLength(1)
    expect(out.hooks[0].status).toBe('open')
  })

  it('非法状态被丢；arcs 最多 5 条', () => {
    const out = extractDirectorCheck(
      JSON.stringify({
        summary: 's',
        arcs: [
          ...Array.from({ length: 8 }, (_, i) => ({ ref: 'a' + i, status: i === 0 ? 'wat' : 'done', note: 'n' })),
          { ref: 'bad', status: 'done' }
        ],
        axes: [], redlines: [], hooks: []
      })
    )
    expect(out.arcs.length).toBeLessThanOrEqual(5)
    expect(out.arcs.every((a) => a.status === 'done')).toBe(true) // 非法状态整条被丢
  })

  it('没有涉事清单时 axes 原样保留（不按人物过滤）', () => {
    const out = extractDirectorCheck(
      JSON.stringify({ summary: 's', arcs: [], axes: [{ character: '任意', ref: 'r', status: 'drifted', note: 'n' }], redlines: [], hooks: [] })
    )
    expect(out.axes).toHaveLength(1)
  })

  it('model 跑偏成散文 → 空结构（触发 retry）', () => {
    const out = extractDirectorCheck('这一章写得很紧张，但跟导演板对不上。')
    expect(out.summary).toBe('')
    expect(out.arcs).toEqual([])
  })
})

describe('runDirectorCheck（走子任务骨架，只读不改稿）', () => {
  it('本章还没有导演板 → 明确报错，驱动零次', async () => {
    readMock.mockImplementation((_id: string, rel: string) => (rel === CH ? goodBody : ''))
    const r = await runDirectorCheck('pj', CH)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('导演板')
    expect(driveMock).not.toHaveBeenCalled()
  })

  it('有导演板有正文 → 一次会话取回结构化结果，材料含导演板与原文章节涉及人物', async () => {
    readMock.mockImplementation((_id: string, rel: string) => {
      const table: Record<string, string> = { [CH]: goodBody, [BOARD]: goodBoard }
      return table[rel] ?? ''
    })
    driveMock.mockResolvedValue(typicalResult)
    const r = await runDirectorCheck('pj', CH)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.result.arcs.length).toBeGreaterThan(0)
      expect(r.result.summary).toContain('兑现')
    }
    expect(driveMock).toHaveBeenCalledTimes(1)
    const prompt = driveMock.mock.calls[0][1]
    expect(prompt).toContain('导演兑现检查')
    expect(prompt).toContain('本章导演板')
    expect(prompt).toContain('本章正文')
    expect(prompt).toContain('阿七、守塔人') // 涉及人物进 prompt，护栏人物来源
  })

  it('模型第一次跑偏成散文 → retry 后再跑，仍返回结果', async () => {
    readMock.mockImplementation((_id: string, rel: string) => {
      const table: Record<string, string> = { [CH]: goodBody, [BOARD]: goodBoard }
      return table[rel] ?? ''
    })
    driveMock
      .mockResolvedValueOnce('这章和导演板差得有点远。')
      .mockResolvedValueOnce(typicalResult)
    const r = await runDirectorCheck('pj', CH)
    expect(r.ok).toBe(true)
    expect(driveMock).toHaveBeenCalledTimes(2)
    expect(driveMock.mock.calls[1][1]).toContain('左花括号')
  })

  it('正文超旧窗口（9500）但 ≤ 正文预算 → 材料全量含中段（头部窗口=contextCaps 权威源防漂移）', async () => {
    const padA = '潮声起落，渔火明灭。' // 10 字符 × 810 = 8100
    const padB = '守塔人背过身去，影子被灯拉得很长。' // 18 字符
    const midMark = '灯塔的灯芯在夜风里轻轻唱起一首旧歌，阿七猛然回头。'
    const longBody = chapterDoc(padA.repeat(810) + midMark + '\n' + padB.repeat(130))
    readMock.mockImplementation((_id: string, rel: string) => {
      const table: Record<string, string> = { [CH]: longBody, [BOARD]: goodBoard }
      return table[rel] ?? ''
    })
    driveMock.mockResolvedValue(typicalResult)
    const r = await runDirectorCheck('pj', CH)
    expect(r.ok).toBe(true)
    const prompt = driveMock.mock.calls[0][1]
    // 正文约 1.05 万字符 > 旧窗口 8000+1500，中段标识句落在旧窗口盲区（约 8100 处）
    expect(prompt).toContain(midMark) // 新窗口（WCTX_CAPS.chapter+1500）下全量，不裁中段
    expect(prompt).not.toContain('省略中部')
  })

  it('能力注册表里有 director-check（设置页可开关）', () => {
    const all = listCapabilities()
    const d = all.find((c) => c.id === 'director-check')
    expect(d?.title).toBe('导演兑现检查')
  })

  it('设置里关闭 director-check → 短路返回并告知原因', async () => {
    readMock.mockImplementation((_id: string, rel: string) => {
      const table: Record<string, string> = { [CH]: goodBody, [BOARD]: goodBoard }
      return table[rel] ?? ''
    })
    setSettings({ capabilities: { 'director-check': false }, workspace: '', libraryRoot: '' })
    const r = await runDirectorCheck('pj', CH)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('关闭')
    expect(driveMock).not.toHaveBeenCalled()
  })
})
