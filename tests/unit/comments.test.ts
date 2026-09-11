import { describe, expect, it } from 'vitest'
import { stripHtmlComments } from '../../src/shared/comments'

describe('stripHtmlComments（装配前剥离 HTML 注释元信息）', () => {
  it('剥离成对注释：单行 / 多行 / 与正文混合', () => {
    expect(stripHtmlComments('a<!-- 说明 -->b')).toBe('ab')
    expect(stripHtmlComments('<!-- 多行\n注释\n说明 -->正文')).toBe('正文')
    expect(stripHtmlComments('## 标题\n\n<!-- 切片同步说明 -->\n\n- 事实条目')).toBe(
      '## 标题\n\n\n\n- 事实条目'
    )
  })

  it('多处注释全部剥离', () => {
    expect(stripHtmlComments('前<!-- 1 -->中<!-- 2 -->后')).toBe('前中后')
  })

  it('未闭合注释保守保留（不吞正文，宁可保留不可误删）', () => {
    expect(stripHtmlComments('正文<!-- 没闭合的说明')).toBe('正文<!-- 没闭合的说明')
  })

  it('无注释原样返回；已剥离调用幂等', () => {
    expect(stripHtmlComments('普通正文')).toBe('普通正文')
    expect(stripHtmlComments(stripHtmlComments('a<!-- x -->b'))).toBe('ab')
  })
})
