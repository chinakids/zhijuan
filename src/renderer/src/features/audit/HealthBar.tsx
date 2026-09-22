// ===== 织卷 · 规则体检状态栏（主人 2026-09-16 拍板，F-20260916-05） =====
// 本地规则检查（零模型·秒级）从 Agent 区「检查」菜单挪到编辑器下方状态栏，常驻实时体检：
//   - 进入/切换项目即体检；保存（fs 事件）后 3s 节流重跑；60s 心跳兜底；手动按钮随时重跑；
//   - 图标状态即健康状态：checking 转圈 / ok 绿盾（无问题）/ issues 琥珀盾（N 处）/ error 红叹；
//   - 点击盾牌打开 AuditDrawer 详情（定位到第一个有问题项），与 Agent 区抽屉同链路同口径。
// 聚合口径：复用 window.zhijuan.agentAudit（真机=主进程零模型 runAudit 本地分支；devShim=同语义 mock），
// 不做新增 IPC——真机与无头 mock 同构，冒烟可复现。
import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleAlert, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react'
import LoadingIndicator from '../../components/LoadingIndicator'
import AuditDrawer from './AuditDrawer'
import { useAgentStore } from '../agent/store'
import type { AuditKind } from '../../../../shared/types'

/** 本地规则 8 项（与 AgentPanel 曾用菜单/本小环同组；零模型、秒级、不落盘） */
const LOCAL_KINDS: AuditKind[] = ['presence', 'order', 'unused', 'actgaps', 'sliceord', 'nameform', 'mixform', 'overuse']

type Health = 'checking' | 'ok' | 'issues' | 'error'

interface Props {
  projectId: string
  /** 保存/外部变更信号（Novel 的 extVersion）：变化后 3s 节流重跑一次 */
  refreshSignal?: number
}

export default function HealthBar({ projectId, refreshSignal = 0 }: Props) {
  const [health, setHealth] = useState<Health>('checking')
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState<Partial<Record<AuditKind, number>>>({})
  const [note, setNote] = useState('')
  const [audit, setAudit] = useState<{ open: boolean; tab: AuditKind }>({ open: false, tab: 'presence' })
  const runSeq = useRef(0)
  // 「让 agent 改」：经 agent store 注册槽把审读发现发给 Agent 面板（AgentPanel 挂载时注册；F-20260916-05 迁移补链）
  const streaming = useAgentStore((s) => s.streaming)

  const run = useCallback(async () => {
    const seq = ++runSeq.current
    setHealth('checking')
    const entries = await Promise.all(
      LOCAL_KINDS.map(async (k): Promise<[AuditKind, number | null]> => {
        try {
          const r = await window.zhijuan.agentAudit(projectId, k)
          return [k, r.ok ? r.result.items.length : null]
        } catch {
          return [k, null]
        }
      })
    )
    if (seq !== runSeq.current) return // 过期结果丢弃（快速连续触发时后到为准）
    const next: Partial<Record<AuditKind, number>> = {}
    let failed = 0
    let sum = 0
    for (const [k, n] of entries) {
      if (n === null) failed++
      else {
        next[k] = n
        sum += n
      }
    }
    setCounts(next)
    setTotal(sum)
    if (failed === LOCAL_KINDS.length) {
      setHealth('error')
      setNote('检查不可用')
    } else {
      setHealth(sum > 0 ? 'issues' : 'ok')
      setNote(failed ? `${failed} 项不可用` : '')
    }
  }, [projectId])

  // 进入/切换项目即体检
  useEffect(() => {
    void run()
  }, [run])

  // 保存/外部变更 → 3s 节流重跑（防连改正文时高频重读）
  useEffect(() => {
    if (!refreshSignal) return
    const t = setTimeout(() => void run(), 3000)
    return () => clearTimeout(t)
  }, [refreshSignal, run])

  // 60s 心跳兜底（页面可见才跑，避免后台空转）
  useEffect(() => {
    const iv = setInterval(() => {
      if (document.visibilityState === 'visible') void run()
    }, 60_000)
    return () => clearInterval(iv)
  }, [run])

  const firstIssue = (LOCAL_KINDS as AuditKind[]).find((k) => (counts[k] ?? 0) > 0) ?? 'presence'
  const K_LABEL: Partial<Record<AuditKind, string>> = { presence: '人物在场', order: '切片时序', unused: '档案腐坏', actgaps: '正文缺段', sliceord: '档案切片', nameform: '称谓发现', mixform: '称谓混用', overuse: '用词重复' }
  const detail = (LOCAL_KINDS as AuditKind[]).filter((k) => (counts[k] ?? 0) > 0).map((k) => `${K_LABEL[k] ?? k} ${counts[k]}`).join('、')
  const healthTitle =
    health === 'ok'
      ? '规则体检：无问题 · 点击查看详情'
      : health === 'issues'
        ? `规则体检：${total} 处问题${detail ? ' · ' + detail : ''} · 点击查看详情`
        : health === 'error'
          ? '规则体检不可用 · 点击查看详情'
          : '规则体检进行中'
  const healthAria =
    health === 'ok'
      ? '规则体检：无问题'
      : health === 'issues'
        ? `规则体检：${total} 处问题`
        : health === 'error'
          ? '规则体检不可用'
          : '规则体检进行中'

  return (
    <div
      data-testid="health-bar"
      className="flex shrink-0 items-center gap-2 text-[11px] text-ink-3"
    >
      <button
        type="button"
        data-testid="health-status"
        title={healthTitle}
        aria-label={healthAria}
        onClick={() => setAudit({ open: true, tab: firstIssue })}
        className="flex min-w-0 items-center gap-2 rounded hover:bg-well focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <span className="relative inline-flex">
          {health === 'checking' ? (
            <LoadingIndicator size={12} />
          ) : health === 'ok' ? (
            <ShieldCheck data-testid="health-icon-ok" className="h-3.5 w-3.5 text-success" />
          ) : health === 'issues' ? (
            <ShieldAlert data-testid="health-icon-issues" className="h-3.5 w-3.5 text-warn" />
          ) : (
            <CircleAlert data-testid="health-icon-error" className="h-3.5 w-3.5 text-danger" />
          )}
          {health === 'issues' && total > 0 && (
            <span
              data-testid="health-badge"
              className="absolute -right-1.5 -top-1 flex h-[13px] min-w-[13px] items-center justify-center rounded-full bg-warn px-[2px] text-[10px] font-semibold leading-none text-white"
            >
              {total > 99 ? '99+' : total}
            </span>
          )}
        </span>
        <span className="truncate">
          {health === 'checking'
            ? '规则体检中…'
            : health === 'ok'
              ? '规则体检：无问题'
              : health === 'issues'
                ? '规则体检：有问题'
                : `规则体检：${note || '不可用'}`}
        </span>
      </button>
      <button
        type="button"
        title="重新体检"
        aria-label="重新体检"
        onClick={() => void run()}
        className="rounded p-0.5 text-ink-3 hover:bg-well hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <RefreshCw className="h-3 w-3" />
      </button>
      <AuditDrawer
        projectId={projectId}
        open={audit.open}
        tab={audit.tab}
        onClose={() => setAudit((a) => ({ ...a, open: false }))}
        onTab={(t) => setAudit((a) => ({ ...a, tab: t }))}
        onToAgent={(text) => {
          setAudit((a) => ({ ...a, open: false }))
          useAgentStore.getState().sendHandler?.(text)
        }}
        toAgentBusy={streaming}
      />
    </div>
  )
}
