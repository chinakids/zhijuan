// ===== 织卷 · 用户动线功能引导（主人 2026-09-23，F-20260923-02） =====
// 机制：useTour(hook，管理步骤序/seen/启用/优先级) + TourTip(高亮 ring+定位气泡，非阻塞、可跳过)。
// 阈值：guideEnabled(默认开) 且 tourKey 未 seen → 当首个步骤 target 出现在页面时自动弹出；
//       完成或跳过 → markSeen 不再重复；设置页可关闭(guideEnabled)与重看(重置 guideSeen)。
// 优先级：opts.priority 越小越优先（默认 50）。同页多个未 seen 引导互斥——同一时刻只弹一个；
//         更高优先可抢占低优先（关闭低优先者，不写 seen）。主线（如 novel-first）给低值。
// 原则（设计文档）：不遮罩、不锁界面——只在目标元素上方叠加高亮框+气泡，作者可随时继续操作。
import { useCallback, useEffect, useRef, useState } from 'react'

export interface TourStep {
  key: string
  title?: string
  text: string
  target: () => Element | null
  placement?: 'bottom' | 'top' | 'left' | 'right'
}

export interface TourOpts {
  /** 越小越优先（默认 50）；可抢占当前低优先引导 */
  priority?: number
}

// 全局引导调度：同一时刻只显示一个，priority 小者优先并可抢占低优先。
interface ActiveTour {
  key: string
  priority: number
  stop: () => void
}
let activeTour: ActiveTour | null = null

export function useTour(tourKey: string, steps: TourStep[], opts: TourOpts = {}) {
  const priority = opts.priority ?? 50
  const [open, setOpen] = useState(false)
  const [idx, setIdx] = useState(-1)
  const step = idx >= 0 && idx < steps.length ? steps[idx] : null

  const clearActiveSelf = useCallback(() => {
    if (activeTour?.key === tourKey) activeTour = null
  }, [tourKey])

  const markSeen = useCallback(() => {
    void window.zhijuan
      .getSettings()
      .then((s) => {
        const seen = s.guideSeen ?? []
        if (!seen.includes(tourKey)) {
          window.zhijuan.setSettings({ guideSeen: [...seen, tourKey] }).catch(() => {})
        }
      })
      .catch(() => {})
  }, [tourKey])

  const closeGuide = useCallback(
    (seenIt: boolean) => {
      setOpen(false)
      setIdx(-1)
      clearActiveSelf()
      if (seenIt) markSeen()
    },
    [clearActiveSelf, markSeen]
  )

  const stopSelf = useCallback(() => {
    setOpen(false)
    setIdx(-1)
    clearActiveSelf()
  }, [clearActiveSelf])

  // 自动开始：需启用且未 seen，等首个 target 出现；按优先级调度（可抢占低优先）
  useEffect(() => {
    let stopped = false
    let timer: number | undefined
    void window.zhijuan
      .getSettings()
      .then((s) => {
        if (stopped) return
        if (s.guideEnabled === false) return
        const seen = s.guideSeen ?? []
        if (seen.includes(tourKey)) return
        const tryStart = () => {
          if (activeTour && activeTour.key !== tourKey) {
            if (priority < activeTour.priority) {
              // 抢占低优先引导：关闭它并接管调度锁（不写其 seen）
              activeTour.stop()
              activeTour = null
            } else {
              return false
            }
          }
          const i = steps.findIndex((st) => st.target())
          if (i >= 0) {
            activeTour = { key: tourKey, priority, stop: stopSelf }
            setIdx(i)
            setOpen(true)
            return true
          }
          return false
        }
        if (tryStart()) return
        timer = window.setInterval(() => {
          if (tryStart()) window.clearInterval(timer)
        }, 300)
      })
      .catch(() => {})
    return () => {
      stopped = true
      if (timer) window.clearInterval(timer)
    }
  }, [tourKey, steps, priority, stopSelf])

  const next = useCallback(() => setIdx((i) => Math.min(i + 1, steps.length - 1)), [steps.length])
  const skip = useCallback(() => closeGuide(true), [closeGuide])
  const finish = useCallback(() => closeGuide(true), [closeGuide])
  const dismiss = useCallback(() => closeGuide(false), [closeGuide]) // 作者主动关闭（不着 seen，下次条件满足仍可提示）

  return { open, step, index: idx, total: steps.length, next, skip, finish, dismiss }
}

export type TourApi = ReturnType<typeof useTour>
