import type { ReactNode } from 'react'
import { cn } from '../lib/utils'

/**
 * 统一页头（2026-10-28，F-20261028-11）：
 * 内容页一律「20px 标题 + 14px 一句说明 + 右侧操作」，避免各页 18/20/无标题三种写法。
 * 列表栏头（如「人物档案」）只承担列表名与列表级操作，不用本组件。
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  className,
  titleTestId
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  className?: string
  titleTestId?: string
}) {
  return (
    <div className={cn('mb-6 flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-ink" data-testid={titleTestId}>
          {title}
        </h1>
        {subtitle ? <p className="mt-1 text-sm leading-6 text-ink-3">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2 pt-0.5">{actions}</div> : null}
    </div>
  )
}