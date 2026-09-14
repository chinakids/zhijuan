import { useEffect, useRef, useState } from 'react'
import { ShieldAlert, ChevronDown, ChevronUp } from 'lucide-react'
import type { SyncIssue } from '../../../../shared/types'
import { cn } from '../../lib/utils'
import { guardIssueSummary } from './guardText'

/**
 * 守卫拦截提示（渐进披露两级，NN/g Progressive Disclosure：摘要常显、明细按需一层展开，不做更深层级）：
 * 摘要行 = 「拦截 N 条 · 查看」按钮；展开浮层逐条给处置徽标（已纠正/已丢弃）+ 原 target + 完整 reason。
 * 就近显示于同步结果旁（NN/g Error-Message Guidelines：Display close to the source）；
 * 浮层 z-40：永远低于批注抽屉遮罩(50)/划词浮层(60)/批注气泡(61)，高于正文内容。
 */
export function GuardIssuesNote({ issues, className }: { issues: SyncIssue[]; className?: string }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement | null>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  if (!issues || !issues.length) return null
  return (
    <span ref={rootRef} className={cn('relative inline-flex items-center', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`守卫拦截 ${issues.length} 条，查看明细`}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-warn/40 bg-warn-soft px-1.5 py-0.5 text-[10px] text-warn transition-colors hover:border-warn/70"
      >
        <ShieldAlert className="h-3 w-3" />
        {guardIssueSummary(issues)}
        查看
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && (
        <div
          role="group"
          aria-label="守卫拦截明细"
          className="absolute left-0 top-full z-40 mt-1 w-[min(70vw,420px)] rounded-xl border border-hair bg-surface p-2 shadow-[var(--shadow)] animate-in fade-in slide-in-from-top-1 duration-150"
        >
          <ul className="space-y-1.5">
            {issues.map((it, i) => (
              <li key={i} className="rounded-lg bg-surface-2 px-2 py-1.5">
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      'shrink-0 rounded px-1 py-px text-[10px]',
                      it.action === 'corrected' ? 'bg-accent-soft text-accent' : 'bg-warn-soft text-warn'
                    )}
                  >
                    {it.action === 'corrected' ? '已纠正' : '已丢弃'}
                  </span>
                  <span className="min-w-0 truncate font-mono text-[11px] text-ink" title={it.target}>
                    {it.target}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] leading-4 text-ink-2">{it.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </span>
  )
}
