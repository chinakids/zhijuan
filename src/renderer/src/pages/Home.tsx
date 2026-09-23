import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FolderOpen, FolderOutput, Plus, Trash2, MoreHorizontal, Search, X, FileDown, FileText, BookOpen } from 'lucide-react'
import LoadingIndicator from '../components/LoadingIndicator'
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
import { isImeComposing } from '../lib/ime'
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
  const searchRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [folder, setFolder] = useState('')
  const [templates, setTemplates] = useState<ProjectTemplate[]>([])
  const [template, setTemplate] = useState('')
  const [libPath, setLibPath] = useState<string | null>(null)

  useEffect(() => {
    void window.zhijuan.listTemplates().then(setTemplates)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const [list, recs, paths] = await Promise.all([
        window.zhijuan.listProjects(),
        window.zhijuan.getRecentEntries(),
        window.zhijuan.getPaths().catch(() => null)
      ])
      setProjects(list)
      setRecents(recs)
      setLibPath(paths ? paths.documents : null)
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

  // 系统菜单 文件→新建项目…（MenuBridge 单点分发 → 本页监听；仅 Home 挂载时生效，菜单灰显保证有效期）
  useEffect(() => {
    const h = () => setCreating(true)
    window.addEventListener('zj:menu-newProject', h)
    return () => window.removeEventListener('zj:menu-newProject', h)
  }, [])

  async function create() {
    if (!name.trim()) return
    try {
      const p = await window.zhijuan.createProject(name.trim(), desc.trim(), template || undefined)
      setCreating(false)
      setName('')
      setDesc('')
      if (p) navigate(`/project/${p.id}?guide=1`)
    } catch (e) {
      toast.add({ kind: 'error', title: '新建项目失败', description: String((e as Error).message ?? e) })
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

  /** 导出项目＝复制项目目录到用户选择的位置（模块设计 §四 A：打开目录 / 导出 / 删除） */
  async function exportTo(id: string, name: string) {
    try {
      const r = await window.zhijuan.exportProject(id)
      if (r.cancelled) return
      if (r.ok && r.dest) {
        toast.add({ kind: 'success', title: '已导出', description: `「${name}」已复制到 ${r.dest}` })
      } else {
        toast.add({ kind: 'error', title: '导出失败', description: r.error ?? '未知错误' })
      }
    } catch (e) {
      toast.add({ kind: 'error', title: '导出失败', description: String((e as Error).message ?? e) })
    }
  }

  /** 作品编译＝整书合并导出单文件 Markdown 成品（模块设计 §四 A 扩展；Scrivener Compile 同构） */
  async function exportCompiled(id: string, name: string) {
    try {
      const r = await window.zhijuan.compileExport(id)
      if (r.ok) {
        toast.add({ kind: 'success', title: '已导出作品', description: `「${name}」已合并为 ${r.chapters} 章：${r.path}` })
        return
      }
      if (r.cancelled) return
      toast.add({ kind: 'error', title: '导出失败', description: r.error ?? '未知错误' })
    } catch (e) {
      toast.add({ kind: 'error', title: '导出失败', description: String((e as Error).message ?? e) })
    }
  }

  /** 作品编译 v1.1＝Word 导出（mac 系统 textutil 零依赖；win/linux 优雅回退 Markdown） */
  async function exportCompiledDocx(id: string, name: string) {
    try {
      const r = await window.zhijuan.compileExportDocx(id)
      if (r.ok) {
        toast.add({ kind: 'success', title: '已导出 Word 作品', description: `「${name}」已合并为 ${r.chapters} 章：${r.path}` })
        return
      }
      if (r.cancelled) return
      toast.add({ kind: 'error', title: '导出失败', description: r.error ?? '未知错误' })
    } catch (e) {
      toast.add({ kind: 'error', title: '导出失败', description: String((e as Error).message ?? e) })
    }
  }

  /** 作品编译 v1.2＝EPUB 导出（mac 系统 zip 打包 EPUB3 容器；win/linux 优雅回退 Markdown） */
  async function exportCompiledEpub(id: string, name: string) {
    try {
      const r = await window.zhijuan.compileExportEpub(id)
      if (r.ok) {
        toast.add({ kind: 'success', title: '已导出 EPUB 作品', description: `「${name}」已合并为 ${r.chapters} 章：${r.path}` })
        return
      }
      if (r.cancelled) return
      toast.add({ kind: 'error', title: '导出失败', description: r.error ?? '未知错误' })
    } catch (e) {
      toast.add({ kind: 'error', title: '导出失败', description: String((e as Error).message ?? e) })
    }
  }

  /** 更改库根路径（模块设计 §四 A「库根路径（可改）」）：系统目录选择器 → 写入设置 → 刷新列表 */
  async function changeLibRoot() {
    try {
      const dir = await window.zhijuan.pickLibrary()
      if (!dir) return
      setLibPath(dir)
      void refresh()
      toast.add({ kind: 'success', title: '已更改项目库', description: `项目库已切换为 ${dir}` })
    } catch (e) {
      toast.add({ kind: 'error', title: '更改项目库失败', description: String((e as Error).message ?? e) })
    }
  }

  // 过滤 + 排序：最近打开优先，其余按最近编辑
  const visible = orderProjects(projects, recents, query)

  return (
    <div className="flex h-full flex-col">
      {/* 项目网格 */}
      <main className="flex-1 overflow-auto p-6">
        {/* 工具条：搜索过滤 + 排序说明（窄窗口不换行，truncate） */}
        <div className="mb-4 flex items-center gap-3">
          <div className="relative w-64 shrink-0">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
            <Input
              ref={searchRef}
              type="text"
              data-testid="home-search"
              className="pl-8 pr-8"
              placeholder="按名称或简介过滤…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // HIG Search fields：Clear button + macOS 搜索框惯例（Esc 清空查询、焦点留在框内）；
                // 不依赖浏览器对 type=search 的原生 clear/Esc（样式不可控、非键盘可达，且跨内核行为不一）。
                if (e.key === 'Escape' && query) {
                  e.preventDefault()
                  e.stopPropagation()
                  setQuery('')
                }
              }}
            />
            {query && (
              <button
                type="button"
                data-testid="home-search-clear"
                aria-label="清空搜索"
                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-ink-3 transition-colors hover:text-ink active:text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                onClick={() => {
                  setQuery('')
                  searchRef.current?.focus()
                }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <p className="truncate text-xs text-ink-3">
            {loading ? '正在读取项目库…' : loadErr ? '项目库读取失败' : `共 ${projects.length} 个项目`}
            {!loading && !loadErr && query.trim() && ` · 命中 ${visible.length}`}
          </p>
          <div className="flex-1" />
          <p className="hidden shrink-0 text-xs text-ink-3 sm:block">排序：最近打开优先 · 未打开的按最近编辑</p>
          {/* 主操作区（2026-09-14 顶栏合并：原 header 按钮上移至工具条，窄窗口不换行） */}
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setImporting(true)} data-testid="home-import-dir">
              <FolderOpen /> 导入目录
            </Button>
            <Button size="sm" onClick={() => setCreating(true)} data-testid="home-new-project">
              <Plus /> 新建项目
            </Button>
          </div>
        </div>
        {loading && (
          <div className="flex items-center justify-center gap-2 pt-20 text-sm text-ink-3">
            <LoadingIndicator size={16} />
            <span>正在读取项目库…</span>
          </div>
        )}
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
            hint="点上方「新建项目」开始第一本，或导入一个已有目录。"
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
              <Card
                key={p.id}
                role="button"
                tabIndex={0}
                aria-label={`打开项目 ${p.name}`}
                className="group zj-card-lift cursor-pointer overflow-hidden hover:-translate-y-1 hover:border-hair-strong hover:shadow-[var(--shadow)] active:brightness-95"
                onClick={() => openProject(p.id)}
                onKeyDown={(e) => {
                  // 键盘等价（HIG Focus and selection「Keyboard equivalence」）：仅卡片自身聚焦时触发，
                  // 卡内子控件（如「更多操作」按钮）按键不得冒泡引发打开项目
                  if (e.target !== e.currentTarget) return
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    openProject(p.id)
                  }
                }}
              >
                {/* 纯文本封面（横版适中；无封面图不模拟材质，用文字排版撑质感；主人 2026-09-12 反馈 v4） */}
                <div className="relative aspect-[16/9] overflow-hidden">
                  <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)` }} />
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{ backgroundImage: 'radial-gradient(120% 70% at 50% -10%, rgba(255,255,255,0.09), transparent 55%)' }}
                  />
                  {/* 居中文本排版：书名 + 装饰线 + 元信息（纯文本封面） */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 px-6 text-center">
                    <h2 className="line-clamp-2 font-serif text-xl font-semibold leading-snug text-white drop-shadow-sm" title={p.name}>{p.name}</h2>
                    <span className="h-px w-8 bg-white/35" />
                    <p className="truncate text-[11px] text-white/60" data-testid="zj-card-stats" title={`${p.stats.chapters} 章 · 人物 ${p.stats.characters} · 素材 ${p.stats.materials}`}>{p.stats.chapters} 章 · 人物 {p.stats.characters} · 素材 {p.stats.materials}</p>
                  </div>
                </div>
                {/* 信息区 */}
                <div className="flex items-start gap-2 border-t border-hair bg-surface-2/60 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-ink-2" title={p.description || '（无简介）'}>{p.description || '（无简介）'}</p>
                    <p className="mt-1 truncate text-[11px] text-ink-3" title={`${p.lastChapter ? `最近：${p.lastChapter}` : '还没有章节'} · ${new Date(p.updatedAt).toLocaleDateString('zh-CN')}`}>
                      {p.lastChapter ? `最近：${p.lastChapter}` : '还没有章节'} · {new Date(p.updatedAt).toLocaleDateString('zh-CN')}
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-ink-3 hover:text-ink data-[state=open]:bg-well data-[state=open]:text-ink" title="更多操作" aria-label="更多操作">
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
                      <DropdownMenuItem onClick={(e) => {
                        e.stopPropagation()
                        void exportTo(p.id, p.name)
                      }}>
                        <FolderOutput className="h-4 w-4" /> 导出到…
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={(e) => {
                        e.stopPropagation()
                        void exportCompiled(p.id, p.name)
                      }}>
                        <FileDown className="h-4 w-4" /> 导出作品（合并 Markdown）
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={(e) => {
                        e.stopPropagation()
                        void exportCompiledDocx(p.id, p.name)
                      }}>
                        <FileText className="h-4 w-4" /> 导出作品（Word）
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={(e) => {
                        e.stopPropagation()
                        void exportCompiledEpub(p.id, p.name)
                      }}>
                        <BookOpen className="h-4 w-4" /> 导出作品（EPUB）
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

      {/* 底栏：当前项目库（模块设计 §四 A「底栏：当前库根」+「库根路径（可改）」；窄窗口不换行） */}
      <footer className="flex items-center gap-2 border-t border-hair bg-surface px-6 py-1.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] text-ink-3" title={libPath ? `项目库：${libPath}` : undefined} data-testid="home-libroot">
            当前项目库：{libPath ?? (loading ? '读取中…' : '—')}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 whitespace-nowrap px-2 text-xs text-ink-2"
          onClick={() => void changeLibRoot()}
        >
          更改库根路径…
        </Button>
      </footer>

      {/* 新建项目 */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-md" outsideDismiss={false}>
          <DialogHeader>
            <DialogTitle>新建项目</DialogTitle>
            <DialogDescription>每个项目一部作品，完全独立，纯文档维护。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>项目名</Label>
              <Input
                autoFocus
                placeholder="如：山那边"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  // IME 组合期 Enter 只确认候选，不建项目（F-IME-03）
                  if (isImeComposing(e)) return
                  if (e.key === 'Enter') void create()
                }}
              />
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
                      {/* 显示名去重：内建模板名恰为「示例」时不再叠「示例（示例）」（与 src/main/templates.ts BUILTIN_SAMPLE 对齐） */}
                      {t.builtin && t.name !== '示例' ? `示例（${t.name}）` : t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-ink-3">选「示例」会带一份人物档案、切片设定和一章示例正文，可随时删除；自定义模板放在 工作区/模板/项目模板/ 下。</p>
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
        <DialogContent className="max-w-md" outsideDismiss={false}>
          <DialogHeader>
            <DialogTitle>导入已有目录</DialogTitle>
            <DialogDescription>选择一个已有作品文件夹，织卷会把它复制进项目库并补全骨架（生成 project.md），不覆盖已有内容；原目录保留不动。</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>目录路径</Label>
            <div className="flex items-center gap-2">
              <Input
                placeholder="/Users/你/某个已有作品目录"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                onKeyDown={(e) => {
                  // IME 组合期 Enter 只确认候选，不导入目录（F-IME-03）
                  if (isImeComposing(e)) return
                  if (e.key === 'Enter') void importDir()
                }}
              />
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
