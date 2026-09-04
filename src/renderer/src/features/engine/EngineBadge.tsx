import { useCallback, useEffect, useState } from 'react'
import { cn } from '../../lib/utils'

/** 顶栏常驻引擎状态点：绿=在线 / 红=离线；点击去设置页。默认每 20s 轮询。
 * 注意：本组件会被挂在 **Router 之外**（WindowChrome 里），所以不能依赖 react-router 的 hook，
 * 跳转直接用 hash（我们用的是 HashRouter）。 */
export default function EngineBadge() {
  const [sid, setSid] = useState('')
  const [s, setS] = useState<{ online: boolean | null; label?: string; tip?: string }>({ online: null })

  const refresh = useCallback(async () => {
    try {
      const r = await window.zhijuan.agentStatus()
      setS({
        online: r.online,
        label: r.online ? (r.provider ? `引擎 · ${r.provider}` : '引擎在线') : '引擎离线',
        tip: r.message
      })
    } catch {
      setS({ online: false, label: '引擎离线', tip: '状态查询失败' })
    }
  }, [])

  useEffect(() => {
    const m = window.location.hash.match(/\/project\/([^/?]+)/)
    if (m) setSid(m[1])
    void refresh()
    const t = window.setInterval(refresh, 20000)
    return () => window.clearInterval(t)
  }, [refresh])

  return (
    <button
      onClick={() => {
        if (sid) window.location.hash = '/project/' + sid + '/settings'
      }}
      title={s.tip ? `${s.label}（${s.tip}）` : s.label}
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors',
        s.online === false ? 'border-hair bg-danger-soft text-danger hover:brightness-95' : 'border-hair bg-surface-2 text-ink-2 hover:bg-well'
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', s.online === false ? 'bg-danger' : 'bg-success')} />
      {s.online === null ? '引擎…' : s.online ? '引擎在线' : '引擎离线'}
    </button>
  )
}
