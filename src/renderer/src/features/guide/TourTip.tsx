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
  const bubbleBottom = rect.bottom + 14
  const bubbleTop = rect.top - 12 - 120
  const placeBelow = window.innerHeight - bubbleBottom > 130
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - bubW - 12))

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
          top: placeBelow ? bubbleBottom : bubbleTop,
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
