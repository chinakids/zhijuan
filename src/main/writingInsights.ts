// ===== 织卷 · 写作习惯学习（读盘执行层，增量 4b，2026-09-22 智能层） =====
// 设计基线：docs/写作习惯学习-产品规划-2026-09-21.md（D-L-1~8、§5 流程、§7 验收、§8 增量 4b）。
// 纯函数/模板/门控在 shared/writingInsights.ts（增量 4a，05ff704）；本文件=主进程读盘执行层：
//   gatherSignals（history 快照 / proposals / 正文 → WritingSignals）→
//   runWritingInsights（开关 + 7 天门控 → 草稿+报告落 <工作区>/skills/_drafts/ → .zhijuan/insights-state.json）。
// 零模型、零网络、零新依赖；IPC/UI 在增量 4c（本层不接）。
// 调研依据（本轮真实抓取，来源记档）：
//   - Grammarly 官方支持页「How do you create the weekly Grammarly Insights reports I get in my email?」
//     （support.grammarly.com/hc/en-us/articles/360003816132，2026-09-22 curl 直连实抓 47,256 字节，
//      存档 /tmp/zj-gram-wk.html）：「text is analyzed in real time…statistics…remain linked to your account…
//      updated continuously throughout the week…Weekly Writing Update email」——周期行为分析=后台持续计算 +
//      账户级统计 + **异步触达**（邮件；织卷=草稿区可见），不打断创作；织卷全本地明文无隐私顾虑。
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'fs'
import { join } from 'path'
import { writeFileAtomic } from './fsutil'
import { libraryRoot, workspaceDir, getSettings } from './settings'
import { listProposals } from './proposals'
import { listSnapshots, readSnapshot } from './history'
import { DOT_DIR } from '../shared/paths'
import { buildSignals, draftSkillFromStats, reportFromStats, shouldRunInsights } from '../shared/writingInsights'
import type { VersionChange, WritingSignals } from '../shared/writingInsights'

// =====================================================================
// 一、状态文件（.zhijuan/insights-state.json：与批注 done.json 同构的记账文件）
// =====================================================================

export interface InsightsState {
  /** 上次成功生成的时间戳（7 天门控依据） */
  lastRunAt: number
  /** 上次生成的草稿文件名（如 2026-09-22-写作习惯.md） */
  lastDraft: string
}

export function insightsStateFile(projectRoot: string): string {
  return join(projectRoot, DOT_DIR, 'insights-state.json')
}

/** 读状态：不存在/坏档 → null（坏档不崩，视为从未跑过） */
export function readInsightsState(projectRoot: string): InsightsState | null {
  const f = insightsStateFile(projectRoot)
  if (!existsSync(f)) return null
  try {
    const s = JSON.parse(readFileSync(f, 'utf-8'))
    if (typeof s?.lastRunAt !== 'number') return null
    return { lastRunAt: s.lastRunAt, lastDraft: typeof s.lastDraft === 'string' ? s.lastDraft : '' }
  } catch {
    return null
  }
}

export function writeInsightsState(projectRoot: string, s: InsightsState): void {
  const f = insightsStateFile(projectRoot)
  mkdirSync(join(projectRoot, DOT_DIR), { recursive: true })
  writeFileAtomic(f, JSON.stringify(s, null, 2))
}

// =====================================================================
// 二、信号采集（读盘；正文/快照/提案三源）
// =====================================================================

/** 递归枚举项目下正文 .md（与 store.listDocs 同旋回：跳过 . 前缀、只收 .md、rel 正斜杠、相对项目根） */
function listChapterFiles(projectRoot: string): { file: string; raw: string }[] {
  const rootDir = join(projectRoot, '正文')
  if (!existsSync(rootDir)) return []
  const out: { file: string; raw: string }[] = []
  const walk = (p: string, prefix: string) => {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue
      const fp = join(p, e.name)
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      if (e.isDirectory()) walk(fp, rel)
      else if (e.name.endsWith('.md')) {
        const file = `正文/${rel}`
        try {
          out.push({ file, raw: readFileSync(fp, 'utf-8') })
        } catch {
          /* 读不了=跳过（不阻断分析） */
        }
      }
    }
  }
  walk(rootDir, '')
  return out
}

/**
 * 版本改动链：对每个正文文件，读 .zhijuan/history/正文/<章>/ 全部快照（写盘前旧版，时间序），
 * 相邻两两成对 + 末对 (最新快照, 当前正文) = 每次保存一个 before/after（= jzOcb original/final 模型，零新埋点）。
 *   - listSnapshots 返回新→旧 → 反转成旧→新；快照 n 个 → n 对 = n 次写入。
 *   - 无快照 = 从未改过 → 无版本信号（句法/提案信号仍可用）。
 */
function versionChangesOf(projectRoot: string, chapters: { file: string; raw: string }[]): VersionChange[] {
  const changes: VersionChange[] = []
  for (const ch of chapters) {
    const snaps = listSnapshots(projectRoot, ch.file) // 新→旧（snapOrderKey 时间排序=权威）
    if (!snaps.length) continue
    const ordered = [...snaps].reverse() // 旧→新
    for (let i = 0; i < ordered.length; i++) {
      const before = readSnapshot(projectRoot, ch.file, ordered[i].name) ?? ''
      const after = i + 1 < ordered.length ? (readSnapshot(projectRoot, ch.file, ordered[i + 1].name) ?? '') : ch.raw
      changes.push({ file: ch.file, before, after })
    }
  }
  return changes
}

/** 采集本项目全部写作习惯信号（只读，零副作用；dict 透传设置页自定义词表） */
export function gatherSignals(projectId: string): WritingSignals {
  const projectRoot = join(libraryRoot(), projectId)
  const chapters = listChapterFiles(projectRoot)
  const proposals = listProposals(libraryRoot(), projectId)
  const changes = versionChangesOf(projectRoot, chapters)
  return buildSignals({ changes, proposals, chapters, dict: getSettings().overuseDict })
}

// =====================================================================
// 三、执行（开关 + 门控 + 产出 + 状态）
// =====================================================================

/** 草稿区：<工作区>/skills/_drafts/（D-L-6：不参与 listSkills/注入/匹配——扫描器只认 skills/<名>/SKILL.md） */
export function draftsDir(): string {
  return join(workspaceDir(), 'skills', '_drafts')
}

/** 文件名/文档日期统一口径（YYYY-MM-DD，与草稿/报告正文日期一致） */
export function insightDateStamp(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export type InsightRunResult =
  | { ok: true; draftFile: string; reportFile: string; state: InsightsState }
  | { ok: false; reason: 'disabled' | 'recent' | 'no-signal' | 'error' }

/** D-L-8：重跑先备份旧版（旧草稿/旧报告 rename 为 -bak-<HHMMSS> 保留一份，防重跑丢历史） */
function backupOld(dir: string, fileName: string): void {
  const now = new Date()
  const hhmmss = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
  try {
    renameSync(join(dir, fileName), join(dir, `${fileName}.bak-${hhmmss}`))
  } catch {
    /* 备份失败不阻断（尽力而为） */
  }
}

/**
 * 跑一次写作习惯分析（完整闭环，供 4c IPC 与打开项目检查接线）。
 * 门控=shared shouldRunInsights（开关开 + 距上次 ≥7 天 + 有信号）；产出草稿+报告到 _drafts/ + 写状态。
 * 门控失败返回 reason 供调用方提示，不抛异常（后台任务不打断创作）。
 */
export function runWritingInsights(projectId: string): InsightRunResult {
  try {
    const enabled = getSettings().writingInsightsEnabled
    if (!enabled) return { ok: false, reason: 'disabled' }
    const projectRoot = join(libraryRoot(), projectId)
    const prev = readInsightsState(projectRoot)
    const now = Date.now()
    const signals = gatherSignals(projectId)
    const hasAnySignal =
      signals.syntax.chars > 0 || signals.versionRules.length > 0 || signals.adoptStats.total > 0
    if (!shouldRunInsights({ enabled, lastRunAt: prev?.lastRunAt, now, hasAnySignal })) {
      const recent =
        prev && typeof prev.lastRunAt === 'number' && now - prev.lastRunAt < 7 * 24 * 3600 * 1000
      return { ok: false, reason: recent ? 'recent' : 'no-signal' }
    }
    const at = new Date(now)
    const stamp = insightDateStamp(at)
    const dir = draftsDir()
    mkdirSync(dir, { recursive: true })
    const draftName = `${stamp}-写作习惯.md`
    const reportName = `${stamp}-写作习惯-报告.md`
    const draftFile = join(dir, draftName)
    const reportFile = join(dir, reportName)
    if (existsSync(draftFile)) backupOld(dir, draftName)
    if (existsSync(reportFile)) backupOld(dir, reportName)
    writeFileAtomic(draftFile, draftSkillFromStats(signals, { generatedAt: at }))
    writeFileAtomic(reportFile, reportFromStats(signals, { generatedAt: at }))
    const state: InsightsState = { lastRunAt: now, lastDraft: draftName }
    writeInsightsState(projectRoot, state)
    return { ok: true, draftFile, reportFile, state }
  } catch (e) {
    // 任何 IO 异常都不让后台分析拖垮打开项目流程：记录原因返回 error（调用方按「执行失败」提示，
    // 不得与「无信号」混同——后台任务失败不可静默为正常态，否则作者假以为分析已做）
    console.error('[writingInsights] run failed:', e)
    return { ok: false, reason: 'error' }
  }
}
