import { describe, expect, it } from 'vitest'
import { createStreamBuffer } from '../../src/shared/streamBuffer'

const schedule = (cb: () => void) => setImmediate(cb)
const cancel = () => {}

describe('streamBuffer', () => {
  it('高频 push 只触发一次 flush，且内容按序完整拼接', async () => {
    const calls: string[] = []
    const buf = createStreamBuffer((t) => calls.push(t), schedule, cancel)
    buf.push('思考第')
    buf.push('一段')
    buf.push('……')
    expect(calls).toEqual([]) // 尚未调度执行
    await new Promise((r) => setImmediate(r))
    expect(calls).toEqual(['思考第一段……'])
  })

  it('flushNow 立即冲刷残余并取消已调度（不重复触发）', async () => {
    const calls: string[] = []
    const buf = createStreamBuffer((t) => calls.push(t), schedule, cancel)
    buf.push('a')
    buf.push('b')
    buf.flushNow()
    expect(calls).toEqual(['ab'])
    await new Promise((r) => setImmediate(r))
    expect(calls).toEqual(['ab']) // 已调度回调被取消，不再触发
  })

  it('多轮 push+flushNow：增量独立结算，不丢不重', () => {
    const calls: string[] = []
    const buf = createStreamBuffer((t) => calls.push(t), schedule, cancel)
    buf.push('1')
    buf.flushNow()
    buf.push('2')
    buf.push('3')
    buf.flushNow()
    expect(calls).toEqual(['1', '23'])
  })

  it('无残余时 flushNow 不调用 flush', () => {
    const calls: string[] = []
    const buf = createStreamBuffer((t) => calls.push(t), schedule, cancel)
    buf.flushNow()
    expect(calls).toEqual([])
  })
})
