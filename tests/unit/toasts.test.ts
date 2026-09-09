import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_TOASTS,
  resetToastsForTest,
  toast,
  useToastsStore
} from '../../src/renderer/src/store/toasts'

beforeEach(() => {
  vi.useFakeTimers()
  resetToastsForTest()
})
afterEach(() => {
  resetToastsForTest()
  vi.useRealTimers()
})

const titles = () => useToastsStore.getState().toasts.map((t) => t.title)

describe('toasts 全局通知（自研轻量）', () => {
  it('add 入栈：默认类型 info，duration 按类型默认', () => {
    const id = toast.add({ title: '提示' })
    expect(id).toBeGreaterThan(0)
    const t = useToastsStore.getState().toasts.find((x) => x.id === id)
    expect(t?.kind).toBe('info')
    expect(t?.duration).toBeGreaterThan(0)
  })

  it('成功类默认 6s 自动消失；loading 不自动消失', () => {
    toast.add({ kind: 'success', title: 'done' })
    expect(useToastsStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(6000)
    expect(useToastsStore.getState().toasts).toHaveLength(0)

    toast.add({ kind: 'loading', title: 'running' })
    vi.advanceTimersByTime(60000)
    expect(useToastsStore.getState().toasts).toHaveLength(1)
  })

  it('栈上限：超出挤掉最旧', () => {
    for (let i = 1; i <= MAX_TOASTS + 1; i++) toast.add({ title: 't' + i })
    const titlesNow = titles()
    expect(useToastsStore.getState().toasts).toHaveLength(MAX_TOASTS)
    expect(titlesNow).not.toContain('t1')
    expect(titlesNow).toContain('t' + (MAX_TOASTS + 1))
  })

  it('dismiss 手动关闭（含计时器清理）', () => {
    const id = toast.add({ kind: 'warning', title: 'w' })
    toast.dismiss(id)
    expect(useToastsStore.getState().toasts).toHaveLength(0)
    // 已关闭的 toast 不应再被定时器移除时报错
    vi.advanceTimersByTime(10000)
    expect(useToastsStore.getState().toasts).toHaveLength(0)
  })

  it('update 从 loading 转成功会重启计时并生效', () => {
    const id = toast.add({ kind: 'loading', title: '生成中' })
    expect(titles()).toEqual(['生成中'])
    toast.update(id, { kind: 'success', title: '完成' })
    const t = useToastsStore.getState().toasts.find((x) => x.id === id)
    expect(t?.kind).toBe('success')
    // success 默认 6s 后自动消失
    vi.advanceTimersByTime(5999)
    expect(useToastsStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(useToastsStore.getState().toasts).toHaveLength(0)
  })

  it('pause/resume：悬停暂停倒计时，离开继续', () => {
    const id = toast.add({ kind: 'success', title: 'hover me' })
    const st = useToastsStore.getState()
    st.pause(id)
    vi.advanceTimersByTime(20000)
    expect(useToastsStore.getState().toasts).toHaveLength(1)
    st.resume(id)
    vi.advanceTimersByTime(6000)
    expect(useToastsStore.getState().toasts).toHaveLength(0)
  })

  it('clear 清空全部', () => {
    toast.add({ title: 'a' })
    toast.add({ kind: 'error', title: 'b' })
    toast.clear()
    expect(useToastsStore.getState().toasts).toHaveLength(0)
  })
})
