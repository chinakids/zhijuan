import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '../store/app'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Separator } from '../components/ui/separator'
import { Switch } from '../components/ui/switch'
import { Card } from '../components/ui/card'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 pb-4">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-ink-3">{hint}</p>}
    </div>
  )
}

export default function Settings() {
  const { settings, loadSettings, updateSettings } = useAppStore()
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [libraryRoot, setLibraryRoot] = useState('')
  const [theme, setTheme] = useState<'paper' | 'dark'>('paper')
  const [collection, setCollection] = useState(true)
  const [agentEngine, setAgentEngine] = useState<'harness' | 'legacy'>('harness')
  const [tools, setTools] = useState({ todo: true, askUser: true })
  const [status, setStatus] = useState<{ online: boolean; engine?: string; model?: string; message?: string } | null>(null)
  const [saved, setSaved] = useState(false)

  const refreshStatus = useCallback(async () => {
    try {
      const s = await window.zhijuan.agentStatus()
      setStatus(s)
    } catch {
      setStatus({ online: false, message: '引擎状态查询失败' })
    }
  }, [])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  useEffect(() => {
    if (!settings) return
    setBaseUrl(settings.llm.baseUrl)
    setModel(settings.llm.model)
    setApiKey(settings.llm.apiKey)
    setLibraryRoot(settings.libraryRoot)
    setTheme(settings.theme)
    setCollection(settings.collectionEnabled)
    setAgentEngine(settings.agentEngine)
    setTools({ todo: settings.agentTools?.todo ?? true, askUser: settings.agentTools?.askUser ?? true })
    void refreshStatus()
  }, [settings, refreshStatus])

  async function save() {
    await updateSettings({
      llm: { baseUrl: baseUrl.trim() || 'http://127.0.0.1:8888', model: model.trim() || 'deepseek-v4-flash-0731', apiKey: apiKey.trim() },
      libraryRoot: libraryRoot.trim(),
      theme,
      collectionEnabled: collection,
      agentEngine,
      agentTools: tools
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
    void refreshStatus()
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      <h2 className="text-lg font-semibold">设置</h2>
      <p className="mt-1 text-sm text-ink-3">全部保存在本机，明文可入 git。</p>

      <Card className="mt-6 p-6">
        <h3 className="text-sm font-semibold text-ink-2">大模型</h3>
        <Separator className="my-4" />
        <Field label="端点地址" hint="本地 vLLM 或其他 OpenAI 兼容端点">
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://127.0.0.1:8888" />
        </Field>
        <Field label="模型名">
          <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-v4-flash-0731" />
        </Field>
        <Field label="API Key（如需要）">
          <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="留空即可（本地端点一般不要）" />
        </Field>
      </Card>

      <Card className="mt-4 p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink-2">写作引擎与常用工具</h3>
          <button onClick={() => void refreshStatus()} className="text-[11px] text-ink-3 hover:text-ink">
            {status === null ? '查询引擎状态…' : status.online ? (
              <span className="flex items-center gap-1 text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" /> 写作引擎在线 · {status.model}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-danger">
                <span className="h-1.5 w-1.5 rounded-full bg-danger" /> 离线 {status.message ? '（' + status.message.slice(0, 40) + '）' : ''}
              </span>
            )}
          </button>
        </div>
        <Separator className="my-4" />
        <div className="flex items-center justify-between pb-4">
          <div>
            <Label>对话引擎</Label>
            <p className="text-xs text-ink-3">后台运行的写作引擎（推荐）：模型可在会话里读章节、列计划、向你确认。切换后下次对话生效。</p>
          </div>
          <div className="flex gap-1 rounded-lg border border-hair p-0.5">
            <Button variant={agentEngine === 'harness' ? 'default' : 'ghost'} size="sm" className="h-7" onClick={() => setAgentEngine('harness')}>
              写作引擎（有工具）
            </Button>
            <Button variant={agentEngine === 'legacy' ? 'default' : 'ghost'} size="sm" className="h-7" onClick={() => setAgentEngine('legacy')}>
              直连对话
            </Button>
          </div>
        </div>
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
      </Card>

      <Card className="mt-4 p-6">
        <h3 className="text-sm font-semibold text-ink-2">项目库</h3>
        <Separator className="my-4" />
        <Field label="库根路径" hint="留空则用默认：~/Documents/织卷项目库">
          <Input value={libraryRoot} onChange={(e) => setLibraryRoot(e.target.value)} placeholder="/Users/你/Documents/织卷项目库" />
        </Field>
      </Card>

      <Card className="mt-4 p-6">
        <h3 className="text-sm font-semibold text-ink-2">外观与采集</h3>
        <Separator className="my-4" />
        <div className="flex items-center justify-between pb-4">
          <div>
            <Label>主题</Label>
            <p className="text-xs text-ink-3">暖纸（默认）适合长时间写作，深色适合夜间。</p>
          </div>
          <div className="flex gap-1 rounded-lg border border-hair p-0.5">
            <Button variant={theme === 'paper' ? 'default' : 'ghost'} size="sm" className="h-7" onClick={() => setTheme('paper')}>
              暖纸
            </Button>
            <Button variant={theme === 'dark' ? 'default' : 'ghost'} size="sm" className="h-7" onClick={() => setTheme('dark')}>
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

      <div className="mt-6 flex items-center gap-3">
        <Button onClick={() => void save()}>保存设置</Button>
        {saved && <span className="text-sm text-success">已保存 ✓</span>}
      </div>
    </div>
  )
}
