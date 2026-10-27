import { describe, expect, it, vi } from 'vitest'
import {
  createLeaveQueue,
  leaveCopy,
  runLeaveChoice,
  shouldBlockUnload
} from '../../src/renderer/src/features/editor/unsavedGuardCore'

// 未保存守卫纯逻辑（2026-10-27 体验层）：三处宿主（DocSection/LibraryBrowser/Outline）共用，
// 这里锁住最容易漂移的三件事：文案三选、保存结果归一、待决队列的结算唯一性。
describe('leaveCopy（三选文案：与 Novel 切章/关窗/路由守卫同句同调）', () => {
  it('切文档：切换后将丢失 / 保存并切换 / 不保存切换', () => {
    const t = leaveCopy('switch', '这份设定')
    expect(t.title).toBe('有未保存的改动')
    expect(t.description).toBe('这份设定有未保存的内容，切换后将丢失。')
    expect(t.saveLabel).toBe('保存并切换')
    expect(t.discardLabel).toBe('不保存切换')
  })

  it('离开页面：离开后将丢失 / 保存并离开 / 不保存离开', () => {
    const t = leaveCopy('leave', '这张章卡')
    expect(t.description).toBe('这张章卡有未保存的内容，离开后将丢失。')
    expect(t.saveLabel).toBe('保存并离开')
    expect(t.discardLabel).toBe('不保存离开')
  })

  it('关窗：关闭窗口后将丢失 / 保存并关闭 / 不保存关闭；缺省主语为「当前文档」', () => {
    const t = leaveCopy('close')
    expect(t.description).toBe('当前文档有未保存的内容，关闭窗口后将丢失。')
    expect(t.saveLabel).toBe('保存并关闭')
    expect(t.discardLabel).toBe('不保存关闭')
  })
})

describe('runLeaveChoice（只有明确落盘才放行离开）', () => {
  it('取消 → false（留在原处）', async () => {
    const doSave = vi.fn(() => true)
    expect(await runLeaveChoice('cancel', doSave)).toBe(false)
    expect(doSave).not.toHaveBeenCalled()
  })

  it('不保存 → true（用户显式放弃，不调保存）', async () => {
    const doSave = vi.fn(() => true)
    expect(await runLeaveChoice('discard', doSave)).toBe(true)
    expect(doSave).not.toHaveBeenCalled()
  })

  it('保存并X：doSave 返回 true → true', async () => {
    expect(await runLeaveChoice('save', async () => true)).toBe(true)
  })

  it('保存被空写防线/IO 拦下（false）→ false：宿主须留在原文档', async () => {
    expect(await runLeaveChoice('save', async () => false)).toBe(false)
  })

  it('编辑器未就绪（undefined）→ false：不把「没存」当「存过了」', async () => {
    expect(await runLeaveChoice('save', () => undefined as unknown as boolean)).toBe(false)
  })

  it('doSave 抛错 → false（不冒泡中断守卫）', async () => {
    expect(
      await runLeaveChoice('save', () => {
        throw new Error('write failed')
      })
    ).toBe(false)
  })

  it('没有保存通道（宿主未传 doSave）→ false', async () => {
    expect(await runLeaveChoice('save', undefined)).toBe(false)
  })
})

describe('shouldBlockUnload（关窗守卫：已确认关闭或无改动时零打扰）', () => {
  it('有改动且未确认关闭 → 拦', () => {
    expect(shouldBlockUnload(true, false)).toBe(true)
  })
  it('已确认关闭 → 放行（防 window.close() 被自身再拦）', () => {
    expect(shouldBlockUnload(true, true)).toBe(false)
  })
  it('无改动 → 放行', () => {
    expect(shouldBlockUnload(false, false)).toBe(false)
  })
})

describe('createLeaveQueue（待决三选：连点时旧请求按取消结算，Promise 不悬空）', () => {
  it('settle(true) 结算为可继续离开', async () => {
    const q = createLeaveQueue()
    const p = q.ask()
    expect(q.pending).toBe(true)
    q.settle(true)
    expect(await p).toBe(true)
    expect(q.pending).toBe(false)
  })

  it('settle(false) 结算为「留下」', async () => {
    const q = createLeaveQueue()
    const p = q.ask()
    q.settle(false)
    expect(await p).toBe(false)
  })

  it('重复 settle 只生效一次（幂等，无待决时是空操作）', async () => {
    const q = createLeaveQueue()
    const p = q.ask()
    q.settle(true)
    q.settle(false)
    expect(await p).toBe(true)
    expect(q.pending).toBe(false)
    expect(() => q.settle(true)).not.toThrow()
  })

  it('第二次 ask 把上一个请求按「取消」结算（连点不卡死宿主）', async () => {
    const q = createLeaveQueue()
    const first = q.ask()
    const second = q.ask()
    expect(await first).toBe(false)
    q.settle(true)
    expect(await second).toBe(true)
  })
})