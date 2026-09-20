// ===== 素材卡 · 共享纯函数（2026-09-18 从 LibraryBrowser 抽取，主进程 context.ts 装配与渲染层素材卡同源同口径） =====
// 单一权威源原则：素材卡的「文件判据 / 标签解析 / 首段预览」只有这一份实现，
// 两边（作者侧素材库 UI、模型侧创作上下文路标）语义一致，避免「同一素材两种口径」。
import { extractFrontMatter } from './fmatter'

/** 素材文件判据：非 采集池/（任务卡）、非 索引.md（目录文档）、非隐藏文件。
 *  file = listDocs('素材库') 返回的相对路径（如 `桥段/旧物定情.md`）或渲染层列表文件名。 */
export function isMaterialCard(file: string): boolean {
  return !file.startsWith('采集池/') && file !== '索引.md' && !file.startsWith('.')
}

/** front matter 里的标签（兼容 `标签:`（旧演示）与 `tags:`（模块设计）两种键） */
export function materialTags(text: string): string[] {
  const { fm } = extractFrontMatter(text)
  if (!fm) return []
  const raw = fm['标签'] ?? fm['tags'] ?? null
  if (Array.isArray(raw)) return raw.map(String)
  return raw ? String(raw).split(/[,，]/).map((s) => s.trim()).filter(Boolean) : []
}

/** 首段预览：第一个非空行（含标题行——采集草稿的 H1 是内容题名，与文件名不同源，最有辨识度）；截 max 字符。
 *  2026-09-18 抽取时曾试「跳过 H1」——被采集草稿实锤打回：素材模板 H1=素材名（与文件名重复）但
 *  采集回填卡的 H1=内容题名（如「校园老图书馆（采集草稿）」），跳过会丢真实题名；原语义是对的。
 *  2026-09-20 体验层走查补：UI 展示侧剥掉 Markdown 标题标记（`# ` 前缀），卡片预览显示干净题名
 *  （模型侧 materialContextPreview 同样受益：H1=素材名的模板素材经此剥除后能正确识别「与文件名相同」而取正文行）。 */
export function materialPreview(text: string, max = 72): string {
  const { body } = extractFrontMatter(text)
  for (const line of body.split('\n')) {
    const t = line.trim()
    if (!t) continue
    const clean = t.replace(/^#+\s*/, '').trim()
    if (!clean) continue
    return clean.length > max ? clean.slice(0, max) + '…' : clean
  }
  return ''
}

/** 上下文路标预览（2026-09-18 素材注入修复）：在 materialPreview（含标题行，已剥 Markdown 标记）基础上做增量判别——
 *  首行若与素材文件名相同（模板素材 H1=素材名，无信息增量）→ 改取正文行（第一个非 # 非空行）；
 *  否则沿用首行（采集草稿题名≠文件名→题名即是信号）；取不到任何行→空（路标只留文件名+标签）。 */
export function materialContextPreview(text: string, name: string, max = 48): string {
  const first = materialPreview(text, 999).replace(/^#+\s*/, '').trim()
  let out = ''
  if (first && first !== name) {
    out = first
  } else {
    const { body } = extractFrontMatter(text)
    for (const line of body.split('\n')) {
      const t = line.trim()
      if (t && !t.startsWith('#')) {
        out = t
        break
      }
    }
  }
  if (!out) return ''
  return out.length > max ? out.slice(0, max) + '…' : out
}
