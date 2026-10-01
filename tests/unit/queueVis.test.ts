import { describe, expect, it } from 'vitest'
import { collectQueued, newQid, removeQueuedByQid } from '../../src/renderer/src/features/agent/queueVis'
import type { CmdQueued, MsgQueued } from '../../src/renderer/src/features/agent/queueVis'

// 排队条目可视化纯函数（体验层 2026-10-01）：只读组装配对 + 按 qid 移除，不改排队机制/drain。
describe('queueVis 排队条目可视化', () => {
  const msg = (qid: string, raw: string, project: string): MsgQueued => ({ qid, raw, project })
  const cmd = (qid: string, raw: string, projectId: string): CmdQueued => ({ qid, raw, projectId })

  it('collectQueued 只收集当前项目条目、消息在前命令在后（与 drain 顺序一致）', () => {
    const mq: MsgQueued[] = [
      msg('m1', '继续。', 'p1'),
      msg('m2', '排给别的项目', 'p2')
    ]
    const cq: CmdQueued[] = [
      cmd('c1', '/巡查 本章', 'p1'),
      cmd('c2', '/导演', 'p2')
    ]
    const r = collectQueued(mq, cq, 'p1')
    expect(r.map((x) => [x.qid, x.kind, x.text])).toEqual([
      ['m1', 'msg', '继续。'],
      ['c1', 'cmd', '/巡查 本章']
    ])
  })

  it('collectQueued 无匹配条目返回空数组', () => {
    expect(collectQueued([], [], 'p1')).toEqual([])
  })

  it('removeQueuedByQid 移除命中条目并返回它、未命中返回 undefined', () => {
    const arr = [msg('a', 'x', 'p1'), msg('b', 'y', 'p1')]
    expect(removeQueuedByQid(arr, 'b')?.qid).toBe('b')
    expect(arr.map((x) => x.qid)).toEqual(['a'])
    expect(removeQueuedByQid(arr, 'nope')).toBeUndefined()
    expect(arr.map((x) => x.qid)).toEqual(['a'])
  })

  it('newQid 生成非空唯一 id', () => {
    const a = newQid()
    const b = newQid()
    expect(a.length).toBeGreaterThan(4)
    expect(a).not.toBe(b)
  })
})
