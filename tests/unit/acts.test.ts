import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { rmSync } from 'fs'

const holder = vi.hoisted(() => {
  const os = require('node:os') as { tmpdir(): string }
  const path = require('node:path') as { join(...a: string[]): string }
  const fs = require('node:fs') as { mkdtempSync(p: string): string }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-acts-'))
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
  listDocs: vi.fn()
}))
vi.mock('../../src/main/agent/runtime', () => ({ driveSession: vi.fn() }))

import { parseDirectorSheet } from '../../src/shared/boardParse'
import { directorToDoc, directorRel, type DirectorSheet } from '../../src/main/agent/director'
import { runActs, buildActsDoc, actsRel, actPrompt, failedNote, type ActArg } from '../../src/main/agent/acts'
import { renderActsSegs, splitActsBody, parseActsWarn } from '../../src/shared/actsSeg'
import { driveSession } from '../../src/main/agent/runtime'
import { readDoc, listChapters, writeDoc } from '../../src/main/store'
import { setSettings } from '../../src/main/settings'
import type { ChapterEntry } from '../../src/shared/types'

afterAll(() => {
  rmSync(holder.tmp, { recursive: true, force: true })
})

const driveMock = vi.mocked(driveSession)
const readMock = vi.mocked(readDoc)
const listChaptersMock = vi.mocked(listChapters)
const writeMock = vi.mocked(writeDoc)

beforeEach(() => {
  vi.clearAllMocks()
  setSettings({ capabilities: {}, workspace: '', libraryRoot: '' })
})

const ch: ChapterEntry = {
  file: '第01章_雾港.md',
  name: '第01章_雾港',
  fm: { 章号: 1, 题名: '雾港', 切片: '第一幕_雾港之夜', 涉及人物: ['阿七', '沈藏'] },
  wordCount: 100,
  mtime: 1234567890,
  hasPendingProposal: false
}

const sheet: DirectorSheet = {
  premise: '把阿七从“被记忆咬住”推到“决定主动去查”。',
  arcs: [
    { task: '推进', goal: '阿七在候船厅翻到一串旧钥匙，认出是灯塔的' },
    { task: '白热化', goal: '守塔人当面把灯再一次熄灭，阿七当夜抢船出海' },
    { task: '拉锯', goal: '在塔底与守塔人对峙' }
  ],
  climax: { at: 2, idea: '守塔人当面吹灭唯一的光' },
  axes: [
    { character: '阿七', line: '从被动转为主动抓住钥匙', level: '试探' },
    { character: '沈藏', line: '把退让落在要不要灭灯上', level: '被压' }
  ],
  redlines: ['不要把守塔人写成单纯的恶人'],
  hooks: ['灯芯带回来要呼应']
}

const pad = (s: string) => s + '，'.repeat(300)

const actArg = (over: Partial<ActArg> = {}): ActArg => ({
  index: 2,
  total: 3,
  arc: { task: '白热化', goal: '守塔人当面灭灯' },
  redlines: ['红线一'],
  premise: '前情一句话',
  atClimax: false,
  prevTail: '',
  ...over
})

describe('parseDirectorSheet（导演板逆解析）', () => {
  it('round-trip：directorToDoc 产出的板子能原样解析回来', () => {
    const md = directorToDoc(sheet, ch)
    const back = parseDirectorSheet(md)
    expect(back.premise).toBe(sheet.premise)
    expect(back.arcs).toEqual(sheet.arcs)
    expect(back.climax).toEqual(sheet.climax)
    expect(back.axes).toEqual(sheet.axes)
    expect(back.redlines).toEqual(sheet.redlines)
    expect(back.hooks).toEqual(sheet.hooks)
  })

  it('解析手写的板子文本：带 front matter、加粗、中英冒号都能吃', () => {
    const md = [
      '---',
      '章号: 1',
      '题名: 雾港',
      '---',
      '',
      '# 导演板 · 第1章 雾港',
      '',
      '## 本章戏剧任务',
      '',
      '这句是前景',
      '',
      '## 情绪弧分段',
      '',
      '1. **推进**：第一段要去哪',
      '2. **白热化**: 第二段要去哪',
      '- 平稳：不是白名单里的任务，要滤掉',
      '',
      '## 波峰',
      '',
      '第 3 段 · 一个具体的波峰事件',
      '',
      '## 人物行为轴',
      '',
      '- **阿七（试探）**：这句是行动轴',
      '- **路人（放开）**：人物不在清单也要保留（无清单）',
      '',
      '## 写作红线（不许破）',
      '',
      '- 别写成纯恶人',
      '- （待定）',
      '',
      '## 钩子（要还的债 / 可新埋）',
      '',
      '- 灯芯要呼应',
      ''
    ].join('\n')
    const out = parseDirectorSheet(md)
    expect(out.premise).toBe('这句是前景')
    expect(out.arcs.map((a) => a.task)).toEqual(['推进', '白热化'])
    expect(out.arcs.map((a) => a.goal)).toEqual(['第一段要去哪', '第二段要去哪'])
    expect(out.climax.idea).toContain('波峰事件')
    expect(out.axes).toHaveLength(2)
    expect(out.axes[0]).toEqual({ character: '阿七', level: '试探', line: '这句是行动轴' })
    expect(out.redlines).toEqual(['别写成纯恶人'])
    expect(out.hooks).toEqual(['灯芯要呼应'])
  })

  it('空串 / 乱文本 → 空结构，不抛错', () => {
    expect(parseDirectorSheet('')).toEqual({ premise: '', arcs: [], climax: { at: 1, idea: '' }, axes: [], redlines: [], hooks: [] })
    expect(parseDirectorSheet('随便一段话')).toEqual({ premise: '', arcs: [], climax: { at: 1, idea: '' }, axes: [], redlines: [], hooks: [] })
  })

  it('条数上限与波峰钳制：arcs 最多 5、axes 最多 8、climax.at 钳回范围', () => {
    const md = directorToDoc(
      {
        premise: 'p',
        arcs: [1, 2, 3, 4, 5, 6].map((n) => ({ task: '推进' as const, goal: '段' + n })),
        climax: { at: 9, idea: 'i' },
        axes: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ character: '人' + n, line: 'l', level: '试探' as const })),
        redlines: [],
        hooks: []
      },
      ch
    )
    const out = parseDirectorSheet(md)
    expect(out.arcs).toHaveLength(5)
    expect(out.axes).toHaveLength(8)
    expect(out.climax.at).toBe(5)
  })
})

describe('actPrompt（分幕段落指令）', () => {
  it('首章第一段给章节前情，无上一章尾则不挂承接', () => {
    const p = actPrompt(actArg({ index: 1 }))
    expect(p).toContain('【章节前情】')
    expect(p).not.toContain('【上一章结尾】')
    expect(p).not.toContain('【前文承接】')
  })
  it('非首章第一段：章节前情与上一章结尾都带（承接但不算前文承接）', () => {
    const tail = '雾更浓了。两个人并肩站着，谁也没再说话。'
    const p = actPrompt(actArg({ index: 1, prevTail: tail }))
    expect(p).toContain('【章节前情】')
    expect(p).toContain('【上一章结尾】')
    expect(p).toContain(tail)
    expect(p).not.toContain('【前文承接】')
  })
  it('后续段给前文承接，不再给章节前情', () => {
    const p = actPrompt(actArg({ index: 2, prevTail: '上一段结尾……' }))
    expect(p).toContain('【前文承接】')
    expect(p).toContain('上一段结尾')
    expect(p).not.toContain('【章节前情】')
  })
  it('波峰段标出波峰要求；红线按有无携带', () => {
    expect(actPrompt(actArg({ atClimax: true }))).toContain('波峰段')
    expect(actPrompt(actArg({ redlines: ['红线一'] }))).toContain('红线一')
    expect(actPrompt(actArg({ redlines: [] }))).not.toContain('红线一')
  })
})

describe('buildActsDoc（草稿文档装配）', () => {
  it('沿用原章约定头并标 状态: 分幕草稿，正文按「## 第 N 段」标记渲染', () => {
    const doc = buildActsDoc(
      ch,
      [
        { index: 1, text: '段一内容' },
        { index: 2, text: '段二内容' }
      ],
      { 章号: 1, 题名: '雾港', 切片: 's1', 涉及人物: ['阿七'] }
    )
    expect(doc).toContain('状态: 分幕草稿')
    expect(doc).toContain('## 第 1 段')
    expect(doc).toContain('## 第 2 段')
    expect(doc).toContain('段一内容')
    expect(doc).toContain('段二内容')
    expect(doc.startsWith('---')).toBe(true)
    expect(parseDirectorSheet(doc)).not.toBeNull()
  })
  it('warn 非空 → 缺段警示注记进草稿；为空 → 与原来一致（无警示行）', () => {
    const doc = buildActsDoc(ch, [{ index: 1, text: '正文' }], { 章号: 1, 题名: '雾港' }, failedNote([2], 3))
    expect(doc).toContain('第 2 段未按导演板写成')
    expect(doc).toContain('请勿直接采纳')
    const plain = buildActsDoc(ch, [{ index: 1, text: '正文' }], { 章号: 1, 题名: '雾港' })
    expect(plain).not.toContain('请勿直接采纳')
  })
})

describe('failedNote（缺段警示文案）', () => {
  it('含失败段号与成功段数信息', () => {
    expect(failedNote([2, 4], 5)).toContain('第 2、4 段')
    expect(failedNote([2, 4], 5)).toContain('3/5 段')
  })
})

describe('runActs（分幕生成主流程）', () => {
  it('章不存在 → 提示找不到章节', async () => {
    listChaptersMock.mockReturnValue([])
    const r = await runActs('p1', '正文/第01章_雾港.md')
    expect(r.ok).toBe(false)
  })
  it('没有导演板 → 提示先导演本章', async () => {
    listChaptersMock.mockReturnValue([ch])
    readMock.mockReturnValue('正文内容')
    const r = await runActs('p1', '正文/第01章_雾港.md')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('导演板')
  })
  it('逐段请求并把前段末文带进下一段，完成拼装落盘', async () => {
    listChaptersMock.mockReturnValue([ch])
    readMock.mockImplementation((_id: string, rel: string) => {
      if (rel === directorRel(ch)) return directorToDoc(sheet, ch)
      if (rel === '正文/' + ch.file) return '---\n章号: 1\n题名: 雾港\n---\n旧正文'
      return null
    })
    driveMock.mockImplementation(async (_sid: string, prompt: string) => {
      if (prompt.includes('第 1 / 3 段')) return pad('阿七在候船厅摸到一串旧钥匙')
      return pad('守塔人把灯吹熄，阿七当夜抢船出海')
    })
    const r = await runActs('p1', '正文/第01章_雾港.md')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.acts).toBe(3)
      expect(r.words).toBeGreaterThan(0)
      expect(r.written).toBe(actsRel(ch))
    }
    const calls = driveMock.mock.calls
    expect(calls).toHaveLength(3)
    // 第二段起，前段末文被带进 prompt
    expect(calls[1][1]).toContain('【前文承接】')
    expect(calls[1][1]).toContain('钥匙')
    const doc = writeMock.mock.calls.find((c) => c[1] === actsRel(ch))?.[2] ?? ''
    expect(doc).toContain('阿七在候船厅摸到一串旧钥匙')
    expect(doc).toContain('守塔人把灯吹熄')
    expect(doc).toContain('分幕草稿')
  })
  it('非首章：首段请求带上一章结尾（剥约定头后的末段正文），后续段仍走前文承接', async () => {
    const prevCh: ChapterEntry = {
      file: '第00章_起航.md',
      name: '第00章_起航',
      fm: { 章号: 0, 题名: '起航', 切片: '序幕', 涉及人物: ['阿七'] },
      wordCount: 100,
      mtime: 12,
      hasPendingProposal: false
    }
    const ch2: ChapterEntry = { ...ch, file: '第02章_灯下.md', name: '第02章_灯下', fm: { ...(ch.fm ?? {}), 章号: 2 } }
    listChaptersMock.mockReturnValue([prevCh, ch2])
    const prevBody =
      '---\n章号: 0\n题名: 起航\n---\n' +
      '前情正文。'.repeat(20) +
      '起航之后，船头劈开浓雾，阿七攥着钥匙的手一直没松开。这是上一章的结尾。'
    readMock.mockImplementation((_id: string, rel: string) => {
      if (rel === directorRel(ch2)) return directorToDoc(sheet, ch2)
      if (rel === '正文/' + prevCh.file) return prevBody
      if (rel === '正文/' + ch2.file) return '---\n章号: 2\n题名: 灯下\n---\n旧正文'
      return null
    })
    driveMock.mockImplementation(async () => pad('首段成文'))
    const r = await runActs('p1', '正文/' + ch2.file)
    expect(r.ok).toBe(true)
    const first = driveMock.mock.calls[0][1]
    expect(first).toContain('【上一章结尾】')
    expect(first).toContain('阿七攥着钥匙的手一直没松开')
    expect(first).toContain('【章节前情】')
    expect(first).not.toContain('【前文承接】')
    // 第二段是段内承接，不是上一章结尾
    expect(driveMock.mock.calls[1][1]).toContain('【前文承接】')
  })
  it('回归：上一章 fm 章号为字符串（extractFrontMatter 真实现返回）时，首段仍带上一章结尾', async () => {
    // 真机 store 归一前曾把 章号 以字符串回传，typeof 判断被架空 → 首段承接整段失效（devShim 是数字把坑盖住）
    const prevCh: ChapterEntry = {
      file: '第00章_起航.md',
      name: '第00章_起航',
      // @ts-expect-error 刻意植入字符串章号（真实文件的约定头就是字符串）
      fm: { 章号: '0', 题名: '起航', 切片: '序幕', 涉及人物: ['阿七'] },
      wordCount: 100,
      mtime: 12,
      hasPendingProposal: false
    }
    const ch2: ChapterEntry = {
      ...ch,
      file: '第02章_灯下.md',
      name: '第02章_灯下',
      // @ts-expect-error 同上
      fm: { ...(ch.fm ?? {}), 章号: '2' }
    }
    listChaptersMock.mockReturnValue([prevCh, ch2])
    readMock.mockImplementation((_id: string, rel: string) => {
      if (rel === directorRel(ch2)) return directorToDoc(sheet, ch2)
      if (rel === '正文/' + prevCh.file) return '---\n章号: 0\n---\n上一章的结尾要留在这里。结尾的尾巴。'
      if (rel === '正文/' + ch2.file) return '---\n章号: 2\n题名: 灯下\n---\n旧正文'
      return null
    })
    driveMock.mockImplementation(async () => pad('首段成文'))
    const r = await runActs('p1', '正文/' + ch2.file)
    expect(r.ok).toBe(true)
    const first = driveMock.mock.calls[0][1]
    expect(first).toContain('【上一章结尾】')
    expect(first).toContain('上一章的结尾要留在这里')
  })
  it('某段重试后仍太短 → 结果带 failed、草稿注入缺段警示且残段不入草稿', async () => {
    listChaptersMock.mockReturnValue([ch])
    readMock.mockImplementation((_id: string, rel: string) => {
      if (rel === directorRel(ch)) return directorToDoc(sheet, ch)
      if (rel === '正文/' + ch.file) return '---\n章号: 1\n题名: 雾港\n---\n旧正文'
      return null
    })
    driveMock.mockImplementation(async (_sid: string, prompt: string) => {
      if (prompt.includes('第 1 / 3 段')) return pad('第一段成文')
      if (prompt.includes('第 2 / 3 段')) return '太短' // 重试后仍不够 MIN_ACT
      return pad('第三段成文')
    })
    const r = await runActs('p1', '正文/第01章_雾港.md')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.failed).toEqual([2])
      expect(r.acts).toBe(2)
      expect(r.words).toBeGreaterThan(0)
    }
    // 第 2 段短文触发了 1 次重试（共 4 次请求），仍失败后草稿无残段但有警示
    expect(driveMock.mock.calls).toHaveLength(4)
    expect(driveMock.mock.calls[2][1]).toContain('写得太短')
    const doc = writeMock.mock.calls.find((c) => c[1] === actsRel(ch))?.[2] ?? ''
    expect(doc).toContain('第一段成文')
    expect(doc).toContain('第三段成文')
    expect(doc).not.toContain('太短')
    expect(doc).toContain('第 2 段未按导演板写成')
    expect(doc).toContain('请勿直接采纳')
  })
  it('全部段都失败 → ok:false 且提示哪些段失败', async () => {
    listChaptersMock.mockReturnValue([ch])
    readMock.mockImplementation((_id: string, rel: string) => {
      if (rel === directorRel(ch)) return directorToDoc(sheet, ch)
      if (rel === '正文/' + ch.file) return '---\n章号: 1\n题名: 雾港\n---\n旧正文'
      return null
    })
    driveMock.mockImplementation(async () => '没有了')
    const r = await runActs('p1', '正文/第01章_雾港.md')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('第 1、2、3 段')
      expect(r.error).toContain('失败')
    }
    expect(writeMock).not.toHaveBeenCalled()
  })
  it('能力被设置页关闭 → 直接被拦', async () => {
    setSettings({ capabilities: { acts: false }, workspace: '', libraryRoot: '' })
    const r = await runActs('p1', '正文/第01章_雾港.md')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('关闭')
  })

  it('全量草稿按段标记渲染（可反解析）', async () => {
    listChaptersMock.mockReturnValue([ch])
    readMock.mockImplementation((_id: string, rel: string) => {
      if (rel === directorRel(ch)) return directorToDoc(sheet, ch)
      if (rel === '正文/' + ch.file) return '---\n章号: 1\n题名: 雾港\n---\n旧正文'
      return null
    })
    driveMock.mockImplementation(async () => pad('成文段落'))
    const r = await runActs('p1', '正文/第01章_雾港.md')
    expect(r.ok).toBe(true)
    const doc = writeMock.mock.calls.find((c) => c[1] === actsRel(ch))?.[2] ?? ''
    expect(doc).toContain('## 第 1 段')
    expect(doc).toContain('## 第 2 段')
    expect(doc).toContain('## 第 3 段')
  })
})

describe('actsSeg（段标记约定）', () => {
  const segs = [
    { index: 1, text: '候船厅的灯慢慢暗下来。' },
    { index: 2, text: '守塔人把手伸向灯台。' },
    { index: 3, text: '阿七攥紧了钥匙。' }
  ]

  it('renderActsSegs → splitActsBody 往返：分段不丢、段号与文本一致', () => {
    const body = renderActsSegs(segs)
    const back = splitActsBody(body)
    expect(back.size).toBe(3)
    expect(back.get(1)).toBe(segs[0].text)
    expect(back.get(2)).toBe(segs[1].text)
    expect(back.get(3)).toBe(segs[2].text)
  })

  it('乱序输入渲染后仍按段号升序', () => {
    expect(renderActsSegs([segs[2], segs[0], segs[1]])).toMatch(/第 1 段[\s\S]*第 2 段[\s\S]*第 3 段/)
  })

  it('parseActsWarn：单段/多段警示都能抽，无警示返回空', () => {
    expect(parseActsWarn('> ⚠️ 第 2 段未按导演板写成，草稿只含 2/3 段')).toEqual([2])
    expect(parseActsWarn('> ⚠️ 第 1、3、4 段未按导演板写成')).toEqual([1, 3, 4])
    expect(parseActsWarn('完整草稿')).toEqual([])
  })

  it('splitActsBody 对无标记的旧格式正文返回空（旧草稿不可定位）', () => {
    expect(splitActsBody('第一段正文\n\n第二段正文').size).toBe(0)
  })
})

describe('runActs 补写缺段（onlyFailed / only）', () => {
  const board = directorToDoc(sheet, ch)
  const chapterRaw = '---\n章号: 1\n题名: 雾港\n---\n旧正文'
  // 第 1、3 段已写成，第 2 段缺（草稿带缺段警示）——补写前的现场
  const draftWithGap = buildActsDoc(
    ch,
    [
      { index: 1, text: pad('第一段成文') },
      { index: 3, text: pad('第三段成文') }
    ],
    { 章号: 1, 题名: '雾港' },
    failedNote([2], 3)
  )
  const setupDraft = (draft: string) => {
    readMock.mockImplementation((_id: string, rel: string) => {
      if (rel === directorRel(ch)) return board
      if (rel === '正文/' + ch.file) return chapterRaw
      if (rel === actsRel(ch)) return draft
      return null
    })
  }

  it('onlyFailed：只重写失败段，成功段原样保留，草稿变完整（无警示）', async () => {
    listChaptersMock.mockReturnValue([ch])
    setupDraft(draftWithGap)
    driveMock.mockImplementation(async () => pad('补写成功的第二段'))
    const r = await runActs('p1', '正文/第01章_雾港.md', undefined, undefined, { onlyFailed: true })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.acts).toBe(3)
      expect(r.failed).toBeUndefined()
      expect(r.words).toBeGreaterThan(0)
    }
    // 只发了 1 段请求（补写第 2 段），且承接来自第 1 段末文
    expect(driveMock.mock.calls).toHaveLength(1)
    expect(driveMock.mock.calls[0][1]).toContain('第 2 / 3 段')
    expect(driveMock.mock.calls[0][1]).toContain('第一段成文')
    const doc = writeMock.mock.calls.find((c) => c[1] === actsRel(ch))?.[2] ?? ''
    expect(doc).toContain('第一段成文')
    expect(doc).toContain('补写成功的第二段')
    expect(doc).toContain('第三段成文')
    expect(doc).not.toContain('请勿直接采纳')
    expect(doc).toContain('## 第 2 段')
  })

  it('onlyFailed：重写后仍失败 → 结果带 failed、草稿仍只缺该段且警示保留', async () => {
    listChaptersMock.mockReturnValue([ch])
    setupDraft(draftWithGap)
    driveMock.mockImplementation(async () => '还是太短')
    const r = await runActs('p1', '正文/第01章_雾港.md', undefined, undefined, { onlyFailed: true })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.failed).toEqual([2])
    expect(driveMock.mock.calls).toHaveLength(2) // 1 次 + 1 次重试
    const doc = writeMock.mock.calls.find((c) => c[1] === actsRel(ch))?.[2] ?? ''
    expect(doc).toContain('第一段成文')
    expect(doc).toContain('第三段成文')
    expect(doc).not.toContain('还是太短')
    expect(doc).toContain('第 2 段未按导演板写成')
  })

  it('onlyFailed：草稿完整（无警示）→ 提示没有缺段可补，不发请求', async () => {
    listChaptersMock.mockReturnValue([ch])
    setupDraft(buildActsDoc(ch, [{ index: 1, text: pad('完整') }], { 章号: 1, 题名: '雾港' }))
    const r = await runActs('p1', '正文/第01章_雾港.md', undefined, undefined, { onlyFailed: true })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('没有缺段可补')
    expect(driveMock).not.toHaveBeenCalled()
    expect(writeMock).not.toHaveBeenCalled()
  })

  it('onlyFailed：旧格式草稿（有警示但无分段标记）→ 提示重新分幕生成', async () => {
    listChaptersMock.mockReturnValue([ch])
    const oldDraft =
      '---\n章号: 1\n题名: 雾港\n状态: 分幕草稿\n---\n\n# 雾港（分幕草稿）\n\n> 由「分幕生成」按导演板情绪弧分段逐段写出。\n> ⚠️ 第 2 段未按导演板写成，草稿只含 1/2 段。请勿直接采纳。\n\n段一正文'
    setupDraft(oldDraft)
    const r = await runActs('p1', '正文/第01章_雾港.md', undefined, undefined, { onlyFailed: true })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('旧格式')
  })

  it('only 指定段号：还没有分幕草稿 → 报错且不发请求、不写盘（不静默盖出只有目标段的空草稿）', async () => {
    listChaptersMock.mockReturnValue([ch])
    setupDraft('')
    const r = await runActs('p1', '正文/第01章_雾港.md', undefined, undefined, { only: [2] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('还没有分幕草稿')
    expect(driveMock).not.toHaveBeenCalled()
    expect(writeMock).not.toHaveBeenCalled()
  })

  it('only 指定段号：旧格式草稿（无分段标记）→ 提示重新分幕生成，原稿不被覆盖', async () => {
    listChaptersMock.mockReturnValue([ch])
    setupDraft('---\n章号: 1\n题名: 雾港\n状态: 分幕草稿\n---\n\n# 雾港（分幕草稿）\n\n旧格式正文没有段标记')
    const r = await runActs('p1', '正文/第01章_雾港.md', undefined, undefined, { only: [1] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('旧格式')
    expect(driveMock).not.toHaveBeenCalled()
    expect(writeMock).not.toHaveBeenCalled()
  })

  it('only 指定段号：重写已存在段 → 该段文本被替换、其余段原样保留', async () => {
    listChaptersMock.mockReturnValue([ch])
    setupDraft(
      buildActsDoc(
        ch,
        [
          { index: 1, text: pad('第一段成文') },
          { index: 2, text: pad('第二段成文') }
        ],
        { 章号: 1, 题名: '雾港' }
      )
    )
    driveMock.mockImplementation(async () => pad('重写后的第二段'))
    const r = await runActs('p1', '正文/第01章_雾港.md', undefined, undefined, { only: [2] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.acts).toBe(2)
    expect(driveMock.mock.calls).toHaveLength(1)
    expect(driveMock.mock.calls[0][1]).toContain('第 2 / 3 段')
    const doc = writeMock.mock.calls.find((c) => c[1] === actsRel(ch))?.[2] ?? ''
    expect(doc).toContain('第一段成文')
    expect(doc).toContain('重写后的第二段')
    expect(doc).not.toContain('第二段成文')
  })

  it('only 指定段号：重写首段用上一章结尾承接（非首章），其余段保留', async () => {
    const prevCh: ChapterEntry = {
      file: '第00章_起航.md',
      name: '第00章_起航',
      fm: { 章号: 0, 题名: '起航', 切片: '序幕', 涉及人物: ['阿七'] },
      wordCount: 100,
      mtime: 12,
      hasPendingProposal: false
    }
    const ch2: ChapterEntry = { ...ch, file: '第02章_灯下.md', name: '第02章_灯下', fm: { ...(ch.fm ?? {}), 章号: 2 } }
    listChaptersMock.mockReturnValue([prevCh, ch2])
    const gapDraft = buildActsDoc(
      ch2,
      [{ index: 2, text: pad('第二段成文') }],
      { 章号: 2, 题名: '灯下' },
      failedNote([1], 2)
    )
    readMock.mockImplementation((_id: string, rel: string) => {
      if (rel === directorRel(ch2)) return directorToDoc(sheet, ch2)
      if (rel === '正文/' + prevCh.file) return '---\n章号: 0\n---\n上一章的结尾要留在这里。'
      if (rel === '正文/' + ch2.file) return '---\n章号: 2\n题名: 灯下\n---\n旧正文'
      if (rel === actsRel(ch2)) return gapDraft
      return null
    })
    driveMock.mockImplementation(async () => pad('补写的首段'))
    const r = await runActs('p1', '正文/' + ch2.file, undefined, undefined, { only: [1] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.acts).toBe(2)
    expect(driveMock.mock.calls).toHaveLength(1)
    expect(driveMock.mock.calls[0][1]).toContain('【上一章结尾】')
    expect(driveMock.mock.calls[0][1]).toContain('上一章的结尾要留在这里')
    const doc = writeMock.mock.calls.find((c) => c[1] === actsRel(ch2))?.[2] ?? ''
    expect(doc).toContain('补写的首段')
    expect(doc).toContain('第二段成文')
    expect(doc).not.toContain('请勿直接采纳')
  })
})
