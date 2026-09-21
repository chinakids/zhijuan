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
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import { writeFileAtomic } from './fsutil'
import { libraryRoot, workspaceDir, getSettings } from './settings'
import { listProposals } from './proposals'
import { listSnapshots, readSnapshot } from './history'
import { DOT_DIR } from '../shared/paths'
import {
  buildSignals,
  draftSkillFromStats,
  reportFromStats,
  shouldRunInsights,
  type InsightsState,
  type InsightRunResult,
  type DraftEntry,
  type VersionChange,
  type WritingSignals
} from '../shared/writingInsights'
import { parseSkillFile, skillNameValid, type SkillWriteResult } from '../shared/skills'

// =====================================================================
// 一、状态文件（.zhijuan/insights-state.json：与批注 done.json 同构的记账文件）
// =====================================================================

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

// =====================================================================
// 四、草稿区数据链（增量 4c：IPC insights:run/status + drafts:list/promote/delete；UI 归体验层）
// 口径：写面只回 {ok}|{ok:false,error}；操作后状态一律重新 drafts:list 拉取（与 devShim mock 同语义）。
// =====================================================================

/** 草稿文件名安全检查：必须纯文件名（禁路径穿越/隐藏文件/非 .md）；不合法返回 null */
function safeDraftName(fileName: string): string | null {
  const n = (fileName ?? '').trim()
  if (!n || n.startsWith('.') || !n.endsWith('.md')) return null
  if (n.includes('/') || n.includes('\\')) return null
  return n
}

/** 草稿区清单：列出 _drafts/ 全部 .md（草稿+报告；新建→旧→新排序）；目录不存在/读不了=空数组 */
export function listDrafts(): DraftEntry[] {
  const dir = draftsDir()
  let names: string[] = []
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.md')).sort()
  } catch {
    return []
  }
  const out: DraftEntry[] = []
  for (const n of names) {
    let mtimeMs = 0
    try {
      mtimeMs = statSync(join(dir, n)).mtimeMs
    } catch {
      /* 读不到元数据=按 0 展示（不阻断列表） */
    }
    out.push({ fileName: n, kind: n.endsWith('-报告.md') ? 'report' : 'draft', mtimeMs })
  }
  return out
}

/** 整目录备份（转正重名先备份旧技能：整个技能目录 rename 为 <名>.bak-<HHMMSS>，防转正覆盖丢 references/） */
function backupSkillDir(skillsRoot: string, name: string): void {
  const now = new Date()
  const hhmmss = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
  try {
    renameSync(join(skillsRoot, name), join(skillsRoot, `${name}.bak-${hhmmss}`))
  } catch {
    /* 备份失败不阻断（尽力而为） */
  }
}

/**
 * 草稿转正（D-L-2：人审转正）：校验（parseSkillFile 必填 + skillNameValid）→ 移到 skills/<名>/SKILL.md
 * （重名=先备份旧技能目录，保留一份；源草稿随移动移除=「转正」语义）。原文保真（含 disabled 字段，
 * 转正默认仍需作者在技能管理开开关——设计文档 §5「转正时作者改」）。
 */
export function promoteDraft(fileName: string): SkillWriteResult {
  const safe = safeDraftName(fileName)
  if (!safe) return { ok: false, error: `草稿文件名「${fileName ?? ''}」不合法` }
  const src = join(draftsDir(), safe)
  let raw: string
  try {
    raw = readFileSync(src, 'utf-8')
  } catch {
    return { ok: false, error: `草稿「${safe}」不存在` }
  }
  const meta = parseSkillFile(raw)
  if (!meta) return { ok: false, error: '转正失败：不是合法的 SKILL.md（需 --- 约定头且 name/description 必填）' }
  if (!skillNameValid(meta.name)) return { ok: false, error: `转正失败：name「${meta.name}」不合法` }
  const skillsRoot = join(workspaceDir(), 'skills')
  const dir = join(skillsRoot, meta.name)
  try {
    if (existsSync(dir)) backupSkillDir(skillsRoot, meta.name)
    mkdirSync(dir, { recursive: true })
    renameSync(src, join(dir, 'SKILL.md'))
  } catch (e) {
    return { ok: false, error: `转正失败：${(e as Error).message}` }
  }
  return { ok: true }
}

/** 删除草稿（未转正的 _drafts/ 文件；不存在→error；删除后状态重新 drafts:list 拉取） */
export function deleteDraft(fileName: string): SkillWriteResult {
  const safe = safeDraftName(fileName)
  if (!safe) return { ok: false, error: `草稿文件名「${fileName ?? ''}」不合法` }
  const f = join(draftsDir(), safe)
  if (!existsSync(f)) return { ok: false, error: `草稿「${safe}」不存在` }
  try {
    rmSync(f, { force: true })
  } catch (e) {
    return { ok: false, error: `草稿删除失败：${(e as Error).message}` }
  }
  return { ok: true }
}
