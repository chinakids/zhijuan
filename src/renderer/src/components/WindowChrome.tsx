import { useEffect, useState } from 'react'
import EngineBadge from '../features/engine/EngineBadge'

/** 全局最顶一行（macOS hiddenInset）：左侧红绿灯之后放软件品牌名，最右侧放引擎状态徽章。
 * 整条可拖动；交互元素用 no-drag 放行。 */
export default function WindowChrome() {
  const [show, setShow] = useState(false)
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
      <div className="flex flex-1 items-center justify-end pr-4" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <EngineBadge />
      </div>
    </div>
  )
}
