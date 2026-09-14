import { describe, expect, it } from 'vitest'
import { summarizeToolArgs, serializeToolArgs } from '../../src/shared/toolArgs'

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

describe('serializeToolArgs（完整参数 JSON，工具卡「细节展开」数据源）', () => {
  it('对象序列化为 JSON 字符串', () => {
    expect(serializeToolArgs({ file: '正文/第01章_雾港.md', offset: 6000 })).toBe('{"file":"正文/第01章_雾港.md","offset":6000}')
  })

  it('字符串参数原样保留（dsh 偶发直传字符串）', () => {
    expect(serializeToolArgs('正文/第01章_雾港.md')).toBe('正文/第01章_雾港.md')
  })

  it('超长截断并注明', () => {
    const s = serializeToolArgs({ q: 'x'.repeat(5000) })
    expect(s?.endsWith('…（截断）')).toBe(true)
  })

  it('空/不可序列化返回 undefined', () => {
    expect(serializeToolArgs(undefined)).toBeUndefined()
    expect(serializeToolArgs(null)).toBeUndefined()
    expect(serializeToolArgs(() => 1)).toBeUndefined()
  })
})
