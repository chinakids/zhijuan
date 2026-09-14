import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { Keyboard } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * 键盘快捷键速查（页内速查入口：⌘K 面板「帮助」与设置页「关于」）。
 * macOS 系统菜单栏已于 2026-09-14 接入（docs/系统菜单-设计口径.md），菜单项本身也显示这些键位；
 * 本面板保留为页内速查。内容与 docs/快捷键.md 总表（权威）同源，新增快捷键时三处同步。
 */

const Kbd = ({ children }: { children: ReactNode }) => (
  <kbd className="inline-flex min-w-[1.4rem] items-center justify-center rounded border border-hair bg-surface-2 px-1.5 py-0.5 font-sans text-[11px] leading-none text-ink-2">
    {children}
  </kbd>
)

const Row = ({ label, keys }: { label: string; keys: string[] }) => (
  <div className="flex items-center justify-between gap-4 py-1.5">
    <span className="min-w-0 text-sm text-ink-2">{label}</span>
    <span className="flex shrink-0 items-center gap-1">
      {keys.map((k, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-[11px] text-ink-3">/</span>}
          <Kbd>{k}</Kbd>
        </span>
      ))}
    </span>
  </div>
)

const Group = ({ title, rows }: { title: string; rows: { label: string; keys: string[] }[] }) => (
  <div>
    <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">{title}</h4>
    <div className="divide-y divide-hair">
      {rows.map((r) => (
        <Row key={r.label} {...r} />
      ))}
    </div>
  </div>
)

const GROUPS: { title: string; rows: { label: string; keys: string[] }[] }[] = [
  {
    title: '全应用',
    rows: [
      { label: '命令面板（页面 / 章节 / 项目 / 素材搜索）', keys: ['⌘K'] },
      { label: '保存当前文档', keys: ['⌘S'] },
      { label: '关闭当前浮层（查找条 / 命令面板 / 对话框）', keys: ['Esc'] }
    ]
  },
  {
    title: '编辑（正文编辑器）',
    rows: [
      { label: '撤销 / 重做', keys: ['⌘Z', '⇧⌘Z', '⌘Y'] },
      { label: '剪切 / 复制 / 粘贴', keys: ['⌘X', '⌘C', '⌘V'] },
      { label: '全选', keys: ['⌘A'] },
      { label: '加粗 / 斜体', keys: ['⌘B', '⌘I'] }
    ]
  },
  {
    title: '查找（正文页）',
    rows: [
      { label: '在正文中查找（有选区时预填）', keys: ['⌘F'] },
      { label: '用选区设置查找词（不展开查找条）', keys: ['⌘E'] },
      { label: '下一处 / 上一处', keys: ['⌘G', '⇧⌘G'] },
      { label: '结束本次查找（清除高亮）', keys: ['Esc'] }
    ]
  },
  {
    title: '选中文字',
    rows: [
      { label: '选中后浮层：复制 / 引用进右侧对话', keys: ['点击浮层按钮'] },
      { label: '右键菜单：剪切 / 复制 / 粘贴 / 全选 / 添加到对话', keys: ['按右键'] }
    ]
  }
]

export default function ShortcutHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-4 w-4 text-ink-3" />
            键盘快捷键
          </DialogTitle>
          <DialogDescription>完整清单见仓库 docs/快捷键.md；快捷键遵循 macOS 标准（Apple Human Interface Guidelines）。</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {GROUPS.map((g) => (
            <Group key={g.title} {...g} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
