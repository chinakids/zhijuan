import { beforeEach, describe, expect, it, vi } from 'vitest'

// engine（runChat/runSync）依赖打桩：runtime/context/refs/store/syncAnchor 全 mock，事件序列纯逻辑可测
// 注意：syncAnchor 用 importOriginal 部分打桩——classifySyncRaw 走真实实现（本轮候选 2f 的核心纯函数），
// 只有 normalize/ensure/guard 被替换；guardPersonTargets 可注入行为（runSync 测试用）。
const mocks = vi.hoisted(() => ({
  driveSession: vi.fn(),
  guardPersonTargets: vi.fn()
}))
// engine 新增依赖 settings（workspaceDir 用 app.getPath('documents')）——测试环境给 /tmp 假路径
vi.mock('electron', () => ({ app: { getPath: (_n: string) => '/tmp/zj-test-docs' } }))
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
vi.mock('../../src/main/agent/syncAnchor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/main/agent/syncAnchor')>()),
  normalizeSyncItems: (x: unknown) => x,
  ensureWorldSliceFile: () => {},
  guardPersonTargets: (...a: unknown[]) => mocks.guardPersonTargets(...a)
}))

import { runChat, abortRequest, runSync, translate } from '../../src/main/agent/engine'

const chunk = (text: string) => ({
  method: 'session.event',
  params: { event: { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text } } } }
})

/** 构造 session.event wire 事件（与真实引擎载荷同构；todo/ask 载荷形态经会话日志实证） */
const wire = (type: string, data: any) => ({ method: 'session.event', params: { event: { type, data } } })

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
  mocks.guardPersonTargets.mockImplementation((x: unknown) => ({ items: x, issues: [] }))
})

describe('translate 事件面映射（候选 1 工具事件面体检）', () => {
  const runT = (events: any[]) => {
    const out: any[] = []
    for (const e of events) translate(e as any, 'r1', (x: any) => out.push(x))
    return out
  }

  it('交互类 todo_write：不发 meta/meta-done，todo/write 结构化事件照发', () => {
    const out = runT([
      wire('tool/call', { name: 'todo_write', callId: 'c1', arguments: '{"todos":[]}' }),
      wire('todo/write', { todos: [{ content: '读取章节', status: 'in_progress' }] }),
      wire('tool/result', { callId: 'c1', message: { content: [{ type: 'tool-result', content: [{ type: 'text', text: 'ok' }] }] } })
    ])
    expect(out.map((e) => e.type)).toEqual(['todo'])
    expect(out[0].items).toEqual([{ content: '读取章节', status: 'in_progress' }])
  })

  it('交互类 ask_user_question：不发 meta/meta-done，zj/user-ask 照发（含 camelCase multiSelect）', () => {
    const out = runT([
      wire('tool/call', { name: 'ask_user_question', callId: 'c2', arguments: '{}' }),
      wire('zj/user-ask', {
        batch: 'b1',
        questions: [{ id: 'q1', header: '走向', question: '怎么走？', options: [{ label: 'A', description: 'd' }], multiSelect: false }]
      }),
      wire('tool/result', { callId: 'c2', message: { content: [{ type: 'tool-result', content: [{ type: 'text', text: 'answered' }] }] } })
    ])
    expect(out.map((e) => e.type)).toEqual(['ask'])
    expect(out[0].batch).toBe('b1')
    expect(out[0].questions[0].multiSelect).toBe(false)
  })

  it('数据工具照发 meta/meta-done（zj_read_doc 不受影响）', () => {
    const out = runT([
      wire('tool/call', { name: 'zj_read_doc', callId: 'c3', arguments: '{"file":"正文/第01章.md"}' }),
      wire('tool/result', { callId: 'c3', message: { content: [{ type: 'tool-result', content: [{ type: 'text', text: '章内容' }] }] } })
    ])
    expect(out.map((e) => e.type)).toEqual(['meta', 'meta-done'])
    expect(out[0].tool).toBe('zj_read_doc')
    expect(out[1].ok).toBe(true)
  })

  it('zj_edit_doc 修改卡路径不受交互类跳过影响（edit + meta-done 同发）', () => {
    const out = runT([
      wire('tool/call', { name: 'zj_edit_doc', callId: 'c4', arguments: '{}' }),
      wire('tool/result', {
        callId: 'c4',
        message: {
          content: [{ type: 'tool-result', content: [{ type: 'text', text: '★ZJ_EDIT★\n{"file":"正文/第01章.md","edits":[{"find":"a","replace":"b"}]}\n★ZJ_END★' }] }]
        }
      })
    ])
    expect(out.map((e) => e.type)).toEqual(['meta', 'edit', 'meta-done'])
    expect(out[1].edits).toHaveLength(1)
  })
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

describe('runSync 产出解析健康（候选 2f：静默空加固）', () => {
  const validItem = { target: '人物/林晓.md', anchor: '切片：x', kind: 'upsert-section', before: '', after: '- 等船', reason: 'r' }

  it('合法空 `[]` → ok + 零条目，只驱动一次（不触发重试）', async () => {
    mocks.driveSession.mockImplementation(async () => '[]')
    const r = await runSync('p', '正文/第01章.md')
    expect(r.ok).toBe(true)
    expect((r as any).items).toHaveLength(0)
    expect(mocks.driveSession).toHaveBeenCalledTimes(1)
  })

  it('散文首答 → 带提醒重试一次，第二次 `[]` → ok 且重试提示已附到第二次提示', async () => {
    const calls: string[] = []
    mocks.driveSession.mockImplementation(async (_sid: string, p: string) => {
      calls.push(p)
      return calls.length === 1 ? '本章没有任何变化。' : '[]'
    })
    const r = await runSync('p', '正文/第01章.md')
    expect(r.ok).toBe(true)
    expect(mocks.driveSession).toHaveBeenCalledTimes(2)
    expect(calls[1]).toContain('你上次的回答没有被解析')
    expect(calls[1]).toContain('先写左中括号')
  })

  it('散文两连 → ok:false，错误带「已重试一次」与原文节选', async () => {
    mocks.driveSession.mockImplementation(async () => '没有变化，作者写得真棒。')
    const r = await runSync('p', '正文/第01章.md')
    expect(r.ok).toBe(false)
    expect((r as any).error).toContain('已重试一次仍失败')
    expect((r as any).error).toContain('原文节选')
    expect((r as any).error).toContain('没有变化')
    expect(mocks.driveSession).toHaveBeenCalledTimes(2)
  })

  it('解析出数组但条目全无效（[{foo}]）→ 重试一次；二次有效条目 → ok', async () => {
    const calls: string[] = []
    mocks.driveSession.mockImplementation(async (_sid: string, p: string) => {
      calls.push(p)
      return calls.length === 1 ? '[{"foo":1}]' : JSON.stringify([validItem])
    })
    const r = await runSync('p', '正文/第01章.md')
    expect(r.ok).toBe(true)
    expect((r as any).items).toHaveLength(1)
    expect((r as any).items[0].target).toBe('人物/林晓.md')
    expect(mocks.driveSession).toHaveBeenCalledTimes(2)
  })

  it('一次成功（有效条目）→ 不触发重试', async () => {
    mocks.driveSession.mockImplementation(async () => JSON.stringify([validItem]))
    const r = await runSync('p', '正文/第01章.md')
    expect(r.ok).toBe(true)
    expect((r as any).items).toHaveLength(1)
    expect(mocks.driveSession).toHaveBeenCalledTimes(1)
  })

  it('产物被 guard 全拦（items 归零）不触发重试——守卫处置不是模型跑偏', async () => {
    mocks.driveSession.mockImplementation(async () => JSON.stringify([validItem]))
    mocks.guardPersonTargets.mockImplementation(() => ({ items: [], issues: [{ target: '人物/林晓.md', action: 'dropped', reason: '未建档' }] }))
    const r = await runSync('p', '正文/第01章.md')
    expect(r.ok).toBe(true)
    expect((r as any).items).toHaveLength(0)
    expect((r as any).guard.issues).toHaveLength(1)
    expect(mocks.driveSession).toHaveBeenCalledTimes(1)
  })
})
