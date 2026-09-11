import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookText, FolderOpen, Plus, Trash2, MoreHorizontal, Search } from 'lucide-react'
import type { ProjectSummary, ProjectTemplate } from '../../../shared/types'
import type { RecentEntry } from '../../../shared/projects'
import { orderProjects } from '../../../shared/projects'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
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
  const hues: [string, string][] = [
    ['#a8c3b5', '#728f88'],
    ['#d8b59a', '#b08a6a'],
    ['#b9c4d8', '#7f8dad'],
    ['#d9b8c0', '#b3848f'],
    ['#c7c2a8', '#a09a72'],
    ['#a8c3cf', '#6f93a3']
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
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-ink">
            <BookText className="h-4 w-4" />
          </div>
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
          <div className="mx-auto mt-24 max-w-sm rounded-xl border border-dashed border-hair-strong p-10 text-center">
            <p className="text-ink-2">还没有项目。</p>
            <p className="mt-1 text-sm text-ink-3">点右上角「新建项目」开始第一本，或导入一个已有目录。</p>
          </div>
        )}
        {!loading && projects.length > 0 && visible.length === 0 && (
          <div className="mx-auto mt-24 max-w-sm rounded-xl border border-dashed border-hair-strong p-10 text-center">
            <p className="text-ink-2">没有匹配「{query.trim()}」的项目。</p>
            <p className="mt-1 text-sm text-ink-3">换个关键词，或清空搜索框看全部项目。</p>
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((p) => {
            const [c1, c2] = coverOf(p.id)
            return (
              <Card key={p.id} className="group cursor-pointer overflow-hidden transition-shadow hover:border-hair-strong hover:shadow-[var(--shadow)]" onClick={() => openProject(p.id)}>
                {/* 封面条 */}
                <div className="h-10" style={{ background: `linear-gradient(120deg, ${c1}, ${c2})` }} />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold">{p.name}</h2>
                      <p className="mt-0.5 line-clamp-2 text-xs text-ink-3">{p.description || '（无简介）'}</p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                          <MoreHorizontal className="h-4 w-4" />
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
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary">正文 {p.stats.chapters}</Badge>
                    <Badge variant="secondary">人物 {p.stats.characters}</Badge>
                    <Badge variant="secondary">世界观 {p.stats.worldviewFiles}</Badge>
                    <Badge variant="secondary">素材 {p.stats.materials}</Badge>
                  </div>
                  <p className="mt-3 text-xs text-ink-3">
                    {p.lastChapter ? `最近：${p.lastChapter}` : '还没有章节'} · {new Date(p.updatedAt).toLocaleString('zh-CN')}
                  </p>
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
