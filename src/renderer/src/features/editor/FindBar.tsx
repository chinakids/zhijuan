import { ArrowDown, ArrowUp, Search, X } from 'lucide-react'
import { useEffect, useRef } from 'react'

/**
 * 正文查找条（Apple HIG Keyboards：⌘F 打开查找窗 / ⌘G 下一处 / ⇧⌘G 上一处 / ⌘E 用选区搜索）。
 * 形态参照 macOS 文本应用的 Find bar：贴合工具栏下沿、输入框 + 计数 + 方向 + 关闭，无边框浮起。
 * 纯受控展示组件，查找逻辑由 Prose.tsx（持 view）闭环。
 */
export interface FindBarProps {
  open: boolean
  query: string
  /** 匹配总数；0 表示无匹配（或空 query） */
  total: number
  /** 当前匹配序号（0-based）；无匹配时为 -1 */
  current: number
  onQueryChange: (q: string) => void
  onNext: () => void
  onPrev: () => void
  onClose: () => void
}

export default function FindBar({ open, query, total, current, onQueryChange, onNext, onPrev, onClose }: FindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [open])

  if (!open) return null
  const none = total === 0

  return (
    <div className="zj-findbar" role="search" aria-label="在正文中查找">
      <Search className="zj-find-ico" aria-hidden />
      <input
        ref={inputRef}
        className="zj-find-input"
        type="text"
        placeholder="在正文中查找"
        value={query}
        spellCheck={false}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (e.shiftKey) onPrev()
            else onNext()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      />
      <span className="zj-find-count">{none ? '无匹配' : `${current + 1}/${total}`}</span>
      <button className="zj-find-btn" title="上一处（⇧⌘G）" onClick={onPrev} disabled={none} aria-label="上一处">
        <ArrowUp className="h-3.5 w-3.5" />
      </button>
      <button className="zj-find-btn" title="下一处（⌘G）" onClick={onNext} disabled={none} aria-label="下一处">
        <ArrowDown className="h-3.5 w-3.5" />
      </button>
      <button className="zj-find-btn" title="关闭（Esc）" onClick={onClose} aria-label="关闭查找">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
