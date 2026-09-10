import { useEffect, useState } from 'react'
import EngineBadge from '../features/engine/EngineBadge'
import { useDocTitleStore } from '../store/docTitle'

/** 全局最顶一行（macOS hiddenInset）：左侧红绿灯之后放软件品牌名 + 当前文档题名，
 * 最右侧放引擎状态徽章。整条可拖动；交互元素用 no-drag 放行。
 * 文档题名遵循 Apple HIG Toolbars「窗口标题用内容、不用 App 名」——品牌名保留（主人拍板），
 * 题名置于其后；题名来自 useDocTitleStore（文档页写入），不在 Router 内故不用路由 hooks。 */
export default function WindowChrome() {
  const [show, setShow] = useState(false)
  const title = useDocTitleStore((s) => s.title)
  useEffect(() => {
    const plat = (window as any).zhijuan?.platform ?? 'darwin'
    setShow(plat === 'darwin')
  }, [])
  if (!show) return null
  return (
    <div
      className="window-chrome relative z-50 flex h-9 shrink-0 select-none items-center border-b border-hair bg-surface/80 pl-[82px] backdrop-blur"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <span className="mr-3 text-xs font-semibold tracking-[0.2em] text-ink-2">织卷</span>
      <span className="text-[10px] text-ink-3">ZHĪJUǍN</span>
      <span className="mx-3 h-3.5 w-px bg-hair" />
      <span className="min-w-0 flex-1 truncate text-xs text-ink-2" title={title}>
        {title || '\u00a0'}
      </span>
      <div className="flex items-center justify-end pr-4" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <EngineBadge />
      </div>
    </div>
  )
}
