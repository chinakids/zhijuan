import { describe, expect, it } from 'vitest'
import { chapterBodyBlock } from '../../src/main/agent/audit'
import { WCTX_CAPS } from '../../src/shared/contextCaps'

describe('chapterBodyBlock（本章检查正文读入口径：≤预算全量 / 超预算保尾+注明，与 runChat 装配同口径）', () => {
  it('预算内全量返回，无省略注记', () => {
    const body = 'a'.repeat(4000)
    const out = chapterBodyBlock(body, '正文/第01章_雾港.md')
    expect(out).toBe(body)
  })

  it('恰在预算边界全量返回', () => {
    const body = 'b'.repeat(WCTX_CAPS.chapter)
    expect(chapterBodyBlock(body, 'x')).toBe(body)
  })

  it('超预算保尾：含结尾哨兵、不含首段哨兵、注明省略量与现读路径', () => {
    const cap = WCTX_CAPS.chapter
    const head = '【首段哨兵】' + 'a'.repeat(300)
    const mid = 'm'.repeat(cap)
    const tail = 'z'.repeat(300) + '【结尾哨兵】'
    const body = head + mid + tail
    const out = chapterBodyBlock(body, '正文/第01章_雾港.md')
    expect(out).toContain('【结尾哨兵】')
    expect(out).not.toContain('【首段哨兵】')
    expect(out).toContain(`已超 ${cap} 字符预算`)
    expect(out).toContain('zj_read_doc 读 正文/第01章_雾港.md')
    expect(out.length).toBeLessThan(body.length)
  })

  it('省略量精确：注记含「前文 N 字符已省略」', () => {
    const cap = WCTX_CAPS.chapter
    const body = 'x'.repeat(500) + 'y'.repeat(cap) + 'z'.repeat(500)
    const out = chapterBodyBlock(body, 'x')
    expect(out).toContain(`前文 ${body.length - cap} 字符已省略`)
  })

  it('预算锚点：WCTX_CAPS.chapter 为 12000（改预算需同步本口径契约）', () => {
    expect(WCTX_CAPS.chapter).toBe(12000)
  })
})
