import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, Outlet, useSearchParams } from 'react-router-dom'
import type { FsEvent, ProjectSummary } from '../../../shared/types'
import SectionNav, { type NavCounts } from '../features/nav/SectionNav'
import { ListChecks } from 'lucide-react'
import { useProposalStore } from '../store/proposals'
import ProposalDrawer from '../features/proposals/ProposalDrawer'
import ProjectGuide from '../features/guide/ProjectGuide'

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
  const refreshProposals = useCallback(() => {
    if (id) void useProposalStore.getState().refresh(id)
  }, [id])
  useEffect(() => {
    refreshProposals()
  }, [refreshProposals, tick])

  if (loadState === 'loading') {
    return <div className="flex h-full items-center justify-center text-sm text-ink-3">正在打开项目…</div>
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
      <SectionNav projectId={project.id} projectName={project.name} counts={counts} />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 顶栏：不再放区块标题标签（左侧导航已有高亮）；有待确认/已过期提案时出一行入口（过期也要可查看清除） */}
        {(pending + stale) > 0 && (
          <header className="flex h-10 shrink-0 items-center justify-end border-b border-hair bg-surface px-4">
            <button onClick={() => setDrawerOpen(true)} className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-warn-soft px-2.5 py-1 text-xs text-warn transition-colors hover:brightness-95">
              <ListChecks className="h-3.5 w-3.5" />
              {pending > 0 ? `待确认提案 ${pending}` : `已过期提案 ${stale}`}
            </button>
          </header>
        )}
        <div className="min-h-0 flex-1">
          <Outlet context={{ newChapterReq }} />
        </div>
      </div>
      {drawerOpen && (
        <ProposalDrawer projectId={project.id} list={proposals} onChanged={refreshProposals} onClose={() => setDrawerOpen(false)} />
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
