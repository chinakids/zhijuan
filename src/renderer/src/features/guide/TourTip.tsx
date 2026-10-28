// 织卷 · 功能引导气泡（高亮目标 + 定位提示 + 下一步/跳过/完成；非阻塞，无遮罩）
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TourStep } from './useTour'

interface Props {
  step: TourStep
  index: number
  total: number
  onNext: () => void
  onSkip: () => void
  onFinish: () => void
}

export default function TourTip({ step, index, total, onNext, onSkip, onFinish }: Props) {
  const [rect, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    const el = step.target()
    if (!el) {
      setRect(null)
      return
    }
    const update = () => setRect(el.getBoundingClientRect())
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [step])

  if (!rect) return null
  const isLast = index === total - 1
  const pad = 6
  // 气泡尽量放目标下方；不足时放上方；水平 clamp 在视口内
  const bubW = 288
  // 2026-10-28（F-20261028-11）：气泡高度按实测 168 计，优先放在空间更大的一侧，
  // 并把 top 钳在视口内——此前固定在目标下方 14px，Agent 步骤正好盖住输入框。
  const bubH = 168
  const gap = 14
  const spaceBelow = window.innerHeight - rect.bottom - gap - 12
  const spaceAbove = rect.top - gap - 12
  const placeBelow = spaceBelow >= bubH || spaceBelow >= spaceAbove
  // 目标很高（如 Agent 面板）时，气泡放到目标左侧、与顶部对齐：
  // 放在下方会正好盖住输入框；放在上方会盖住面板提示。
  const placeLeft = rect.height > 220 && rect.left - bubW - gap > 12
  const left = placeLeft
    ? rect.left - bubW - gap
    : Math.max(12, Math.min(rect.left, window.innerWidth - bubW - 12))
  const top = Math.max(
    12,
    Math.min(
      placeLeft ? rect.top : placeBelow ? rect.bottom + gap : rect.top - bubH - gap,
      window.innerHeight - bubH - 12
    )
  )

  return createPortal(
    <div className="fixed inset-0 z-[90] pointer-events-none">
      {/* 目标高亮框 */}
      <div
        className="absolute rounded-lg ring-2 ring-accent/70"
        style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}
      />
      {/* 提示气泡（可点击，不遮罩 target 之外操作） */}
      <div
        className="pointer-events-auto absolute w-72 rounded-xl border border-hair bg-surface p-3 shadow-[var(--shadow)]"
        style={{
          left,
          top,
        }}
        data-testid="tour-tip"
      >
        <p className="mb-1 text-[11px] font-semibold text-accent">
          {index + 1}/{total} ·{step.title ? ` ${step.title}` : ' 使用引导'}
        </p>
        <p className="text-xs leading-5 text-ink">{step.text}</p>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            data-testid="tour-skip"
            onClick={onSkip}
            className="ml-auto rounded-md px-2 py-1 text-[11px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            跳过
          </button>
          <button
            type="button"
            data-testid="tour-next"
            onClick={isLast ? onFinish : onNext}
            className="whitespace-nowrap rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-ink transition-colors hover:brightness-95"
          >
            {isLast ? '完成' : '下一步'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
