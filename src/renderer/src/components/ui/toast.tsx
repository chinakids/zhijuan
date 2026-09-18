import type { ComponentType, MouseEvent } from 'react'
import { useState } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Info, X } from 'lucide-react'
import LoadingIndicator from '../LoadingIndicator'
import { useToastsStore, toast, type ToastItem, type ToastKind } from '../../store/toasts'
import { cn } from '../../lib/utils'

const ICON: Partial<Record<ToastKind, ComponentType<{ className?: string }>>> = {
  success: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
  error: AlertCircle
}

const ICON_CLS: Record<ToastKind, string> = {
  success: 'text-success',
  info: 'text-accent',
  warning: 'text-warn',
  error: 'text-danger',
  loading: 'text-accent'
}

function ToastCard({ t }: { t: ToastItem }) {
  const Icon = ICON[t.kind]
  // 明细渐进披露（NN/g Progressive Disclosure 2006）：摘要常显、明细按需一层展开（不设更深层级）；
  // 展开态是组件局部 state——toast 常驻期间跨 re-render 保留，dismiss 后自然归零。
  const [showDetail, setShowDetail] = useState(false)
  const toggleDetail = (e: MouseEvent) => {
    e.stopPropagation()
    setShowDetail((v) => !v)
  }
  return (
    <div
      role="status"
      data-leaving={t.leaving || undefined}
      className={cn(
        'zj-toast pointer-events-auto flex items-start gap-2.5 rounded-lg border border-hair bg-surface px-3 py-2.5 shadow-[var(--shadow)]',
        // V-08 动效基线（HIG Motion）：进场 150ms 淡入+8px 微滑；退场镜像；reduced-motion 由 tokens.css [class*=animate-*] 全关
        t.leaving
          ? 'animate-out fade-out slide-out-to-top-2 duration-150'
          : 'animate-in fade-in slide-in-from-top-2 duration-150'
      )}
      onMouseEnter={() => toastPause(t.id)}
      onMouseLeave={() => toastResume(t.id)}
    >
      {t.kind === 'loading' ? (
        <LoadingIndicator size={16} className="mt-0.5" />
      ) : Icon ? (
        <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', ICON_CLS[t.kind])} />
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium leading-5 text-ink">{t.title}</div>
        {t.description && <div className="mt-0.5 whitespace-pre-wrap break-all text-[11px] leading-4 text-ink-2">{t.description}</div>}
        {t.detail && (
          <>
            <button
              type="button"
              aria-expanded={showDetail}
              aria-label={showDetail ? '收起明细' : '查看明细'}
              onClick={toggleDetail}
              className="mt-1 inline-flex shrink-0 items-center gap-0.5 rounded px-0.5 py-px text-[11px] text-accent transition-colors hover:bg-accent-soft"
            >
              {showDetail ? '收起明细' : '查看明细'}
              {showDetail ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
            {showDetail && (
              <div
                data-testid="toast-detail"
                className="mt-1 whitespace-pre-wrap break-all border-t border-hair pt-1.5 text-[11px] leading-4 text-ink-2"
              >
                {t.detail}
              </div>
            )}
          </>
        )}
        {t.action && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              t.action?.onClick()
            }}
            className="mt-1.5 shrink-0 rounded-md border border-hair px-1.5 py-0.5 text-[11px] text-accent transition-colors hover:bg-accent-soft"
          >
            {t.action.label}
          </button>
        )}
      </div>
      <button
        onClick={() => toast.dismiss(t.id)}
        className="shrink-0 rounded p-0.5 text-ink-3 transition-colors hover:text-ink"
        aria-label="关闭通知"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

const toastPause = (id: number) => useToastsStore.getState().pause(id)
const toastResume = (id: number) => useToastsStore.getState().resume(id)

/** 全局通知堆栈：右上角（标题栏下方），栈式堆叠、自动消失、悬停暂停、可手动关。 */
export function Toaster() {
  const toasts = useToastsStore((s) => s.toasts)
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 top-12 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} t={t} />
      ))}
    </div>
  )
}

export { toast }
export type { ToastKind }
