import type { ComponentType, MouseEvent } from 'react'
import { useRef, useState } from 'react'
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
  // 2.2.1 Timing Adjustable：自动消失须可暂停——hover 与 focus（键盘/读屏用户 Tab 进卡片）任一成立即暂停计时，
  // 全部离开才恢复；pause/resume 幂等（store paused Set），重复触发安全（MFA11y「pause on hover and focus」）。
  const hoverRef = useRef(false)
  const focusRef = useRef(false)
  const syncPause = () => {
    if (hoverRef.current || focusRef.current) toastPause(t.id)
    else toastResume(t.id)
  }
  const toggleDetail = (e: MouseEvent) => {
    e.stopPropagation()
    setShowDetail((v) => !v)
  }
  return (
    <div
      data-leaving={t.leaving || undefined}
      className={cn(
        'zj-toast pointer-events-auto flex items-start gap-2.5 rounded-lg border border-hair bg-surface px-3 py-2.5 shadow-[var(--shadow)]',
        // V-08 动效基线（HIG Motion）：进场 150ms 淡入+8px 微滑；退场镜像；reduced-motion 由 tokens.css [class*=animate-*] 全关
        t.leaving
          ? 'animate-out fade-out slide-out-to-top-2 duration-150'
          : 'animate-in fade-in slide-in-from-top-2 duration-150'
      )}
      onMouseEnter={() => { hoverRef.current = true; syncPause() }}
      onMouseLeave={() => { hoverRef.current = false; syncPause() }}
      onFocusCapture={() => { focusRef.current = true; syncPause() }}
      onBlurCapture={() => { focusRef.current = false; syncPause() }}
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

/** 全局通知堆栈：右上角（标题栏下方），栈式堆叠、自动消失、悬停/聚焦暂停、可手动关。
 * a11y（WCAG 4.1.3 Status Messages + MFA11y/A11yPath 权威模式 2026-09-22 走查落地）：
 * live region 必须**常驻**才能可靠播报——卡片与文本同帧创建的 role 会被屏幕阅读器漏播（最常见失败模式），
 * 故卡片不带 role，由两个**常驻**容器承担：polite（role=status）承载常规/成功/警告，assertive（role=alert）承载错误
 * （错误必须打断播报；其余排队）；aria-atomic=false 只播报新增卡片、不重复整区（勿改 true——会重读全部）。
 * 视觉上仍是单一堆栈（两组上下排列），位置与 z 层不变。 */
export function Toaster() {
  const toasts = useToastsStore((s) => s.toasts)
  const polite = toasts.filter((t) => t.kind !== 'error')
  const assertive = toasts.filter((t) => t.kind === 'error')
  return (
    <div className="pointer-events-none fixed right-4 top-12 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      <div role="status" aria-live="polite" aria-atomic="false" className="flex flex-col gap-2">
        {polite.map((t) => (
          <ToastCard key={t.id} t={t} />
        ))}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="false" className="flex flex-col gap-2">
        {assertive.map((t) => (
          <ToastCard key={t.id} t={t} />
        ))}
      </div>
    </div>
  )
}

export { toast }
export type { ToastKind }
