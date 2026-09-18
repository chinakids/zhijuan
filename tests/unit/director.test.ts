import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { rmSync } from 'fs'
import { join } from 'path'

const holder = vi.hoisted(() => {
  const os = require('node:os') as { tmpdir(): string }
  const path = require('node:path') as { join(...a: string[]): string }
  const fs = require('node:fs') as { mkdtempSync(p: string): string }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-dir-'))
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

import { extractDirector, runDirector, cancelDirector, directorRel, type DirectorSheet } from '../../src/main/agent/director'
import { driveSession } from '../../src/main/agent/runtime'
import { listCapabilities } from '../../src/main/agent/subtask'
import { setSettings } from '../../src/main/settings'
import { readDoc, listChapters, writeDoc, listDocs } from '../../src/main/store'

afterAll(() => {
  rmSync(holder.tmp, { recursive: true, force: true })
})

const driveMock = vi.mocked(driveSession)
const readMock = vi.mocked(readDoc)
const listChaptersMock = vi.mocked(listChapters)
const writeMock = vi.mocked(writeDoc)
const listDocsMock = vi.mocked(listDocs)

beforeEach(() => {
  vi.clearAllMocks()
  setSettings({ capabilities: {}, workspace: '', libraryRoot: '' })
  // 素材路标动态生成（2026-09-18）：素材库默认空，防 buildWritingContext 内 listDocs undefined 抛错
  listDocsMock.mockReturnValue([] as never)
})

describe('extractDirector（导演板提取）', () => {
  it('arcs 白名单清洗并限 5 段；axes 人物只在已知涉及人物里留；climax 钳制到弧段范围', () => {
    const out = extractDirector(
      JSON.stringify({
        premise: '给本章一个明确走向',
        arcs: [
          { task: '白热化', goal: '守塔人当面灭灯' },
          { task: '平稳', goal: '（不该出现在白名单里）' },
          { task: '拉锯', goal: '两人对峙' },
          { task: '低谷', goal: '灯全黑下来的那一瞬' }
        ],
        climax: { at: 9, idea: '在弧段之外也应被钳回' },
        axes: [
          { character: '阿七', line: '从被动到主动', level: '试探' },
          { character: '路人甲', line: '不在清单里要被滤掉', level: '放开' }
        ],
        redlines: ['别把守塔人写成纯恶人', '钥匙来历先落钩子'],
        hooks: ['灯芯要呼应']
      }),
      ['阿七']
    )
    expect(out.premise).toContain('走向')
    expect(out.arcs).toHaveLength(3)
    expect(out.arcs.map((a) => a.task)).toEqual(['白热化', '拉锯', '低谷'])
    // climax.at 被钳到 arcs 长度之内
    expect(out.climax.at).toBeLessThanOrEqual(3)
    expect(out.climax.at).toBeGreaterThanOrEqual(1)
    expect(out.axes).toHaveLength(1)
    expect(out.axes[0].character).toBe('阿七')
    expect(out.redlines.length).toBeLessThanOrEqual(5)
    expect(out.hooks.length).toBeLessThanOrEqual(3)
  })

  it('没有涉及人物清单时 axes 原样保留（角色由模型自定）', () => {
    const out = extractDirector('{"premise":"p","arcs":[{"task":"推进","goal":"g"}],"axes":[{"character":"任意","line":"l","level":"放开"}]}')
    expect(out.axes).toHaveLength(1)
  })

  it('model 跑偏成散文 → 空结构（触发 retry）', () => {
    const out = extractDirector('这一章要写得紧张一点，让阿七和守塔人对峙。')
    expect(out.premise).toBe('')
    expect(out.arcs).toEqual([])
  })

  it('导演板落盘文件路径：大纲/<章名>_导演.md', () => {
    const rel = directorRel({ file: '第01章_雾港.md', name: '第01章_雾港', fm: null, wordCount: 0, mtime: 0 } as never)
    expect(rel).toBe('大纲/第01章_雾港_导演.md')
  })
})

describe('runDirector（走子任务骨架，结果直写 大纲/）', () => {
  it('素材含涉事人物档案与前章尾，结果写盘并返回', async () => {
    readMock.mockImplementation((_id: string, rel: string) => {
      const table: Record<string, string> = {
        '正文/第02章_灯塔.md': '---\n章号: 2\n题名: 灯塔\n切片: 第二幕\n涉及人物: [阿七, 守塔人]\n---\n> == 本章故事要素 ==\n> 目标：去灯塔\n> 核心冲突：灯要不要重新亮',
        '人物/阿七.md': '阿七：失忆的守灯后人，怕黑但硬撑。',
        '人物/守塔人.md': '守塔人：沉默，守着灯灭的规矩。',
        '正文/第01章_雾港.md': '---\n章号: 1\n题名: 雾港\n切片: 第一幕\n---\n阿七在候船厅捡到一串旧钥匙。灯是谁灭的，没人说。'
      }
      return table[rel] ?? ''
    })
    listChaptersMock.mockReturnValue([
      { file: '第01章_雾港.md', name: '第01章_雾港', fm: { 章号: 1 }, wordCount: 0, mtime: 0, hasPendingProposal: false },
      { file: '第02章_灯塔.md', name: '第02章_灯塔', fm: { 章号: 2 }, wordCount: 0, mtime: 0, hasPendingProposal: false }
    ] as never)
    writeMock.mockReturnValue(undefined as never)

    driveMock.mockResolvedValue(
      '{"premise":"把阿七从被回忆咬住推到决定出国","arcs":[{"task":"推进","goal":"阿七到塔下"},{"task":"白热化","goal":"当夜抢船出海"}],"climax":{"at":2,"idea":"守塔人当面灭掉唯一的光"},"axes":[{"character":"阿七","line":"从被动到主动","level":"试探"}],"redlines":["别把守塔人写成纯恶人"],"hooks":["旧钥匙的来历下章揭"]}'
    )
    const r = await runDirector('pj', '正文/第02章_灯塔.md')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.written).toBe('大纲/第02章_灯塔_导演.md')
      expect(r.sheet.arcs).toHaveLength(2)
    }
    // 驱动过两次会话：一次正常（无 retry，因为解析成功了）
    expect(driveMock).toHaveBeenCalledTimes(1)
    const prompt = driveMock.mock.calls[0][1]
    expect(prompt).toContain('章节导演')
    expect(prompt).toContain('阿七、守塔人')
    expect(prompt).toContain('前文略，以下为上一章结尾')
    expect(prompt).toContain('旧钥匙')
    // 写盘内容包含导演板各节
    const written = writeMock.mock.calls[0][2] as string
    expect(written).toContain('导演板')
    expect(written).toContain('本章戏剧任务')
    expect(written).toContain('情绪弧分段')
    expect(written).toContain('写作红线')
  })

  it('/导演 参数＝作者要求：进入驱动 prompt 的【作者要求】块（2026-09-12）', async () => {
    readMock.mockImplementation((_id: string, rel: string) => {
      const table: Record<string, string> = {
        '正文/第02章_灯塔.md': '---\n章号: 2\n题名: 灯塔\n切片: 第二幕\n涉及人物: [阿七]\n---\n阿七走向灯塔。',
        '人物/阿七.md': '阿七：失忆。'
      }
      return table[rel] ?? ''
    })
    listChaptersMock.mockReturnValue([{ file: '第02章_灯塔.md', name: '第02章_灯塔', fm: { 章号: 2 }, wordCount: 0, mtime: 0, hasPendingProposal: false }] as never)
    writeMock.mockReturnValue(undefined as never)
    driveMock.mockResolvedValue('{"premise":"阿七主动夜航","arcs":[{"task":"推进","goal":"出海"}],"climax":{"at":1,"idea":"浪里看到灯"},"axes":[],"redlines":[],"hooks":[]}')
    const r = await runDirector('pj', '正文/第02章_灯塔.md', '高潮必须落在灭灯瞬间')
    expect(r.ok).toBe(true)
    const prompt = driveMock.mock.calls[0][1]
    expect(prompt).toContain('【作者要求】高潮必须落在灭灯瞬间')
    // 空白参数不产生【作者要求】块
    driveMock.mockClear()
    await runDirector('pj', '正文/第02章_灯塔.md', '   ')
    expect(driveMock.mock.calls[0][1]).not.toContain('【作者要求】')
  })

  it('取消路径：cancelDirector 标记后不再落资产（2026-09-12）', async () => {
    readMock.mockImplementation((_id: string, rel: string) =>
      rel === '正文/第02章_灯塔.md' ? '---\n章号: 2\n题名: 灯塔\n---\n阿七走向灯塔。' : ''
    )
    listChaptersMock.mockReturnValue([{ file: '第02章_灯塔.md', name: '第02章_灯塔', fm: { 章号: 2 }, wordCount: 0, mtime: 0, hasPendingProposal: false }] as never)
    writeMock.mockReturnValue(undefined as never)
    let release!: () => void
    const sheet = '{"premise":"x","arcs":[{"task":"推进","goal":"y"}],"climax":{"at":1,"idea":"z"},"axes":[],"redlines":[],"hooks":[]}'
    driveMock.mockImplementation(() => new Promise<string>((res) => { release = () => res(sheet) }))
    const p = runDirector('pj', '正文/第02章_灯塔.md', undefined, 'tok-cancel-1')
    await new Promise((r) => setTimeout(r, 10)) // 让 runSubtask 挂到 driveSession
    cancelDirector('tok-cancel-1')
    release()
    const r = await p
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('已取消')
    expect(writeMock).not.toHaveBeenCalled()
    // 标记用完即清：同 token 不取消再跑 → 正常落盘
    driveMock.mockResolvedValue(sheet)
    const r2 = await runDirector('pj', '正文/第02章_灯塔.md', undefined, 'tok-cancel-1')
    expect(r2.ok).toBe(true)
    expect(writeMock).toHaveBeenCalledTimes(1)
  })

  it('模型第一次跑偏成散文 → retry 后提示再跑，最终写盘', async () => {
    readMock.mockImplementation((_id: string, rel: string) => {
      const table: Record<string, string> = {
        '正文/第02章_灯塔.md': '---\n章号: 2\n题名: 灯塔\n切片: 第二幕\n涉及人物: [阿七]\n---\n阿七走向灯塔。',
        '人物/阿七.md': '阿七：失忆。'
      }
      return table[rel] ?? ''
    })
    listChaptersMock.mockReturnValue([{ file: '第02章_灯塔.md', name: '第02章_灯塔', fm: { 章号: 2 }, wordCount: 0, mtime: 0, hasPendingProposal: false }] as never)
    writeMock.mockReturnValue(undefined as never)
    driveMock
      .mockResolvedValueOnce('这一章要写得紧张一点。')
      .mockResolvedValueOnce('{"premise":"阿七主动夜航","arcs":[{"task":"推进","goal":"出海"}],"climax":{"at":1,"idea":"浪里看到灯在岸上点起"},"axes":[],"redlines":[],"hooks":[]}')
    const r = await runDirector('pj', '正文/第02章_灯塔.md')
    expect(r.ok).toBe(true)
    // 第一次失败触发一次 retry 会话
    expect(driveMock).toHaveBeenCalledTimes(2)
    expect(driveMock.mock.calls[1][1]).toContain('左花括号')
    expect(writeMock).toHaveBeenCalledTimes(1)
  })

  it('能力注册表里有 director（设置页可开关）', () => {
    const all = listCapabilities()
    const d = all.find((c) => c.id === 'director')
    expect(d?.title).toBe('章节导演')
  })

  it('设置里关闭 director → 短路返回并告知原因', async () => {
    readMock.mockImplementation((_id: string, rel: string) =>
      rel === '正文/第02章_灯塔.md' ? '---\n章号: 2\n题名: 灯塔\n---\n阿七走向灯塔。' : ''
    )
    listChaptersMock.mockReturnValue([{ file: '第02章_灯塔.md', name: '第02章_灯塔', fm: { 章号: 2 }, wordCount: 0, mtime: 0, hasPendingProposal: false }] as never)
    setSettings({ capabilities: { director: false }, workspace: '', libraryRoot: '' })
    const r = await runDirector('pj', '正文/第02章_灯塔.md')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('关闭')
    expect(driveMock).not.toHaveBeenCalled()
  })
})
