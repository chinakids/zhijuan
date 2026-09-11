import type { ReactNode } from 'react'
import { cn } from '../lib/utils'
import { EmptyArt, type ArtVariant } from './EmptyArt'

// 统一空态版式（V-05）：装饰插图（可选）＋ 标题 ＋ 说明 ＋ 动作（可选）。
// 体例对齐 Material Empty States：tagline 传达页面目的但不「假装可交互」；动作由显式按钮承载。
// compact：侧栏/小容器用（无插图、更紧凑），避免小空间插图喧宾夺主。

export interface EmptyStateProps {
  /** 装饰插图变体；主区空态建议给，compact 模式自动忽略 */
  art?: ArtVariant
  title?: string
  hint?: string
  action?: ReactNode
  /** 侧栏/抽屉等紧凑容器：无插图、收紧间距 */
  compact?: boolean
  className?: string
  /** 测试/冒烟锚点 */
  dataTestId?: string
}

export function EmptyState({ art, title, hint, action, compact, className, dataTestId }: EmptyStateProps) {
  if (compact) {
    return (
      <div className={cn('px-3 py-6 text-center', className)} data-testid={dataTestId}>
        {title && <p className="text-xs font-medium text-ink-2">{title}</p>}
        {hint && <p className="mt-1 text-xs leading-relaxed text-ink-3">{hint}</p>}
        {action && <div className="mt-2.5 flex justify-center">{action}</div>}
      </div>
    )
  }
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)} data-testid={dataTestId}>
      {art && <EmptyArt variant={art} className="mb-5 shrink-0" />}
      {title && <p className="text-sm font-medium text-ink-2">{title}</p>}
      {hint && <p className="mt-1.5 max-w-[26rem] text-xs leading-relaxed text-ink-3">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
