import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, Outlet, useSearchParams } from 'react-router-dom'
import type { FsEvent, ProjectSummary } from '../../../shared/types'
import SectionNav, { type NavCounts } from '../features/nav/SectionNav'
import LoadingIndicator from '../components/LoadingIndicator'
import { useProposalStore } from '../store/proposals'
import ProposalDrawer from '../features/proposals/ProposalDrawer'
import ProjectGuide from '../features/guide/ProjectGuide'
import { toast } from '../store/toasts'
import { useAppStore } from '../store/app'

const emptyCounts: NavCounts = { novel: 0, characters: 0, worldview: 0, outline: 0, library: 0 }

export default function Workspace() {
  const { id } = useParams<{ id: string }>()
  const [sp, setSp] = useSearchParams()
  const [guideOpen, setGuideOpen] = useState(() => sp.get('guide') === '1')
  // 引导「现在新建第一章」信号：递增计数传给 Outlet context，Novel 据此打开建章对话框
  const [newChapterReq, setNewChapterReq] = useState(0)
  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [counts, setCounts] = useState<NavCounts>(emptyCounts)
  // 读取失败与「项目不存在」要分开呈现：listProjects 异常不是「项目没了」（误报曾把加载失败显示成“项目不存在”）
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadErr, setLoadErr] = useState('')
  const readyRef = useRef(false)
  // 批注定时优化开关（主人 2026-09-12 定：默认关，走设置页「批注定时优化」；开启才挂定时器）
  const annotationsEnabled = useAppStore((s) => s.settings?.annotationsEnabled ?? false)

  // 批注定时优化（主人 2026-09-12）：仅设置开启时——打开项目 10s 后首扫 + 每 30 分钟静默扫描；
  // 只在「生成了提案 / 发现了但没能生成」时 toast，无批注时保持安静；关闭=完全不扫（手动按钮不受影响，见提案抽屉）
  useEffect(() => {
    if (!id || loadState !== 'ready' || !annotationsEnabled) return
    let disposed = false
    const run = async () => {
      try {
        const r = await window.zhijuan.scanAnnotations(id)
        if (disposed) return
        if (r.generated > 0) {
          toast.add({ kind: 'success', title: '批注定时优化', description: r.note })
          refreshProposals()
        } else if (r.found > 0) {
          toast.add({ kind: 'warning', title: '批注定时优化', description: r.note })
        }
      } catch {
        /* 静默：扫描器失败不打扰写作 */
      }
    }
    const t1 = window.setTimeout(() => void run(), 10000)
    const iv = window.setInterval(() => void run(), 30 * 60 * 1000)
    return () => {
      disposed = true
      window.clearTimeout(t1)
      window.clearInterval(iv)
    }
  }, [id, loadState, annotationsEnabled])

  const refreshAll = useCallback(async () => {
    if (!id) return
    try {
      // 致命项：本项目的存在性（查不到 = 项目没了）
      const list = await window.zhijuan.listProjects()
      setProject(list.find((p) => p.id === id) ?? null)
      // 非致命项：侧栏计数（失败不打断页面，各页自持错误态；Novel 列表失败会在正文页里显示自己的错误卡）
      try {
        const [chs, chars, world, outline, lib] = await Promise.all([
          window.zhijuan.listChapters(id),
          window.zhijuan.listDocs(id, '人物'),
          window.zhijuan.listDocs(id, '世界观'),
          window.zhijuan.listDocs(id, '大纲'),
          window.zhijuan.listDocs(id, '素材库')
        ])
        setCounts({
          novel: chs.length,
          characters: chars.filter((d) => d.file !== '人物/总览.md').length,
          worldview: world.filter((d) => d.file !== '世界观/总纲.md').length,
          outline: outline.filter((d) => d.file !== '索引.md').length,
          library: lib.filter((d) => !d.file.startsWith('素材库/采集池')).length
        })
      } catch {
        // 非致命：保留旧计数
      }
      readyRef.current = true
      setLoadState('ready')
    } catch (e) {
      // 后台（fs 事件触发）刷新失败不打断已就绪页面，保留旧数据；仅首次失败才进错误态
      if (!readyRef.current) {
        setLoadErr(String((e as Error).message ?? e))
        setLoadState('error')
      }
    }
  }, [id])

  useEffect(() => {
    if (!id) return
    void window.zhijuan.openProject(id)
    void refreshAll()
    const off = window.zhijuan.onFsEvent((evt: FsEvent) => {
      if (evt.projectId === id) void refreshAll()
    })
    return off
  }, [id, refreshAll])

  const proposals = useProposalStore((s) => s.list)
  const tick = useProposalStore((s) => s.tick)
  const pending = proposals.filter((p) => p.status === 'pending').length
  const stale = proposals.filter((p) => p.status === 'stale').length
  const [drawerOpen, setDrawerOpen] = useState(false)
  // 浮条「查看提案」直达定位（2026-09-20 候选 3 可行动性）：Novel 等子页经 zj:open-proposals
  // 事件请求打开抽屉并定位某张卡（跨章同款聚合后提示与卡可能异章）
  const [focusId, setFocusId] = useState<string | undefined>(undefined)
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<{ focusId?: string }>).detail
      setDrawerOpen(true)
      setFocusId(d?.focusId)
    }
    window.addEventListener('zj:open-proposals', h)
    return () => window.removeEventListener('zj:open-proposals', h)
  }, [])
  const refreshProposals = useCallback(() => {
    if (id) void useProposalStore.getState().refresh(id)
  }, [id])
  useEffect(() => {
    refreshProposals()
  }, [refreshProposals, tick])

  if (loadState === 'loading') {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-ink-3">
        <LoadingIndicator size={16} />
        <span>正在打开项目…</span>
      </div>
    )
  }
  if (loadState === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm">
        <p className="text-danger">打开项目失败</p>
        <p className="max-w-md break-all text-center text-xs text-ink-3">{loadErr}</p>
        <button
          className="text-xs text-accent underline-offset-2 hover:underline"
          onClick={() => {
            readyRef.current = false
            setLoadState('loading')
            void refreshAll()
          }}
        >
          重试
        </button>
      </div>
    )
  }
  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-3">项目不存在或已被删除。</div>
    )
  }

  return (
    <div className="flex h-full">
      <SectionNav projectId={project.id} projectName={project.name} counts={counts} pending={pending} stale={stale} onOpenProposals={() => setDrawerOpen(true)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">
          <Outlet context={{ newChapterReq }} />
        </div>
      </div>
      {drawerOpen && (
        <ProposalDrawer projectId={project.id} list={proposals} onChanged={refreshProposals} focusId={focusId} onClose={() => { setDrawerOpen(false); setFocusId(undefined) }} />
      )}
      <ProjectGuide
        projectId={project.id}
        projectName={project.name}
        open={guideOpen}
        onClose={(action) => {
          setGuideOpen(false)
          setSp({}, { replace: true })
          if (action === 'start-chapter') setNewChapterReq((n) => n + 1)
        }}
      />
    </div>
  )
}
