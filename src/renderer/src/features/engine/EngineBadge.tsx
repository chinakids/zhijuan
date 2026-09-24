import { useCallback, useEffect, useState } from 'react'
import { cn } from '../../lib/utils'
import { router } from '../../router'

/** 顶栏常驻引擎状态点：绿=在线 / 红=离线；点击去设置页。默认每 20s 轮询。
 * 注意：本组件被挂在 **Router 之外**（WindowChrome 里），不能依赖 react-router 的 hook；
 * 跳转走 router.navigate（data router 单例全局可用——2026-09-24 创作层：原直接改
 * window.location.hash 属外部导航，createHashRouter 下 useBlocker 守卫对它会
 * 「fail silently in production」（本地 v7.18.3 源码警告原文），统一路由入口保证守卫全覆盖）。 */
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
        if (sid) void router.navigate('/project/' + sid + '/settings')
      }}
      title={s.tip ? `${s.label}（${s.tip}）` : s.label}
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors',
        s.online === false ? 'border-hair bg-danger-soft text-danger hover:brightness-95' : 'border-hair bg-surface-2 text-ink-2 hover:bg-well'
      )}
    >
      {/* 状态点：SVG 状态灯（在线呼吸光晕 / 离线实心；主人 2026-09-12 SVG+动画） */}
      <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center" aria-hidden="true">
        <svg viewBox="0 0 12 12" className="h-3 w-3">
          {s.online ? (
            <>
              <circle cx="6" cy="6" r="5.5" fill="none" stroke="var(--success)" strokeOpacity="0.5" strokeWidth="1.2" className="zj-pulse-ring" />
              <circle cx="6" cy="6" r="2.6" fill="var(--success)" />
            </>
          ) : (
            <circle cx="6" cy="6" r="2.6" fill={s.online === false ? 'var(--danger)' : 'var(--ink-3)'} />
          )}
        </svg>
      </span>
      {s.online === null ? '引擎…' : s.online ? '引擎在线' : '引擎离线'}
    </button>
  )
}
