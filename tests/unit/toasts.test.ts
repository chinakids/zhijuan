import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_DURATION,
  LEAVE_MS,
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

  it('成功类默认 6s 自动消失（先 leaving 后移除）；loading 不自动消失', () => {
    toast.add({ kind: 'success', title: 'done' })
    expect(useToastsStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(6000)
    // 到点 → 标记退场（播退出动画），LEAVE_MS 后真正移除
    expect(useToastsStore.getState().toasts).toHaveLength(1)
    expect(useToastsStore.getState().toasts[0].leaving).toBe(true)
    vi.advanceTimersByTime(LEAVE_MS)
    expect(useToastsStore.getState().toasts).toHaveLength(0)

    toast.add({ kind: 'loading', title: 'running' })
    vi.advanceTimersByTime(60000)
    expect(useToastsStore.getState().toasts).toHaveLength(1)
  })

  it('栈上限：超出挤掉最旧（leaving 中不占位）', () => {
    for (let i = 1; i <= MAX_TOASTS + 1; i++) toast.add({ title: 't' + i })
    const titlesNow = titles()
    // t1 进入退场（仍在数组里供动画），其余 4 条可见
    expect(useToastsStore.getState().toasts.filter((t) => !t.leaving)).toHaveLength(MAX_TOASTS)
    expect(titlesNow).toContain('t1')
    expect(useToastsStore.getState().toasts.find((t) => t.title === 't1')?.leaving).toBe(true)
    expect(titlesNow).toContain('t' + (MAX_TOASTS + 1))
    vi.advanceTimersByTime(LEAVE_MS)
    expect(titles()).not.toContain('t1')
  })

  it('dismiss 手动关闭：标记 leaving → LEAVE_MS 后移除（含计时器清理）', () => {
    const id = toast.add({ kind: 'warning', title: 'w' })
    toast.dismiss(id)
    expect(useToastsStore.getState().toasts).toHaveLength(1)
    expect(useToastsStore.getState().toasts[0].leaving).toBe(true)
    vi.advanceTimersByTime(LEAVE_MS)
    expect(useToastsStore.getState().toasts).toHaveLength(0)
    // 已关闭的 toast 不应再被定时器移除时报错
    vi.advanceTimersByTime(10000)
    expect(useToastsStore.getState().toasts).toHaveLength(0)
  })

  it('dismiss 幂等：重复 dismiss 不重复安排退场', () => {
    const id = toast.add({ kind: 'info', title: 'dup' })
    toast.dismiss(id)
    toast.dismiss(id)
    expect(useToastsStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(LEAVE_MS)
    expect(useToastsStore.getState().toasts).toHaveLength(0)
    vi.advanceTimersByTime(LEAVE_MS * 10)
    expect(useToastsStore.getState().toasts).toHaveLength(0)
  })

  it('update 从 loading 转成功会重启计时并生效', () => {
    const id = toast.add({ kind: 'loading', title: '生成中' })
    expect(titles()).toEqual(['生成中'])
    toast.update(id, { kind: 'success', title: '完成' })
    const t = useToastsStore.getState().toasts.find((x) => x.id === id)
    expect(t?.kind).toBe('success')
    // success 默认 6s 后自动消失（先 leaving 后移除）
    vi.advanceTimersByTime(5999)
    expect(useToastsStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(useToastsStore.getState().toasts).toHaveLength(1)
    expect(useToastsStore.getState().toasts[0].leaving).toBe(true)
    vi.advanceTimersByTime(LEAVE_MS)
    expect(useToastsStore.getState().toasts).toHaveLength(0)
  })

  it('action 内嵌操作按钮：add 携带、update 可替换/清除（null），onClick 可执行', () => {
    let clicked = 0
    const id = toast.add({
      kind: 'error',
      title: '切片同步失败',
      description: '模型跑偏',
      action: {
        label: '重试同步',
        onClick: () => {
          clicked++
        }
      }
    })
    let t = useToastsStore.getState().toasts.find((x) => x.id === id)
    expect(t?.action?.label).toBe('重试同步')
    t?.action?.onClick()
    expect(clicked).toBe(1)
    // update 换 action
    toast.update(id, { action: { label: '再试', onClick: () => void 0 } })
    t = useToastsStore.getState().toasts.find((x) => x.id === id)
    expect(t?.action?.label).toBe('再试')
    // update 清除 action（重试中先摘按钮）
    toast.update(id, { kind: 'loading', title: '重试中', action: null })
    t = useToastsStore.getState().toasts.find((x) => x.id === id)
    expect(t?.action).toBeNull()
    expect(t?.kind).toBe('loading')
  })

  it('带 action 的 toast 常驻：不自动消失（duration 0），手动 dismiss 才退场', () => {
    const id = toast.add({
      kind: 'error',
      title: '切片同步失败',
      action: { label: '重试同步', onClick: () => void 0 }
    })
    expect(useToastsStore.getState().toasts.find((x) => x.id === id)?.duration).toBe(0)
    // 远超 error 默认 10s 仍在（VS Code「带 action 的失败通知」建议口径）
    vi.advanceTimersByTime(30000)
    expect(useToastsStore.getState().toasts).toHaveLength(1)
    expect(useToastsStore.getState().toasts[0].leaving).toBeUndefined()
    toast.dismiss(id)
    vi.advanceTimersByTime(LEAVE_MS)
    expect(useToastsStore.getState().toasts).toHaveLength(0)
  })

  it('update 移除 action（收尾成功）→ 恢复类型默认自动消失', () => {
    const id = toast.add({
      kind: 'error',
      title: '切片同步失败',
      action: { label: '重试同步', onClick: () => void 0 }
    })
    toast.update(id, { kind: 'success', title: '切片同步完成', action: null })
    const t = useToastsStore.getState().toasts.find((x) => x.id === id)
    expect(t?.action).toBeNull()
    expect(t?.duration).toBe(DEFAULT_DURATION.success)
    vi.advanceTimersByTime(5999)
    expect(useToastsStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(useToastsStore.getState().toasts[0].leaving).toBe(true)
    vi.advanceTimersByTime(LEAVE_MS)
    expect(useToastsStore.getState().toasts).toHaveLength(0)
  })

  it('update 给无 action 的 toast 挂 action → 转常驻（现有计时停止）', () => {
    const id = toast.add({ kind: 'warning', title: 'w' })
    vi.advanceTimersByTime(3000)
    expect(useToastsStore.getState().toasts).toHaveLength(1)
    toast.update(id, { action: { label: '重试同步', onClick: () => void 0 } })
    expect(useToastsStore.getState().toasts.find((x) => x.id === id)?.duration).toBe(0)
    vi.advanceTimersByTime(60000)
    expect(useToastsStore.getState().toasts).toHaveLength(1)
    expect(useToastsStore.getState().toasts[0].leaving).toBeUndefined()
    // 仅 action 变化（kind 不变）也重排计时——再次挂 action 保持常驻
    toast.update(id, { action: { label: '再试', onClick: () => void 0 } })
    vi.advanceTimersByTime(60000)
    expect(useToastsStore.getState().toasts).toHaveLength(1)
  })

  it('悬停暂停中 update 成常驻类（loading/带 action）→ 恢复不误退场', () => {
    const id = toast.add({ kind: 'error', title: '失败' })
    const st = useToastsStore.getState()
    st.pause(id)
    // 悬停中重试：摘 action 转 loading（常驻）
    toast.update(id, { kind: 'loading', title: '重试中', action: null })
    st.resume(id)
    // 常驻类恢复后不应被立即 dismiss（left=0 误判防护）
    expect(useToastsStore.getState().toasts).toHaveLength(1)
    expect(useToastsStore.getState().toasts[0].leaving).toBeUndefined()
    vi.advanceTimersByTime(60000)
    expect(useToastsStore.getState().toasts).toHaveLength(1)
  })

  it('pause/resume：悬停暂停倒计时，离开继续', () => {
    const id = toast.add({ kind: 'success', title: 'hover me' })
    const st = useToastsStore.getState()
    st.pause(id)
    vi.advanceTimersByTime(20000)
    expect(useToastsStore.getState().toasts).toHaveLength(1)
    st.resume(id)
    vi.advanceTimersByTime(6000)
    expect(useToastsStore.getState().toasts).toHaveLength(1)
    expect(useToastsStore.getState().toasts[0].leaving).toBe(true)
    vi.advanceTimersByTime(LEAVE_MS)
    expect(useToastsStore.getState().toasts).toHaveLength(0)
  })

  it('detail 明细：add 透传、update 可保留/显式清除（渐进披露二级，与 description 独立）', () => {
    const id = toast.add({ kind: 'success', title: '切片同步', description: '（拦截 3 条）', detail: '已纠正 人物/沈眠.md：原因\n已丢弃 人物/新角色1.md：尚未建档' })
    const t = useToastsStore.getState().toasts.find((x) => x.id === id)
    expect(t?.detail).toContain('已纠正 人物/沈眠.md')
    // update 不带 detail → 浅合并保留
    toast.update(id, { title: '切片同步完成' })
    expect(useToastsStore.getState().toasts.find((x) => x.id === id)?.detail).toContain('已丢弃')
    // update 显式 detail: undefined → 清除（语义收尾后不再有明细块）
    toast.update(id, { description: '已为 2 名人物建档案', detail: undefined, action: null })
    const t2 = useToastsStore.getState().toasts.find((x) => x.id === id)
    expect(t2?.detail).toBeUndefined()
    expect(t2?.description).toBe('已为 2 名人物建档案')
  })

  it('clear 清空全部（走退场动画后移除）', () => {
    toast.add({ title: 'a' })
    toast.add({ kind: 'error', title: 'b' })
    toast.clear()
    expect(useToastsStore.getState().toasts).toHaveLength(2)
    expect(useToastsStore.getState().toasts.every((t) => t.leaving)).toBe(true)
    vi.advanceTimersByTime(LEAVE_MS)
    expect(useToastsStore.getState().toasts).toHaveLength(0)
  })
})
