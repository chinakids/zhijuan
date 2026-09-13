// ===== 批注导航列表 · 抽屉（体验层 2026-09-13：候选 1③）=====
// 形态：正文页底部「批注 N」→ 右侧抽屉逐条列出 行号/意图/原文预览，点击条目跳到对应高亮
// （复用 Prose.jumpToAnnotation(row)，row=csv 行号精确定位）；drawer 保持打开可连续浏览。
// 不可定位（before 为空）条目标记「正文中未命中」并禁用点击。
import { useEffect, useRef } from 'react'
import { StickyNote } from 'lucide-react'
import { ScrollArea } from '../../components/ui/scroll-area'
import { Button } from '../../components/ui/button'
import { cn } from '../../lib/utils'
import { useModalA11y } from '../../lib/useModalA11y'
import type { AnnotationRow } from '../../../../shared/annotations'

interface Props {
  annotations: AnnotationRow[]
  open: boolean
  onClose: () => void
  /** 跳到某行批注对应高亮（row = csv 行号） */
  jump: (row: number) => void
  /** 条目 hover 联动：高亮编辑器左缘对应侧标（row=csv 行号；null=清除） */
  onHoverRow?: (row: number | null) => void
}

/** 「L10:1-L10:34」→ 徽标「L10」；无 loc 用 #行号 */
function rowBadge(a: AnnotationRow, i: number): string {
  const m = /^L(\d+)/.exec(a.loc)
  if (m) return 'L' + m[1]
  return `#${a.row ?? i + 1}`
}

export default function AnnoDrawer({ annotations, open, onClose, jump, onHoverRow }: Props) {
  // 模态无障碍：焦点圈闭 / Esc 关闭 / 滚动锁 / 关闭回焦（Apple HIG Keyboards）
  const panelRef = useRef<HTMLDivElement>(null)
  useModalA11y(open, panelRef, onClose)
  // 抽屉关闭时清掉侧标联动高亮（防残留 active 态）
  useEffect(() => {
    if (!open) onHoverRow?.(null)
  }, [open, onHoverRow])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20 animate-in fade-in">
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-label="批注列表"
        className="zj-anno-drawer flex h-full w-[380px] flex-col border-l border-hair bg-paper shadow-[var(--shadow)] animate-in fade-in slide-in-from-right-3"
      >
        <div className="flex h-12 shrink-0 items-center border-b border-hair px-4">
          <StickyNote className="mr-2 h-4 w-4 text-warn" />
          <span className="text-sm font-medium">批注列表</span>
          <span className="ml-2 shrink-0 text-[11px] text-ink-3">共 {annotations.length} 条</span>
          <span className="flex-1" />
          <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-[11px]" onClick={onClose}>
            收起
          </Button>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          {annotations.map((a, i) => {
            const jumpable = a.before.length > 0
            return (
              <button
                key={a.row ?? i}
                data-testid="anno-nav-item"
                data-row={a.row ?? i + 1}
                data-jumpable={jumpable ? '1' : '0'}
                disabled={!jumpable}
                onClick={() => jumpable && a.row !== undefined && jump(a.row)}
                onMouseEnter={() => onHoverRow?.(a.row ?? null)}
                onMouseLeave={() => onHoverRow?.(null)}
                className={cn(
                  'zj-anno-item block w-full border-b border-hair px-4 py-3 text-left transition-colors',
                  jumpable ? 'hover:bg-surface-2' : 'cursor-default opacity-55'
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-medium',
                      jumpable ? 'bg-warn-soft text-warn' : 'bg-surface-2 text-ink-3'
                    )}
                  >
                    {rowBadge(a, i)}
                  </span>
                  <span className="shrink-0 text-[10px] text-ink-3">#{a.row ?? i + 1}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-ink-3">{jumpable ? '点击定位' : '正文中未命中'}</span>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-ink-2">{a.note || '（无批注意图）'}</p>
                {a.before.length > 0 && (
                  <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-ink-3">「{a.before}」</p>
                )}
              </button>
            )
          })}
        </ScrollArea>
      </div>
    </div>
  )
}
