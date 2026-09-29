import { describe, expect, it } from 'vitest'
import { shouldRestorePromptAfterAbort } from '../../src/renderer/src/features/agent/draftRestore'

describe('shouldRestorePromptAfterAbort（中断草稿恢复判定）', () => {
  it('aborted 且正文 delta 为空 → 恢复（误停/模型慢：原输入回到输入框）', () => {
    expect(shouldRestorePromptAfterAbort('aborted', '')).toBe(true)
  })

  it('aborted 且正文只有空白字符（\n\n）→ 视同未产出，恢复', () => {
    expect(shouldRestorePromptAfterAbort('aborted', '\n\n')).toBe(true)
  })

  it('aborted 且已有正文产出 → 不恢复（响应已开始，靠 ↑ 回取）', () => {
    expect(shouldRestorePromptAfterAbort('aborted', '刚把当前章节读了一遍')).toBe(false)
  })

  it('done / error 不触发恢复（error 已有 ErrorNotice「重试」按原载荷重发）', () => {
    expect(shouldRestorePromptAfterAbort('done', '')).toBe(false)
    expect(shouldRestorePromptAfterAbort('error', '')).toBe(false)
  })
})
