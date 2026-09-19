import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { rmSync } from 'fs'
import { join } from 'path'

const holder = vi.hoisted(() => {
  const os = require('node:os') as { tmpdir(): string }
  const path = require('node:path') as { join(...a: string[]): string }
  const fs = require('node:fs') as { mkdtempSync(p: string): string }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-sub-'))
  return { tmp, userData: path.join(tmp, 'userData'), documents: path.join(tmp, 'doc') }
})

vi.mock('electron', () => ({
  app: { getPath: (n: string) => (n === 'userData' ? holder.userData : holder.documents) },
  shell: {}
}))
vi.mock('../../src/main/agent/runtime', () => ({ driveSession: vi.fn() }))

import { registerCapability, runSubtask, extractJson, listCapabilities, clip, stripFm, resolveMaxTokens, resolveReasoningEffort, type SubtaskDef } from '../../src/main/agent/subtask'
import { driveSession } from '../../src/main/agent/runtime'
import { setSettings } from '../../src/main/settings'

afterAll(() => {
  rmSync(holder.tmp, { recursive: true, force: true })
})

const driveMock = vi.mocked(driveSession)

beforeEach(() => {
  vi.clearAllMocks()
  setSettings({ capabilities: {}, workspace: '', libraryRoot: '' })
})

const goodDef: SubtaskDef<{ items: string[] }> = {
  id: 'demo',
  title: '演示能力',
  description: '仅测试用',
  buildParts: () => ['系统提示', '材料包'],
  parse: (text) => ({ items: extractJson<{ items: string[] }>(text)?.items ?? [] })
}

function json(text: string) {
  return Promise.resolve(text)
}

describe('extractJson（通用结构化提取）', () => {
  it('剥 markdown 围栏、找花括号或方括号', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJson('前缀说明 {\"b\":2} 后缀')).toEqual({ b: 2 })
    expect(extractJson('[1,2,3]')).toEqual([1, 2, 3])
    expect(extractJson('什么都没有')).toBeNull()
  })
})

describe('stripFm / clip', () => {
  it('stripFm 只去头约定块', () => {
    expect(stripFm('---\n章号: 1\n---\n正文')).toBe('正文')
    expect(stripFm('没约定头')).toBe('没约定头')
  })
  it('clip 超长前后各留一段，并带省略注记', () => {
    const big = '甲'.repeat(5000)
    const out = clip(big, 10, 10)
    expect(out.length).toBeLessThan(100)
    expect(out).toContain('省略')
  })
})

describe('runSubtask（子任务骨架）', () => {
  it('正常路径：一次驱动 + 解析，返回 ok', async () => {
    driveMock.mockResolvedValue('{"items":["a"]}')
    const r = await runSubtask(goodDef, 'p1')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.result.items).toEqual(['a'])
    expect(driveMock).toHaveBeenCalledTimes(1)
    const sid = driveMock.mock.calls[0][0]
    expect(sid).toContain('demo-')
  })

  it('材料组装抛错 → 折叠成 ok:false，不驱动模型', async () => {
    const d: SubtaskDef<unknown> = {
      id: 'demo',
      title: '演示能力',
      buildParts: (): string[] => {
        throw new Error('材料不足')
      },
      parse: (t: string) => t
    }
    const r = await runSubtask(d, 'p1')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('材料不足')
    expect(driveMock).not.toHaveBeenCalled()
  })

  it('空结果触发 retry（第二次带强化提示）', async () => {
    const d: SubtaskDef<{ items: string[] }> = {
      ...goodDef,
      retry: { check: (r) => !r.items.length, prompt: '请只输出 JSON' },
      parse: (text) => ({ items: extractJson<{ items: string[] }>(text)?.items ?? [] })
    }
    driveMock
      .mockResolvedValueOnce('跑偏成散文的文字')
      .mockResolvedValueOnce('{"items":["ok"]}')
    const r = await runSubtask(d, 'p1')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.result.items).toEqual(['ok'])
    expect(driveMock).toHaveBeenCalledTimes(2)
    const second = driveMock.mock.calls[1][1]
    expect(second).toContain('请只输出 JSON')
  })

  it('设置里的能力开关关闭 → 短路返回并告知原因', async () => {
    setSettings({ capabilities: { demo: false } })
    const r = await runSubtask(goodDef, 'p1')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('关闭')
    expect(driveMock).not.toHaveBeenCalled()
  })

  it('驱动失败 → ok:false 且截断错误串', async () => {
    driveMock.mockRejectedValue(new Error('写作引擎驱动超时'))
    const r = await runSubtask(goodDef, 'p1')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('驱动超时')
  })

  it('postprocess 可改写结果', async () => {
    const d: SubtaskDef<{ items: string[] }> = {
      ...goodDef,
      postprocess: (r) => ({ items: r.items.map((x) => x + '!') })
    }
    driveMock.mockResolvedValue('{"items":["a"]}')
    const r = await runSubtask(d, 'p1')
    if (r.ok) expect(r.result.items).toEqual(['a!'])
  })

  it('重试后仍空 → 附原始回包（诊断「模型空 vs 解析失败」）', async () => {
    const d: SubtaskDef<{ items: string[] }> = {
      ...goodDef,
      retry: { check: (r) => !r.items.length, prompt: '请只输出 JSON' },
      parse: (text) => ({ items: extractJson<{ items: string[] }>(text)?.items ?? [] })
    }
    driveMock
      .mockResolvedValueOnce('我看不懂这章，但还是要说几句……')
      .mockResolvedValueOnce('第二次还是散文，没有 JSON')
    const r = await runSubtask(d, 'p1')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.result.items).toEqual([])
      expect(r.lastRaw).toContain('第二次还是散文')
    }
    expect(driveMock).toHaveBeenCalledTimes(2)
  })

  it('重试后有效 → 正常路径不带原始回包（省跨 IPC 大文本）', async () => {
    const d: SubtaskDef<{ items: string[] }> = {
      ...goodDef,
      retry: { check: (r) => !r.items.length, prompt: '请只输出 JSON' },
      parse: (text) => ({ items: extractJson<{ items: string[] }>(text)?.items ?? [] })
    }
    driveMock.mockResolvedValueOnce('{"items":["a"]}')
    const r = await runSubtask(d, 'p1')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.lastRaw).toBeUndefined()
  })
})

describe('resolveMaxTokens（子任务输出预算分层）', () => {
  const ctx = { projectId: 'p1', seq: 0, args: { kind: 'revision' } }

  it('静态值直接返回', () => {
    expect(resolveMaxTokens({ ...goodDef, maxTokens: 20480 }, ctx)).toBe(20480)
  })

  it('函数按 ctx.args 区分（revision 返回预算、其他 undefined=全局档）', () => {
    const f: SubtaskDef<unknown> = {
      id: 'demo', title: '演示能力', buildParts: () => ['系统提示', '材料包'],
      parse: (t) => t,
      maxTokens: (c) => (c.args?.kind === 'revision' ? 20480 : undefined)
    }
    expect(resolveMaxTokens(f, ctx)).toBe(20480)
    expect(resolveMaxTokens(f, { ...ctx, args: { kind: 'chapter' } } as never)).toBeUndefined()
  })

  it('未设置 → undefined（不覆盖 SDK 全局档）', () => {
    expect(resolveMaxTokens(goodDef, ctx)).toBeUndefined()
  })

  it('runSubtask 把解析出的 maxTokens 传给 driveSession 第三参数', async () => {
    driveMock.mockResolvedValue('{"items":["a"]}')
    const d: SubtaskDef<{ items: string[] }> = { ...goodDef, maxTokens: (c) => (c.args?.kind === 'revision' ? 20480 : undefined) }
    await runSubtask(d, 'p1', { kind: 'revision' })
    expect(driveMock).toHaveBeenCalledTimes(1)
    expect(driveMock.mock.calls[0][2]).toMatchObject({ maxTokens: 20480 })
  })

  it('maxMs 函数化：按 ctx.args.kind 分层（revision 12min / 其他 8min）', async () => {
    driveMock.mockResolvedValue('{"items":["a"]}')
    const d: SubtaskDef<{ items: string[] }> = {
      ...goodDef,
      maxMs: (c) => (c.args?.kind === 'revision' ? 12 * 60 * 1000 : 8 * 60 * 1000)
    }
    await runSubtask(d, 'p1', { kind: 'revision' })
    expect(driveMock.mock.calls[0][2]).toMatchObject({ maxMs: 12 * 60 * 1000 })
    driveMock.mockClear()
    await runSubtask(d, 'p1', { kind: 'chapter' })
    expect(driveMock.mock.calls[0][2]).toMatchObject({ maxMs: 8 * 60 * 1000 })
  })
})

describe('resolveReasoningEffort（子任务思考档位分层，2026-09-20）', () => {
  const ctx = { projectId: 'p1', seq: 0, args: { kind: 'revision' } }

  it('静态值直接返回', () => {
    expect(resolveReasoningEffort({ ...goodDef, reasoningEffort: 'low' }, ctx)).toBe('low')
  })

  it('函数按 ctx.args 区分（revision→low、其他 undefined=模型默认档）', () => {
    const f: SubtaskDef<unknown> = {
      id: 'demo', title: '演示能力', buildParts: () => ['系统提示', '材料包'],
      parse: (t) => t,
      reasoningEffort: (c) => (c.args?.kind === 'revision' ? 'low' : undefined)
    }
    expect(resolveReasoningEffort(f, ctx)).toBe('low')
    expect(resolveReasoningEffort(f, { ...ctx, args: { kind: 'chapter' } } as never)).toBeUndefined()
  })

  it('未设置 → undefined（不传参=模型默认档）', () => {
    expect(resolveReasoningEffort(goodDef, ctx)).toBeUndefined()
  })

  it('runSubtask 把解析出的 reasoningEffort 传给 driveSession 第三参数（未设置时不带该键）', async () => {
    driveMock.mockResolvedValue('{"items":["a"]}')
    const d: SubtaskDef<{ items: string[] }> = { ...goodDef, reasoningEffort: (c) => (c.args?.kind === 'revision' ? 'low' : undefined) }
    await runSubtask(d, 'p1', { kind: 'revision' })
    expect(driveMock.mock.calls[0][2]).toMatchObject({ reasoningEffort: 'low' })
    driveMock.mockClear()
    await runSubtask(d, 'p1', { kind: 'chapter' })
    expect(driveMock.mock.calls[0][2]).not.toHaveProperty('reasoningEffort')
  })
})

describe('能力注册表', () => {
  it('注册后可枚举', () => {
    registerCapability({ ...goodDef, id: 'reg-one', title: '登记演示' } as never)
    const all = listCapabilities()
    expect(all.some((c) => c.id === 'reg-one')).toBe(true)
  })
})
