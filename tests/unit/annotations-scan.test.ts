import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'

const holder = vi.hoisted(() => {
  const os = require('node:os') as { tmpdir(): string }
  const path = require('node:path') as { join(...a: string[]): string }
  const fs = require('node:fs') as { mkdtempSync(p: string): string }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-annot-'))
  return { tmp, userData: path.join(tmp, 'userData'), documents: path.join(tmp, 'doc') }
})

vi.mock('electron', () => ({
  app: { getPath: (n: string) => (n === 'userData' ? holder.userData : holder.documents) },
  shell: {}
}))
vi.mock('../../src/main/agent/runtime', () => ({ driveSession: vi.fn() }))

import { scanAnnotations, listAnnotations, removeAnnotation } from '../../src/main/agent/annotations'
import { driveSession } from '../../src/main/agent/runtime'
import { setSettings } from '../../src/main/settings'

const driveMock = vi.mocked(driveSession)

// 项目：正文/第01章.md 五行正文 + 三条批注（csv）
const ROOT = join(holder.tmp, 'lib')
const PID = 'p-annot'
const MD = ['---', '章号: 1', '题名: 测试', '---', '雨把港口淋成一片灰。', '阿七攥着灯。', '她没说话。'].join('\n') + '\n'
const CSV = [
  'L5:1-L5:10,改雨句',
  'L6:1-L6:6,改灯句',
  'L7:1-L7:5,改她说'
].join('\n') + '\n'

function setup(): void {
  rmSync(ROOT, { recursive: true, force: true })
  mkdirSync(join(ROOT, PID, '正文'), { recursive: true })
  writeFileSync(join(ROOT, PID, '正文', '第01章.md'), MD, 'utf-8')
  writeFileSync(join(ROOT, PID, '正文', '第01章_批注.csv'), CSV, 'utf-8')
  rmSync(join(ROOT, PID, '.zhijuan'), { recursive: true, force: true })
}

afterAll(() => {
  rmSync(holder.tmp, { recursive: true, force: true })
})

beforeEach(() => {
  vi.clearAllMocks()
  setSettings({ capabilities: {}, workspace: '', libraryRoot: ROOT })
  setup()
})

function doneRows(): number[] | undefined {
  const f = join(ROOT, PID, '.zhijuan', 'annotations.done.json')
  if (!existsSync(f)) return undefined
  const d = JSON.parse(readFileSync(f, 'utf-8'))
  return d['正文/第01章_批注.csv']?.rows
}

describe('scanAnnotations 记账（未匹配行不得误记账，保留下轮重试）', () => {
  it('部分匹配：只记生成提案的行，未匹配行不进 done', async () => {
    // 引擎只改写前两条（第 3 条未匹配）
    driveMock.mockResolvedValue(
      JSON.stringify([
        { before: '雨把港口淋成一片灰', after: '雨大。', reason: '改' },
        { before: '阿七攥着灯', after: '阿七攥灯', reason: '改' }
      ])
    )
    const r = await scanAnnotations(PID)
    expect(r.found).toBe(3)
    expect(r.generated).toBe(2)
    expect(r.skipped).toBe(1)
    expect(doneRows()).toEqual([1, 2]) // 修复前 = [1,2,3]（第 3 行被误记）
  })

  it('未匹配行下轮仍可重试（done 不含它 → find target 仍发现）', async () => {
    driveMock.mockResolvedValue(
      JSON.stringify([
        { before: '雨把港口淋成一片灰', after: '雨大。', reason: '改' }
      ])
    )
    const first = await scanAnnotations(PID)
    expect(first.found).toBe(3)
    expect(first.generated).toBe(1)
    // 第二次引擎修好，全部命中
    driveMock.mockResolvedValue(
      JSON.stringify([
        { before: '雨把港口淋成一片灰', after: '雨大。', reason: '改' },
        { before: '阿七攥着灯', after: '阿七攥灯', reason: '改' },
        { before: '她没说话', after: '她沉默。', reason: '改' }
      ])
    )
    const second = await scanAnnotations(PID)
    // 修复前：第 2/3 行已被误记 → found=0；修复后：found=2（仅未匹配行）
    expect(second.found).toBe(2)
    expect(second.generated).toBe(2)
    expect(doneRows()).toEqual([1, 2, 3])
  })
})

describe('listAnnotations 显示定位（before 优先、loc 切片兜底；loc 为含 fm 全文行号）', () => {
  it('无 csv → 空数组', () => {
    expect(listAnnotations(PID, '正文/第02章.md')).toEqual([])
  })

  it('两列 csv：按 loc（含 front matter 行号）从全文切片定位', () => {
    const r = listAnnotations(PID, '正文/第01章.md')
    expect(r).toHaveLength(3)
    // Python 切片语义 [sc-1, ec-1)：L5:1-L5:10 → 前 9 字符（不含句号——定位前缀即可在正文匹配）
    expect(r[0]).toEqual({ row: 1, loc: 'L5:1-L5:10', note: '改雨句', before: '雨把港口淋成一片灰' })
    expect(r[1]).toMatchObject({ row: 2 })
    expect(r[1].before).toBe('阿七攥着灯')
    expect(r[2].before).toBe('她没说话')
  })

  it('removeAnnotation：删指定行（行号对齐 csv 原文），空文件删除', () => {
    // 删第 2 行 → 剩 2 条；行号保持 csv 原行（第 1/3 行重新编号后 row 不变语义由 list 反映）
    let r = removeAnnotation(PID, '正文/第01章.md', 2)
    expect(r.ok).toBe(true)
    expect(r.remaining).toBe(2)
    const left = listAnnotations(PID, '正文/第01章.md')
    expect(left.map((x) => x.note)).toEqual(['改雨句', '改她说'])
    expect(left.map((x) => x.row)).toEqual([1, 2])
    // 删第 1 行（改雨句）→ 剩 1 条
    r = removeAnnotation(PID, '正文/第01章.md', 1)
    expect(r.ok).toBe(true)
    expect(r.remaining).toBe(1)
    // 删最后一条 → 文件删除、remaining 0
    r = removeAnnotation(PID, '正文/第01章.md', 1)
    expect(r.ok).toBe(true)
    expect(r.remaining).toBe(0)
    expect(existsSync(join(ROOT, PID, '正文', '第01章_批注.csv'))).toBe(false)
    // 再删不存在的行 → 失败
    r = removeAnnotation(PID, '正文/第01章.md', 5)
    expect(r.ok).toBe(false)
    expect(r.note).toBe('批注行不存在')
  })

  it('三列 csv：before 原文优先（loc 失效也命中）', () => {
    writeFileSync(join(ROOT, PID, '正文', '第01章_批注.csv'), 'L99:1-L99:5,改写灯句,阿七攥着灯。\n', 'utf-8')
    const r = listAnnotations(PID, '正文/第01章.md')
    expect(r).toHaveLength(1)
    expect(r[0].note).toBe('改写灯句')
    expect(r[0].before).toBe('阿七攥着灯。')
  })

  it('loc 与 before 都定位不到 → before 留空', () => {
    writeFileSync(join(ROOT, PID, '正文', '第01章_批注.csv'), 'L99:1-L99:5,坏行\n', 'utf-8')
    const r = listAnnotations(PID, '正文/第01章.md')
    expect(r).toHaveLength(1)
    expect(r[0].before).toBe('')
  })
})
