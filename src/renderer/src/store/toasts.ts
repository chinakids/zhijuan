import { create } from 'zustand'

/** 全局轻量 Toast（织卷自研，zustand 单例，零新依赖）。
 * 设计参照 shadcn/Base UI Toast 的 api：add / update / dismiss，类型 success·info·warning·error·loading，
 * 自动消失（可暂停于 hover），栈上限 MAX，加载类不自动消失。 */
export type ToastKind = 'success' | 'info' | 'warning' | 'error' | 'loading'

export interface ToastItem {
  id: number
  kind: ToastKind
  title: string
  description?: string
  /** 自动消失毫秒数；0 = 不自动消失（loading 默认） */
  duration: number
  createdAt: number
}

export interface ToastInput {
  kind?: ToastKind
  title: string
  description?: string
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

let seq = 1
interface LiveTimer {
  handle: ReturnType<typeof setTimeout> | null
  left: number
  by: number
}
const timers = new Map<number, LiveTimer>()
const paused = new Set<number>()

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
  useToastsStore.getState()._remove(id)
}

interface ToastsState {
  toasts: ToastItem[]
  add: (input: ToastInput) => number
  update: (id: number, patch: Partial<Pick<ToastItem, 'kind' | 'title' | 'description' | 'duration'>>) => void
  dismiss: (id: number) => void
  /** hover 暂停（其余时间继续计） */
  pause: (id: number) => void
  resume: (id: number) => void
  clear: () => void
  _remove: (id: number) => void
}

export const useToastsStore = create<ToastsState>((set, get) => ({
  toasts: [],
  add: (input) => {
    const kind = input.kind ?? 'info'
    const duration = input.duration ?? DEFAULT_DURATION[kind]
    const id = seq++
    const toast: ToastItem = { id, kind, title: input.title, description: input.description, duration, createdAt: Date.now() }
    const cur = get().toasts
    // 栈上限：挤掉最旧的一条
    if (cur.length >= MAX_TOASTS) dismiss(cur[0].id)
    set((s) => ({ toasts: [...s.toasts, toast] }))
    if (duration > 0) arm(id, duration)
    return id
  },
  update: (id, patch) => {
    set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
    // 仅类型/时长变化才重排计时（标题描述变化不打扰倒计时）
    if (patch.kind !== undefined || patch.duration !== undefined) {
      const cur = get().toasts.find((t) => t.id === id)
      const duration = patch.duration ?? (cur ? DEFAULT_DURATION[cur.kind] : 0)
      if (paused.has(id)) {
        // 悬停中：改好剩余时长，恢复时再启
        timers.set(id, { handle: null, left: duration, by: Date.now() })
        return
      }
      if (duration > 0) arm(id, duration)
      else stop(id)
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
    if (t.left <= 0) dismiss(id)
    else arm(id, t.left)
  },
  clear: () => {
    for (const id of [...useToastsStore.getState().toasts.map((t) => t.id)]) dismiss(id)
  },
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
  useToastsStore.getState().clear()
  seq = 1
  paused.clear()
  timers.clear()
}
