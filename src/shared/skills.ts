// ===== 织卷 · skill 技能包（作者方法论资产）运行层纯逻辑 =====
// 设计基线：docs/skill-运行层-产品规划-2026-09-21.md（§3 格式 / §5 注入与触发 / §7 验收）。
// 业界共识：技能=作者资产；渐进披露（描述常驻、正文按需激活）；显式 /技能名 + 关键词匹配双路。
// 本文件只放纯函数（可单测）；fs 扫描在主进程（main/skills.ts listSkills）。
import { extractFrontMatter } from './fmatter'
import type { ZjCommand } from './commands'

export interface SkillMeta {
  /** 技能名（=目录名；front matter name 与目录名不一致=不生效，见 validateSkillDir） */
  name: string
  /** 做什么+何时用（≤500 字符；清单展示与模型语义匹配用） */
  description: string
  /** 触发场景补充（追加到清单行，计入展示预算） */
  whenToUse?: string
  /** 触发词列表（织卷扩展：确定性关键词匹配，模型语义之外的补路） */
  triggers?: string[]
  /** 参数说明（如「[要点]」；浮层 argHint 与激活时拼装用，一期=提示文本不替换变量） */
  arguments?: string
  /** true=禁用：不注入清单、不参与任何匹配（含显式 /技能名） */
  disabled?: boolean
  /** 技能根目录名（相对工作区 skills/ 的目录名，=name） */
  dir: string
  /** front matter 剥离后的正文（激活时注入） */
  body: string
  /** 无效原因（缺必填字段/与目录名不一致）；有值=该技能不生效 */
  invalid?: string
}

/** name 必须等于目录名（防「目录叫 A 命令却调用 B」的幻影——与 parsePatrolArgs 不静默降级同精神） */
export function validateSkillDir(meta: SkillMeta, dirName: string): boolean {
  if (dirName !== meta.name) {
    meta.invalid = `技能目录名「${dirName}」与 name「${meta.name}」不一致，技能不生效`
    return false
  }
  return true
}

/**
 * 解析 SKILL.md 文本 → SkillMeta（不含 dir；调用方补）。
 * 校验：必须是 front matter（--- 开头）+ name 必填 + description 必填；不合格返回 null。
 * 一期子集字段：name/description/when_to_use/triggers/arguments/disabled；
 * 其余（license/compatibility/metadata/scripts 等）不解析不报错，忽略（导入导出互操作预留）。
 */
export function parseSkillFile(raw: string): SkillMeta | null {
  const { fm, body } = extractFrontMatter(raw)
  if (!fm) return null
  const name = String(fm['name'] ?? '').trim()
  const description = String(fm['description'] ?? '').trim()
  if (!name || !description) return null
  const meta: SkillMeta = {
    name,
    description,
    dir: name,
    body: body.trim(),
    invalid: undefined
  }
  const w = String(fm['when_to_use'] ?? '').trim()
  if (w) meta.whenToUse = w
  // arguments：YAML 列表（如 `[要点]`）还原为方括号提示样式；纯文本（`详见正文第二节`）原样
  const av = fm['arguments']
  const args =
    av === undefined || av === null
      ? ''
      : Array.isArray(av)
        ? '[' + av.join(', ') + ']'
        : String(av).trim()
  if (args) meta.arguments = args
  // triggers：YAML 列表（[a, b] 由 fmatter 解析成数组）或空格/竖线分隔字符串
  const tg = fm['triggers']
  if (Array.isArray(tg)) {
    meta.triggers = tg.map((x) => String(x).trim()).filter(Boolean)
  } else if (typeof tg === 'string' && tg.trim()) {
    meta.triggers = tg.split(/[\s|/]+/).map((x) => x.trim()).filter(Boolean)
  }
  // disabled：YAML true（fmatter 存 string|number|string[]，'true' 字符串语义）
  const disVal = fm['disabled']
  meta.disabled = String(disVal).trim() === 'true'
  return meta
}

const CUT = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s)

/** 清单行（- 名：描述（触发词：a/b））；超预算截断在 skillListing 内 */
export function listingLine(meta: SkillMeta, perLine: number): string {
  let line = `- ${meta.name}：${meta.description}`
  if (meta.triggers && meta.triggers.length) line += `（触发词：${meta.triggers.join('/')}）`
  return CUT(line, perLine)
}

/**
 * 生成【可用技能】清单块（描述常驻；对齐 Claude「description always in context」）。
 * 预算：perLine 每行截断；listing 总预算超=降级 name-only（对齐 Claude 「name-only」）。
 * 无可用技能（空/全 disabled/全无效）→ null（不注入）。
 */
export function skillListing(skills: SkillMeta[], perLine: number, total: number): string | null {
  const usable = skills.filter((s) => !s.disabled && !s.invalid)
  if (!usable.length) return null
  const head =
    '【可用技能】（作者沉淀的写作方法/流程；与需求匹配时说明「按<技能名>来做」，或直接输入 /技能名 调用；命中技能的内容已自动提供，无需再用工具加载）'
  const rows = usable.map((s) => listingLine(s, perLine))
  let body = rows.join('\n')
  if (body.length > total) {
    // 超总预算：降级 name-only（描述不再进上下文，模型只知道有什么技能）
    body = usable.map((s) => `- ${s.name}`).join('\n')
    if (body.length > total) {
      // name-only 仍超（极端）：只留前 N 条并注明
      const kept: string[] = []
      let len = 0
      for (const s of usable) {
        const line = `- ${s.name}`
        if (len + line.length + 1 > total) break
        kept.push(line)
        len += line.length + 1
      }
      body = kept.join('\n') + `\n（另有 ${usable.length - kept.length} 个技能未列出）`
    }
  }
  return head + '\n' + body
}

/** 2-gram 集合（纯文本相似度轻量口径；与 wordfreq.ts 免分词 n-gram 先例同源，零依赖零分词器） */
function ngrams(s: string): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2))
  return out
}

/**
 * 输入匹配技能（自动激活通道；不含显式 /技能名）。
 * 匹配顺序：① triggers 精确包含（任一触发词出现即中）；② 回退 description 相似度——
 *   desc 的 2-gram 在输入中出现的数量 ≥3 视为命中（中文免分词轻量口径），按命中数降序。
 * disabled/invalid 不参与；最多返回 limit 条（默认 2，防一次激活一堆）。
 * 不做 embedding（bge-m3 语义匹配=二期候选，触发条件=关键词漏检反馈）。
 */
export function matchSkillForInput(text: string, skills: SkillMeta[], limit = 2): SkillMeta[] {
  const usable = skills.filter((s) => !s.disabled && !s.invalid)
  const t = text || ''
  // ① 触发词通道
  const trig = usable.filter((s) => s.triggers?.some((k) => k && t.includes(k)))
  if (trig.length) return trig.slice(0, limit)
  // ② 描述相似度通道
  const scored: { s: SkillMeta; hits: number }[] = []
  for (const s of usable) {
    const grams = ngrams(s.description + (s.whenToUse ?? ''))
    let hits = 0
    for (const g of grams) if (t.includes(g)) hits++
    if (hits >= 3) scored.push({ s, hits })
  }
  scored.sort((a, b) => b.hits - a.hits)
  return scored.slice(0, limit).map((x) => x.s)
}

/**
 * 显式调用解析：输入以 `/技能名 [参数]` 开头 → { skill, args }；未匹配（含禁用/无效技能）→ null。
 * 与 expandCommand/matchFixedCommand 同口径（命令必须在行首、技能名后跟空白或结束）。
 */
export function matchExplicitSkill(value: string, skills: SkillMeta[]): { skill: SkillMeta; args: string } | null {
  const m = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec((value || '').trim())
  if (!m) return null
  const s = skills.find((x) => !x.disabled && !x.invalid && x.name === m[1])
  if (!s) return null
  return { skill: s, args: (m[2] ?? '').trim() }
}

/**
 * 激活注入块：`【技能：<名>】\n<正文>（参数：…）`。
 * 预算 body（SKILL_CAPS.body=3000）：超=保头+尾注（与 zj_read_doc offset 尾注同构，可现读完整）。
 */
export function skillBodyBlock(skill: SkillMeta, args?: string, bodyCaps = 3000): string {
  let body = skill.body
  if (body.length > bodyCaps) {
    body =
      body.slice(0, bodyCaps) +
      `\n（正文已省略 ${skill.body.length - bodyCaps} 字符；完整内容在 skills/${skill.name}/SKILL.md，需要时用 zj_read_doc 读取）`
  }
  if (args) body += `\n（参数：${args}）`
  // 2026-09-21 12:00 轮真模型实测修正：明示「正文已完整给出、无需再读技能文件」——
  // 否则模型（Claude Code 系引擎自带 skill 工具）会去磁盘 seek 技能文件，工具循环直至超时
  body += `\n（技能正文已完整给出，无需再读取技能文件；子文件在 skills/${skill.name}/ 下，需要时用 zj_read_doc 读取）`
  return `【技能：${skill.name}】\n${body}`
}

/** 技能 → / 命令卡（kind='skill'；与内置合并进 ALL_COMMANDS 展示，内置优先由 filterCommandCandidates 保证） */
export function skillCommandOf(meta: SkillMeta): ZjCommand {
  return {
    id: 'skill:' + meta.name,
    name: meta.name,
    desc: meta.description,
    argHint: meta.arguments ?? '',
    kind: 'skill'
  }
}

/**
 * runChat 技能注入组装（2026-09-21 12:00 轮提取为纯函数；engine.ts 调用）。
 * 返回本轮激活技能块（【技能：名】正文）与替换后的用户消息：
 * 显式 /技能名 命中→注入+把斜杠命令替换为技能指令（Claude Code 系引擎会把「/xx」当引擎命令解读，
 * 真模型实测会陷入 seek 技能文件工具循环直至超时——见智能层档案 2026-09-21 12:00 轮）；
 * 未命中→关键词自动匹配（≤2 条）注入，用户消息原样。
 */
export function resolveSkillInjection(
  skills: SkillMeta[],
  prompt: string,
  quote: string | null,
  bodyCaps = 3000
): { blocks: string[]; userPrompt: string } {
  const blocks: string[] = []
  let userPrompt = prompt
  const explicit = matchExplicitSkill(prompt, skills)
  if (explicit) {
    blocks.push(skillBodyBlock(explicit.skill, explicit.args, bodyCaps))
    userPrompt = `（按技能《${explicit.skill.name}》执行）` + (explicit.args ? `\n${explicit.args}` : '')
  } else {
    for (const s of matchSkillForInput(prompt + (quote ?? ''), skills)) {
      blocks.push(skillBodyBlock(s, undefined, bodyCaps))
    }
  }
  return { blocks, userPrompt }
}
