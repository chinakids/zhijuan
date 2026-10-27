// ===== useUnsavedGuard：正文页之外的「未保存守卫」单一实现（2026-10-27 体验层）=====
// 覆盖三条离开面（与 Novel.tsx 守卫同语义，只抽成可复用 hook）：
//   ① 页内切换（切文档 / 切素材 / 切章）—— confirmLeave() 三选确认后再切；
//   ② 路由离开（侧栏切页 / ⌘K / 系统菜单 / 回首页 / 切项目）—— useBlocker 拦截后弹同一弹窗；
//   ③ 关窗（beforeunload：窗口关闭 / ⌘W / 重载 / 退出 app）—— 取消关闭 + 弹同一弹窗。
// 行为口径：只在真有未保存改动时打扰（NN/g：确认过频成路障）；只有 doSave 明确返回 true 才放行离开，
// 被空写防线/IO 拦下时留在原地（内容未落盘，绝不静默丢弃）。
//
// 用法（宿主）：
//   const saveRef = useRef<(() => Promise<boolean>) | null>(null)
//   const guard = useUnsavedGuard({ subject: '这份设定', doSave: () => (saveRef.current ? saveRef.current() : false) })
//   <DocEditor ... saveHandleRef={saveRef} onDirtyChange={guard.reportDirty} />
//   async function selectDoc(rel) { if (!(await guard.confirmLeave('switch'))) return; guard.setDirty(false); setSel(rel) }
//   ... 根节点末尾 {guard.dialog}
import { createElement, useCallback, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { useBlocker, type BlockerFunction } from 'react-router-dom'
import UnsavedLeaveDialog from './UnsavedLeaveDialog'
import { createLeaveQueue, runLeaveChoice, shouldBlockUnload, type LeaveReason } from './unsavedGuardCore'

export interface UnsavedGuardOptions {
  /** 文案主语（如「这份设定」「这张素材卡」）；缺省「当前文档」 */
  subject?: string
  /**
   * 「保存并X」要调的保存动作，通常是 DocEditor 的 saveHandleRef.current 包装。
   * 返回 true=已落盘；false/undefined=被拦或失败（调用方留在原地）。缺省时「保存并X」置灰。
   */
  doSave?: () => Promise<boolean> | boolean
  /** 关窗守卫（beforeunload）；默认开 */
  guardBeforeUnload?: boolean
  /** 路由级离开守卫（useBlocker，须 data router）；默认开 */
  guardRoute?: boolean
}

export interface UnsavedGuard {
  /** 当前是否有未保存改动（宿主展示用） */
  dirty: boolean
  /** 同步可读的 dirty（供事件回调/守卫判定，避开渲染延迟） */
  dirtyRef: MutableRefObject<boolean>
  setDirty: (dirty: boolean) => void
  /** setDirty 的稳定别名，专供 DocEditor onDirtyChange（effect 依赖它，必须稳定） */
  reportDirty: (dirty: boolean) => void
  /** 页内离开前调用：无改动→直接 true；有改动→弹三选，true=可以继续（已保存或明确放弃） */
  confirmLeave: (reason?: LeaveReason) => Promise<boolean>
  /** 路由守卫是否处于拦截态（宿主自定义展示用；弹窗已由 dialog 提供） */
  blocked: boolean
  /** 三选确认弹窗节点（放在宿主组件根节点内） */
  dialog: ReactNode
}

export function useUnsavedGuard(opts: UnsavedGuardOptions = {}): UnsavedGuard {
  const { subject = '当前文档', guardBeforeUnload = true, guardRoute = true } = opts
  // doSave 每次渲染可能换身份（宿主内联箭头），经 ref 取最新，弹窗动作里不闭包旧值
  const doSaveRef = useRef(opts.doSave)
  doSaveRef.current = opts.doSave

  const [dirty, setDirtyState] = useState(false)
  const dirtyRef = useRef(false)
  const setDirty = useCallback((d: boolean) => {
    dirtyRef.current = d
    setDirtyState((prev) => (prev === d ? prev : d))
  }, [])
  const reportDirty = setDirty

  // 弹窗态：reason=null 即关闭
  const [reason, setReason] = useState<LeaveReason | null>(null)
  const reasonRef = useRef<LeaveReason | null>(null)
  reasonRef.current = reason
  const [saving, setSaving] = useState(false)
  // 已确认关闭（放行 beforeunload，避免 window.close() 被自身守卫二次拦下）
  const closeRef = useRef(false)
  const queueRef = useRef(createLeaveQueue())

  // 路由级守卫（与 Novel 同写法：只在有未保存改动且路径变化时拦）
  const routeBlocker = useBlocker(
    useCallback<BlockerFunction>(
      ({ currentLocation, nextLocation }) =>
        guardRoute && dirtyRef.current && currentLocation.pathname !== nextLocation.pathname,
      [guardRoute]
    )
  )
  const blocked = routeBlocker.state === 'blocked'

  // 路由被拦 → 直接呈现同一三选弹窗（文案用「离开」语义）
  useEffect(() => {
    if (!blocked) return
    setReason('leave')
  }, [blocked])

  // 关窗守卫：native prompt 在 Electron 不显示，故取消关闭并自绘三选（Novel 同款）
  useEffect(() => {
    if (!guardBeforeUnload) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!shouldBlockUnload(dirtyRef.current, closeRef.current)) return
      e.preventDefault()
      e.returnValue = '未保存的改动'
      setReason((r) => r ?? 'close')
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [guardBeforeUnload])

  // 宿主页内切换入口
  const confirmLeave = useCallback(async (r: LeaveReason = 'switch') => {
    if (!dirtyRef.current) return true
    setReason(r)
    return queueRef.current.ask()
  }, [])

  const closeDialog = useCallback(() => {
    setReason(null)
    setSaving(false)
  }, [])

  const onCancel = useCallback(() => {
    closeDialog()
    if (routeBlocker.state === 'blocked') routeBlocker.reset()
    queueRef.current.settle(false)
  }, [closeDialog, routeBlocker])

  const onDiscard = useCallback(() => {
    const r = reasonRef.current
    queueRef.current.settle(true)
    if (r === 'close') {
      // 显式「不保存关闭」：先放行 beforeunload 再关窗
      closeRef.current = true
      closeDialog()
      window.close()
      return
    }
    closeDialog()
    if (routeBlocker.state === 'blocked') routeBlocker.proceed()
  }, [closeDialog, routeBlocker])

  const onSave = useCallback(async () => {
    const r = reasonRef.current
    setSaving(true)
    const ok = await runLeaveChoice('save', doSaveRef.current)
    setSaving(false)
    if (!ok) {
      // 保存被拦/失败：内容未落盘 → 留在原地。路由态保持弹窗（可重试）；页内切换收起弹窗停在当前文档
      if (!blocked) {
        closeDialog()
        queueRef.current.settle(false)
      }
      return
    }
    queueRef.current.settle(true)
    if (r === 'close') {
      closeRef.current = true
      closeDialog()
      window.close()
      return
    }
    closeDialog()
    if (routeBlocker.state === 'blocked') routeBlocker.proceed()
  }, [blocked, closeDialog, routeBlocker])

  // 弹窗节点：本文件是 .ts（宿主 import 路径不带扩展名），用 createElement 而非 JSX
  const dialog = createElement(UnsavedLeaveDialog, {
    open: reason !== null,
    reason: reason ?? 'switch',
    subject,
    saving,
    canSave: !!opts.doSave,
    onCancel,
    onDiscard,
    onSave: () => void onSave()
  })

  return { dirty, dirtyRef, setDirty, reportDirty, confirmLeave, blocked, dialog }
}

export default useUnsavedGuard
export type { LeaveReason } from './unsavedGuardCore'