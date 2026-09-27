import { describe, expect, it } from 'vitest'
import { clipBody, REPLY_DISPLAY_CAP } from '../../src/renderer/src/features/agent/clip'

// 渲染层单条回复显示截断（体验层 2026-09-27，04-体验层.md 五候选1 收口）：
// content 存全量、仅渲染前缀；clipBody 为纯函数——截断语义=内容完整只是超长（显示截断），
// 与 engine max-tokens 截断（terminalMark truncated，内容不完）无关，勿混用。
describe('clipBody', () => {
  it('未超上限时原样返回、不标截断', () => {
    const r = clipBody('正文前半段。')
    expect(r.text).toBe('正文前半段。')
    expect(r.clipped).toBe(false)
  })

  it('恰好等于上限不截断', () => {
    const body = '字'.repeat(REPLY_DISPLAY_CAP)
    const r = clipBody(body)
    expect(r.text).toBe(body)
    expect(r.clipped).toBe(false)
  })

  it('超过上限时仅渲染前缀、标记截断（完整内容不被截掉）', () => {
    const body = '字'.repeat(REPLY_DISPLAY_CAP + 100)
    const r = clipBody(body)
    expect(r.clipped).toBe(true)
    expect(r.text.length).toBe(REPLY_DISPLAY_CAP)
    expect(r.text).toBe(body.slice(0, REPLY_DISPLAY_CAP))
  })

  it('空串不截断', () => {
    expect(clipBody('')).toEqual({ text: '', clipped: false })
  })

  it('可用自定义上限（测试/预览面）', () => {
    const r = clipBody('一二三四五六', 4)
    expect(r).toEqual({ text: '一二三四', clipped: true })
  })
})
