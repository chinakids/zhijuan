// ===== 织卷 · 用户动线功能引导（主人 2026-09-23，F-20260923-02） =====
// 机制：useTour(hook，管理步骤序/seen/启用) + TourTip(高亮 ring+定位气泡，非阻塞、可跳过)。
// 阈值：guideEnabled(默认开) 且 tourKey 未 seen → 当首个步骤 target 出现在页面时自动弹出；
//       完成或跳过 → markSeen 不再重复；设置页可关闭(guideEnabled)与重看(重置 guideSeen)。
// 原则（设计文档）：不遮罩、不锁界面——只在目标元素上方叠加高亮框+气泡，作者可随时继续操作。
import { useCallback, useEffect, useState } from 'react'

export interface TourStep {
  key: string
  title?: string
  text: string
  target: () => Element | null
  placement?: 'bottom' | 'top' | 'left' | 'right'
}

export function useTour(tourKey: string, steps: TourStep[]) {
  const [open, setOpen] = useState(false)
  const [idx, setIdx] = useState(-1)
  const step = idx >= 0 && idx < steps.length ? steps[idx] : null

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

  const close = useCallback(
    (seenIt: boolean) => {
      setOpen(false)
      setIdx(-1)
      if (seenIt) markSeen()
    },
    [markSeen]
  )

  // 自动开始：需启用且未 seen，等首个 target 出现
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
          const i = steps.findIndex((st) => st.target())
          if (i >= 0) {
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
  }, [tourKey, steps])

  const next = useCallback(() => setIdx((i) => Math.min(i + 1, steps.length - 1)), [steps.length])
  const skip = useCallback(() => close(true), [close])
  const finish = useCallback(() => close(true), [close])
  const dismiss = useCallback(() => close(false), [close]) // 作者主动关闭（不着 seen，下次条件满足仍可提示）

  return { open, step, index: idx, total: steps.length, next, skip, finish, dismiss }
}

export type TourApi = ReturnType<typeof useTour>
