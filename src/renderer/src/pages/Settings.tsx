import { useEffect, useState } from 'react'
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
  const [saved, setSaved] = useState(false)

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
  }, [settings])

  async function save() {
    await updateSettings({
      llm: { baseUrl: baseUrl.trim() || 'http://127.0.0.1:8888', model: model.trim() || 'deepseek-v4-flash-0731', apiKey: apiKey.trim() },
      libraryRoot: libraryRoot.trim(),
      theme,
      collectionEnabled: collection
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
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
