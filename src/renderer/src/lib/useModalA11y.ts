import { useEffect, useRef, type RefObject } from 'react'

/**
 * 自研模态（抽屉/浮层）无障碍三件套（Apple HIG Keyboards「Support Full Keyboard Access」＋
 * WAI-ARIA dialog 焦点管理；对齐 macOS 对话框惯例：焦点在对话框内循环、Esc 取消）：
 *  - 打开时：记录触发源，初始聚焦面板内第一个可聚焦元素（无则聚焦面板容器，需 tabIndex={-1}）；
 *  - Tab / Shift+Tab 在面板内循环圈闭；
 *  - Escape 调用 onClose（不 stopPropagation，让既有全局监听各按职责处理，不破坏查找条等行为）；
 *  - body 滚动锁：打开时 overflow hidden、关闭恢复原值；
 *  - 关闭后焦点回到触发源（HIG Focus and selection「Avoid changing focus without people's interaction」）。
 * 仅用于自研 overlay（Radix Dialog/Select 等自带闭环，不要重复套用）。
 */
export function useModalA11y(open: boolean, panelRef: RefObject<HTMLDivElement | null>, onClose: () => void) {
  const restoreRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (!panel) return

    const prevBodyOverflow = document.body.style.overflow
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.body.style.overflow = 'hidden'

    const FOCUS_SEL =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const focusables = () =>
      Array.from(panel.querySelectorAll<HTMLElement>(FOCUS_SEL)).filter(
        (el) => el.getClientRects().length > 0 && !el.closest('[aria-hidden="true"]')
      )

    const first = focusables()[0]
    ;(first ?? panel).focus({ preventScroll: true })

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const els = focusables()
      if (els.length === 0) {
        e.preventDefault()
        return
      }
      const firstEl = els[0]
      const lastEl = els[els.length - 1]
      const active = document.activeElement as HTMLElement | null
      const inside = !!active && panel.contains(active)
      if (e.shiftKey && (!inside || active === firstEl)) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && (!inside || active === lastEl)) {
        e.preventDefault()
        firstEl.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)

    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = prevBodyOverflow
      const t = restoreRef.current
      if (t && t.isConnected && document.contains(t)) t.focus({ preventScroll: true })
      restoreRef.current = null
    }
  }, [open, panelRef])
}
