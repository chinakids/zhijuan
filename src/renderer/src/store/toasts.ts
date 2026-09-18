import { create } from 'zustand'

/** 全局轻量 Toast（织卷自研，zustand 单例，零新依赖）。
 * 设计参照 shadcn/Base UI Toast 的 api：add / update / dismiss，类型 success·info·warning·error·loading，
 * 自动消失（可暂停于 hover），栈上限 MAX，加载类不自动消失。 */
export type ToastKind = 'success' | 'info' | 'warning' | 'error' | 'loading'

/** toast 内嵌操作按钮（参照 sonner toast.action 的成熟模式：错误类 toast 挂就地重试/跳转动作） */
export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastItem {
  id: number
  kind: ToastKind
  title: string
  description?: string
  /** 可展开的完整明细（渐进披露二级，默认折叠；与 GuardIssuesNote「摘要常显、明细按需一层展开」同构——2026-09-18 创作层） */
  detail?: string
  /** 内嵌操作按钮（可选；弹层存活期间一直可点，不随自动消失时序处理） */
  action?: ToastAction | null
  /** 实际生效的自动消失毫秒数；0 = 不自动消失（loading 默认；带 action 的 toast 同此口径——常驻到用户操作/手动关闭） */
  duration: number
  createdAt: number
  /** 退场中（已触发 dismiss，播退出动画，LEAVE_MS 后真正移除） */
  leaving?: boolean
}

/** 退出动画时长（与 V-08 动效基线 150ms 同口径；reduced-motion 下动画被关，仍照常延迟移除） */
export const LEAVE_MS = 150

export interface ToastInput {
  kind?: ToastKind
  title: string
  description?: string
  /** 可展开的完整明细（默认折叠；传 undefined 清空——update 浅合并下必须显式清除） */
  detail?: string
  /** 内嵌操作按钮（可选） */
  action?: ToastAction | null
  duration?: number
}

export const MAX_TOASTS = 4

/** 各类型的默认停留时长：错误更长，加载类常驻直到被 update/dismiss */
export const DEFAULT_DURATION: Record<ToastKind, number> = {
  success: 6000,
  info: 6000,
  warning: 8000,
  error: 10000,
  loading: 0
}

/** 最终生效时长：带 action 的 toast 不自动消失（常驻，仅手动关/update 收尾）——VS Code「带 action 的失败通知」建议 + sonner duration:Infinity 同口径；
 * 无 action 时按调用方显式 duration ?? 类型默认。 */
export function effDuration(kind: ToastKind, duration: number | undefined, hasAction: boolean): number {
  if (hasAction) return 0
  return duration ?? DEFAULT_DURATION[kind]
}

let seq = 1
interface LiveTimer {
  handle: ReturnType<typeof setTimeout> | null
  left: number
  by: number
}
const timers = new Map<number, LiveTimer>()
const paused = new Set<number>()
/** 退场延迟定时器：dismiss 标记 leaving → LEAVE_MS 后真正 _remove */
const leavingTimers = new Map<number, ReturnType<typeof setTimeout>>()

function stop(id: number) {
  const t = timers.get(id)
  if (t?.handle != null) {
    clearTimeout(t.handle)
    t.handle = null
  }
}

function arm(id: number, ms: number) {
  const t = timers.get(id) ?? { handle: null, left: ms, by: Date.now() }
  stop(id)
  if (ms <= 0) {
    t.left = 0
    timers.set(id, t)
    return
  }
  t.left = ms
  t.by = Date.now()
  t.handle = setTimeout(() => dismiss(id), ms)
  timers.set(id, t)
}

export function dismiss(id: number) {
  stop(id)
  timers.delete(id)
  paused.delete(id)
  const cur = useToastsStore.getState().toasts.find((t) => t.id === id)
  if (!cur || cur.leaving) return
  // 先标记退场（播退出动画），LEAVE_MS 后真正移除；重复 dismiss 幂等
  useToastsStore.getState()._markLeaving(id)
  const handle = setTimeout(() => {
    leavingTimers.delete(id)
    useToastsStore.getState()._remove(id)
  }, LEAVE_MS)
  leavingTimers.set(id, handle)
}

interface ToastsState {
  toasts: ToastItem[]
  add: (input: ToastInput) => number
  update: (id: number, patch: Partial<Pick<ToastItem, 'kind' | 'title' | 'description' | 'detail' | 'action' | 'duration'>>) => void
  dismiss: (id: number) => void
  /** hover 暂停（其余时间继续计） */
  pause: (id: number) => void
  resume: (id: number) => void
  clear: () => void
  _markLeaving: (id: number) => void
  _remove: (id: number) => void
}

export const useToastsStore = create<ToastsState>((set, get) => ({
  toasts: [],
  add: (input) => {
    const kind = input.kind ?? 'info'
    // 带 action 的 toast 常驻（不自动消失），显式 duration 仅对无 action 生效
    const duration = effDuration(kind, input.duration, Boolean(input.action))
    const id = seq++
    const toast: ToastItem = { id, kind, title: input.title, description: input.description, detail: input.detail, action: input.action ?? null, duration, createdAt: Date.now() }
    const cur = get().toasts
    // 栈上限：挤掉最旧的一条（leaving 中的不占位、不重复挤）
    const active = cur.filter((t) => !t.leaving)
    if (active.length >= MAX_TOASTS) dismiss(active[0].id)
    set((s) => ({ toasts: [...s.toasts, toast] }))
    if (duration > 0) arm(id, duration)
    return id
  },
  update: (id, patch) => {
    const cur = get().toasts.find((t) => t.id === id)
    // 类型/时长/action（action 存在 ⇔ 常驻）变化才重排计时；标题描述变化不打扰倒计时
    const reTime = patch.kind !== undefined || patch.duration !== undefined || patch.action !== undefined
    const hasAction = patch.action !== undefined ? Boolean(patch.action) : Boolean(cur?.action)
    const kind = patch.kind ?? cur?.kind ?? 'info'
    // duration 字段同步成实际生效值（原实现只重排计时器、字段停留旧值——带 action 常驻口径下会失真）
    const duration = reTime ? effDuration(kind, patch.duration, hasAction) : (cur?.duration ?? 0)
    set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, ...patch, duration } : t)) }))
    if (!reTime || !cur) return
    if (paused.has(id)) {
      // 悬停中：常驻类（duration 0）移出计时器（resume 不再误退场），否则改好剩余时长恢复时再启
      if (duration > 0) timers.set(id, { handle: null, left: duration, by: Date.now() })
      else timers.delete(id)
      return
    }
    if (duration > 0) arm(id, duration)
    else {
      stop(id)
      timers.delete(id)
    }
  },
  dismiss,
  pause: (id) => {
    const t = timers.get(id)
    if (!t || paused.has(id)) return
    if (t.handle != null) {
      clearTimeout(t.handle)
      t.handle = null
      t.left = Math.max(0, t.left - (Date.now() - t.by))
    }
    paused.add(id)
  },
  resume: (id) => {
    if (!paused.delete(id)) return
    const t = timers.get(id)
    if (!t) return
    const cur = get().toasts.find((x) => x.id === id)
    // 常驻类（loading / 带 action，duration=0）：悬停恢复不因 left=0 误退场，保持常驻
    if (cur && cur.duration <= 0) {
      timers.delete(id)
      return
    }
    if (t.left <= 0) dismiss(id)
    else arm(id, t.left)
  },
  clear: () => {
    for (const id of [...useToastsStore.getState().toasts.map((t) => t.id)]) dismiss(id)
  },
  _markLeaving: (id) => set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)) })),
  _remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))

/** 供外部（含页面组件）使用的单例 API */
export const toast = {
  add: (input: ToastInput) => useToastsStore.getState().add(input),
  update: (id: number, patch: Parameters<ToastsState['update']>[1]) => useToastsStore.getState().update(id, patch),
  dismiss: (id: number) => dismiss(id),
  clear: () => useToastsStore.getState().clear()
}

/** 测试用：复位全部状态（清计时器与队列） */
export function resetToastsForTest() {
  // 测试复位：直接清空（不走 dismiss 的退场动画，避免 fake timers 下残留）
  useToastsStore.setState({ toasts: [] })
  seq = 1
  paused.clear()
  timers.clear()
  for (const h of leavingTimers.values()) clearTimeout(h)
  leavingTimers.clear()
}
