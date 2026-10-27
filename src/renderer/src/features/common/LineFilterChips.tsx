// ===== 织卷 · 时间线筛选 chips（多时间线叙事，2026-10-27 体验层抽为共享组件） =====
// 出现面：时间线页（Timeline）与正文页章节列（Novel）——两处是同一件事「按叙事线看一部分」，
// 视觉语言与键盘行为必须同源，故抽成单一组件，勿各写一份（shared/line.ts 同款单一权威源思路）。
// 口径参考：调研 Braidr（多 POV 小说工具，POV Outline 一次看一条线／Braided Timeline 按阅读序）
// 与 Plottr（按 plotline/属性过滤时间线）；本组件=「阅读序不变 + 按线过滤」的镜头，不是重排。
// 键盘＝ARIA tabs pattern（HIG Segmented controls「Segments become selected when focus moves to them」）：
// ←/→ 循环并选中、Home/End 首尾、roving tabindex（只有当前选段参与 Tab 序）。
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { LineInfo } from '../../../../shared/line'
import { cn } from '../../lib/utils'

/** 「全部」哨兵值（线名理论上不会等于它；与 devShim/真机线名无冲突） */
export const ALL_LINES = '__all__'

interface Props {
  /** 线清单（shared/line.listLinesFromEntries 产出；要求 lines.length > 1 才值得渲染） */
  lines: LineInfo[]
  /** 当前筛选项：ALL_LINES 或线名 */
  value: string
  onChange: (next: string) => void
  /** tablist 可访问名称（如「时间线筛选」/「按时间线筛选章节」） */
  ariaLabel: string
  testId?: string
  className?: string
}

export default function LineFilterChips({ lines, value, onChange, ariaLabel, testId, className }: Props) {
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return
    const keys = [ALL_LINES, ...lines.map((ln) => ln.name)]
    if (!keys.length) return
    const nodes = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]'))
    if (!nodes.length) return
    const cur = Math.max(0, keys.indexOf(value))
    let next = cur
    if (e.key === 'ArrowRight') next = (cur + 1) % keys.length
    else if (e.key === 'ArrowLeft') next = (cur - 1 + keys.length) % keys.length
    else if (e.key === 'Home') next = 0
    else next = keys.length - 1
    e.preventDefault()
    onChange(keys[next])
    nodes[next]?.focus()
  }

  const chip = (key: string, text: string, dataLine: string) => {
    const selected = value === key
    return (
      <button
        key={key}
        role="tab"
        aria-selected={selected}
        data-line={dataLine}
        tabIndex={selected ? 0 : -1}
        onClick={() => onChange(key)}
        className={cn(
          'shrink-0 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] transition-colors',
          selected ? 'border-accent bg-accent text-accent-ink' : 'border-hair text-ink-2 hover:bg-well'
        )}
      >
        {text}
      </button>
    )
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      data-testid={testId}
      className={cn('flex flex-wrap items-center gap-1.5', className)}
    >
      {chip(ALL_LINES, '全部', ALL_LINES)}
      {lines.map((ln) => chip(ln.name, `${ln.name} · ${ln.chapters}`, ln.name))}
    </div>
  )
}