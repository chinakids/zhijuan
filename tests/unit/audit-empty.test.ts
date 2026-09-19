// 审读存档·空结果保护（2026-09-20 智能层）：「提取失败」与「真零发现」的语义区分。
// 背景：模型未按格式回复（JSON 截断/跑偏）时 extract 折叠成空结果，若照常落盘会把
// 「这一遍没有发现问题」覆盖上次好存档（03:00 轮实锤：perspectives 截断→空报告覆盖 06:00 轮好报告）。
// 判据：retry 后仍「空且非法」的弱结果必带 lastRaw（runSubtask 契约）→ runAudit 返回失败并保留存档；
// 无 lastRaw 的空结果=模型按格式回答「没有问题」（合法空 JSON）→ 照常落盘（正反馈语义）。
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { rmSync } from 'fs'

const holder = vi.hoisted(() => {
  const os = require('node:os') as { tmpdir(): string }
  const path = require('node:path') as { join(...a: string[]): string }
  const fs = require('node:fs') as { mkdtempSync(p: string): string }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-audempty-'))
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

import { auditReplyIsValid, runAudit } from '../../src/main/agent/audit'
import { driveSession } from '../../src/main/agent/runtime'
import { setSettings } from '../../src/main/settings'
import { readDoc, writeDoc, listChapters, listDocs } from '../../src/main/store'

afterAll(() => {
  rmSync(holder.tmp, { recursive: true, force: true })
})

const driveMock = vi.mocked(driveSession)
const writeMock = vi.mocked(writeDoc)
const readMock = vi.mocked(readDoc)
const listChaptersMock = vi.mocked(listChapters)
const listDocsMock = vi.mocked(listDocs)

beforeEach(() => {
  vi.clearAllMocks()
  setSettings({ capabilities: {}, workspace: '', libraryRoot: '' })
  readMock.mockImplementation((_id: string, rel: string) => (rel === '正文/第1章_雾.md' ? '---\n章号: 1\n题名: 雾\n切片: 第一幕\n---\n正文。' : null))
  listChaptersMock.mockReturnValue([{ file: '第1章_雾.md', name: '第1章_雾', fm: { 章号: 1 }, wordCount: 0, mtime: 0, hasPendingProposal: false }] as never)
  listDocsMock.mockReturnValue([])
})

describe('auditReplyIsValid（原始回复结构合法性判定）', () => {
  it('合法空 JSON（真零发现）判有效：items 可为空数组', () => {
    expect(auditReplyIsValid('{"summary":"","items":[]}')).toBe(true)
  })
  it('带围栏/前后废话的合法 JSON 判有效', () => {
    expect(auditReplyIsValid('```json\n{"summary":"好","items":[]}\n```')).toBe(true)
    expect(auditReplyIsValid('好的，报告如下：{"summary":"好","items":[]}')).toBe(true)
  })
  it('截断 JSON（无闭合/缺 items）判无效', () => {
    expect(auditReplyIsValid('{"summary":"开头","items":[{"severity":"high"')).toBe(false)
    expect(auditReplyIsValid('{"summary":"只有总结","items":')).toBe(false)
    expect(auditReplyIsValid('{"foo":1}')).toBe(false)
  })
  it('散文/空串/undefined 判无效', () => {
    expect(auditReplyIsValid('这一遍没有发现问题。')).toBe(false)
    expect(auditReplyIsValid('')).toBe(false)
    expect(auditReplyIsValid(undefined)).toBe(false)
  })
})

describe('runAudit 空结果保护（提取失败不覆盖好存档）', () => {
  it('两次截断（retry 后仍非法）→ ok:false 且不写盘', async () => {
    driveMock.mockResolvedValueOnce('{"summary":"开头","items":[{"severity":"high"')
    driveMock.mockResolvedValueOnce('{"summary":"还是截断","items":[{"severity":')
    const r = await runAudit('pj', 'consistency')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('未覆盖')
    expect(writeMock).not.toHaveBeenCalled()
    expect(driveMock).toHaveBeenCalledTimes(2) // 首次 + retry
  })

  it('散文回复（retry 后仍无结构）→ ok:false 且不写盘', async () => {
    driveMock.mockResolvedValueOnce('这一遍没有发现问题，故事很完整。')
    driveMock.mockResolvedValueOnce('我还是直接说吧：没有问题。')
    const r = await runAudit('pj', 'review')
    expect(r.ok).toBe(false)
    expect(writeMock).not.toHaveBeenCalled()
  })

  it('合法空 JSON（模型按格式回答“没有问题”）→ ok:true 且落盘“这一遍没有发现问题”', async () => {
    driveMock.mockResolvedValue('{"summary":"","items":[]}')
    const r = await runAudit('pj', 'consistency')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.savedReport).toBe('大纲/审读_一致性巡查.md')
      expect(r.result.items).toHaveLength(0)
    }
    expect(writeMock).toHaveBeenCalledTimes(1)
    const md = (writeMock.mock.calls[0] as [string, string, string])[2]
    expect(md).toContain('这一遍没有发现问题')
    expect(driveMock).toHaveBeenCalledTimes(1) // 真零发现不重试
  })

  it('先非法后合法（retry 兜底成功）→ ok:true 且落盘', async () => {
    driveMock.mockResolvedValueOnce('{"summary":"')
    driveMock.mockResolvedValueOnce('{"summary":"","items":[]}')
    const r = await runAudit('pj', 'consistency')
    expect(r.ok).toBe(true)
    expect(writeMock).toHaveBeenCalledTimes(1)
    expect(driveMock).toHaveBeenCalledTimes(2)
  })

  it('多视角审视同口径：截断 → ok:false 不写盘；合法空 → ok:true 写盘', async () => {
    driveMock.mockResolvedValueOnce('{"viewer":')
    driveMock.mockResolvedValueOnce('{"viewer":')
    const r1 = await runAudit('pj', 'perspectives')
    expect(r1.ok).toBe(false)
    expect(writeMock).not.toHaveBeenCalled()
    driveMock.mockResolvedValue('{"summary":"","items":[]}')
    const r2 = await runAudit('pj', 'perspectives')
    expect(r2.ok).toBe(true)
    expect(writeMock).toHaveBeenCalledTimes(1)
  })
})
