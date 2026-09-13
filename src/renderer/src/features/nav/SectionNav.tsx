import { NavLink } from 'react-router-dom'
import {
  PenLine,
  Users,
  Globe2,
  Library as LibraryIcon,
  ListTree,
  History,
  Settings as SettingsIcon,
  ArrowLeft,
  CloudDownload
} from 'lucide-react'
import { cn } from '../../lib/utils'

export interface NavCounts {
  novel: number
  characters: number
  worldview: number
  outline: number
  library: number
}

interface Props {
  projectId: string
  projectName: string
  counts: NavCounts
}

interface NavItem {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  key: string
  /** plain = 展示项但不带计数徽标（如时间线） */
  plain?: boolean
}

const items: NavItem[] = [
  { to: 'novel', label: '正文创作', icon: PenLine, key: 'novel' },
  { to: 'characters', label: '人物设定', icon: Users, key: 'characters' },
  { to: 'worldview', label: '世界观设定', icon: Globe2, key: 'worldview' },
  { to: 'outline', label: '大纲区', icon: ListTree, key: 'outline' },
  { to: 'timeline', label: '时间线', icon: History, key: 'timeline', plain: true },
  { to: 'library', label: '素材库', icon: LibraryIcon, key: 'library' }
]

export default function SectionNav({ projectId, projectName, counts }: Props) {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-hair bg-surface">
      {/* 项目名 */}
      <div className="px-4 pb-3 pt-4">
        <NavLink to={`/project/${projectId}`} className="block rounded-lg px-3 py-2 transition-colors hover:bg-well" title="回到项目首页">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">项目</p>
          <p className="truncate text-sm font-semibold">{projectName}</p>
        </NavLink>
      </div>

      {/* 板块导航 */}
      <nav className="flex-1 space-y-0.5 px-3">
        {items.map((it) => (
          <NavLink
            key={it.key}
            to={it.to}
            className={({ isActive }) =>
              cn(
                'flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors',
                isActive ? 'bg-accent-soft font-medium text-accent' : 'text-ink-2 hover:bg-well hover:text-ink'
              )
            }
          >
            <span className="flex items-center gap-2.5">
              <it.icon className="h-4 w-4" />
              {it.label}
            </span>
            {!it.plain && (
              <span className="rounded-full bg-well px-1.5 py-0.5 text-[10px] leading-none text-ink-3">
                {counts[it.key as keyof NavCounts] ?? 0}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* 底部 */}
      <div className="space-y-0.5 border-t border-hair p-3">
        {/* 模块设计 §五 B：底部「采集入口快捷方式、设置入口」——一键直达素材库页并自动打开采集表单 */}
        <NavLink
          to={`/project/${projectId}/library?collect=1`}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
              isActive ? 'bg-accent-soft font-medium text-accent' : 'text-ink-2 hover:bg-well hover:text-ink'
            )
          }
        >
          <CloudDownload className="h-4 w-4" />
          发起采集
        </NavLink>
        <NavLink
          to="settings"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
              isActive ? 'bg-accent-soft font-medium text-accent' : 'text-ink-2 hover:bg-well hover:text-ink'
            )
          }
        >
          <SettingsIcon className="h-4 w-4" />
          设置
        </NavLink>
        <NavLink
          to="/"
          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-2 transition-colors hover:bg-well hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          返回项目列表
        </NavLink>
      </div>
    </aside>
  )
}
