import { describe, expect, it } from 'vitest'
import { groupToolMeta, isContinuedRead, parseToolFile, summarizeGroup } from '../../src/renderer/src/features/agent/toolChain'

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

describe('summarizeGroup（链组聚合摘要）', () => {
  const doneOk = (id: string, elapsedMs?: number, content?: string) => ({ id, tool: 'zj_read_doc', done: true, toolOk: true, elapsedMs, content })
  const doneFail = (id: string, elapsedMs?: number, content?: string) => ({ id, tool: 'zj_read_doc', done: true, toolOk: false, elapsedMs, content })

  it('少于 2 步返回 undefined（单卡无聚合语义）', () => {
    expect(summarizeGroup([doneOk('m1')])).toBeUndefined()
    expect(summarizeGroup([])).toBeUndefined()
  })

  it('全成功：无失败无取消，耗时=合计', () => {
    const agg = summarizeGroup([doneOk('m1', 100, 'a'), doneOk('m2', 250, 'b'), doneOk('m3', 50, 'c')])
    expect(agg).toEqual({ hasFailed: false, hasCancelled: false, summary: undefined, elapsedMs: 400, count: 3 })
  })

  it('组内尾步失败：hasFailed=true 且摘要取首个失败步内容', () => {
    const agg = summarizeGroup([doneOk('m1', 100, 'a'), doneOk('m2', 200, 'b'), doneFail('m3', 300, '读取失败：文件已被外部修改')])
    expect(agg?.hasFailed).toBe(true)
    expect(agg?.hasCancelled).toBe(false)
    expect(agg?.summary).toBe('读取失败：文件已被外部修改')
    expect(agg?.elapsedMs).toBe(600)
  })

  it('组内首步失败：摘要取首步内容', () => {
    const agg = summarizeGroup([doneFail('m1', 100, 'ENOENT'), doneOk('m2', 200, 'b')])
    expect(agg?.hasFailed).toBe(true)
    expect(agg?.summary).toBe('ENOENT')
  })

  it('组内任一步取消且无失败：hasCancelled=true；有失败则失败优先', () => {
    const cancelled = { id: 'm2', tool: 'zj_read_doc', cancelled: true }
    expect(summarizeGroup([doneOk('m1', 100, 'a'), cancelled])?.hasCancelled).toBe(true)
    expect(summarizeGroup([doneOk('m1', 100, 'a'), doneFail('m2', 100, 'err'), cancelled])?.hasCancelled).toBe(false)
    expect(summarizeGroup([doneOk('m1', 100, 'a'), doneFail('m2', 100, 'err'), cancelled])?.hasFailed).toBe(true)
  })

  it('无任何耗时数据：elapsedMs=undefined（旧事件无字段不误显示 0）', () => {
    const agg = summarizeGroup([doneOk('m1'), doneOk('m2')])
    expect(agg?.elapsedMs).toBeUndefined()
  })

  it('部分步骤有耗时：只累计有值部分', () => {
    const agg = summarizeGroup([doneOk('m1', 100, 'a'), doneOk('m2'), { id: 'm3', tool: 'zj_read_doc', done: true, toolOk: true, elapsedMs: 50, content: 'c' }])
    expect(agg?.elapsedMs).toBe(150)
  })
})
