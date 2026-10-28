import { useCallback, useEffect, useRef, useState } from 'react'
import { useMatch, useNavigate, useSearchParams } from 'react-router-dom'
import { useAppStore, applyTheme } from '../store/app'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Separator } from '../components/ui/separator'
import { Switch } from '../components/ui/switch'
import { Card } from '../components/ui/card'
import { cn } from '../lib/utils'
import { ArrowLeft, Keyboard, Plus, Trash2, FileUp, FileDown, RefreshCw, RotateCw, Download, FolderOpen } from 'lucide-react'
import LoadingIndicator from '../components/LoadingIndicator'
import ShortcutHelp from '../features/command/ShortcutHelp'
import { toast } from '../components/ui/toast'
import { PROVIDER_PRESETS, providerById } from '../../../shared/providers'
import { normalizeOveruseDict } from '../../../shared/wordfreq'
import { isImeComposing } from '../lib/ime'
import SkillSettingsCard from '../features/skills/SkillSettingsCard'
import type { AppDiagnostics, AppSettings, ForensicsEntry, LlmProviderCfg, LlmProviderId } from '../../../shared/types'
import type { SettingsPaneKey } from '../../../shared/types'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 pb-4">
      <Label className="text-sm font-medium text-ink">{label}</Label>
      {children}
      {hint && <p className="min-w-0 text-xs leading-5 text-ink-3">{hint}</p>}
    </div>
  )
}

/** 取证文件大小（B/KB/MB） */
function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** 修改时间 → 「MM-DD HH:mm」 */
function fmtMtime(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 设置页一级分区（将来加配置先挂到这里，保证布局稳定） */
const SECTIONS = [
  { key: 'workspace', label: '工作区与项目', hint: '工作区、项目库与文档落档', icon: 'Folder' },
  { key: 'engine', label: '写作引擎', hint: '模型连接、常用工具与运行', icon: 'Sparkles' },
  { key: 'look', label: '外观与数据', hint: '主题与联网采集', icon: 'Palette' },
  { key: 'about', label: '关于', hint: '版本与本地数据', icon: 'Info' }
] as const
type SectionKey = (typeof SECTIONS)[number]['key']
const SECTION_KEYS: SettingsPaneKey[] = SECTIONS.map((s) => s.key)

export default function Settings() {
  const { settings, settingsErr, loadSettings, updateSettings } = useAppStore()
  const [workspacePath, setWorkspacePath] = useState('')
  const [wsInfo, setWsInfo] = useState<{ dir: string; inited: boolean; docs: { file: string; name: string }[] } | null>(null)
  const [libPath, setLibPath] = useState<string | null>(null)
  const [openDoc, setOpenDoc] = useState<string | null>(null)
  const [openDocBody, setOpenDocBody] = useState('')
  const [wsMsg, setWsMsg] = useState('')
  const [provider, setProvider] = useState<LlmProviderId>('local')
  const [provApiKey, setProvApiKey] = useState('')
  const [provBaseUrl, setProvBaseUrl] = useState('')
  const [provModel, setProvModel] = useState('')
  const [llmCheck, setLlmCheck] = useState<{ ok: boolean; step?: string; status: number; message: string; body?: string; baseUrl?: string; model?: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const [engStatus, setEngStatus] = useState<{ online: boolean; provider?: string; model?: string; message?: string } | null>(null)
  const [restarting, setRestarting] = useState(false)
  const [libraryRoot, setLibraryRoot] = useState('')
  const [theme, setTheme] = useState<'paper' | 'dark'>('paper')
  const [collection, setCollection] = useState(true)
  const [annotations, setAnnotations] = useState(false)
  const [writingInsights, setWritingInsights] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [typewriter, setTypewriter] = useState(false)
  const [guide, setGuide] = useState(true)
  const [shortcutOpen, setShortcutOpen] = useState(false)
  const [tools, setTools] = useState({ todo: true, askUser: true })
  const [caps, setCaps] = useState<Record<string, boolean>>({})
  const [capsMeta, setCapsMeta] = useState<{ id: string; title: string; description?: string }[]>([])
  const [overuseList, setOveruseList] = useState<string[]>([])
  const [overuseDraft, setOveruseDraft] = useState('')
  const [overuseMsg, setOveruseMsg] = useState('')
  const [saved, setSaved] = useState(false)
  const [saveErr, setSaveErr] = useState('')
  // 即时写盘类开关的失败态（2026-10-27 可见性 P1）：写盘失败 → 回滚开关 + 内联红字 + toast。
  // 与 saveErr（保存按钮）分开：开关是「点即生效」，失败必须就地说明，不能混在保存状态里。
  const [settingErr, setSettingErr] = useState('')
  // 诊断与取证（2026-10-27 可见性 C/E）
  const [diagBusy, setDiagBusy] = useState(false)
  const [diagMsg, setDiagMsg] = useState('')
  const [forensics, setForensics] = useState<ForensicsEntry[] | null>(null)
  const [forensicsErr, setForensicsErr] = useState('')
  const [tailOpen, setTailOpen] = useState<Record<string, boolean>>({})
  const [section, setSection] = useState<SectionKey>('workspace')
  // 返回目标：项目内设置（/project/:id/settings）回原项目正文页，全局设置（/settings）回项目列表。
  const projMatch = useMatch('/project/:id/*')
  const projectId = projMatch?.params.id ?? null
  const navigate = useNavigate()
  // ?pane=<分区>：外部深链直达分区（大纲空态「去设置配置引擎」等），消费后清参
  const [sp, setSp] = useSearchParams()
  const paneParam = sp.get('pane')
  // 版本单一来源：主进程 app.getVersion()（与系统「关于」面板同源）；读取失败不阻塞页面
  const [appVer, setAppVer] = useState('')
  // HIG Settings「Restore the most recently viewed pane」：打开回到上次分区（即时写盘 settingsPane）。
  // touched ref 防「设置异步加载完成时覆盖用户已点选的新 pane」——仅首次加载未触碰时恢复持久化值。
  const paneTouched = useRef(false)

  /** 选择分区：即时写盘上次 pane（HIG macOS Settings 惯例） */
  function selectPane(k: SectionKey) {
    paneTouched.current = true
    setSection(k)
    void updateSettings({ settingsPane: k as SettingsPaneKey }).catch(() => {})
  }

  const refreshWorkspace = useCallback(async () => {
    try {
      const st = await window.zhijuan.workspaceStatus()
      setWsInfo(st)
    } catch {
      setWsInfo(null)
    }
  }, [])

  const refreshLibrary = useCallback(async () => {
    try {
      const p = await window.zhijuan.getPaths()
      setLibPath(p.documents || null)
    } catch {
      setLibPath(null)
    }
  }, [])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  // 版本：唯一来源主进程 app.getVersion()（失败留空，不显示假版本号）
  useEffect(() => {
    void window.zhijuan
      .appVersion()
      .then((v) => setAppVer(String(v ?? '')))
      .catch(() => setAppVer(''))
  }, [])

  // ?pane=<分区> 深链：消费后清参（与 novel?ch= / library?doc= 同策略，刷新不残留）
  useEffect(() => {
    if (!paneParam) return
    if ((SECTION_KEYS as string[]).includes(paneParam)) {
      paneTouched.current = true
      setSection(paneParam as SectionKey)
    }
    setSp({}, { replace: true })
  }, [paneParam, setSp])

  useEffect(() => {
    if (!settings) return
    // 恢复上次 pane（HIG Settings「Restore the most recently viewed pane」）；用户已主动点选则尊重
    if (!paneTouched.current && SECTION_KEYS.includes(settings.settingsPane)) {
      setSection(settings.settingsPane)
    }
    setWorkspacePath(settings.workspace)
    const llm = settings.llm ?? { active: 'local' as LlmProviderId, providers: {} }
    setProvider(llm.active)
    const pc = llm.providers?.[llm.active] ?? {}
    setProvApiKey(pc.apiKey ?? '')
    setProvBaseUrl(pc.baseUrl ?? '')
    setProvModel(pc.model ?? '')
    setLibraryRoot(settings.libraryRoot)
    setTheme(settings.theme)
    setCollection(settings.collectionEnabled)
    setAnnotations(settings.annotationsEnabled ?? false)
    setWritingInsights(settings.writingInsightsEnabled ?? false)
    setFocusMode(settings.focusModeEnabled ?? false)
    setTypewriter(settings.typewriterEnabled ?? false)
    setGuide(settings.guideEnabled ?? true)
    setTools({ todo: settings.agentTools?.todo ?? true, askUser: settings.agentTools?.askUser ?? true })
    setCaps(settings.capabilities ?? {})
    setOveruseList(normalizeOveruseDict(settings.overuseDict))
    void window.zhijuan.agentListCapabilities().then(setCapsMeta).catch(() => {})
    void refreshWorkspace()
    void refreshLibrary()
  }, [settings, refreshWorkspace, refreshLibrary])

  /** 切换服务商：同时把可编辑字段换成该家已存的值 */
  /** 即时切换 agent 能力开关（写设置；下次运行该能力时生效）；写盘失败回滚，不假装已改 */
  function toggleCap(id: string, on: boolean) {
    const prev = caps
    const next = { ...caps, [id]: on }
    setCaps(next)
    void applySetting({ capabilities: next }, () => setCaps(prev), '检查能力开关')
  }

  // ===== 自定义用词词表（智能层数据链 2026-09-21 移交：清洗闸=normalizeOveruseDict，勿另写） =====
  /** 写入即生效（与本区开关族同口径）；统一走 normalizeOveruseDict 清洗 */
  function writeOveruseList(next: string[]) {
    const norm = normalizeOveruseDict(next)
    setOveruseList(norm)
    void updateSettings({ overuseDict: norm }).catch(() => setOveruseMsg('保存失败，请重试'))
  }
  function addOveruse() {
    const p = overuseDraft.trim()
    if (!p) return
    if (overuseList.includes(p)) {
      setOveruseMsg(`「${p}」已在词表中`)
      return
    }
    writeOveruseList([...overuseList, p])
    setOveruseDraft('')
    setOveruseMsg(`已添加「${p}」，下次「用词重复核查」生效`)
  }
  function removeOveruse(p: string) {
    writeOveruseList(overuseList.filter((x) => x !== p))
  }
  function clearOveruse() {
    writeOveruseList([])
    setOveruseMsg('已清空自定义词条，仅使用内置词表')
  }
  async function importOveruse() {
    const r = await window.zhijuan.importOveruseTxt()
    if (r.cancelled) return
    if (!r.ok || !r.lines) {
      setOveruseMsg(`导入失败：${r.error ?? '未知错误'}`)
      return
    }
    const merged = normalizeOveruseDict([...overuseList, ...r.lines])
    const added = merged.length - overuseList.length
    writeOveruseList(merged)
    setOveruseMsg(added > 0 ? `已导入 ${added} 条短语（按每行一条读取）` : '没有新增（导入内容与现有重复）')
  }
  async function exportOveruse() {
    if (!overuseList.length) return
    const r = await window.zhijuan.exportOveruseTxt(overuseList)
    if (r.cancelled) return
    if (!r.ok) {
      setOveruseMsg(`导出失败：${r.error ?? '未知错误'}`)
      return
    }
    setOveruseMsg(`已导出 ${overuseList.length} 条 → ${r.path}`)
  }

  function selectProvider(id: LlmProviderId) {
    const pc = (settings?.llm?.providers?.[id] ?? {}) as LlmProviderCfg
    setProvider(id)
    setProvModel(pc.model ?? '')
    setProvApiKey(pc.apiKey ?? '')
    setProvBaseUrl(pc.baseUrl ?? '')
  }
  /** 连接检测（2026-10-26）：用当前填的配置发最小请求，返回断点诊断供排查「连不上/看不了日志」。 */
  function runLlmCheck() {
    setChecking(true)
    void window.zhijuan
      .checkLlmConnection({ provider, model: provModel, baseUrl: provBaseUrl, apiKey: provApiKey })
      .then((r) => setLlmCheck(r))
      .catch((e) => setLlmCheck({ ok: false, step: 'error', status: 0, message: String((e as Error)?.message ?? e) }))
      .finally(() => setChecking(false))
  }
  /** 引擎状态（2026-10-26 主人「连接成功但引擎离线」）：拉 agentStatus，离线时展示详细诊断并可复制。 */
  function refreshEngine() {
    void window.zhijuan
      .agentStatus()
      .then(setEngStatus)
      .catch(() => setEngStatus({ online: false, message: '获取引擎状态失败' }))
  }
  /** 重启引擎（2026-10-27 鲁棒性）：关掉旧子进程重新拉起——引擎崩溃后不必重启整个应用；
   * 失败沿用诊断串展示（engine:restart 与 agent:status 同形返回）。devShim 无此方法时退回刷新。 */
  function restartEngine() {
    setRestarting(true)
    setEngStatus(null)
    const api = window.zhijuan
    const call = api.engineRestart ? api.engineRestart() : api.agentStatus()
    void call
      .then(setEngStatus)
      .catch((e) => setEngStatus({ online: false, message: '重启引擎失败：' + String((e as Error)?.message ?? e) }))
      .finally(() => setRestarting(false))
  }
  useEffect(() => { refreshEngine() }, [])

  // ===== 即时写盘（2026-10-27 可见性 P1）=====
  /** 开关/主题这类「点了就写」的设置：失败必须回滚并说出来。
   * 旧形态 `void updateSettings(...)` 无 catch——写盘失败（权限/磁盘满/settings.json 损坏）时
   * 开关已翻、界面显示已改，设置其实没落盘，下次启动又变回去，作者无从判断哪个是真的。 */
  async function applySetting(patch: Partial<AppSettings>, rollback: () => void, label: string): Promise<boolean> {
    setSettingErr('')
    try {
      await updateSettings(patch)
      return true
    } catch (e) {
      rollback()
      const msg = `「${label}」保存失败：${String((e as Error)?.message ?? e)}（已恢复原状）`
      setSettingErr(msg)
      toast.add({ kind: 'error', title: '设置未能保存', description: msg })
      return false
    }
  }

  // ===== 诊断与取证（2026-10-27 可见性 C/E）=====
  /** 一次性诊断快照（版本/平台/引擎/路径/日志尾）+ 导出时的上下文 */
  async function collectDiagnostics(): Promise<Record<string, unknown> | null> {
    try {
      const d: AppDiagnostics = await window.zhijuan.diagnostics()
      return {
        ...d,
        exportedAt: new Date().toISOString(),
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        settings: { theme: settings?.theme, workspace: settings?.workspace, libraryRoot: settings?.libraryRoot, provider: settings?.llm?.active }
      }
    } catch (e) {
      setDiagMsg(`读取诊断失败：${String((e as Error)?.message ?? e)}`)
      return null
    }
  }

  async function exportDiagnostics() {
    setDiagBusy(true)
    setDiagMsg('')
    try {
      const payload = await collectDiagnostics()
      if (!payload) return
      const r = await window.zhijuan.diagnosticsExport(payload)
      setDiagMsg(r.cancelled ? '已取消导出' : r.ok ? `已导出 → ${r.path}` : `导出失败：${r.error ?? '未知错误'}`)
    } catch (e) {
      setDiagMsg(`导出失败：${String((e as Error)?.message ?? e)}`)
    } finally {
      setDiagBusy(false)
    }
  }

  async function copyDiagnostics() {
    setDiagMsg('')
    const payload = await collectDiagnostics()
    if (!payload) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
      setDiagMsg('诊断快照已复制到剪贴板')
    } catch (e) {
      setDiagMsg(`复制失败：${String((e as Error)?.message ?? e)}`)
    }
  }

  async function openLogDir() {
    setDiagMsg('')
    try {
      const r = await window.zhijuan.openLogDir()
      setDiagMsg(r.ok ? `已打开日志目录：${r.path ?? ''}` : `打开失败：${r.error ?? '未知错误'}`)
    } catch (e) {
      setDiagMsg(`打开失败：${String((e as Error)?.message ?? e)}`)
    }
  }

  async function revealForensics(p: string) {
    setDiagMsg('')
    try {
      const r = await window.zhijuan.revealPath(p)
      if (!r.ok) setDiagMsg(`定位失败：${r.error ?? '未知错误'}`)
    } catch (e) {
      setDiagMsg(`定位失败：${String((e as Error)?.message ?? e)}`)
    }
  }

  function loadForensics() {
    setForensicsErr('')
    window.zhijuan
      .forensics(projectId)
      .then(setForensics)
      .catch((e: unknown) => {
        setForensics(null)
        setForensicsErr(`读取取证清单失败：${String((e as Error)?.message ?? e)}`)
      })
  }

  // 关于页才拉取证清单（含项目 .zhijuan 三件套）：进项目内设置时带 projectId，全局设置只看主进程日志
  useEffect(() => {
    if (section === 'about') loadForensics()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, projectId])

  async function save() {
    const cur = settings?.llm ?? { active: 'local' as LlmProviderId, providers: {} }
    const providers = { ...(cur.providers ?? {}) }
    // 空字段不落盘：用厂商预设默认；被清空的 apiKey 即从本机移除
    providers[provider] = {
      ...(provApiKey.trim() ? { apiKey: provApiKey.trim() } : {}),
      ...(provBaseUrl.trim() ? { baseUrl: provBaseUrl.trim() } : {}),
      ...(provModel.trim() ? { model: provModel.trim() } : {})
    }
    try {
      await updateSettings({
        workspace: workspacePath.trim(),
        llm: { active: provider, providers },
        libraryRoot: libraryRoot.trim(),
        theme,
        collectionEnabled: collection,
        annotationsEnabled: annotations,
        writingInsightsEnabled: writingInsights,
        focusModeEnabled: focusMode,
        typewriterEnabled: typewriter,
        agentTools: tools
      })
      setSaveErr('')
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
      void refreshWorkspace()
      void refreshLibrary()
    } catch (e) {
      // 写盘失败不静默（HIG：错误就地、可行动）；FieldError 同款 role=alert 语义
      setSaveErr(`设置保存失败：${String((e as Error).message ?? e)}`)
    }
  }

  async function initWorkspace() {
    setWsMsg('落档中…')
    const r = await window.zhijuan.workspaceInit()
    await refreshWorkspace()
    setWsMsg(r.created.length ? `已在工作区落档：${r.created.join('、')}` : '说明文档已就位（无需重复创建）')
    setTimeout(() => setWsMsg(''), 4000)
  }

  async function viewDoc(file: string) {
    if (openDoc === file) {
      setOpenDoc(null)
      return
    }
    const t = await window.zhijuan.workspaceRead(file)
    setOpenDoc(file)
    setOpenDocBody(t ?? '')
  }

  const cur = SECTIONS.find((s) => s.key === section)
  return (
    <div className="flex h-full">
      <aside className="flex w-52 shrink-0 flex-col gap-1 border-r border-hair bg-surface-2 p-3">
        <button
          type="button"
          data-testid="settings-back"
          onClick={() => navigate(projectId ? `/project/${projectId}/novel` : '/')}
          className="mb-2 flex shrink-0 items-center gap-1.5 rounded-md border border-hair px-2 py-1.5 text-xs text-ink-2 transition-colors hover:border-accent hover:text-accent"
          title={projectId ? '返回项目（正文创作）' : '返回项目列表'}
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          <span>{projectId ? '返回项目' : '返回'}</span>
        </button>
        <div className="mb-2 flex items-center gap-2 px-1 py-1">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-xs font-bold text-accent-ink">织</span>
          <span className="text-sm font-semibold">设置</span>
        </div>
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => selectPane(s.key)}
            className={cn(
              'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
              section === s.key ? 'bg-accent-soft' : 'hover:bg-surface'
            )}
          >
            <span
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold',
                section === s.key ? 'bg-accent text-accent-ink' : 'bg-surface text-ink-3'
              )}
            >
              {s.label.slice(0, 1)}
            </span>
            <span className="min-w-0">
              <span className={cn('block truncate text-sm', section === s.key ? 'font-medium text-accent' : 'text-ink')} title={s.label}>{s.label}</span>
              <span className="block truncate text-[10px] text-ink-3" title={s.hint}>{s.hint}</span>
            </span>
          </button>
        ))}
        <div className="flex-1" />
        <p className="px-2 text-[10px] leading-relaxed text-ink-3">全部保存在本机，明文可进版本库。</p>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto">
        {/* 设置读取失败：不静默回退默认值（防止误改覆盖原配置）；提供重试路径（HIG Alerts：内联+下一步动作） */}
        {!settings && settingsErr ? (
          <div className="mx-auto mt-16 max-w-sm rounded-xl border border-dashed border-danger/40 p-8 text-center">
            <p className="text-sm font-medium text-danger">读取设置失败</p>
            <p className="mt-1 break-all text-xs text-ink-3">{settingsErr}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => {
                useAppStore.setState({ settingsErr: '' })
                void loadSettings()
              }}
            >
              重试
            </Button>
          </div>
        ) : !settings ? (
          <div className="flex items-center justify-center gap-2 pt-20 text-sm text-ink-3">
            <LoadingIndicator size={16} />
            <span>正在读取设置…</span>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl p-8">
          <div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
            <div>
              <h2 className="text-lg font-semibold">{cur?.label}</h2>
              <p className="mt-0.5 text-sm text-ink-3">{cur?.hint}</p>
            </div>
            <div className="flex items-center gap-2">
              {saved && !saveErr && <span className="text-xs text-success">已保存 ✓</span>}
              {saveErr && (
                <span role="alert" className="max-w-56 truncate text-xs text-danger" title={saveErr}>
                  {saveErr}
                </span>
              )}
              <Button onClick={() => void save()}>保存设置</Button>
            </div>
          </div>

          {/* 即时写盘失败（2026-10-27）：开关已回滚，这里留可读原因（role=alert 让读屏也听到） */}
          {settingErr && (
            <div
              role="alert"
              data-testid="setting-err"
              className="mt-4 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2"
            >
              <p className="min-w-0 flex-1 break-all text-xs leading-5 text-danger">{settingErr}</p>
              <button
                type="button"
                aria-label="关闭提示"
                className="shrink-0 rounded px-1 text-xs text-ink-3 transition-colors hover:text-ink"
                onClick={() => setSettingErr('')}
              >
                ×
              </button>
            </div>
          )}

          {section === 'workspace' && (
            <>
              <Card className="mt-6 p-6">
                <h3 className="text-sm font-semibold text-ink-2">工作区</h3>
        <Separator className="my-4" />
        <Field label="工作区路径" hint="留空用默认：~/Documents/织卷工作区。相关的说明文档、项目库都在这里落档。">
          <Input value={workspacePath} onChange={(e) => setWorkspacePath(e.target.value)} placeholder="如：~/Documents/织卷工作区" />
        </Field>
        <div className="flex items-center justify-between rounded-lg border border-hair bg-surface-2 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-xs text-ink-2" title={wsInfo ? wsInfo.dir : undefined}>当前：{wsInfo ? wsInfo.dir : '读取中…'}</p>
            <p className="text-[11px] text-ink-3">
              {wsInfo ? (wsInfo.inited ? `已落档 ${wsInfo.docs.length} 篇说明文档` : '尚未落档说明文档') : ''}
            </p>
          </div>
          <Button size="sm" variant="outline" className="h-7 shrink-0" onClick={() => void initWorkspace()}>
            在工作区落档文档
          </Button>
        </div>
        {wsMsg && <p className="mt-2 text-xs text-success">{wsMsg}</p>}
        {wsInfo && wsInfo.docs.length > 0 && (
          <div className="mt-3 space-y-1">
            {wsInfo.docs.map((d) => (
              <div key={d.file}>
                <button className="text-xs text-accent hover:underline" onClick={() => void viewDoc(d.file)}>
                  {openDoc === d.file ? '▾' : '▸'} {d.name}
                </button>
                {openDoc === d.file && (
                  <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded border border-hair bg-surface-2 p-3 text-[11px] leading-relaxed text-ink-2">
                    {openDocBody}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

        <Card className="mt-4 p-6">
          <h3 className="text-sm font-semibold text-ink-2">项目库</h3>
          <Separator className="my-4" />
          <Field label="库根路径" hint="留空则用工作区下的默认位置（工作区/项目库），老目录还在时会先保持原地；现有项目迁移时可直接填老路径。">
            <Input value={libraryRoot} onChange={(e) => setLibraryRoot(e.target.value)} placeholder="/Users/你/Documents/织卷工作区/项目库" />
          </Field>
          <div className="flex items-center justify-between rounded-lg border border-hair bg-surface-2 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-xs text-ink-2" title={libPath ?? undefined}>当前：{libPath ?? '读取中…'}</p>
              <p className="text-[11px] text-ink-3">项目实际保存在这里（生效库根）。</p>
            </div>
          </div>
        </Card>
            </>
          )}

          {section === 'engine' && (
            <>
              <Card className="mt-6 p-6">
                <h3 className="text-sm font-semibold text-ink-2">大模型</h3>
                <Separator className="my-4" />
                <Field
                  label="服务商"
                  hint="写作引擎始终走你选中的这家；切换即完成远程模型对接。保存后下一次对话生效（本机为默认，无需任何配置）。"
                >
                  <div className="flex flex-wrap gap-1 rounded-lg border border-hair p-1" role="group" aria-label="服务商">
                    {PROVIDER_PRESETS.map((p) => (
                      <Button
                        key={p.id}
                        variant={provider === p.id ? 'default' : 'ghost'}
                        size="sm"
                        className="h-7"
                        aria-pressed={provider === p.id}
                        onClick={() => selectProvider(p.id)}
                      >
                        {p.name}
                      </Button>
                    ))}
                  </div>
                </Field>
                {(() => {
                  const p = providerById(provider)
                  if (!p) return null
                  return (
                    <>
                      <Field label="模型名" hint={p.kind === 'local' ? '本机 vLLM 部署的模型名。' : '默认给出该家官方公开型号，可改写成你的订阅 / 专属型号。'}>
                        <Input value={provModel} onChange={(e) => setProvModel(e.target.value)} placeholder={p.models[0]?.id} list="zj-model-suggest" />
                      </Field>
                      <datalist id="zj-model-suggest">{p.models.map((m) => <option key={m.id} value={m.id}>{m.note ?? ''}</option>)}</datalist>
                      {p.kind === 'remote' && (
                        <Field label="API Key" hint={p.keyHint}>
                          <Input type="password" value={provApiKey} onChange={(e) => setProvApiKey(e.target.value)} placeholder="粘贴该家的 API Key" />
                        </Field>
                      )}
                      <Field label="接入地址（高级，留空用官方默认）" hint={`默认：${p.baseURL}。改了走自定义网关 / 代理。`}>
                        <Input value={provBaseUrl} onChange={(e) => setProvBaseUrl(e.target.value)} placeholder={p.baseURL} />
                      </Field>
                      <div className="mt-1 rounded-lg border border-hair bg-surface-2 px-3 py-2.5">
                        <div className="flex items-center justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium leading-5 text-ink">连接检测</div>
                            <p className="mt-0.5 text-xs leading-5 text-ink-3">用当前配置发最小请求，诊断「连不上」的原因（连接日志）。</p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="shrink-0"
                            data-testid="llm-check"
                            disabled={checking}
                            onClick={runLlmCheck}
                          >
                            {checking ? '检测中…' : '连接检测'}
                          </Button>
                        </div>
                        {llmCheck && (
                          <pre
                            role={llmCheck.ok ? 'status' : 'alert'}
                            data-testid="llm-check-result"
                            className={`mt-2 max-h-40 overflow-auto break-all whitespace-pre-wrap rounded-md border p-2 text-[11px] leading-relaxed ${
                              llmCheck.ok ? 'border-hair text-ink' : 'border-destructive/40 bg-destructive/5 text-destructive'
                            }`}
                          >
                            {`● ${llmCheck.message}\n地址：${llmCheck.baseUrl || '-'}\n模型：${llmCheck.model || '-'}\n状态码：${llmCheck.status ?? '-'}\n${llmCheck.body ? '响应：' + llmCheck.body + '\n' : ''}${(llmCheck as { step?: string }).step ? '断点：' + (llmCheck as { step?: string }).step : ''}`}
                          </pre>
                        )}
                        {llmCheck && (
                          <button
                            type="button"
                            data-testid="llm-copy"
                            onClick={() => { void navigator.clipboard?.writeText(JSON.stringify(llmCheck, null, 2)) }}
                            className="mt-1 rounded px-1 py-0.5 text-[11px] text-ink-3 transition-colors hover:text-accent"
                          >
                            复制诊断
                          </button>
                        )}
                      </div>
                    </>
                  )
                })()}
              </Card>

      <Card className="mt-4 p-6">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-2">
          引擎状态
          <Button size="sm" variant="ghost" aria-label="刷新引擎状态" onClick={refreshEngine} data-testid="engine-refresh" title="重新检测引擎">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="重启引擎"
            onClick={restartEngine}
            disabled={restarting}
            data-testid="engine-restart"
            title="关闭当前引擎进程后重新拉起（引擎崩溃/卡死时的复活入口）"
          >
            <RotateCw className={cn('h-3.5 w-3.5', restarting && 'animate-spin')} />
          </Button>
          {/* 引擎出问题的那一刻最想带走现场：这里直接给导出（详情/取证列表在「关于」页诊断卡） */}
          <button
            type="button"
            data-testid="export-diagnostics"
            disabled={diagBusy}
            onClick={() => void exportDiagnostics()}
            title="导出诊断快照（版本/引擎/路径/主进程日志尾）为 JSON"
            className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-normal text-ink-3 transition-colors hover:text-accent disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            {diagBusy ? '导出中…' : '导出诊断'}
          </button>
        </h3>
        <Separator className="my-4" />
        {diagMsg && (
          <p className="mb-2 break-all text-[11px] text-ink-2" role="status" data-testid="diagnostics-msg-engine">
            {diagMsg}
          </p>
        )}
        {restarting ? (
          <p className="min-w-0 text-xs text-ink-3" data-testid="engine-status">重启引擎中…（首次启动最长 45s）</p>
        ) : engStatus === null ? (
          <p className="min-w-0 text-xs text-ink-3">检测中…</p>
        ) : engStatus.online ? (
          <p className="min-w-0 text-xs text-ink" data-testid="engine-status">● 引擎在线 · {engStatus.provider} · {engStatus.model}</p>
        ) : (
          <div data-testid="engine-status" role="alert">
            <p className="min-w-0 text-xs font-medium text-destructive">● 引擎离线</p>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border border-destructive/40 bg-destructive/5 p-2 text-[11px] leading-relaxed text-ink">{engStatus.message}</pre>
            <button
              type="button"
              data-testid="engine-copy"
              onClick={() => { void navigator.clipboard?.writeText(engStatus.message ?? '') }}
              className="mt-1 rounded px-1 py-0.5 text-[11px] text-ink-3 transition-colors hover:text-accent"
            >
              复制诊断
            </button>
          </div>
        )}
      </Card>

      <Card className="mt-4 p-6">
        <h3 className="text-sm font-semibold text-ink-2">写作引擎与常用工具</h3>
        <Separator className="my-4" />
        <p className="pb-4 text-xs text-ink-3">
          后台写作引擎默认生效（无需开关）：有 zj_* 写作工具、可读章节列计划、可向你确认；开始写一章时自动装配当前章节的创作上下文。
        </p>
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1">
              <Label className="text-sm font-medium text-ink">任务清单（todo_write）</Label>
              <p className="min-w-0 text-xs leading-5 text-ink-3">模型会把执行步骤画成清单卡片，随进度更新。</p>
            </div>
            <Switch
              aria-label="任务清单（todo_write）"
              checked={tools.todo}
              onCheckedChange={(v) => {
                const prev = tools
                const next = { ...tools, todo: v }
                setTools(next)
                void applySetting({ agentTools: next }, () => setTools(prev), '任务清单')
              }}
            />
          </div>
          <div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1">
              <Label className="text-sm font-medium text-ink">需要你确认（ask_user）</Label>
              <p className="min-w-0 text-xs leading-5 text-ink-3">需要选择时模型会停下，用提问卡等你回答。</p>
            </div>
            <Switch
              aria-label="需要你确认（ask_user）"
              checked={tools.askUser}
              onCheckedChange={(v) => {
                const prev = tools
                const next = { ...tools, askUser: v }
                setTools(next)
                void applySetting({ agentTools: next }, () => setTools(prev), '需要你确认')
              }}
            />
          </div>
        </div>
        <Separator className="my-5" />
        <h4 className="mb-3 text-xs font-medium text-ink-2">检查能力（agent 子任务）</h4>
        <p className="mb-3 text-xs text-ink-3">这些能力由设置页开关控制；关掉后对应入口会提示先打开。</p>
        <div className="space-y-3">
          {capsMeta.length ? (
            capsMeta.map((c) => (
              <div key={c.id} className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <Label className="text-sm font-medium text-ink">{c.title}</Label>
                  <p className="min-w-0 text-xs leading-5 text-ink-3">{c.description ?? '…'}</p>
                </div>
                <Switch aria-label={c.title} checked={caps[c.id] !== false} onCheckedChange={(v) => toggleCap(c.id, v)} />
              </div>
            ))
          ) : (
            <p className="min-w-0 text-xs leading-5 text-ink-3">引擎未注册检查能力。</p>
          )}
        </div>
      </Card>
      <SkillSettingsCard />
            </>
          )}

          {section === 'look' && (
            <>
              <Card className="mt-6 p-6">
                <h3 className="text-sm font-semibold text-ink-2">外观与采集</h3>
                <Separator className="my-4" />
                <div className="flex items-start justify-between gap-4 pb-4">
                  <div className="min-w-0 flex-1">
                    <Label className="text-sm font-medium text-ink">主题</Label>
                    <p className="min-w-0 text-xs leading-5 text-ink-3">暖纸（默认）适合长时间写作，深色适合夜间。</p>
                  </div>
                  <div className="flex gap-1 rounded-lg border border-hair p-0.5" role="group" aria-label="主题">
                    <Button
                      variant={theme === 'paper' ? 'default' : 'ghost'}
                      size="sm"
                      className="h-7"
                      aria-pressed={theme === 'paper'}
                      onClick={() => {
                        const prev = theme
                        setTheme('paper')
                        applyTheme('paper')
                        // 即时写盘（HIG Settings 即时生效）：失败回滚并提示，不再「切了主题其实没存」
                        void applySetting({ theme: 'paper' }, () => {
                          setTheme(prev)
                          applyTheme(prev)
                        }, '主题')
                      }}
                    >
                      暖纸
                    </Button>
                    <Button
                      variant={theme === 'dark' ? 'default' : 'ghost'}
                      size="sm"
                      className="h-7"
                      aria-pressed={theme === 'dark'}
                      onClick={() => {
                        const prev = theme
                        setTheme('dark')
                        applyTheme('dark')
                        void applySetting({ theme: 'dark' }, () => {
                          setTheme(prev)
                          applyTheme(prev)
                        }, '主题')
                      }}
                    >
                      深色
                    </Button>
                  </div>
                </div>
                <div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <Label className="text-sm font-medium text-ink">联网采集管道</Label>
                    <p className="min-w-0 text-xs leading-5 text-ink-3">开启后，采集池的任务会由本机管道后台处理（S5）。</p>
                  </div>
                  <Switch
                    className="shrink-0"
                    aria-label="联网采集管道"
                    checked={collection}
                    onCheckedChange={(v) => {
                      const prev = collection
                      setCollection(v)
                      void applySetting({ collectionEnabled: v }, () => setCollection(prev), '联网采集管道')
                    }}
                  />
                </div>
                <div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <Label className="text-sm font-medium text-ink">批注定时优化</Label>
                    <p className="min-w-0 text-xs leading-5 text-ink-3">开启后，打开项目 10 秒后及每 30 分钟自动扫描批注并生成提案；关闭后仅在提案抽屉手动「扫描批注」。</p>
                  </div>
                  <Switch
                    className="shrink-0"
                    aria-label="批注定时优化"
                    checked={annotations}
                    onCheckedChange={(v) => {
                      const prev = annotations
                      setAnnotations(v)
                      void applySetting({ annotationsEnabled: v }, () => setAnnotations(prev), '批注定时优化')
                    }}
                  />
                </div>
                <div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <Label className="text-sm font-medium text-ink">写作习惯学习</Label>
                    <p className="min-w-0 text-xs leading-5 text-ink-3">
                      开启后，打开项目时自动分析写作行为（版本改动/批注意图/用词习惯），每周生成技能草稿到草稿区；草稿需在「写作引擎」技能包管理中手动转正才生效。默认关闭。
                    </p>
                  </div>
                  <Switch
                    className="shrink-0"
                    aria-label="写作习惯学习"
                    checked={writingInsights}
                    onCheckedChange={(v) => {
                      const prev = writingInsights
                      setWritingInsights(v)
                      void applySetting({ writingInsightsEnabled: v }, () => setWritingInsights(prev), '写作习惯学习')
                    }}
                  />
                </div>
                <div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <Label className="text-sm font-medium text-ink">焦点模式</Label>
                    <p className="min-w-0 text-xs leading-5 text-ink-3">开启后，正文只强调当前段，其余段落淡化（iA Writer / Typora 同类范式）；默认关闭。</p>
                  </div>
                  <Switch
                    className="shrink-0"
                    aria-label="焦点模式"
                    checked={focusMode}
                    onCheckedChange={(v) => {
                      const prev = focusMode
                      setFocusMode(v)
                      void applySetting({ focusModeEnabled: v }, () => setFocusMode(prev), '焦点模式')
                    }}
                  />
                </div>
                <div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <Label className="text-sm font-medium text-ink">打字机滚动</Label>
                    <p className="min-w-0 text-xs leading-5 text-ink-3">开启后，输入时正文自动滚动，让光标保持在屏幕中线附近（Typora 同类范式）；点击定位不强制居中；默认关闭。</p>
                  </div>
                  <Switch
                    className="shrink-0"
                    aria-label="打字机滚动"
                    checked={typewriter}
                    onCheckedChange={(v) => {
                      const prev = typewriter
                      setTypewriter(v)
                      void applySetting({ typewriterEnabled: v }, () => setTypewriter(prev), '打字机滚动')
                    }}
                  />
                </div>
                <div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <Label className="text-sm font-medium text-ink">首次使用引导</Label>
                    <p className="min-w-0 text-xs leading-5 text-ink-3">开启后，首次进入核心页面会弹出功能引导（可跳过，引导过的动线不再重复）；关闭则不打扰。</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      data-testid="guide-replay"
                      onClick={() => void window.zhijuan.getSettings().then((s) => window.zhijuan.setSettings({ guideSeen: [] })).catch(() => {})}
                      className="whitespace-nowrap rounded-md border border-hair px-2 py-1 text-[11px] text-ink-2 transition-colors hover:border-accent hover:text-accent"
                      title="清空已看过的引导记录，让核心页面的引导重新出现"
                    >
                      重新查看
                    </button>
                    <Switch
                      aria-label="首次使用引导"
                      checked={guide}
                      onCheckedChange={(v) => {
                        const prev = guide
                        setGuide(v)
                        void applySetting({ guideEnabled: v }, () => setGuide(prev), '首次使用引导')
                      }}
                    />
                  </div>
                </div>
              </Card>
              <Card className="mt-4 p-6">
                <h3 className="text-sm font-semibold text-ink-2">自定义用词词表</h3>
                <Separator className="my-4" />
                <p className="pb-3 text-xs text-ink-3">
                  追踪作者自己的复用语（口头禅、AI 腔等），与内置词表一起供「用词重复核查」统计；只报频次，不改正文。留空则仅用内置词表。
                </p>
                {overuseList.length > 0 ? (
                  <ul className="mb-3 space-y-1">
                    {overuseList.map((p) => (
                      <li
                        key={p}
                        className="flex items-center justify-between rounded-md border border-hair bg-surface-2 px-3 py-1.5"
                      >
                        <span className="min-w-0 truncate text-sm text-ink-2" title={p}>
                          {p}
                        </span>
                        <button
                          className="ml-2 shrink-0 rounded p-1 text-ink-3 hover:bg-hair hover:text-ink-1"
                          aria-label={`删除词条 ${p}`}
                          title={`删除词条 ${p}`}
                          onClick={() => removeOveruse(p)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mb-3 text-xs text-ink-3">还没有自定义短语，先添加或导入；当前仅使用内置词表。</p>
                )}
                <div className="flex gap-2">
                  <Input
                    value={overuseDraft}
                    placeholder="输入短语，如：整个人"
                    onChange={(e) => setOveruseDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !isImeComposing(e)) {
                        e.preventDefault()
                        addOveruse()
                      }
                    }}
                    className="h-8"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0"
                    onClick={addOveruse}
                    disabled={!overuseDraft.trim()}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span className="ml-1">添加</span>
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button variant="ghost" size="sm" className="h-7" onClick={() => void importOveruse()}>
                    <FileUp className="h-3.5 w-3.5" />
                    <span className="ml-1">导入 .txt</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7"
                    onClick={() => void exportOveruse()}
                    disabled={!overuseList.length}
                  >
                    <FileDown className="h-3.5 w-3.5" />
                    <span className="ml-1">导出 .txt</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7"
                    onClick={clearOveruse}
                    disabled={!overuseList.length}
                    aria-label="清空词表"
                    title="清空词表"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {overuseMsg && (
                  <p className="mt-2 break-all text-xs text-ink-3" role="status">
                    {overuseMsg}
                  </p>
                )}
              </Card>
            </>
          )}

          {section === 'about' && (
            <>
            <Card className="mt-6 p-6">
              <h3 className="text-sm font-semibold text-ink-2">关于</h3>
              <Separator className="my-4" />
              <p className="text-sm text-ink-2">
                织卷{appVer ? ` v${appVer}` : ''} — AI 辅助小说创作工作台。
              </p>
              <p className="mt-1 text-xs text-ink-3">
                所有数据都是本机明文文件：项目在项目库（默认 工作区/项目库），说明文档在工作区 文档/；
                每个章节是一个时间切片，约定头写在正文文件顶部；正文为源，设定跟着走。
              </p>
              <button
                onClick={() => setShortcutOpen(true)}
                className="mt-4 flex items-center gap-1.5 text-xs text-ink-2 underline-offset-2 hover:underline"
              >
                <Keyboard className="h-3.5 w-3.5" />
                键盘快捷键速查（⌘K 里也能打开）
              </button>
            </Card>

            {/* 诊断与取证（2026-10-27 可见性 C/E）：一次带走现场 + 取证文件有写无读的入口 */}
            <Card className="mt-4 p-6" data-testid="diagnostics-card">
              <h3 className="text-sm font-semibold text-ink-2">诊断与取证</h3>
              <Separator className="my-4" />
              <p className="text-xs leading-5 text-ink-3">
                「导出诊断」生成一份 JSON 快照：版本 / 平台 / 引擎状态 / 关键路径 / 主进程日志尾部 200 行。
                出问题时把它连同下面的取证文件一起带走，不必再自己找路径。
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  data-testid="export-diagnostics"
                  disabled={diagBusy}
                  onClick={() => void exportDiagnostics()}
                  className="[&_svg]:size-3.5"
                >
                  <Download />
                  <span className="ml-1">{diagBusy ? '导出中…' : '导出诊断'}</span>
                </Button>
                <Button size="sm" variant="outline" data-testid="copy-diagnostics" onClick={() => void copyDiagnostics()}>
                  复制诊断
                </Button>
                <Button size="sm" variant="outline" data-testid="open-log-dir" onClick={() => void openLogDir()} className="[&_svg]:size-3.5">
                  <FolderOpen />
                  <span className="ml-1">打开日志目录</span>
                </Button>
              </div>
              {diagMsg && (
                <p className="mt-2 break-all text-xs text-ink-2" role="status" data-testid="diagnostics-msg">
                  {diagMsg}
                </p>
              )}
              {forensicsErr && (
                <div className="mt-3 flex items-start gap-2 rounded-md border border-danger/40 bg-danger-soft px-2 py-1.5" role="alert">
                  <p className="min-w-0 flex-1 break-all text-[11px] text-danger">{forensicsErr}</p>
                  <button type="button" className="shrink-0 text-[11px] text-ink-2 hover:text-accent" onClick={loadForensics}>
                    重试
                  </button>
                </div>
              )}
              {forensics && (
                <div className="mt-4 space-y-2" data-testid="forensics-list">
                  {forensics.map((f) => (
                    <div key={f.kind} className="rounded-lg border border-hair bg-surface-2 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-xs text-ink-2" title={f.path}>
                          {f.label}
                        </span>
                        <span className="shrink-0 text-[10px] text-ink-3">
                          {f.exists ? `${fmtBytes(f.bytes)} · ${fmtMtime(f.mtime)}` : '尚未生成'}
                        </span>
                        <button
                          type="button"
                          data-testid={`reveal-${f.kind}`}
                          onClick={() => void revealForensics(f.path)}
                          className="shrink-0 rounded px-1 py-0.5 text-[11px] text-accent transition-colors hover:underline"
                        >
                          打开
                        </button>
                        {f.exists && f.tail.length > 0 && (
                          <button
                            type="button"
                            data-testid={`tail-${f.kind}`}
                            onClick={() => setTailOpen((m) => ({ ...m, [f.kind]: !m[f.kind] }))}
                            className="shrink-0 rounded px-1 py-0.5 text-[11px] text-ink-3 transition-colors hover:text-accent"
                          >
                            {tailOpen[f.kind] ? '收起' : '看尾部'}
                          </button>
                        )}
                      </div>
                      <p className="mt-1 break-all text-[10px] leading-4 text-ink-3" title={f.path}>
                        {f.path}
                      </p>
                      {tailOpen[f.kind] && f.tail.length > 0 && (
                        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded border border-hair bg-surface p-2 text-[10px] leading-relaxed text-ink-2">
                          {f.tail.join('\n')}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {!projectId && (
                <p className="mt-3 text-[11px] leading-4 text-ink-3">
                  在项目内打开设置，这里还会列出该项目的 write-log / save-trace / sync-log。
                </p>
              )}
            </Card>
            </>
          )}
        </div>
        )}
        <ShortcutHelp open={shortcutOpen} onOpenChange={setShortcutOpen} />
      </div>
    </div>
  )
}
