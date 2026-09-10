import { useCallback, useEffect, useState } from 'react'
import { useAppStore, applyTheme } from '../store/app'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Separator } from '../components/ui/separator'
import { Switch } from '../components/ui/switch'
import { Card } from '../components/ui/card'
import { cn } from '../lib/utils'
import { Keyboard } from 'lucide-react'
import ShortcutHelp from '../features/command/ShortcutHelp'
import { PROVIDER_PRESETS, providerById } from '../../../shared/providers'
import type { LlmProviderId } from '../../../shared/types'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 pb-4">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-ink-3">{hint}</p>}
    </div>
  )
}

/** 设置页一级分区（将来加配置先挂到这里，保证布局稳定） */
const SECTIONS = [
  { key: 'workspace', label: '工作区与项目', hint: '工作区、项目库与文档落档', icon: 'Folder' },
  { key: 'engine', label: '写作引擎', hint: '模型连接、常用工具与运行', icon: 'Sparkles' },
  { key: 'look', label: '外观与数据', hint: '主题与联网采集', icon: 'Palette' },
  { key: 'about', label: '关于', hint: '版本与本地数据', icon: 'Info' }
] as const
type SectionKey = (typeof SECTIONS)[number]['key']

export default function Settings() {
  const { settings, loadSettings, updateSettings } = useAppStore()
  const [workspacePath, setWorkspacePath] = useState('')
  const [wsInfo, setWsInfo] = useState<{ dir: string; inited: boolean; docs: { file: string; name: string }[] } | null>(null)
  const [openDoc, setOpenDoc] = useState<string | null>(null)
  const [openDocBody, setOpenDocBody] = useState('')
  const [wsMsg, setWsMsg] = useState('')
  const [provider, setProvider] = useState<LlmProviderId>('local')
  const [provApiKey, setProvApiKey] = useState('')
  const [provBaseUrl, setProvBaseUrl] = useState('')
  const [provModel, setProvModel] = useState('')
  const [libraryRoot, setLibraryRoot] = useState('')
  const [theme, setTheme] = useState<'paper' | 'dark'>('paper')
  const [collection, setCollection] = useState(true)
  const [shortcutOpen, setShortcutOpen] = useState(false)
  const [tools, setTools] = useState({ todo: true, askUser: true })
  const [caps, setCaps] = useState<Record<string, boolean>>({})
  const [capsMeta, setCapsMeta] = useState<{ id: string; title: string; description?: string }[]>([])
  const [saved, setSaved] = useState(false)
  const [section, setSection] = useState<SectionKey>('workspace')

  const refreshWorkspace = useCallback(async () => {
    try {
      const st = await window.zhijuan.workspaceStatus()
      setWsInfo(st)
    } catch {
      setWsInfo(null)
    }
  }, [])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  useEffect(() => {
    if (!settings) return
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
    setTools({ todo: settings.agentTools?.todo ?? true, askUser: settings.agentTools?.askUser ?? true })
    setCaps(settings.capabilities ?? {})
    void window.zhijuan.agentListCapabilities().then(setCapsMeta).catch(() => {})
    void refreshWorkspace()
  }, [settings, refreshWorkspace])

  /** 切换服务商：同时把可编辑字段换成该家已存的值 */
  /** 即时切换 agent 能力开关（写设置；下次运行该能力时生效） */
  function toggleCap(id: string, on: boolean) {
    const next = { ...caps, [id]: on }
    setCaps(next)
    void updateSettings({ capabilities: next })
  }

  function selectProvider(id: LlmProviderId) {
    setProvider(id)
    const pc = settings?.llm?.providers?.[id] ?? {}
    setProvApiKey(pc.apiKey ?? '')
    setProvBaseUrl(pc.baseUrl ?? '')
    setProvModel(pc.model ?? '')
  }

  async function save() {
    const cur = settings?.llm ?? { active: 'local' as LlmProviderId, providers: {} }
    const providers = { ...(cur.providers ?? {}) }
    // 空字段不落盘：用厂商预设默认；被清空的 apiKey 即从本机移除
    providers[provider] = {
      ...(provApiKey.trim() ? { apiKey: provApiKey.trim() } : {}),
      ...(provBaseUrl.trim() ? { baseUrl: provBaseUrl.trim() } : {}),
      ...(provModel.trim() ? { model: provModel.trim() } : {})
    }
    await updateSettings({
      workspace: workspacePath.trim(),
      llm: { active: provider, providers },
      libraryRoot: libraryRoot.trim(),
      theme,
      collectionEnabled: collection,
      agentTools: tools
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
    void refreshWorkspace()
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
        <div className="mb-2 flex items-center gap-2 px-1 py-1">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-xs font-bold text-accent-ink">织</span>
          <span className="text-sm font-semibold">设置</span>
        </div>
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
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
              <span className={cn('block truncate text-sm', section === s.key ? 'font-medium text-accent' : 'text-ink')}>{s.label}</span>
              <span className="block truncate text-[10px] text-ink-3">{s.hint}</span>
            </span>
          </button>
        ))}
        <div className="flex-1" />
        <p className="px-2 text-[10px] leading-relaxed text-ink-3">全部保存在本机，明文可进版本库。</p>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl p-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">{cur?.label}</h2>
              <p className="mt-0.5 text-sm text-ink-3">{cur?.hint}</p>
            </div>
            <div className="flex items-center gap-2">
              {saved && <span className="text-xs text-success">已保存 ✓</span>}
              <Button onClick={() => void save()}>保存设置</Button>
            </div>
          </div>

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
            <p className="truncate text-xs text-ink-2">当前：{wsInfo ? wsInfo.dir : '读取中…'}</p>
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
          <Field label="库根路径" hint="留空则用工作区下的默认位置（工作区/项目库）；现有项目迁移时可直接填老路径。">
            <Input value={libraryRoot} onChange={(e) => setLibraryRoot(e.target.value)} placeholder="/Users/你/Documents/织卷工作区/项目库" />
          </Field>
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
                  <div className="flex flex-wrap gap-1 rounded-lg border border-hair p-1">
                    {PROVIDER_PRESETS.map((p) => (
                      <Button key={p.id} variant={provider === p.id ? 'default' : 'ghost'} size="sm" className="h-7" onClick={() => selectProvider(p.id)}>
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
                    </>
                  )
                })()}
              </Card>

      <Card className="mt-4 p-6">
        <h3 className="text-sm font-semibold text-ink-2">写作引擎与常用工具</h3>
        <Separator className="my-4" />
        <p className="pb-4 text-xs text-ink-3">
          后台写作引擎默认生效（无需开关）：有 zj_* 写作工具、可读章节列计划、可向你确认；开始写一章时自动装配当前章节的创作上下文。
        </p>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label>任务清单（todo_write）</Label>
              <p className="text-xs text-ink-3">模型会把执行步骤画成清单卡片，随进度更新。</p>
            </div>
            <Switch checked={tools.todo} onCheckedChange={(v) => setTools((t) => ({ ...t, todo: v }))} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>需要你确认（ask_user）</Label>
              <p className="text-xs text-ink-3">需要选择时模型会停下，用提问卡等你回答。</p>
            </div>
            <Switch checked={tools.askUser} onCheckedChange={(v) => setTools((t) => ({ ...t, askUser: v }))} />
          </div>
        </div>
        <Separator className="my-5" />
        <h4 className="mb-3 text-xs font-medium text-ink-2">检查能力（agent 子任务）</h4>
        <p className="mb-3 text-xs text-ink-3">这些能力由设置页开关控制；关掉后对应入口会提示先打开。</p>
        <div className="space-y-3">
          {capsMeta.length ? (
            capsMeta.map((c) => (
              <div key={c.id} className="flex items-center justify-between">
                <div>
                  <Label>{c.title}</Label>
                  <p className="text-xs text-ink-3">{c.description ?? '…'}</p>
                </div>
                <Switch checked={caps[c.id] !== false} onCheckedChange={(v) => toggleCap(c.id, v)} />
              </div>
            ))
          ) : (
            <p className="text-xs text-ink-3">引擎未注册检查能力。</p>
          )}
        </div>
      </Card>
            </>
          )}

          {section === 'look' && (
            <>
              <Card className="mt-6 p-6">
                <h3 className="text-sm font-semibold text-ink-2">外观与采集</h3>
                <Separator className="my-4" />
                <div className="flex items-center justify-between pb-4">
                  <div>
                    <Label>主题</Label>
                    <p className="text-xs text-ink-3">暖纸（默认）适合长时间写作，深色适合夜间。</p>
                  </div>
                  <div className="flex gap-1 rounded-lg border border-hair p-0.5">
                    <Button variant={theme === 'paper' ? 'default' : 'ghost'} size="sm" className="h-7" onClick={() => { setTheme('paper'); applyTheme('paper') }}>
                      暖纸
                    </Button>
                    <Button variant={theme === 'dark' ? 'default' : 'ghost'} size="sm" className="h-7" onClick={() => { setTheme('dark'); applyTheme('dark') }}>
                      深色
                    </Button>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>联网采集管道</Label>
                    <p className="text-xs text-ink-3">开启后，采集池的任务会由本机管道后台处理（S5）。</p>
                  </div>
                  <Switch checked={collection} onCheckedChange={setCollection} />
                </div>
              </Card>
            </>
          )}

          {section === 'about' && (
            <Card className="mt-6 p-6">
              <h3 className="text-sm font-semibold text-ink-2">关于</h3>
              <Separator className="my-4" />
              <p className="text-sm text-ink-2">织卷 v0.1.0 — AI 辅助小说创作工作台。</p>
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
          )}
        </div>
        <ShortcutHelp open={shortcutOpen} onOpenChange={setShortcutOpen} />
      </div>
    </div>
  )
}
