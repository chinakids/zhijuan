import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Button } from '../../components/ui/button'

/**
 * 导航列折叠（HIG Sidebars「Let people hide and show the sidebar」/ macOS show/hide 按钮）。
 * 2026-09-18 17:15 体验层：Novel 章列（5376f30）同机制统一到 DocSection/Outline/Library。
 * 折叠钮=功能点（按钮与状态显示-规范.md ③：纯 icon + title/aria 双写）；默认展开（HIG「避免默认隐藏侧栏」）。
 */

/** 列头「隐藏」按钮：title/aria = 隐藏<label> */
export function ColHideButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      title={`隐藏${label}列表`}
      aria-label={`隐藏${label}列表`}
      onClick={onClick}
    >
      <PanelLeftClose />
    </Button>
  )
}

/** 折叠后主区顶部「显示」入口条（与 Novel 章列 entry bar 同构）：icon 钮 + 列名 + 弹性占位 */
export function ColShowBar({
  label,
  onShow,
  dataTestId
}: {
  label: string
  onShow: () => void
  dataTestId?: string
}) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-hair px-2">
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        data-testid={dataTestId}
        title={`显示${label}列表`}
        aria-label={`显示${label}列表`}
        onClick={onShow}
      >
        <PanelLeftOpen />
      </Button>
      <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{label}</span>
      <span className="flex-1" />
    </div>
  )
}
