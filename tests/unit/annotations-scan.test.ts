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

import { scanAnnotations } from '../../src/main/agent/annotations'
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
