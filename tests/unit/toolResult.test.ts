import { describe, expect, it } from 'vitest'
import { toolResultFailed } from '../../src/shared/toolResult'

describe('toolResultFailed（dsh tool/result 事件失败判定）', () => {
  it('isError=true 判定失败（模型面向的失败标志）', () => {
    expect(
      toolResultFailed({
        turn: 1,
        step: 2,
        message: { content: [{ type: 'tool-result', toolCallId: 'c1', content: [], isError: true }] }
      })
    ).toBe(true)
  })

  it('会话层 error={name,code} 判定失败', () => {
    expect(toolResultFailed({ message: { content: [{ isError: false }] }, error: { name: 'FileNotFound', code: 'ENOENT' } })).toBe(true)
  })

  it('正常结果（isError 缺省/false）判定成功', () => {
    expect(toolResultFailed({ message: { content: [{ type: 'tool-result', isError: false }] } })).toBe(false)
    expect(toolResultFailed({ message: { content: [{ type: 'tool-result' }] } })).toBe(false)
  })

  it('空/异常形状不误判为失败（向后兼容：无 ok 字段即成功）', () => {
    expect(toolResultFailed({})).toBe(false)
    expect(toolResultFailed(undefined)).toBe(false)
    expect(toolResultFailed({ message: {} })).toBe(false)
    expect(toolResultFailed({ message: { content: 'oops' } })).toBe(false)
  })
})
