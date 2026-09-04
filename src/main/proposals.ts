// ===== 织卷 S4 · 提案库（模块设计 §8）：文件落在 <项目>/.zhijuan/proposals/*.json =====
// 所有函数首参都是项目根目录（由调用方从 store 的设置里取），保持纯文件逻辑、可测。
import { join, dirname } from 'path'
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import type { Proposal, ProposalItem } from '../shared/types'
import { DOT_DIR } from '../shared/paths'

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

/** 同章旧的 pending 一律 stale；每个 item 一条提案（便于逐条接受/拒绝） */
export function createProposals(root: string, projectId: string, source: Proposal['source'], chapter: string, slice: string, items: ProposalItem[]): Proposal[] {
  for (const old of readAll(root, projectId)) {
    if (old.chapter === chapter && old.status === 'pending') {
      old.status = 'stale'
      write(root, projectId, old)
    }
  }
  return items.map((it) => {
    const p: Proposal = { id: pid(), source, chapter, slice, status: 'pending', createdAt: Date.now(), items: [it] }
    write(root, projectId, p)
    return p
  })
}

/** 接受：把 each item 的 after 按锚点写入对应文件 */
export function applyProposal(root: string, projectId: string, id: string): { ok: boolean; applied: string[]; errors: string[] } {
  const p = findStatus(root, projectId, id)
  if (!p) return { ok: false, applied: [], errors: ['提案不存在'] }
  if (p.status !== 'pending') return { ok: false, applied: [], errors: ['提案状态为 ' + p.status] }
  const applied: string[] = []
  const errors: string[] = []
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
    }
  }
  p.status = applied.length ? 'accepted' : 'rejected'
  write(root, projectId, p)
  return { ok: applied.length > 0, applied, errors }
}

export function rejectProposal(root: string, projectId: string, id: string): boolean {
  const p = findStatus(root, projectId, id)
  if (!p || p.status !== 'pending') return false
  p.status = 'rejected'
  write(root, projectId, p)
  return true
}

/** 按锚点把 item.after 写进文档；upsert-section 做「同节替换 / 无节追加」 */
export function applyAnchor(text: string, it: ProposalItem): { ok: boolean; out?: string; msg?: string } {
  if (it.kind === 'append') return { ok: true, out: text + '\n\n' + it.after }
  const anchor = (it.anchor || '').replace(/^#+\s*/, '').trim()
  if (!anchor) return { ok: true, out: text + '\n\n### 切片状态\n\n' + it.after }
  const lines = text.split('\n')
  let hit = -1
  let hitLevel = 0
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.*)$/)
    if (m && m[2].trim().includes(anchor)) {
      hit = i
      hitLevel = m[1].length
      break
    }
  }
  if (hit < 0) return { ok: true, out: text + '\n\n### ' + anchor + '\n\n' + it.after }
  let end = lines.length
  for (let i = hit + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+/)
    if (m && m[1].length <= hitLevel) { end = i; break }
  }
  const keepHeader = lines[hit]
  return { ok: true, out: [...lines.slice(0, hit), keepHeader, '', ...it.after.split('\n'), '', ...lines.slice(end)].join('\n') }
}
