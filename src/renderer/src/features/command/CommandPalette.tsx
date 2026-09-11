import { useCallback, useEffect, useRef, useState } from 'react'
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
import { BookOpen, FileText, FolderOpen, Globe2, History, Keyboard, Library as LibraryIcon, ListTree, Loader2, PenLine, Settings as SettingsIcon, Users } from 'lucide-react'
import type { ChapterEntry, ProjectSummary, RecentLibraryDoc, SearchHit } from '../../../../shared/types'
import { libraryCategoryOf } from '../../../../shared/libraryTree'
import { formatRelativeTime } from '../../../../shared/relativeTime'
import ShortcutHelp from './ShortcutHelp'

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
  const [shortcutOpen, setShortcutOpen] = useState(false)
  const [chapters, setChapters] = useState<ChapterEntry[]>([])
  const [chLoading, setChLoading] = useState(false)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [q, setQ] = useState('')
  const [matHits, setMatHits] = useState<SearchHit[] | null>(null)
  const [matLoading, setMatLoading] = useState(false)
  const matSeq = useRef(0)
  const [recentMats, setRecentMats] = useState<RecentLibraryDoc[] | null>(null)

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

  // 打开时拉数据（会话内兜底，读取失败不阻塞面板）+ 清空上次搜索词（面板为瞬态层，不残留）
  useEffect(() => {
    if (!open) return
    setProjects([])
    setChapters([])
    setQ('')
    setMatHits(null)
    setMatLoading(false)
    setRecentMats(null)
    void window.zhijuan.listProjects().then(setProjects).catch(() => setProjects([]))
    if (projectId) {
      setChLoading(true)
      void window.zhijuan
        .listChapters(projectId)
        .then(setChapters)
        .catch(() => setChapters([]))
        .finally(() => setChLoading(false))
      // 最近素材（q 为空时的「最近」建议，HIG Search fields）：打开时一次性拉取，随面板瞬态刷新
      void window.zhijuan
        .recentLibraryDocs(projectId, 5)
        .then(setRecentMats)
        .catch(() => setRecentMats([]))
    }
  }, [open, projectId])

  // 素材库全文搜索：输入即搜（HIG Search fields「start search immediately」），防抖 300ms；
  // 与素材库页同一口径——文件名+正文、空格分词 AND、排除采集池；面板只取前 8 条防噪。
  useEffect(() => {
    if (!open || !projectId) return
    const query = q.trim()
    if (!query) {
      setMatHits(null)
      setMatLoading(false)
      return
    }
    setMatLoading(true)
    const seq = ++matSeq.current
    const t = setTimeout(() => {
      window.zhijuan
        .searchDocs(projectId, '素材库', query, { excludePrefix: ['素材库/采集池/'], limit: 8 })
        .then((r) => {
          if (seq === matSeq.current) setMatHits(r)
        })
        .catch(() => {
          if (seq === matSeq.current) setMatHits([])
        })
        .finally(() => {
          if (seq === matSeq.current) setMatLoading(false)
        })
    }, 300)
    return () => clearTimeout(t)
  }, [open, projectId, q])

  const close = useCallback(() => setOpen(false), [])
  const go = useCallback(
    (to: string) => {
      setOpen(false)
      navigate(to)
    },
    [navigate]
  )

  return (
    <>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="输入页面、章节、项目或素材关键词…" autoFocus onValueChange={setQ} />
      <CommandList>
        <CommandEmpty>没有匹配项（试试「正文」、章节题名或素材里的关键词）</CommandEmpty>

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

        {projectId && q.trim() === '' && (recentMats && recentMats.length > 0) && (
          <>
            <CommandSeparator />
            <CommandGroup heading="最近素材">
              {recentMats.map((m) => (
                <CommandItem
                  key={m.file}
                  value={`素材 最近 ${m.name}`}
                  keywords={[m.name, libraryCategoryOf(m.file)]}
                  onSelect={() => go(`/project/${projectId}/library?doc=${encodeURIComponent(m.file)}`)}
                >
                  <FileText className="h-4 w-4 shrink-0 text-ink-3" />
                  <span className="min-w-0 truncate">
                    {libraryCategoryOf(m.file) ? <span className="text-ink-3">{libraryCategoryOf(m.file)}/</span> : null}
                    {m.name}
                  </span>
                  <span className="ml-auto shrink-0 text-[11px] text-ink-3">{formatRelativeTime(m.mtime)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {projectId && q.trim() !== '' && (matLoading || (matHits && matHits.length > 0)) && (
          <>
            <CommandSeparator />
            <CommandGroup heading={`素材 · 全文搜索${matHits ? `（${matHits.length} 条）` : ''}`}>
              {matLoading && (!matHits || matHits.length === 0) && (
                <CommandItem disabled value="正在搜索素材…">
                  <Loader2 className="h-4 w-4 animate-spin text-ink-3" />
                  <span>正在搜索素材…</span>
                </CommandItem>
              )}
              {(matHits ?? []).map((h) => (
                <CommandItem
                  key={h.file}
                  value={`素材 ${h.name} ${h.snippet}`}
                  keywords={[h.name, h.snippet, libraryCategoryOf(h.file)]}
                  onSelect={() => go(`/project/${projectId}/library?doc=${encodeURIComponent(h.file)}`)}
                >
                  <FileText className="h-4 w-4 shrink-0 text-ink-3" />
                  <span className="min-w-0 truncate">
                    {libraryCategoryOf(h.file) ? <span className="text-ink-3">{libraryCategoryOf(h.file)}/</span> : null}
                    {h.name}
                  </span>
                  <span className="ml-1 shrink-0 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-2">
                    {h.field === 'name' ? '文件名' : '正文'}
                  </span>
                  <span className="ml-auto max-w-44 shrink-0 truncate text-[11px] text-ink-3">{h.snippet}</span>
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

        <CommandSeparator />
        <CommandGroup heading="帮助">
          <CommandItem
            value="帮助 键盘快捷键速查"
            keywords={['快捷键', '键盘', 'help', 'shortcut', '快捷键速查']}
            onSelect={() => {
              setOpen(false)
              setShortcutOpen(true)
            }}
          >
            <Keyboard className="h-4 w-4 text-ink-3" />
            <span>键盘快捷键速查</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
      </CommandDialog>
      <ShortcutHelp open={shortcutOpen} onOpenChange={setShortcutOpen} />
    </>
  )
}
