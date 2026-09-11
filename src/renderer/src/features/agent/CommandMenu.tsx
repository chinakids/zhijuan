import { useEffect, useRef } from 'react'
import { TerminalSquare } from 'lucide-react'
import type { ZjCommand } from '../../../../shared/commands'
import { cn } from '../../lib/utils'

/**
 * 输入框 / 命令浮层（Slack/Cursor slash command 范式，v1 固定于输入框上方，不跟随光标）。
 * 纯展示：命令列表 + 高亮行；键控与插入由 AgentPanel 负责（本组件只上抛 onPick/onActiveChange）。
 */
export default function CommandMenu({
  items,
  active,
  onPick,
  onActiveChange
}: {
  items: ZjCommand[]
  active: number
  onPick: (index: number) => void
  onActiveChange: (index: number) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  // 键盘导航时让高亮行跟随滚动（列表超过可视高度时）
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!items.length) {
    return (
      <div className="zj-cmd-menu absolute bottom-full left-0 right-0 z-20 mb-1 rounded-lg border border-hair bg-surface px-3 py-2 text-[11px] text-ink-3 shadow-lg">
        没有匹配的命令
      </div>
    )
  }
  return (
    <div
      ref={listRef}
      className="zj-cmd-menu absolute bottom-full left-0 right-0 z-20 mb-1 max-h-52 overflow-y-auto rounded-lg border border-hair bg-surface p-1 shadow-lg"
    >
      {items.map((c, i) => (
        <button
          key={c.id}
          data-idx={i}
          onMouseEnter={() => onActiveChange(i)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(i)}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left',
            i === active ? 'bg-accent-soft text-ink' : 'text-ink-2 hover:bg-surface-2'
          )}
        >
          <TerminalSquare className={cn('h-3.5 w-3.5 shrink-0', i === active ? 'text-accent' : 'text-ink-3')} />
          <span className="shrink-0 font-mono text-xs font-medium">/{c.name}</span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-ink-3">{c.desc}</span>
          {c.argHint && <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-3">{c.argHint}</span>}
        </button>
      ))}
    </div>
  )
}
