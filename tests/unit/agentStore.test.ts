import { beforeEach, describe, expect, it } from 'vitest'
import { useAgentStore } from '../../src/renderer/src/features/agent/store'

// Agent 对话按项目分桶（体验层 2026-09-22，04-体验层.md 五候选3 收口）：
// 切项目=切桶；跨项目事件按消息 id 路由到原桶；quote 同桶；reset 只清当前项目。
describe('useAgentStore 按项目分桶', () => {
  beforeEach(() => {
    useAgentStore.setState({ messages: [], project: null, byProject: {}, quote: null, quoteByProject: {} })
  })

  it('切项目时消息按桶隔离、切回不丢', () => {
    useAgentStore.getState().setProject('p1')
    useAgentStore.getState().append({ role: 'user', content: 'A' })
    useAgentStore.getState().append({ role: 'assistant', content: '' })
    const aId = useAgentStore.getState().messages.at(-1)!.id
    useAgentStore.getState().patch(aId, 'A回复')
    useAgentStore.getState().setProject('p2')
    expect(useAgentStore.getState().messages).toEqual([])
    useAgentStore.getState().append({ role: 'user', content: 'B' })
    expect(useAgentStore.getState().messages.map((m) => m.content)).toEqual(['B'])
    useAgentStore.getState().setProject('p1')
    expect(useAgentStore.getState().messages.map((m) => m.content)).toEqual(['A', 'A回复'])
  })

  it('切项目后按 id 的 patch/upsert 仍路由到原桶（流式事件不串桶）', () => {
    useAgentStore.getState().setProject('p1')
    useAgentStore.getState().append({ role: 'assistant', content: '' })
    const id = useAgentStore.getState().messages.at(-1)!.id
    useAgentStore.getState().setProject('p2')
    useAgentStore.getState().patch(id, '流式内容') // 模拟切走后事件到达
    useAgentStore.getState().upsertTool({ id: 'r1-m0', kind: 'meta', tool: 'zj_read_doc', done: true, toolOk: true, project: 'p1' })
    expect(useAgentStore.getState().messages).toEqual([]) // p2 桶保持空
    useAgentStore.getState().setProject('p1')
    const [a, t] = useAgentStore.getState().messages
    expect(a.content).toBe('流式内容')
    expect(a.role).toBe('assistant')
    expect(t.kind).toBe('meta')
    expect(t.done).toBe(true)
  })

  it('切走后新建工具卡带归属项目（流式期到达的 meta/ask/edit 不落当前桶）', () => {
    useAgentStore.getState().setProject('p1')
    useAgentStore.getState().append({ role: 'user', content: 'A' }, { project: 'p1' })
    useAgentStore.getState().setProject('p2')
    // 模拟 p1 的流式事件在作者已切到 p2 后到达（id 为轮前缀，按 id 找不到 → 用归属 hint）
    useAgentStore.getState().upsertTool({ id: 'r1-m0', kind: 'meta', tool: 'zj_read_doc', done: false, startedAt: 1, project: 'p1' })
    expect(useAgentStore.getState().messages).toHaveLength(0) // p2 桶不受影响
    useAgentStore.getState().setProject('p1')
    const t = useAgentStore.getState().messages[1]
    expect(t.kind).toBe('meta')
    expect(t.tool).toBe('zj_read_doc')
  })

  it('quote 按项目分桶', () => {
    useAgentStore.getState().setProject('p1')
    useAgentStore.getState().setQuote('q1')
    useAgentStore.getState().setProject('p2')
    expect(useAgentStore.getState().quote).toBeNull()
    useAgentStore.getState().setProject('p1')
    expect(useAgentStore.getState().quote).toBe('q1')
  })

  it('reset 只清当前项目桶', () => {
    useAgentStore.getState().setProject('p1')
    useAgentStore.getState().append({ role: 'user', content: 'A' })
    useAgentStore.getState().setProject('p2')
    useAgentStore.getState().append({ role: 'user', content: 'B' })
    useAgentStore.getState().reset()
    expect(useAgentStore.getState().messages).toEqual([])
    useAgentStore.getState().setProject('p1')
    expect(useAgentStore.getState().messages.map((m) => m.content)).toEqual(['A'])
  })

  it('同项目重入 setProject 幂等（不丢消息）', () => {
    useAgentStore.getState().setProject('p1')
    useAgentStore.getState().append({ role: 'user', content: 'A' })
    useAgentStore.getState().setProject('p1')
    expect(useAgentStore.getState().messages.map((m) => m.content)).toEqual(['A'])
  })

  it('append/thinking 作用于当前项目桶', () => {
    useAgentStore.getState().setProject('p1')
    useAgentStore.getState().append({ role: 'assistant', content: '' })
    const id = useAgentStore.getState().messages.at(-1)!.id
    useAgentStore.getState().appendThinking(id, '思考')
    useAgentStore.getState().setProject('p2')
    useAgentStore.getState().append({ role: 'assistant', content: '' })
    expect(useAgentStore.getState().messages.some((m) => m.thinking)).toBe(false)
    useAgentStore.getState().setProject('p1')
    expect(useAgentStore.getState().messages.find((m) => m.id === id)?.thinking).toBe('思考')
  })
})
