import { describe, expect, it } from 'vitest'
import { chapterLine, DEFAULT_LINE } from '../../src/shared/line'

describe('chapterLine（约定头「时间线」字段提取）', () => {
  it('缺省=主线（无字段/无 fm）', () => {
    expect(chapterLine(null)).toBe(DEFAULT_LINE)
    expect(chapterLine({})).toBe(DEFAULT_LINE)
  })

  it('空或纯空白 = 主线', () => {
    expect(chapterLine({ '时间线': '' })).toBe(DEFAULT_LINE)
    expect(chapterLine({ '时间线': '   ' })).toBe(DEFAULT_LINE)
  })

  it('自定义线名 trim 后返回', () => {
    expect(chapterLine({ '时间线': ' 过去线 ' })).toBe('过去线')
  })

  it('非字符串值按主线兜底', () => {
    expect(chapterLine({ '时间线': 42 } as never)).toBe(DEFAULT_LINE)
  })
})
