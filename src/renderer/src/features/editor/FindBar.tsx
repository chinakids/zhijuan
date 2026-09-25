import { ArrowDown, ArrowUp, Search, X } from 'lucide-react'
import { useEffect, useRef } from 'react'

/**
 * 正文查找条（Apple HIG Keyboards：⌘F 打开查找窗 / ⌥⌘F 查找与替换（聚焦替换输入） / ⌘G 下一处 / ⇧⌘G 上一处 / ⌘E 用选区搜索）。
 * 形态参照 macOS 文本应用的 Find bar：贴合工具栏下沿、无边框浮起；第二行=查找与替换
 * （TextEdit/Pages/VS Code 同基线：替换输入 + 「替换」当前 + 「全部替换」）。
 * 纯受控展示组件，查找/替换逻辑由 Prose.tsx（持 view）闭环。
 */
export interface FindBarProps {
  open: boolean
  query: string
  replacement: string
  /** 匹配总数；0 表示无匹配（或空 query） */
  total: number
  /** 当前匹配序号（0-based）；无匹配时为 -1 */
  current: number
  /** 打开/重开时聚焦替换输入（⌥⌘F「查找与替换」；TextEdit/Pages 同键） */
  focusReplace?: boolean
  /** 聚焦请求令牌：值变化即按 focusReplace 目标重新聚焦（查找条已开时重按 ⌥⌘F 也回焦替换输入） */
  focusReq?: number
  onQueryChange: (q: string) => void
  onReplacementChange: (r: string) => void
  onReplace: () => void
  onReplaceAll: () => void
  onNext: () => void
  onPrev: () => void
  onClose: () => void
}

export default function FindBar({
  open,
  query,
  replacement,
  total,
  current,
  focusReplace = false,
  focusReq = 0,
  onQueryChange,
  onReplacementChange,
  onReplace,
  onReplaceAll,
  onNext,
  onPrev,
  onClose
}: FindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const replRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      const el = focusReplace ? replRef.current : inputRef.current
      el?.focus()
      el?.select()
    }
  }, [open, focusReplace, focusReq])

  if (!open) return null
  const none = total === 0

  return (
    <div className="zj-findbar" role="search" aria-label="在正文中查找">
      <div className="zj-find-row">
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
            // IME 组合期按键（Enter 确认候选/Esc 取消）交还输入法，不跳转/不关闭（2026-09-18 体检）
            if ((e.nativeEvent as { isComposing?: boolean }).isComposing) return
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
      <div className="zj-find-row zj-find-repl-row">
        <input
          ref={replRef}
          className="zj-find-input zj-find-repl"
          type="text"
          placeholder="替换为"
          aria-label="替换为"
          value={replacement}
          spellCheck={false}
          onChange={(e) => onReplacementChange(e.target.value)}
          onKeyDown={(e) => {
            if ((e.nativeEvent as { isComposing?: boolean }).isComposing) return
            if (e.key === 'Enter') {
              e.preventDefault()
              if (!none && (e.metaKey || e.ctrlKey)) onReplaceAll()
              else if (!none) onReplace()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
          }}
        />
        <button className="zj-find-act" onClick={onReplace} disabled={none} title="替换当前匹配（Enter）">
          替换
        </button>
        <button className="zj-find-act" onClick={onReplaceAll} disabled={none} title="替换全部匹配（⌘Enter 亦可）">
          全部替换
        </button>
      </div>
    </div>
  )
}
