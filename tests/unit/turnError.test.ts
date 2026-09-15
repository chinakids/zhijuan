import { describe, expect, it } from 'vitest'
import { classifyTurnError, type TurnErrorMsg } from '../../src/renderer/src/features/agent/turnError'

/** 结构超集（file/edits/tool 仅测试用，turnError 只读 role/content/error/errorText/kind） */
type TestMsg = {
  role: string
  content?: string
  error?: boolean
  errorText?: string
  kind?: string
  tool?: string
  file?: string
  edits?: unknown
  errorRetry?: unknown
}
const mk = (m: TestMsg): TurnErrorMsg => ({ ...m, content: m.content ?? '' } as TurnErrorMsg)

describe('classifyTurnError（对话轮错误态分类）', () => {
  it('超时前已产出正文修改卡 → warn + hasEditCards=true（降级提示，成果保留）', () => {
    const msgs = [
      mk({ role: 'user', content: '帮我把这段改一下' }),
      mk({ role: 'assistant', content: '已读完当前章节，定位到——', error: true, errorText: '请求失败：写作引擎驱动超时（已中止引擎本轮）', errorRetry: {} }),
      mk({ role: 'tool', kind: 'edit', file: '正文/第01章.md', edits: [] })
    ]
    const info = classifyTurnError(msgs, 1)
    expect(info.kind).toBe('warn')
    expect(info.hasEditCards).toBe(true)
    expect(info.hasPartial).toBe(true)
    expect(info.bare).toBe(false)
    expect(info.canRetry).toBe(true)
  })

  it('超时前无任何产出 → danger（硬失败，仍可重试）', () => {
    const msgs = [
      mk({ role: 'user', content: '写一段' }),
      mk({ role: 'assistant', content: '', error: true, errorText: '请求失败：写作引擎驱动超时（已中止引擎本轮）', errorRetry: {} })
    ]
    const info = classifyTurnError(msgs, 1)
    expect(info.kind).toBe('danger')
    expect(info.hasEditCards).toBe(false)
    expect(info.hasPartial).toBe(false)
    expect(info.canRetry).toBe(true)
  })

  it('旧 append 错误路径（无 errorText，content=错误文案）→ bare=true', () => {
    const msgs = [
      mk({ role: 'user', content: '/导演' }),
      mk({ role: 'assistant', content: '导演板生成失败：引擎未就绪', error: true })
    ]
    const info = classifyTurnError(msgs, 1)
    expect(info.bare).toBe(true)
    expect(info.kind).toBe('danger')
    expect(info.canRetry).toBe(false)
  })

  it('有部分流式内容但无修改卡 → warn + hasPartial=true', () => {
    const msgs = [
      mk({ role: 'user', content: '续写' }),
      mk({ role: 'assistant', content: '这一段建议这样写：', error: true, errorText: '引擎断开', errorRetry: {} }),
      mk({ role: 'tool', kind: 'meta', tool: 'zj_read_doc' })
    ]
    const info = classifyTurnError(msgs, 1)
    expect(info.kind).toBe('warn')
    expect(info.hasPartial).toBe(true)
    expect(info.hasEditCards).toBe(false)
  })

  it('修改卡属于更早轮次（隔了一条 user 消息）不误判为本轮产出', () => {
    const msgs = [
      mk({ role: 'user', content: '改前一轮' }),
      mk({ role: 'assistant', content: '上一轮的回执' }),
      mk({ role: 'tool', kind: 'edit', file: '正文/第01章.md', edits: [] }),
      mk({ role: 'user', content: '再写一段' }),
      mk({ role: 'assistant', content: '', error: true, errorText: '超时', errorRetry: {} })
    ]
    const info = classifyTurnError(msgs, 4)
    expect(info.hasEditCards).toBe(false)
    expect(info.kind).toBe('danger')
  })

  it('无错误标记的消息 → 按无产出危险态处理且不可重试', () => {
    const msgs = [mk({ role: 'assistant', content: '正常回复' })]
    const info = classifyTurnError(msgs, 0)
    expect(info.kind).toBe('danger')
    expect(info.canRetry).toBe(false)
  })

  it('越界索引 → 极端兜底不抛错', () => {
    const msgs = [mk({ role: 'assistant', content: 'x' })]
    expect(() => classifyTurnError(msgs, 5)).not.toThrow()
  })
})
