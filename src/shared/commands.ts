// 织卷 · 输入框 skill 命令（/ 命令，纯逻辑，可单测）
// 范式参照 Cursor / Claude Code Slash Command：`/名称` 显式调用 + 命名 prompt 模板 + 参数拼装。
// 两层结构（与 Claude Code 同款分层，docs.claude.com/en/docs/claude-code/slash-commands）：
//   template 型＝提示词模板（发送前展开为任务指令，模型经上下文字具完成，同「bundled skills」）；
//   action 型＝固定逻辑命令（发送时直连既有入口执行，不经模型自由发挥，同「built-in commands」）。
// 采集自 2026-09-11：`Most built-in commands instead execute fixed logic directly.`，
// 且 bundled skills 是 prompt-based；本文件 v1 三个模板命令 + 两个固定逻辑命令（/巡查 /导演）。
// 固定逻辑命令的枚举值（run: 'chapterCheck' | 'director'）与渲染层分发一一对应。

export interface ZjCommand {
  id: string
  /** 命令名（不含斜杠），如「续写」 */
  name: string
  desc: string
  /** 参数提示，如 [要求]，浮层展示用 */
  argHint: string
  /** template=提示词模板（发送前展开给模型）；action=固定逻辑命令（发送时直连入口执行）；skill=作者技能包（主进程注入技能正文） */
  kind: 'template' | 'action' | 'skill'
  /** 仅 action：直连的动作标识（渲染层据此分发，不得与既有按钮实现双写） */
  run?: 'chapterCheck' | 'director'
  /** 仅 template：展开模板：title=当前章题名（空回退「当前章」），args=命令后的参数文本（可为空） */
  template?: (title: string, args: string) => string
}

export const BUILTIN_COMMANDS: ZjCommand[] = [
  {
    id: 'continue',
    name: '续写',
    desc: '接续当前章正文，以修改卡提交',
    argHint: '[要求]',
    kind: 'template',
    template: (title, args) =>
      `创作任务：续写《${title}》正文。先用 zj_read_doc 读当前章正文，再承接其末尾续写；接续前文叙事腔调、视角与未收束线索自然推进，不要复述或改写已有正文；` +
      `新增内容走正文修改口径：用 zj_edit_doc 提交修改卡（before=正文末尾一段唯一原文，after=原文之后接新增），一次提交一段；不要用终端命令找文件。` +
      (args ? `\n具体要求：${args}` : '')
  },
  {
    id: 'polish',
    name: '润色',
    desc: '打磨当前章语感，逐处播改卡',
    argHint: '[范围/侧重]',
    kind: 'template',
    template: (title, args) =>
      `创作任务：润色《${title}》正文。先用 zj_read_doc 读当前章正文，再逐句打磨语感（病句、赘词、节奏），保持原意与信息量，不要重写情节；` +
      `改动走正文修改口径：用 zj_edit_doc 提交修改卡，逐处给 before/after 对。` +
      (args ? `\n具体要求：${args}` : '')
  },
  {
    id: 'extend',
    name: '延伸',
    desc: '给 3 个可发展的走向，不写正文',
    argHint: '[焦点]',
    kind: 'template',
    template: (title, args) =>
      `创作任务：围绕《${title}》当前情节，给出 3 个可发展的走向（冲突、悬念、人物动机各一），` +
      `每条 2-3 句说明如何接上、可埋什么；只给走向，不写正文。` +
      (args ? `\n聚焦：${args}` : '')
  }
]

/** /巡查 参数模式：chapter=本章小环·短巡查（默认）；revision=分层修订；full=全卷一致性巡查 */
export type PatrolMode = 'chapter' | 'revision' | 'full'

/**
 * /巡查 参数严格解析（枚举校验，不静默降级——2026-09-12 对话流收尾）：
 * 空/「本章」「短巡查」→ chapter；「修订」「分层」→ revision；「全卷」「一致性」→ full；
 * 其余返回 null，调用方就地提示合法参数，不做猜测性降级（此前 `/巡查 乱写` 会静默跑短巡查）。
 */
export function parsePatrolArgs(args: string): PatrolMode | null {
  const a = args.trim()
  if (!a || a === '本章' || a === '短巡查') return 'chapter'
  if (a === '修订' || a === '分层') return 'revision'
  if (a === '全卷' || a === '一致性') return 'full'
  return null
}

/** 固定逻辑命令：发送时不走模型，直连既有入口（与按钮共用同一实现，不双写）。 */
export const FIXED_COMMANDS: ZjCommand[] = [
  {
    id: 'patrol',
    name: '巡查',
    desc: '本章小环·短巡查：读当前章与设定找问题，逐条可转提案',
    argHint: '[本章|修订|全卷]',
    kind: 'action',
    run: 'chapterCheck'
  },
  {
    id: 'director',
    name: '导演',
    desc: '给当前章出一份导演板并写入大纲（结论落资产）',
    argHint: '[要求]',
    kind: 'action',
    run: 'director'
  }
]

export const ALL_COMMANDS: ZjCommand[] = [...BUILTIN_COMMANDS, ...FIXED_COMMANDS]

const MAX_QUERY = 30

/**
 * 在 value 的 caret 位置解析 `/` 命令触发（与 mention.ts 的 @ 触发同规则）：
 * caret 前最近的 `/`；`/` 前必须行首或空白（避免 a/b 这样的路径）；`/` 后到 caret 间不得含空白/换行；
 * token 可空且长度 ≤ MAX_QUERY。返回替换区间 [at, at+1+length)，null=未触发。
 */
export function parseCommandTrigger(value: string, caret: number): { at: number; length: number; query: string } | null {
  if (caret <= 0) return null
  const before = value.slice(0, caret)
  const at = before.lastIndexOf('/')
  if (at < 0) return null
  if (at > 0 && !/\s/.test(before[at - 1])) return null
  const token = before.slice(at + 1)
  if (token.length > MAX_QUERY) return null
  if (/\s/.test(token)) return null
  return { at, length: token.length, query: token }
}

/**
 * 候选过滤（内置模板命令 + 固定逻辑命令 + 附加技能命令）：query 为空全出；否则按命令名/说明包含过滤。
 * 内置优先=顺序在前（同名技能不遮蔽：仍列出并标注「技能」——设计基线 §六「技能仅在菜单列出且标注」；
 * 命令解析侧 expandCommand/matchFixedCommand 先行=同名时技能不可显式调用，属既定取舍）。
 * 2026-09-21 智能层 skill 运行层：技能命令由渲染层经 skills:list 拉取后作为 extras 传入。
 */
export function filterCommandCandidates(query: string, extras: ZjCommand[] = []): ZjCommand[] {
  const q = query.trim().toLowerCase()
  const builtin = ALL_COMMANDS.filter((c) => !q || c.name.includes(q) || c.desc.includes(q))
  const extra = extras.filter((c) => !q || c.name.includes(q) || c.desc.includes(q))
  return [...builtin, ...extra]
}

/** 把 `/token` 替换为 `/命令名 `（后续空格处理与 insertAtMention 一致），返回新 value 与光标位置。 */
export function insertCommand(
  value: string,
  trig: { at: number; length: number },
  cmd: ZjCommand
): { value: string; caret: number } {
  const tail = value.slice(trig.at + 1 + trig.length)
  const needSpace = !/^\s/.test(tail)
  const repl = `/${cmd.name}${needSpace ? ' ' : ''}`
  const next = value.slice(0, trig.at) + repl + tail
  return { value: next, caret: trig.at + repl.length }
}

/**
 * 把整条用户输入展开为命令模板：`/续写 300 字，带出沈藏`
 * 匹配规则：输入以 `/命令名` 开头（命令名后跟空白或结束），命令名必须严格等于内置模板命令名；
 * 非模板命令（无 `/` 开头、命令名不存在、固定逻辑命令）返回 null，调用方按普通消息/固定逻辑处理。
 */
export function expandCommand(value: string, chapterTitle: string): string | null {
  const m = /^\/([^\s]+)\s*([\s\S]*)$/.exec(value.trim())
  if (!m) return null
  const cmd = BUILTIN_COMMANDS.find((c) => c.kind === 'template' && c.name === m[1])
  if (!cmd?.template) return null
  return cmd.template(chapterTitle || '当前章', m[2].trim())
}

/**
 * 发送前识别「固定逻辑命令」：整条输入以 `/命令名` 开头（命令名后跟空白或结束），
 * 命令名严格等于 FIXED_COMMANDS 内置名。与 expandCommand 同口径（命令必须在行首）。
 * 返回匹配的命令与参数文本；非固定逻辑命令返回 null（调用方走模板展开或普通消息）。
 */
export function matchFixedCommand(value: string): { cmd: ZjCommand; args: string } | null {
  const m = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(value.trim())
  if (!m) return null
  const cmd = FIXED_COMMANDS.find((c) => c.name === m[1])
  if (!cmd) return null
  return { cmd, args: (m[2] ?? '').trim() }
}
