// ===== 织卷 · pi 内核写作域工具（zj_* → pi ToolDefinition）=====
// 语义来源：src/plugins/zj-core.ts（dsh cordis 插件形态，2026-09 起在 dsh 内核下运行）。
// 本文件把同样六个工具迁到 @earendil-works/pi-coding-agent 的 ToolDefinition 形态：
//   · 入参 schema：纯 JSON Schema 字面量（pi 的 tool-definition-wrapper 只把 parameters 当 JSON Schema，
//     非 TypeBox 时走 coerceWithJsonSchema + Value.Check——实测可用，见 Phase 2 探针），
//     因此主进程无需 import typebox（ESM-only，且会拖大 main bundle）。
//   · 返回值：AgentToolResult —— content 为模型可见文本，details 给运行时/UI 用。
//   · 文本契约严格沿用 zj-core（★ZJ_EDIT★ / ★ZJ_COLLECT★ 载荷、续读 offset 提示、
//     错误串括注中文），engine.ts 的 translate() 与本文件零耦合、无需改动。
//
// 与 zj-core 的差异（刻意）：
//   1) signal 由 pi 传入（每轮 tool call 的 AbortSignal），fs 读取全部受其约束（dsh 版用模块级常量 ABORT，
//      取消时不会真的中断读盘）；
//   2) edits / keywords 同时接受 JSON 数组字符串与真数组（dsh 版只吃字符串；旧 prompt 仍按字符串调用）；
//   3) 额外提供 todo_write / ask_user_question 两个「交互类」工具（settings.agentTools 开关），
//      与 dsh 内建同名工具对齐——engine.translate 的 INTERACTIVE_TOOLS 按同一名字跳过 meta 事件。
//
// 存储：只读 fs（作品根目录由调用方以 base 传入），不引入第二套存储；写操作一律走 UI 提案制。

import { readdir, readFile, stat } from 'node:fs/promises'
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'

const MAX_HEAD = 80_000 // zj_read_doc 单文件返回上限（与 zj-core 同值）

/** 纯 JSON Schema（pi 的 TSchema 结构化等价物；本文件不引 typebox） */
type JsonSchema = Record<string, unknown>

const str = (description: string): JsonSchema => ({ type: 'string', description })
const num = (description: string): JsonSchema => ({ type: 'number', description })

function objectSchema(props: Record<string, JsonSchema>, required: string[]): JsonSchema {
  return { type: 'object', properties: props, required, additionalProperties: false }
}

export interface PiToolDeps {
  /** 用户问答回灌目录（与 dsh 同目录：主进程 agent:answer 写 <batch>.json） */
  answerDir: () => string
  /** settings.agentTools 解析结果（缺省全开，与 dsh toolsOverrideArgs 同口径） */
  interactive?: { todo?: boolean; askUser?: boolean }
  /** 单次问答等待上限（默认 20 分钟，与 zj-questions 同值） */
  askTimeoutMs?: number
}

/** base 是作品根目录（绝对路径）。所有相对路径先钳制再读（与 zj-core.clamp 同语义）。 */
function clamp(base: string, rel: string): string {
  const root = resolve(base)
  const full = resolve(root, rel)
  if (full !== root && !full.startsWith(root + sep)) throw new Error(`路径超出作品目录：${rel}`)
  return full
}

function parseFrontMatter(text: string): { meta: string; body: string } {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!m) return { meta: '', body: text }
  return { meta: m[1], body: text.slice(m[0].length) }
}

/** 取文件第 offset 字符起 max 字符并给出文件信息头；超长注明已读到哪里、如何续读（与 zj-core 同文案） */
async function readClipped(file: string, max: number, label: string, offset = 0, signal?: AbortSignal): Promise<string> {
  const buf = await readFile(file, { encoding: 'utf8', signal })
  const { meta, body } = parseFrontMatter(buf)
  let head = `【${label} · ${basename(file)}】`
  if (meta) {
    const keep = meta
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^(章号|题名|切片|时间|涉及人物|姓名|身份|标签):/.test(l))
    if (keep.length) head += '\n' + keep.join('\n')
  }
  const start = Math.max(0, offset)
  const seg = body.slice(start, start + max)
  if (body.length <= max && start === 0) return `${head}\n\n${body}`
  const readTo = start + seg.length
  if (!seg.length) return `${head}\n\n…（已到文件末尾：全文共 ${body.length} 字符，之前已读 ${start} 字符；要看更早内容请用较小的 offset 或 zj_search）`
  if (readTo >= body.length) return `${head}\n\n${seg}\n\n…（已到文件末尾，全文共 ${body.length} 字符）`
  return `${head}\n\n${seg}\n\n…（已读到第 ${readTo} 字符，全文共 ${body.length} 字符，剩 ${body.length - readTo} 字符；可传 offset=${readTo} 继续读，或调大 maxChars、定向 zj_search）`
}

async function walkMd(root: string, dir: string, depth = 0, out: string[] = []): Promise<string[]> {
  if (depth > 3) return out
  let entries
  try {
    entries = await readdir(clamp(root, dir), { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const rel = dir ? `${dir}/${e.name}` : e.name
    if (e.isDirectory()) {
      if (e.name === '.zhijuan') continue
      await walkMd(root, rel, depth + 1, out)
    } else if (e.name.endsWith('.md')) {
      out.push(rel)
    }
  }
  return out
}

/** 工具返回：模型可见文本 + 结构化细节 */
function textResult(text: string, details: Record<string, unknown> = {}, isError = false) {
  return { content: [{ type: 'text' as const, text }], details: { ...details, isError }, ...(isError ? { isError: true } : {}) }
}

/** JSON 数组入参的两种形态（字符串 / 真数组）统一解析；失败返回 null */
function parseJsonArray(v: unknown): unknown[] | null {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v)
      return Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }
  return null
}

/** 等待用户回答：轮询答案目录（主进程 agent:answer 写 { answers: [...] }），与 zj-questions 同法 */
async function waitAnswer(dir: string, batch: string, signal?: AbortSignal, timeoutMs = 20 * 60 * 1000) {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, batch + '.json')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('ask_user_question 在用户回答前被取消')
    if (existsSync(file)) {
      const raw = readFileSync(file, 'utf-8')
      try {
        unlinkSync(file)
      } catch {
        /* 答案文件已被他人清理：忽略 */
      }
      return JSON.parse(raw) as { answers?: { id: string; selected: string[]; custom?: string }[] }
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('ask_user_question 等待回答超时')
}

/**
 * 构造 pi 侧工具集。
 * 六个 zj_* 工具与 zj-core 一一对应；todo_write / ask_user_question 按设置开关追加。
 */
export function buildPiTools(deps: PiToolDeps): ToolDefinition[] {
  const tools: any[] = [
    {
      name: 'zj_workspace',
      label: '作品结构',
      description: '查看织卷作品的总体结构：顶层目录各有多少文档、最近改动的几个文件。适合开始工作时先了解项目里有什么。',
      parameters: objectSchema({ base: str('作品根目录（绝对路径，来自上下文中的“作品根目录”）') }, ['base']),
      async execute(_id: string, args: any) {
        const base = String(args.base)
        const root = resolve(base)
        const dirs = await readdir(root, { withFileTypes: true })
        const lines: string[] = ['【作品结构】']
        const recent: { rel: string; mtime: number }[] = []
        for (const e of dirs) {
          if (e.name.startsWith('.') || !e.isDirectory()) continue
          const docs = await walkMd(root, e.name)
          lines.push(`- ${e.name}/：${docs.length} 篇`)
          for (const rel of docs) {
            try {
              const s = await stat(clamp(root, rel))
              recent.push({ rel, mtime: s.mtimeMs })
            } catch {
              /* 忽略读取失败的条目 */
            }
          }
        }
        recent.sort((a, b) => b.mtime - a.mtime)
        if (recent.length) {
          lines.push('')
          lines.push('最近改动：')
          for (const r of recent.slice(0, 6)) lines.push(`- ${r.rel}`)
        }
        return textResult(lines.join('\n'), { dirs: dirs.length, docs: recent.length })
      }
    },
    {
      name: 'zj_list_docs',
      label: '列文档',
      description: '列出作品某个目录下的文档清单（正文按章号排序）。dir 用相对路径，如 正文、人物、世界观、素材库；省略则列出全部。',
      parameters: objectSchema(
        {
          base: str('作品根目录或工作区根目录（绝对路径；列技能/模板等工作区目录时传【工作区根目录】）'),
          dir: str('相对目录名，如 正文')
        },
        ['base']
      ),
      async execute(_id: string, args: any) {
        const base = String(args.base)
        const dir = String(args.dir ?? '')
        const files = await walkMd(resolve(base), dir)
        files.sort((a, b) => {
          const na = Number(a.match(/第?(\d+)章/)?.[1])
          const nb = Number(b.match(/第?(\d+)章/)?.[1])
          if (na && nb) return na - nb
          return a.localeCompare(b, 'zh')
        })
        if (!files.length) return textResult(`（${dir || '项目里'}没有找到 .md 文档）`, { files: [] })
        return textResult(`【${dir || '全部文档'} · ${files.length} 篇】\n` + files.map((f) => `- ${f}`).join('\n'), { files })
      }
    },
    {
      name: 'zj_read_doc',
      label: '读文档',
      description:
        '读取织卷作品的某个文档正文片段（返回约定头和正文内容片段）。file 为相对作品根目录的路径，如 正文/第03章_晨雾.md、人物/阿七.md、世界观/第一幕_雾港之夜.md、素材库/桥段/追忆型开头.md。默认从开头读 maxChars 个字符；文档超长时返回里会注明已读到第几字符、全文多长，并给出可照抄的 offset——想读中间或末尾就按提示的 offset 续读（通常先读开头、再续读一两段），不要为一次读全而把 maxChars 调得很大：那会把整篇文档都塞进上下文、白耗 token 且拖慢响应。',
      parameters: objectSchema(
        {
          base: str('作品根目录或工作区根目录（绝对路径；读技能/模板等工作区文件时传【工作区根目录】）'),
          file: str('相对该根目录的文档路径'),
          maxChars: num('最多返回的字符数，默认 6000；仅确需整篇时才调大（最大 80000），超长文档优先按提示的 offset 续读'),
          offset: num('从第几个字符开始读（默认 0=开头；续读=上一次返回提示里的 offset 值）')
        },
        ['base', 'file']
      ),
      async execute(_id: string, args: any, signal?: AbortSignal) {
        const base = String(args.base)
        const file = String(args.file)
        const max = Math.min(Number(args.maxChars) || 6000, MAX_HEAD)
        const off = Math.max(0, Math.floor(Number(args.offset) || 0))
        const full = clamp(base, file)
        try {
          const text = await readClipped(full, max, '文档', off, signal)
          return textResult(text, { file, offset: off, maxChars: max })
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'ENOENT') return textResult(`（没有这个文档：${file}）`, { file }, true)
          throw e
        }
      }
    },
    {
      name: 'zj_search',
      label: '全文搜索',
      description: '在作品里做全文搜索：按关键词子串匹配，按目录顺序扫描文件、只取前 N 个命中文件（每个文件至多 3 个命中行及上下文，无相关性排序）。适合查某个设定、台词、人物在哪些地方出现过。dir 可限定目录（如 正文）。',
      parameters: objectSchema(
        {
          base: str('作品根目录（绝对路径）'),
          query: str('要搜索的关键词'),
          dir: str('限定在此相对目录内搜索，默认全项目'),
          maxResults: num('最多返回几个文件的命中，默认 5')
        },
        ['base', 'query']
      ),
      async execute(_id: string, args: any, signal?: AbortSignal) {
        const base = String(args.base)
        const q = String(args.query).toLowerCase()
        const maxRes = Math.max(1, Math.min(Number(args.maxResults) || 5, 20))
        const files = await walkMd(resolve(base), String(args.dir ?? ''))
        const hits: string[] = []
        for (const rel of files) {
          if (hits.length >= maxRes) break
          let text: string
          try {
            text = await readFile(clamp(base, rel), { encoding: 'utf8', signal })
          } catch {
            continue
          }
          const lower = text.toLowerCase()
          if (!lower.includes(q)) continue
          const lines = text.split('\n')
          const shown: string[] = []
          for (let i = 0; i < lines.length && shown.length < 3; i++) {
            if (lines[i].toLowerCase().includes(q)) {
              const from = Math.max(0, i - 1)
              const to = Math.min(lines.length, i + 2)
              const ctx = lines.slice(from, to).join('\n').slice(0, 240)
              shown.push(`  · L${i + 1}: ${ctx}`)
            }
          }
          hits.push(`## ${rel}\n` + shown.join('\n'))
        }
        if (!hits.length) return textResult(`（全文搜索「${args.query}」没有命中）`, { hits: 0 })
        return textResult(`【全文搜索「${args.query}」· ${hits.length} 个文件】\n\n` + hits.join('\n\n'), { hits: hits.length })
      }
    },
    {
      name: 'zj_edit_doc',
      label: '正文修改方案',
      description:
        '为织卷作品生成“正文修改方案”：不直接写盘，而是算出针对某个文档的一处或多处修改（每条 = 在原文中唯一出现的片段 find，替换为 replace），供作者在界面上采纳后写入。file 为相对作品根目录的路径（如 正文/第03章_晨雾.md、人物/阿七.md）。适用范围：改正文文字、修语病、统一称谓、扩充段落等。“新增内容”也可用：find 填要插入位置的前一句原文即可。',
      parameters: objectSchema(
        {
          base: str('作品根目录（绝对路径）'),
          file: str('相对作品根目录的文档路径'),
          edits: {
            description:
              '修改条目：JSON 数组（或 JSON 数组字符串），每条：{"find":"要替换的原文片段（须在全文唯一出现）","replace":"替换成的新文本","reason":"为什么改（可选）"}。示例：[{"find":"夜色很深","replace":"夜色像墨一样深","reason":"强化氛围"}]。find 尽量带足够上下文保证唯一；若 find 出现多次或没找到，本工具会逐条报错让你改。落地整套修改前，应先 zj_read_doc 读一次目标文件。',
            anyOf: [
              { type: 'string' },
              {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { find: { type: 'string' }, replace: { type: 'string' }, reason: { type: 'string' } },
                  required: ['find', 'replace'],
                  additionalProperties: false
                }
              }
            ]
          }
        },
        ['base', 'file', 'edits']
      ),
      async execute(_id: string, args: any, signal?: AbortSignal) {
        const base = String(args.base)
        const file = String(args.file)
        const edits = parseJsonArray(args.edits)
        if (!edits) return textResult('（zj_edit_doc 的 edits 须是合法 JSON 数组或 JSON 数组字符串）', { file }, true)
        const full = clamp(base, file)
        let text: string
        try {
          text = await readFile(full, { encoding: 'utf8', signal })
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'ENOENT') return textResult(`（没有这个文档：${file}）`, { file }, true)
          throw e
        }
        const errors: string[] = []
        const out: { id: string; find: string; replace: string; reason?: string; before?: string; after?: string }[] = []
        // 逐条替换到“工作副本”上做后续校验，以保证多处修改互不冲突、位置按当前工作副本算
        let working = text
        for (let i = 0; i < edits.length; i++) {
          const e = edits[i] as any
          const find = String(e?.find ?? '')
          const replace = String(e?.replace ?? '')
          if (!find) {
            errors.push(`第 ${i + 1} 条缺少 find`)
            continue
          }
          const first = working.indexOf(find)
          if (first < 0) {
            errors.push(`第 ${i + 1} 条 find 没找到：${find.slice(0, 40)}`)
            continue
          }
          if (working.indexOf(find, first + 1) >= 0) {
            errors.push(`第 ${i + 1} 条 find 出现多次，请带更多上下文：${find.slice(0, 40)}`)
            continue
          }
          // 展示用的上下文：圈定整行，并把命中的片段本身高亮标记出来
          const lines = working.split('\n')
          let acc = 0
          let lineIdx = -1
          for (let li = 0; li < lines.length; li++) {
            const ll = lines[li] + '\n'
            if (first < acc + ll.length - 1) {
              lineIdx = li
              break
            }
            acc += ll.length
          }
          const row = lines[Math.max(0, lineIdx)] ?? ''
          const before = lineIdx >= 0 ? `L${lineIdx + 1} │ ${row}` : find
          const afterRow = row.replace(find, replace)
          const after = lineIdx >= 0 ? `L${lineIdx + 1} │ ${afterRow}` : replace
          out.push({ id: 'e' + (i + 1), find, replace, ...(e.reason ? { reason: String(e.reason) } : {}), before, after })
          working = working.slice(0, first) + replace + working.slice(first + find.length)
        }
        if (errors.length) {
          return textResult(`（zj_edit_doc 校验未过，请修正后重试）\n` + errors.join('\n') + `\n目标文件：${file}`, { file, errors }, true)
        }
        const payload = JSON.stringify({ file, edits: out }, null, 2)
        return textResult(
          `（已为 ${file} 生成修改方案，共 ${out.length} 处；作者采纳后才会写入；完整载荷见下）\n★ZJ_EDIT★\n` + payload + '\n★ZJ_END★',
          { file, edits: out }
        )
      }
    },
    {
      name: 'zj_collect_suggest',
      label: '素材采集建议',
      description:
        '为织卷作品提出「素材采集建议」：当写作需要而手头资料不足的具体现实细节（器物、场景、行业、地域知识等）时，给出采集需求建议。不写盘——作者在界面上确认后才会创建采集任务卡（素材库/采集池/任务_*.md），由本机管道后台抓取回填成素材。仅当确实缺少可支撑写作的细节时使用，不要为无关琐事提建议。',
      parameters: objectSchema(
        {
          base: str('作品根目录（绝对路径）'),
          demand: str('采集需求：要采什么素材（一句话，具体到可搜索，如「九十年代小城火车站候车室的常见陈设与氛围」）'),
          keywords: {
            description: '搜索关键词：JSON 数组（或 JSON 数组字符串），如 ["火车站候车室","九十年代","候车室陈设"]',
            anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }]
          },
          category: str('建议放入的素材库类别（默认 环境；作者确认时可改）'),
          note: str('为什么建议（可选）：与本作当前写作的关联，如「第03章雾港线候车室场景需要具体细节支撑」')
        },
        ['base', 'demand', 'keywords']
      ),
      async execute(_id: string, args: any) {
        const demand = String(args.demand ?? '').trim()
        if (!demand) return textResult('（zj_collect_suggest 缺少 demand：说明要采什么素材）', {}, true)
        const rawKw = parseJsonArray(args.keywords)
        if (!rawKw) return textResult('（zj_collect_suggest 的 keywords 须是合法 JSON 数组或 JSON 数组字符串）', {}, true)
        const keywords = rawKw.map((x: unknown) => String(x).trim()).filter(Boolean)
        const category = String(args.category ?? '').trim() || '环境'
        const note = String(args.note ?? '').trim()
        const payload = JSON.stringify({ demand, keywords, category, note }, null, 2)
        return textResult(`（已生成采集建议，作者确认后才会创建任务卡；完整载荷见下）\n★ZJ_COLLECT★\n` + payload + '\n★ZJ_END★', {
          demand,
          keywords,
          category,
          note
        })
      }
    }
  ]

  // ---------- 交互类工具（与 dsh 内建同名；engine.translate 的 INTERACTIVE_TOOLS 按名字跳过 meta）----------
  if (deps.interactive?.todo !== false) {
    tools.push({
      name: 'todo_write',
      label: '待办清单',
      description:
        '维护本轮工作的待办清单（全量覆盖写）。长任务（多章巡查、多文件同步、分幕起草）开始前先列 3-6 项，完成一项就更新一项；短问答不必使用。',
      parameters: objectSchema(
        {
          todos: {
            type: 'array',
            description: '全量清单（覆盖旧清单）',
            items: {
              type: 'object',
              properties: {
                content: { type: 'string', description: '一项待办' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] }
              },
              required: ['content', 'status'],
              additionalProperties: false
            }
          }
        },
        ['todos']
      ),
      async execute(_id: string, args: any) {
        const todos = Array.isArray(args.todos)
          ? args.todos.map((x: any) => ({ content: String(x?.content ?? ''), status: String(x?.status ?? 'pending') }))
          : []
        return textResult(`（待办已更新：${todos.filter((t: any) => t.status === 'completed').length}/${todos.length} 完成）`, { todos })
      }
    })
  }

  if (deps.interactive?.askUser !== false) {
    tools.push({
      name: 'ask_user_question',
      label: '问作者',
      description:
        '就创作决策向作者提问（1-4 个问题，可带选项）。只在「作者的偏好决定走向」时用（如改稿方向、人物取舍），能从正文/设定推断的不要问；提问后会阻塞等待作者在界面作答。',
      parameters: objectSchema(
        {
          questions: {
            type: 'array',
            description: '问题列表（1-4 个）',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: '问题 id（缺省自动生成）' },
                question: { type: 'string', description: '问题正文' },
                header: { type: 'string', description: '短标题（≤12 字）' },
                options: {
                  type: 'array',
                  description: '可选项',
                  items: {
                    type: 'object',
                    properties: { label: { type: 'string' }, description: { type: 'string' } },
                    required: ['label'],
                    additionalProperties: false
                  }
                },
                multiSelect: { type: 'boolean', description: '是否多选' }
              },
              required: ['question'],
              additionalProperties: false
            }
          }
        },
        ['questions']
      ),
      async execute(toolCallId: string, args: any, signal?: AbortSignal) {
        const questions = Array.isArray(args.questions) ? args.questions : []
        if (!questions.length) return textResult('（ask_user_question 缺少 questions）', {}, true)
        // batch 用 toolCallId：piRuntime 在 tool_execution_start 时已按同一 id 发 zj/user-ask（主进程据 batch 写答案文件）
        const res = await waitAnswer(deps.answerDir(), toolCallId, signal, deps.askTimeoutMs)
        const answers = res?.answers ?? []
        const lines = answers.map((a) => `- ${a.id}：${(a.selected ?? []).join('、')}${a.custom ? `（补充：${a.custom}）` : ''}`)
        return textResult(lines.length ? `（作者回答）\n` + lines.join('\n') : '（作者未作答）', { answers })
      }
    })
  }

  return tools as ToolDefinition[]
}