// ===== 织卷 · agent 子任务骨架（模块设计 §11之 模块 J / 评审 E1） =====
// 把「起 session → 注入上下文 → 跑模型 → 解析结构化 JSON → 返回」这套从前每个检查器各写一遍的样板，
// 收敛为 runSubtask(任务定义)。检查器 = 一个 SubtaskDef；加新检查器 = 写一个定义，不复制接线。
// 同文件带能力注册表（评审 E3）与通用 JSON 提取工具。
import { driveSession } from './runtime'
import { getSettings } from '../settings'
import type { SubtaskOutcome, SubtaskCtx, SubtaskDef } from './subtask-types'

export type { SubtaskOutcome, SubtaskCtx, SubtaskDef }

// ---------- 通用提取：剥围栏 + 切花括号/方括号 + parse（各检查器原重复逻辑收敛于此） ----------
export function extractJson<T = unknown>(text: string): T | null {
  const clean = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  try {
    return JSON.parse(clean) as T
  } catch {}
  const a = clean.indexOf('{')
  const b = clean.lastIndexOf('}')
  if (a >= 0 && b > a) {
    try {
      return JSON.parse(clean.slice(a, b + 1)) as T
    } catch {}
  }
  const c = clean.indexOf('[')
  const d = clean.lastIndexOf(']')
  if (c >= 0 && d > c) {
    try {
      return JSON.parse(clean.slice(c, d + 1)) as T
    } catch {}
  }
  return null
}

/** 正文去掉 front matter（约定头） */
export function stripFm(raw: string): string {
  const m = raw.match(/^---\n[\s\S]*?\n---\n/)
  return m ? raw.slice(m[0].length) : raw
}

/** 超长文本取 前段+省略注记+尾段，保证材料包可控 */
export function clip(text: string, head = 2400, tail = 1400): string {
  if (text.length <= head + tail) return text
  return text.slice(0, head) + '\n……（此处为节省篇幅省略中部）……\n' + text.slice(-tail)
}

let runSeq = 0

/** 能力是否被设置页关闭（返回关闭原因串，null = 可跑） */
export function subtaskBlocked(id: string, title: string): string | null {
  const caps = getSettings().capabilities ?? {}
  return caps[id] === false ? `能力「${title}」已在设置里关闭，先用设置页把它打开。` : null
}

/** 执行一次结构化子任务（单会话）；材料组装的失败、驱动失败、解析失败都折叠成 { ok:false, error } */
export async function runSubtask<T>(
  def: SubtaskDef<T>,
  projectId: string,
  args?: Record<string, unknown>
): Promise<SubtaskOutcome<T>> {
  const blocked = subtaskBlocked(def.id, def.title)
  if (blocked) return { ok: false, error: blocked }
  try {
    const out = await runOnceInner(def, { projectId, args, seq: runSeq++ })
    // 诊断增强：最后一次驱动仍被判「空/无效」时，把模型原始回复带回（正常路径不带，省跨 IPC 大文本）
    const weak = def.retry ? def.retry.check(out.value) : false
    return weak
      ? { ok: true, result: out.value, lastRaw: out.lastRaw }
      : { ok: true, result: out.value }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 300) }
  }
}

/** 低层驱动一次（outline 这类循环任务用它**一个接一个跑**；正常情况请走 runSubtask） */
export async function runOnce<T>(def: SubtaskDef<T>, ctx: SubtaskCtx): Promise<T> {
  return (await runOnceInner(def, ctx)).value
}

/** 同 runOnce，但把最后一次模型原始回复一并带回（诊断「空=模型没给 vs 解析失败」用；acts/outline 循环场景按需取） */
export async function runOnceInner<T>(def: SubtaskDef<T>, ctx: SubtaskCtx): Promise<{ value: T; lastRaw: string }> {
  const parts = await def.buildParts(ctx)
  if (!parts || !parts.length) throw new Error('任务材料为空')
  const sid = `${def.sidPrefix ?? def.id}-${Date.now().toString(36)}-${ctx.seq.toString(36)}-${ctx.projectId}`
  const prompt = () => parts.join('\n\n')
  const exec = (sidX: string, p: string) => driveSession(sidX, p, { maxMs: def.maxMs ?? 7 * 60 * 1000 })
  let text = await exec(sid, prompt())
  let result = def.parse(text, ctx)
  if (def.retry && def.retry.check(result)) {
    text = await exec(sid + '-r', prompt() + '\n\n' + def.retry.prompt)
    result = def.parse(text, ctx)
  }
  if (def.postprocess) result = def.postprocess(result, ctx)
  return { value: result, lastRaw: text }
}

// ---------- 能力注册表（模块 J / E3）：检查器登记后可枚举，供设置页开关 ----------
const registry = new Map<string, SubtaskDef<unknown>>()

export function registerCapability(def: SubtaskDef<unknown>): void {
  registry.set(def.id, def)
}

export function listCapabilities(): { id: string; title: string; description?: string }[] {
  return [...registry.values()].map((d) => ({ id: d.id, title: d.title, description: d.description }))
}
