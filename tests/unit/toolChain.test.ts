import { describe, expect, it } from 'vitest'
import { groupToolMeta, isContinuedRead, parseToolFile } from '../../src/renderer/src/features/agent/toolChain'

const meta = (id: string, tool: string, toolArgs?: string) => ({ id, kind: 'meta' as const, tool, toolArgs })

describe('groupToolMeta（工具链分组）', () => {
  it('相邻 meta 聚合成一条链', () => {
    const msgs = [
      meta('m1', 'zj_read_doc', '正文/a.md'),
      meta('m2', 'zj_read_doc', '正文/a.md (offset=6000)'),
      meta('m3', 'zj_read_doc', '正文/a.md (offset=12000)')
    ]
    expect(groupToolMeta(msgs)).toEqual([{ type: 'chain', ids: ['m1', 'm2', 'm3'] }])
  })

  it('单卡不成组（保持既有视觉零回归）', () => {
    expect(groupToolMeta([meta('m1', 'zj_read_doc', '正文/a.md')])).toEqual([{ type: 'single', id: 'm1' }])
  })

  it('被非 meta 消息隔断即拆组', () => {
    const msgs = [
      meta('m1', 'zj_read_doc', '正文/a.md'),
      { id: 'a1', kind: undefined },
      meta('m2', 'zj_search', '灯语'),
      meta('m3', 'zj_search', '雾')
    ]
    expect(groupToolMeta(msgs)).toEqual([
      { type: 'single', id: 'm1' },
      { type: 'chain', ids: ['m2', 'm3'] }
    ])
  })

  it('两组之间有多条单卡也正确', () => {
    const msgs = [meta('m1', 'z', 'x'), meta('m2', 'z', 'x'), { id: 't', kind: undefined }, meta('m3', 'z', 'x')]
    expect(groupToolMeta(msgs)).toEqual([{ type: 'chain', ids: ['m1', 'm2'] }, { type: 'single', id: 'm3' }])
  })

  it('空数组返回空', () => {
    expect(groupToolMeta([])).toEqual([])
  })
})

describe('parseToolFile（args 摘要取文档路径）', () => {
  it('取本体路径', () => {
    expect(parseToolFile('正文/第01章_雾港.md')).toBe('正文/第01章_雾港.md')
  })
  it('剥掉 offset 后缀', () => {
    expect(parseToolFile('正文/第01章_雾港.md (offset=6000)')).toBe('正文/第01章_雾港.md')
  })
  it('undefined/空串返回 undefined', () => {
    expect(parseToolFile(undefined)).toBeUndefined()
    expect(parseToolFile('')).toBeUndefined()
  })
})

describe('isContinuedRead（续读判据）', () => {
  it('同一文档第二次及以后读取 = 续读', () => {
    const msgs = [
      meta('m1', 'zj_read_doc', '正文/a.md'),
      meta('m2', 'zj_read_doc', '正文/a.md (offset=6000)'),
      meta('m3', 'zj_read_doc', '正文/a.md (offset=12000)')
    ]
    expect(isContinuedRead(msgs, 0)).toBe(false)
    expect(isContinuedRead(msgs, 1)).toBe(true)
    expect(isContinuedRead(msgs, 2)).toBe(true)
  })

  it('先读 A 再读 B 再回读 A：回到 A 也算续读（前面已读过同一文档）', () => {
    const msgs = [
      meta('m1', 'zj_read_doc', '正文/a.md'),
      meta('m2', 'zj_read_doc', '人物/阿七.md'),
      meta('m3', 'zj_read_doc', '正文/a.md (offset=6000)')
    ]
    expect(isContinuedRead(msgs, 2)).toBe(true)
  })

  it('不同的文档不算续读；非 zj_read_doc 不算', () => {
    const msgs = [
      meta('m1', 'zj_read_doc', '正文/a.md'),
      meta('m2', 'zj_read_doc', '人物/阿七.md'),
      meta('m3', 'zj_search', '灯语')
    ]
    expect(isContinuedRead(msgs, 1)).toBe(false)
    expect(isContinuedRead(msgs, 2)).toBe(false)
  })

  it('越界/空/缺失参数安全返回 false', () => {
    expect(isContinuedRead([], 0)).toBe(false)
    expect(isContinuedRead([meta('m1', 'zj_read_doc')], 0)).toBe(false)
  })
})
