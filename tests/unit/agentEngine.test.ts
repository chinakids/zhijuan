import { beforeEach, describe, expect, it, vi } from 'vitest'

// engine（runChat）依赖打桩：runtime/context/refs/store/syncAnchor 全 mock，事件序列纯逻辑可测
const mocks = vi.hoisted(() => ({
  driveSession: vi.fn()
}))
vi.mock('../../src/main/agent/runtime', () => ({
  driveSession: (...a: unknown[]) => mocks.driveSession(...a),
  closeHarness: () => {}
}))
vi.mock('../../src/main/store', () => ({ projectDir: () => '/tmp/zj-test', listDocs: () => [] }))
vi.mock('../../src/main/agent/context', () => ({
  buildWritingContext: async () => ({ blocks: [] }),
  buildProjectContext: async () => ({ blocks: [] }),
  isTemplateShell: () => false
}))
vi.mock('../../src/main/agent/refs', () => ({ expandAtRefs: async () => ({ block: null }) }))
vi.mock('../../src/main/agent/syncAnchor', () => ({
  normalizeSyncItems: (x: unknown) => x,
  ensureWorldSliceFile: () => {},
  guardPersonTargets: (x: unknown, _: unknown) => ({ items: x, issues: [] })
}))

import { runChat, abortRequest } from '../../src/main/agent/engine'

const chunk = (text: string) => ({
  method: 'session.event',
  params: { event: { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text } } } }
})

const INPUT = {
  requestId: 'r1',
  projectId: 'p',
  chapterRel: null,
  chapterTitle: '第一章',
  prompt: 'hi',
  history: [],
  quote: null
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runChat 事件序列（流式稳定性）', () => {
  it('正常完成：依次发 delta→final→done', async () => {
    mocks.driveSession.mockImplementation(async (_sid: string, _p: string, opts: any) => {
      opts.onEvent(chunk('你'))
      return '完整文本'
    })
    const events: any[] = []
    await runChat(INPUT as any, (e) => events.push(e))
    expect(events.map((e) => e.type)).toEqual(['delta', 'final', 'done'])
    expect(events[1].text).toBe('完整文本')
  })

  it('中途停止：abortRequest 生效，且不再发 final/done（收尾=aborted）', async () => {
    mocks.driveSession.mockImplementation(async (_sid: string, _p: string, opts: any) => {
      opts.onEvent(chunk('你'))
      abortRequest('r1') // 模拟用户点停止（下一次事件应被拦截）
      opts.onEvent(chunk('好')) // 停止后的事件必须丢弃
      return '完整文本'
    })
    const events: any[] = []
    await runChat(INPUT as any, (e) => events.push(e))
    expect(events.map((e) => e.type)).toEqual(['delta', 'aborted'])
  })

  it('停止后的事件不再转发（run.aborted 拦截 onEvent）', async () => {
    mocks.driveSession.mockImplementation(async (_sid: string, _p: string, opts: any) => {
      opts.onEvent(chunk('你'))
      abortRequest('r1')
      opts.onEvent(chunk('好'))
      return 'x'
    })
    const events: any[] = []
    await runChat(INPUT as any, (e) => events.push(e))
    const deltas = events.filter((e) => e.type === 'delta')
    expect(deltas).toHaveLength(1)
    expect(deltas[0].text).toBe('你')
  })

  it('driveSession 抛错 + 已停止：发 aborted（不落 error）', async () => {
    mocks.driveSession.mockImplementation(async (_sid: string, _p: string, opts: any) => {
      opts.onEvent(chunk('你'))
      abortRequest('r1')
      throw new Error('interrupted')
    })
    const events: any[] = []
    await runChat(INPUT as any, (e) => events.push(e))
    expect(events.map((e) => e.type)).toEqual(['delta', 'aborted'])
  })
})
