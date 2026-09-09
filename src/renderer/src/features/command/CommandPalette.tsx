import { useCallback, useEffect, useState } from 'react'
import { useMatch, useNavigate } from 'react-router-dom'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator
} from '../../components/ui/command'
import { BookOpen, FolderOpen, Globe2, History, Library as LibraryIcon, ListTree, PenLine, Settings as SettingsIcon, Users } from 'lucide-react'
import type { ChapterEntry, ProjectSummary } from '../../../../shared/types'

const PAGE_ITEMS = [
  { key: 'novel', label: '正文创作', icon: PenLine },
  { key: 'characters', label: '人物设定', icon: Users },
  { key: 'worldview', label: '世界观设定', icon: Globe2 },
  { key: 'outline', label: '大纲区', icon: ListTree },
  { key: 'timeline', label: '时间线', icon: History },
  { key: 'library', label: '素材库', icon: LibraryIcon },
  { key: 'settings', label: '设置', icon: SettingsIcon }
]

/** 全局命令面板（⌘K / Ctrl+K）：页面导航 + 打开章节 + 打开项目（模块设计 §13.2 键盘优先） */
export default function CommandPalette() {
  const navigate = useNavigate()
  const projMatch = useMatch('/project/:id/*')
  const projectId = projMatch?.params.id ?? null
  const [open, setOpen] = useState(false)
  const [chapters, setChapters] = useState<ChapterEntry[]>([])
  const [chLoading, setChLoading] = useState(false)
  const [projects, setProjects] = useState<ProjectSummary[]>([])

  // 全局快捷键：Mac Cmd+K / Win Ctrl+K（编辑器未绑 Mod-k，无冲突）
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  // 打开时拉数据（会话内兜底，读取失败不阻塞面板）
  useEffect(() => {
    if (!open) return
    setProjects([])
    setChapters([])
    void window.zhijuan.listProjects().then(setProjects).catch(() => setProjects([]))
    if (projectId) {
      setChLoading(true)
      void window.zhijuan
        .listChapters(projectId)
        .then(setChapters)
        .catch(() => setChapters([]))
        .finally(() => setChLoading(false))
    }
  }, [open, projectId])

  const close = useCallback(() => setOpen(false), [])
  const go = useCallback(
    (to: string) => {
      setOpen(false)
      navigate(to)
    },
    [navigate]
  )

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="输入页面、章节或项目名…" autoFocus />
      <CommandList>
        <CommandEmpty>没有匹配项（试试「正文」或章节题名）</CommandEmpty>

        {projectId ? (
          <CommandGroup heading="页面">
            {PAGE_ITEMS.map((it) => {
              const Icon = it.icon
              return (
                <CommandItem key={it.key} value={`页面 ${it.label}`} keywords={[it.label]} onSelect={() => go(`/project/${projectId}/${it.key}`)}>
                  <Icon className="h-4 w-4 text-ink-3" />
                  <span>{it.label}</span>
                </CommandItem>
              )
            })}
          </CommandGroup>
        ) : (
          <CommandGroup heading="页面">
            <CommandItem value="页面 项目列表" keywords={['首页', '项目']} onSelect={() => go('/')}>
              <FolderOpen className="h-4 w-4 text-ink-3" />
              <span>项目列表（首页）</span>
            </CommandItem>
            <CommandItem value="页面 设置" keywords={['设置']} onSelect={() => go('/settings')}>
              <SettingsIcon className="h-4 w-4 text-ink-3" />
              <span>设置</span>
            </CommandItem>
          </CommandGroup>
        )}

        {projectId && (chLoading || chapters.length > 0) && (
          <>
            <CommandSeparator />
            <CommandGroup heading="打开章节">
              {chLoading && !chapters.length && (
                <CommandItem disabled value="读取章节…">
                  <BookOpen className="h-4 w-4 text-ink-3" />
                  <span>正在读取章节…</span>
                </CommandItem>
              )}
              {chapters.map((c) => (
                <CommandItem
                  key={c.file}
                  value={`章节 ${c.fm?.['题名'] ?? c.name} 第${c.fm?.['章号'] ?? ''}章 ${c.fm?.['切片'] ?? ''}`}
                  keywords={[c.fm?.['题名'] ?? '', c.fm?.['切片'] ?? '', String(c.fm?.['章号'] ?? '')]}
                  onSelect={() => go(`/project/${projectId}/novel?ch=${encodeURIComponent(c.file)}`)}
                >
                  <BookOpen className="h-4 w-4 text-ink-3" />
                  <span className="truncate">{c.fm ? `第${c.fm['章号'] ?? '?'}章 · ${c.fm['题名'] ?? c.name}` : c.name}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-ink-3">{c.wordCount} 字</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {projects.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="打开项目">
              {projects.map((p) => (
                <CommandItem key={p.id} value={`项目 ${p.name}`} keywords={[p.name, p.description ?? '']} onSelect={() => go(`/project/${p.id}`)}>
                  <FolderOpen className="h-4 w-4 text-ink-3" />
                  <span className="truncate">{p.name}</span>
                  {p.description ? <span className="ml-auto max-w-40 truncate text-[11px] text-ink-3">{p.description}</span> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  )
}
