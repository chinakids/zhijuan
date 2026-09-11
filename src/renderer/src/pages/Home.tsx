import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FolderOpen, Plus, Trash2, MoreHorizontal, Search } from 'lucide-react'
import type { ProjectSummary, ProjectTemplate } from '../../../shared/types'
import type { RecentEntry } from '../../../shared/projects'
import { orderProjects } from '../../../shared/projects'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { EmptyState } from '../components/EmptyState'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose
} from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { toast } from '../store/toasts'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../components/ui/dropdown-menu'

/** 由项目 id 稳定生成的封面渐变色（避免每次不同） */
function coverOf(id: string): [string, string] {
  // 深色书封色板：白字清晰、纸本书脊感（2026-09-11 主人反馈「没有书架质感」——原浅色渐变像贴条，白字几乎贴不上）
  const hues: [string, string][] = [
    ['#3f5f56', '#26413a'],
    ['#6e4a35', '#4c3122'],
    ['#4b5872', '#313d52'],
    ['#7d4b58', '#57303c'],
    ['#5f5741', '#403a29'],
    ['#4e6a76', '#31474f']
  ]
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 997
  return hues[h % hues.length]
}

export default function Home() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [recents, setRecents] = useState<RecentEntry[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [folder, setFolder] = useState('')
  const [templates, setTemplates] = useState<ProjectTemplate[]>([])
  const [template, setTemplate] = useState('')

  useEffect(() => {
    void window.zhijuan.listTemplates().then(setTemplates)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const [list, recs] = await Promise.all([window.zhijuan.listProjects(), window.zhijuan.getRecentEntries()])
      setProjects(list)
      setRecents(recs)
      setLoadErr('')
    } catch (e) {
      setLoadErr(String((e as Error).message ?? e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function create() {
    if (!name.trim()) return
    try {
      const p = await window.zhijuan.createProject(name.trim(), desc.trim(), template || undefined)
      setCreating(false)
      setName('')
      setDesc('')
      if (p) navigate(`/project/${p.id}?guide=1`)
    } catch (e) {
      toast.add({ kind: 'error', title: '创建项目失败', description: String((e as Error).message ?? e) })
    }
  }

  async function importDir() {
    if (!folder.trim()) return
    try {
      const r = await window.zhijuan.importProject(folder.trim())
      setImporting(false)
      setFolder('')
      if (r.ok && r.summary) {
        toast.add({
          kind: r.copied ? 'success' : 'info',
          title: r.copied ? `已导入「${r.summary.name}」` : `项目库中已有「${r.summary.name}」，未重复复制`,
          description: r.copied ? '已复制进项目库并补全骨架，原目录保留不动' : '骨架已确保完整，可直接使用'
        })
        navigate(`/project/${r.summary.id}`)
      } else {
        toast.add({ kind: 'error', title: '导入失败', description: r.error ?? '未知错误' })
      }
    } catch (e) {
      toast.add({ kind: 'error', title: '导入目录失败', description: String((e as Error).message ?? e) })
    }
  }

  async function pickImportDir() {
    const dir = await window.zhijuan.importPicker()
    if (dir) setFolder(dir)
  }

  function openProject(id: string) {
    void navigate(`/project/${id}`)
  }

  async function remove(id: string) {
    try {
      await window.zhijuan.removeProject(id)
      void refresh()
    } catch (e) {
      toast.add({ kind: 'error', title: '删除失败', description: String((e as Error).message ?? e) })
    }
  }

  // 过滤 + 排序：最近打开优先，其余按最近编辑
  const visible = orderProjects(projects, recents, query)

  return (
    <div className="flex h-full flex-col">
      {/* 顶栏 */}
      <header className="flex items-center gap-3 border-b border-hair bg-surface px-6 py-3">
        <div className="flex items-center gap-2">
          {/* 定制徽标：「织」册子 SVG（渐变+书页织纹；主人 2026-09-12 SVG 化） */}
          <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" aria-hidden="true">
            <defs>
              <linearGradient id="zj-logo-g" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="var(--accent)" />
                <stop offset="1" stopColor="color-mix(in srgb, var(--accent) 60%, #000 40%)" />
              </linearGradient>
            </defs>
            <rect width="32" height="32" rx="8" fill="url(#zj-logo-g)" />
            <path
              d="M16 9 C13 7.4 9.6 7.1 7 8 v15 C9.6 22.1 13 22.4 16 24 C19 22.4 22.4 22.1 25 23 V8 C22.4 7.1 19 7.4 16 9 Z"
              fill="rgba(255,255,255,0.92)"
            />
            <path d="M16 9 V24" stroke="var(--accent)" strokeWidth="1.2" opacity="0.5" />
            <path d="M10.5 12.5 L14 12.5 M10.5 15.5 L14 15.5" stroke="var(--accent)" strokeWidth="1.1" strokeLinecap="round" opacity="0.55" />
            <path d="M18 12.5 L21.5 12.5 M18 15.5 L21.5 15.5" stroke="var(--accent)" strokeWidth="1.1" strokeLinecap="round" opacity="0.55" />
            <rect width="32" height="32" rx="8" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1" />
          </svg>
          <div>
            <h1 className="text-base font-semibold leading-none">织卷</h1>
            <p className="text-xs text-ink-3">小说创作工作台</p>
          </div>
        </div>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => setImporting(true)}>
          <FolderOpen /> 导入目录
        </Button>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus /> 新建项目
        </Button>
      </header>

      {/* 项目网格 */}
      <main className="flex-1 overflow-auto p-6">
        {/* 工具条：搜索过滤 + 排序说明（窄窗口不换行，truncate） */}
        <div className="mb-4 flex items-center gap-3">
          <div className="relative w-64 shrink-0">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
            <Input
              type="search"
              className="pl-8"
              placeholder="按名称或简介过滤…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <p className="truncate text-xs text-ink-3">
            {loading ? '正在读取项目库…' : loadErr ? '项目库读取失败' : `共 ${projects.length} 个项目`}
            {!loading && !loadErr && query.trim() && ` · 命中 ${visible.length}`}
          </p>
          <div className="flex-1" />
          <p className="hidden shrink-0 text-xs text-ink-3 sm:block">排序：最近打开优先 · 未打开的按最近编辑</p>
        </div>
        {loading && <p className="text-center text-sm text-ink-3 pt-20">正在读取项目库…</p>}
        {!loading && loadErr && (
          <div className="mx-auto mt-24 max-w-sm rounded-xl border border-dashed border-danger/40 p-8 text-center">
            <p className="text-sm font-medium text-danger">读取项目库失败</p>
            <p className="mt-1 break-all text-xs text-ink-3">{loadErr}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => {
                setLoading(true)
                setLoadErr('')
                void refresh()
              }}
            >
              重试
            </Button>
          </div>
        )}
        {!loading && !loadErr && projects.length === 0 && (
          <EmptyState
            art="library"
            title="还没有项目"
            hint="点右上角「新建项目」开始第一本，或导入一个已有目录。"
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus /> 新建项目
              </Button>
            }
            className="mx-auto mt-12 max-w-sm"
            dataTestId="empty-projects"
          />
        )}
        {!loading && projects.length > 0 && visible.length === 0 && (
          <EmptyState
            art="search"
            title={`没有匹配「${query.trim()}」的项目`}
            hint="换个关键词，或清空搜索框看全部项目。"
            className="mx-auto mt-12 max-w-sm"
            dataTestId="empty-search"
          />
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((p) => {
            const [c1, c2] = coverOf(p.id)
            return (
              <Card key={p.id} className="group cursor-pointer overflow-hidden transition-all duration-200 hover:-translate-y-1 hover:border-hair-strong hover:shadow-[var(--shadow)]" onClick={() => openProject(p.id)}>
                {/* 纯文本封面（横版适中；无封面图不模拟材质，用文字排版撑质感；主人 2026-09-12 反馈 v4） */}
                <div className="relative aspect-[16/9] overflow-hidden">
                  <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)` }} />
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{ backgroundImage: 'radial-gradient(120% 70% at 50% -10%, rgba(255,255,255,0.09), transparent 55%)' }}
                  />
                  {/* 居中文本排版：书名 + 装饰线 + 元信息（纯文本封面） */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 px-6 text-center">
                    <h2 className="line-clamp-2 font-serif text-xl font-semibold leading-snug text-white drop-shadow-sm">{p.name}</h2>
                    <span className="h-px w-8 bg-white/35" />
                    <p className="truncate text-[11px] text-white/60">{p.stats.chapters} 章 · 人物 {p.stats.characters}</p>
                  </div>
                </div>
                {/* 信息区 */}
                <div className="flex items-start gap-2 border-t border-hair bg-surface-2/60 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-ink-2">{p.description || '（无简介）'}</p>
                    <p className="mt-1 truncate text-[11px] text-ink-3">
                      {p.lastChapter ? `最近：${p.lastChapter}` : '还没有章节'} · {new Date(p.updatedAt).toLocaleDateString('zh-CN')}
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-ink-3 hover:text-ink">
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={(e) => {
                        e.stopPropagation()
                        void window.zhijuan.revealProject(p.id)
                      }}>
                        <FolderOpen className="h-4 w-4" /> 打开所在文件夹
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-danger focus:text-danger"
                        onClick={(e) => {
                          e.stopPropagation()
                          void remove(p.id)
                        }}
                      >
                        <Trash2 className="h-4 w-4" /> 移到废纸篓
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </Card>
            )
          })}
        </div>
      </main>

      {/* 新建项目 */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>新建项目</DialogTitle>
            <DialogDescription>每个项目一部作品，完全独立，纯文档维护。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>项目名</Label>
              <Input autoFocus placeholder="如：山那边" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void create()} />
            </div>
            <div className="space-y-1.5">
              <Label>一句话简介（可选）</Label>
              <Input placeholder="讲讲这本书是什么…" value={desc} onChange={(e) => setDesc(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>初始内容（可选）</Label>
              <Select value={template} onValueChange={setTemplate}>
                <SelectTrigger>
                  <SelectValue placeholder="空白（仅目录骨架）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">空白（仅目录骨架）</SelectItem>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.builtin ? `示例（${t.name}）` : t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-ink-3">选「示例」会带一份角色档案、切片设定和一章示例正文，可随时删除；自定义模板放在 工作区/模板/项目模板/ 下。</p>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">取消</Button>
            </DialogClose>
            <Button onClick={create} disabled={!name.trim()}>
              创建并进入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 导入已有目录 */}
      <Dialog open={importing} onOpenChange={setImporting}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>导入已有目录</DialogTitle>
            <DialogDescription>选择一个已有作品文件夹，织卷会把它复制进项目库并补全骨架（生成 project.md），不覆盖已有内容；原目录保留不动。</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>目录路径</Label>
            <div className="flex items-center gap-2">
              <Input placeholder="/Users/你/某个已有作品目录" value={folder} onChange={(e) => setFolder(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void importDir()} />
              <Button variant="outline" size="sm" className="shrink-0 whitespace-nowrap" onClick={() => void pickImportDir()}>
                选择文件夹…
              </Button>
            </div>
            <p className="text-xs text-ink-3">也可手动输入绝对路径；库内已有同名项目时不会重复复制。</p>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">取消</Button>
            </DialogClose>
            <Button onClick={importDir} disabled={!folder.trim()}>
              导入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
