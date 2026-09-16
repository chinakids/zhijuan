// ===== 织卷 S4 · 提案库（模块设计 §8）：文件落在 <项目>/.zhijuan/proposals/*.json =====
// 所有函数首参都是项目根目录（由调用方从 store 的设置里取），保持纯文件逻辑、可测。
import { join, dirname } from 'path'
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs'
import type { Proposal, ProposalItem } from '../shared/types'
import { DOT_DIR } from '../shared/paths'
import { findAnchorLine, normalizeAnchor } from '../shared/anchor'
import { isIoFailure } from '../shared/proposalApply'

function dir(root: string, projectId: string): string {
  return join(root, projectId, DOT_DIR, 'proposals')
}
function ensure(p: string) { mkdirSync(p, { recursive: true }) }
function pid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function readAll(root: string, projectId: string): Proposal[] {
  const d = dir(root, projectId)
  if (!existsSync(d)) return []
  const out: Proposal[] = []
  for (const f of readdirSync(d)) {
    if (!f.endsWith('.json')) continue
    try { out.push(JSON.parse(readFileSync(join(d, f), 'utf-8'))) } catch { /* 跳过坏档 */ }
  }
  out.sort((a, b) => b.createdAt - a.createdAt)
  return out
}
function write(root: string, projectId: string, p: Proposal) {
  const d = dir(root, projectId)
  ensure(d)
  writeFileSync(join(d, p.id + '.json'), JSON.stringify(p, null, 2), 'utf-8')
}

function findStatus(root: string, projectId: string, id: string): Proposal | null {
  return readAll(root, projectId).find((x) => x.id === id) ?? null
}

/** 列出全部提案（新的在前） */
export function listProposals(root: string, projectId: string): Proposal[] {
  return readAll(root, projectId)
}

/** 同章旧的 pending 一律 stale；每个 item 一条提案（便于逐条接受/拒绝）；metas 与 items 对齐（逐条独立 meta） */
export function createProposals(root: string, projectId: string, source: Proposal['source'], chapter: string, slice: string, items: ProposalItem[], meta?: Proposal['meta'], metas?: Proposal['meta'][]): Proposal[] {
  for (const old of readAll(root, projectId)) {
    if (old.chapter === chapter && old.status === 'pending') {
      old.status = 'stale'
      write(root, projectId, old)
    }
  }
  return items.map((it, idx) => {
    const m = metas?.[idx] ?? meta
    const p: Proposal = { id: pid(), source, chapter, slice, status: 'pending', createdAt: Date.now(), items: [it], meta: m }
    write(root, projectId, p)
    return p
  })
}

/**
 * 章节重命名后同步迁移 proposals 的 chapter 引用（2026-09-11 拍板）。
 * 依据：重命名=身份延续（git --follow / Obsidian 重命名自动更新链接同构）；chapter 是 stale 判定键——
 * 不迁移会让「同章再同步时旧 pending 标 stale」失效（新旧两份 pending 并存，用户可能接受旧稿产物）。
 * 只更新 chapter 指针（展示 + 判定），不动 item 的 before/after 审计内容。返回迁移条数（best-effort，坏档跳过）。
 */
export function migrateChapter(root: string, projectId: string, oldRel: string, newRel: string): number {
  if (!oldRel || !newRel || oldRel === newRel) return 0
  const d = dir(root, projectId)
  if (!existsSync(d)) return 0
  let n = 0
  for (const f of readdirSync(d)) {
    if (!f.endsWith('.json')) continue
    try {
      const p = JSON.parse(readFileSync(join(d, f), 'utf-8')) as Proposal
      if (p.chapter === oldRel) {
        p.chapter = newRel
        writeFileSync(join(d, f), JSON.stringify(p, null, 2), 'utf-8')
        n++
      }
    } catch { /* 坏档跳过 */ }
  }
  return n
}

/** 章节删除后无效化其 pending 提案（2026-09-12 审计补齐）：删除=该章产生的提议不再适用，
 * 置 stale 与「同章再保存」同语义（抽屉「已过期」展示、apply 拒绝），属镜像 migrateChapter 的指针面。
 * 返回处理条数（best-effort，坏档跳过）。 */
export function invalidateChapter(root: string, projectId: string, rel: string): number {
  if (!rel) return 0
  const d = dir(root, projectId)
  if (!existsSync(d)) return 0
  let n = 0
  for (const f of readdirSync(d)) {
    if (!f.endsWith('.json')) continue
    try {
      const p = JSON.parse(readFileSync(join(d, f), 'utf-8')) as Proposal
      if (p.chapter === rel && p.status === 'pending') {
        p.status = 'stale'
        writeFileSync(join(d, f), JSON.stringify(p, null, 2), 'utf-8')
        n++
      }
    } catch { /* 坏档跳过 */ }
  }
  return n
}

/** 接受：把 each item 的 after 按锚点写入对应文件 */
export function applyProposal(root: string, projectId: string, id: string): { ok: boolean; applied: string[]; errors: string[]; retryable?: boolean } {
  const p = findStatus(root, projectId, id)
  if (!p) return { ok: false, applied: [], errors: ['提案不存在'] }
  if (p.status !== 'pending') return { ok: false, applied: [], errors: ['提案状态为 ' + p.status] }
  const applied: string[] = []
  const errors: string[] = []
  // 2026-09-16 候选1：失败分两类的判定（shared/proposalApply，devShim 同口径）——IO/系统失败保持 pending 可重试
  let ioFail = false
  const byFile = new Map<string, ProposalItem[]>()
  for (const it of p.items) {
    const arr = byFile.get(it.target) ?? []
    arr.push(it)
    byFile.set(it.target, arr)
  }
  for (const [file, its] of byFile) {
    const abs = join(root, projectId, file)
    try {
      const text = existsSync(abs) ? readFileSync(abs, 'utf-8') : ''
      let out = text
      for (const it of its) {
        const r = applyAnchor(out, it)
        if (!r.ok) throw new Error(r.msg)
        out = r.out as string
      }
      ensure(dirname(abs))
      writeFileSync(abs, out, 'utf-8')
      applied.push(file)
    } catch (e) {
      errors.push(file + ': ' + String((e as Error).message || e))
      // IO/系统错误（带 code，如 EISDIR/EACCES/ENOSPC）＝瞬态可重试；内容校验错误（无 code）＝确定性失败
      if (isIoFailure(e)) ioFail = true
    }
  }
  // 内容校验失败（漂移/缺 before）→ rejected 不可重试（重放必然再败，正确处置=重扫/再保存重新生成）；
  // IO/系统失败 → 保持 pending，作者可就地重试（pending 卡「接受」按钮天然可用，无需 failed 状态）
  p.status = applied.length ? 'accepted' : ioFail ? 'pending' : 'rejected'
  write(root, projectId, p)
  return { ok: applied.length > 0, applied, errors, retryable: ioFail || undefined }
}

export function rejectProposal(root: string, projectId: string, id: string): boolean {
  const p = findStatus(root, projectId, id)
  if (!p || p.status !== 'pending') return false
  p.status = 'rejected'
  write(root, projectId, p)
  return true
}

/** 清除一条已过期提案（仅 stale 有效）：删除提案文件，让「已过期」条目可以从界面被清理，
 * 否则 stale 提案永久残留（reject 只对 pending 生效，界面又无入口）。 */
export function discardProposal(root: string, projectId: string, id: string): boolean {
  const p = findStatus(root, projectId, id)
  if (!p || p.status !== 'stale') return false
  try {
    rmSync(join(dir(root, projectId), id + '.json'))
  } catch {
    return false
  }
  return true
}

/**
 * 章节「切片」改名后，把该章 slice-sync 的 pending 提案一律置 stale（返回条数）。
 * 为什么只按 source 收口：slice-sync 提案的 items 锚点/世界 target 都携带切片名
 * （人物小节「切片：<旧名>」、世界文件 切片_<旧名>.md）——切片名改后 apply 将命中不到
 * 锚点而按「文末追加 H2」落盘，堆积近重复小节（syncAnchor 白名单要防的形态）；注解/其他
 * 来源提案与切片名无关（target=正文/…），保留 pending。撤销方向不可逆，只做增量不迁移。
 */
export function staleSliceSyncByChapter(root: string, projectId: string, chapter: string): number {
  const d = dir(root, projectId)
  if (!existsSync(d)) return 0
  let n = 0
  for (const f of readdirSync(d)) {
    if (!f.endsWith('.json')) continue
    try {
      const p = JSON.parse(readFileSync(join(d, f), 'utf-8')) as Proposal
      if (p.chapter === chapter && p.source === 'slice-sync' && p.status === 'pending') {
        p.status = 'stale'
        writeFileSync(join(d, f), JSON.stringify(p, null, 2), 'utf-8')
        n++
      }
    } catch { /* 坏档跳过 */ }
  }
  return n
}

/** 按锚点把 item.after 写进文档；upsert-section 做「同节替换 / 无节追加」。
 *  锚点匹配＝归一化后精确相等（shared/anchor.ts，与 devShim 同口径）：不做 includes——
 *  「切片：第一幕_夜」不得误命中「切片：第一幕_夜雨」并整节替换（2026-09-11 锚点精确化）。 */
export function applyAnchor(text: string, it: ProposalItem): { ok: boolean; out?: string; msg?: string } {
  if (it.kind === 'append') return { ok: true, out: text + '\n\n' + it.after }
  if (it.kind === 'replace-text') {
    // 批注同步：按原文文段精确替换（before 校验——原文被手动编辑过则失败，提示人工确认）
    if (!it.before) return { ok: false, msg: 'replace-text 缺少 before 文段' }
    if (!text.includes(it.before)) return { ok: false, msg: '原文段已变（可能被手动编辑），请人工确认' }
    return { ok: true, out: text.replace(it.before, it.after) }
  }
  const anchor = normalizeAnchor(it.anchor || '')
  if (!anchor) return { ok: true, out: text + '\n\n## 切片状态\n\n' + it.after }
  const lines = text.split('\n')
  const hit = findAnchorLine(lines, anchor)
  if (!hit) return { ok: true, out: text + '\n\n## ' + anchor + '\n\n' + it.after }
  let end = lines.length
  for (let i = hit.line + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+/)
    if (m && m[1].length <= hit.level) { end = i; break }
  }
  const keepHeader = lines[hit.line]
  return { ok: true, out: [...lines.slice(0, hit.line), keepHeader, '', ...it.after.split('\n'), '', ...lines.slice(end)].join('\n') }
}
