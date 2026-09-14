import { describe, expect, it } from 'vitest'
import { summarizeToolArgs } from '../../src/shared/toolArgs'

describe('summarizeToolArgs（工具参数摘要）', () => {
  it('读取文档：显示 file 路径', () => {
    expect(summarizeToolArgs({ file: '正文/第01章_雾港.md', base: '/x' })).toBe('正文/第01章_雾港.md')
  })

  it('续读：file 带 offset 时附上（续读链可追溯）', () => {
    expect(summarizeToolArgs({ file: '正文/第01章_雾港.md', offset: 6000, base: '/x' })).toBe('正文/第01章_雾港.md (offset=6000)')
  })

  it('搜索：显示 query，不显示 dir', () => {
    expect(summarizeToolArgs({ query: '灯塔', dir: '正文', maxResults: 5, base: '/x' })).toBe('灯塔')
  })

  it('其他工具：取第一个非 base 键值', () => {
    expect(summarizeToolArgs({ base: '/x', chapter: '第02章' })).toBe('chapter=第02章')
  })

  it('无参返回 undefined', () => {
    expect(summarizeToolArgs(undefined)).toBeUndefined()
    expect(summarizeToolArgs(null)).toBeUndefined()
    expect(summarizeToolArgs({ base: '/x' })).toBeUndefined()
  })

  it('字符串参数：JSON 可解析按对象处理，否则截断 60 字符', () => {
    expect(summarizeToolArgs('{"file":"a.md","offset":1}')).toBe('a.md (offset=1)')
    expect(summarizeToolArgs('x'.repeat(100))).toBe('x'.repeat(60))
  })
})
