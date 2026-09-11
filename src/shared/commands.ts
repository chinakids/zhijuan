// 织卷 · 输入框 skill 命令（/ 命令，纯逻辑，可单测）
// 范式参照 Cursor / Claude Code Slash Command：`/名称` 显式调用 + 命名 prompt 模板 + 参数拼装。
// v1 内置命令全部为「模板注入型」（发送前把命令展开为任务指令，模型经上下文与工具完成）；
// 固定逻辑型动作（/巡查→本章小环、/导演→runDirector 等已有按钮能力）不在此列，留后续轮接入。

export interface ZjCommand {
  id: string
  /** 命令名（不含斜杠），如「续写」 */
  name: string
  desc: string
  /** 参数提示，如 [要求]，浮层展示用 */
  argHint: string
  /** 展开模板：title=当前章题名（空回退「当前章」），args=命令后的参数文本（可为空） */
  template: (title: string, args: string) => string
}

export const BUILTIN_COMMANDS: ZjCommand[] = [
  {
    id: 'continue',
    name: '续写',
    desc: '接续当前章正文，以修改卡提交',
    argHint: '[要求]',
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
    template: (title, args) =>
      `创作任务：围绕《${title}》当前情节，给出 3 个可发展的走向（冲突、悬念、角色动机各一），` +
      `每条 2-3 句说明如何接上、可埋什么；只给走向，不写正文。` +
      (args ? `\n聚焦：${args}` : '')
  }
]

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

/** 候选过滤：query 为空全出；否则按命令名/说明包含过滤（内置就 3 个，不做限量）。 */
export function filterCommandCandidates(query: string): ZjCommand[] {
  const q = query.trim().toLowerCase()
  return BUILTIN_COMMANDS.filter((c) => !q || c.name.includes(q) || c.desc.includes(q))
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
 * 匹配规则：输入以 `/命令名` 开头（命令名后跟空白或结束），命令名必须严格等于内置名；
 * 非命令（无 `/` 开头、命令名不存在）返回 null，调用方按普通消息发送。
 */
export function expandCommand(value: string, chapterTitle: string): string | null {
  const m = /^\/([^\s]+)\s*([\s\S]*)$/.exec(value.trim())
  if (!m) return null
  const cmd = BUILTIN_COMMANDS.find((c) => c.name === m[1])
  if (!cmd) return null
  return cmd.template(chapterTitle || '当前章', m[2].trim())
}
