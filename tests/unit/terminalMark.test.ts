import { beforeEach, describe, expect, it } from 'vitest'
import { parseTerminalSuffix, TERMINAL_TEXT } from '../../src/renderer/src/features/agent/terminalMark'
import { useAgentStore } from '../../src/renderer/src/features/agent/store'

// 轮次终态标记（体验层 2026-09-26，04-体验层.md 五候选1 收口）：
// parseTerminalSuffix=旧实现拼在 content 尾部的标记剥离（渲染前兼容旧会话内消息）；纯函数可测。
describe('parseTerminalSuffix', () => {
  it('剥离截断标记后缀并识别 truncated', () => {
    const r = parseTerminalSuffix('正文前半段。\n\n（输出已截断）')
    expect(r.mark).toBe('truncated')
    expect(r.body).toBe('正文前半段。')
  })

  it('剥离停止标记后缀并识别 stopped', () => {
    const r = parseTerminalSuffix('部分增量。\n\n（已停止）')
    expect(r.mark).toBe('stopped')
    expect(r.body).toBe('部分增量。')
  })

  it('无标记后缀时原样返回（正文含相似文本不误剥）', () => {
    expect(parseTerminalSuffix('他说：「（已停止）」。')).toEqual({ body: '他说：「（已停止）」。', mark: null })
    expect(parseTerminalSuffix('')).toEqual({ body: '', mark: null })
  })

  it('只匹配固定全串后缀，缺换行或文本不全不剥', () => {
    // 缺一个换行
    expect(parseTerminalSuffix('正文\n（已停止）').mark).toBeNull()
    // 前文刚好以「（输出已截断）」收尾但没有前置空行——视为正文一部分
    expect(parseTerminalSuffix('上一段。（输出已截断）').mark).toBeNull()
  })

  it('终态文案与文案口径表行一致', () => {
    expect(TERMINAL_TEXT.stopped).toBe('（已停止）')
    expect(TERMINAL_TEXT.truncated).toBe('（输出已截断）')
  })
})

describe('useAgentStore.markTerminal', () => {
  beforeEach(() => {
    useAgentStore.setState({ messages: [], project: null, byProject: {}, quote: null, quoteByProject: {} })
  })

  it('按 id 标记终态且不改 content', () => {
    useAgentStore.getState().setProject('p1')
    useAgentStore.getState().append({ role: 'assistant', content: '残缺正文' })
    const id = useAgentStore.getState().messages.at(-1)!.id
    useAgentStore.getState().markTerminal(id, 'truncated')
    const m = useAgentStore.getState().messages.at(-1)!
    expect(m.terminalMark).toBe('truncated')
    expect(m.content).toBe('残缺正文')
  })

  it('切项目后按 id 标记仍路由原桶', () => {
    useAgentStore.getState().setProject('p1')
    useAgentStore.getState().append({ role: 'assistant', content: 'x' })
    const id = useAgentStore.getState().messages.at(-1)!.id
    useAgentStore.getState().setProject('p2')
    useAgentStore.getState().markTerminal(id, 'stopped')
    expect(useAgentStore.getState().messages).toHaveLength(0)
    useAgentStore.getState().setProject('p1')
    expect(useAgentStore.getState().messages.at(-1)!.terminalMark).toBe('stopped')
  })
})
