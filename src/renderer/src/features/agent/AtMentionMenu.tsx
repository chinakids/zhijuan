import { useEffect, useRef } from 'react'
import { BookOpen, Globe2, Library, User } from 'lucide-react'
import type { AtCandidate, AtType } from '../../../../shared/mention'
import { cn } from '../../lib/utils'

const ICONS: Record<AtType, typeof User> = {
  人物: User,
  章节: BookOpen,
  世界观: Globe2,
  素材: Library
}

/**
 * 输入框 @ 引用浮层（GitHub/Slack mention 范式，v1 固定于输入框上方，不跟随光标）。
 * 纯展示：候选列表 + 高亮行；键控与插入由 AgentPanel 负责（本组件只上抛 onPick/onActiveChange）。
 */
export default function AtMentionMenu({
  items,
  active,
  onPick,
  onActiveChange
}: {
  items: AtCandidate[]
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
      <div className="zj-at-menu absolute bottom-full left-0 right-0 z-20 mb-1 rounded-lg border border-hair bg-surface px-3 py-2 text-[11px] text-ink-3 shadow-lg">
        没有匹配的 @ 引用
      </div>
    )
  }
  return (
    <div
      ref={listRef}
      className="zj-at-menu absolute bottom-full left-0 right-0 z-20 mb-1 max-h-52 overflow-y-auto rounded-lg border border-hair bg-surface p-1 shadow-lg"
    >
      {items.map((c, i) => {
        const Icon = ICONS[c.type]
        return (
          <button
            key={c.type + '|' + c.file}
            data-idx={i}
            onMouseEnter={() => onActiveChange(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(i)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left',
              i === active ? 'bg-accent-soft text-ink' : 'text-ink-2 hover:bg-surface-2'
            )}
          >
            <Icon className={cn('h-3.5 w-3.5 shrink-0', i === active ? 'text-accent' : 'text-ink-3')} />
            <span className="max-w-[45%] shrink-0 truncate text-xs font-medium">{c.name}</span>
            <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-3">{c.type}</span>
            <span className="min-w-0 flex-1 break-all text-[10px] leading-4 text-ink-3">{c.file}</span>
          </button>
        )
      })}
    </div>
  )
}
