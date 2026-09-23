// 织卷 · reasoning_effort 对 revision（分层修订）think 长度/质量的影响实测（2026-09-19 智能层，候选 2 第二步）。
// 背景：revision 两跑超时（480.3s/720.6s，think 单 turn >20K tokens 不收敛）；12:00 轮「宽松/约束」双向实测
// 结论=保持宽松；治本候选=reasoning_effort（四档 none/low/high/max 默认 high，官方 API 文档）。
// 本探针=同场景（织卷smoke 第02章_灯下 + revision 系统提示与 chapterBrief 同构材料）直调 vLLM 三档对比。
// 判定：finish=stop（完成）+ 输出体量（reasoning_content+content 字符数，think 长度代理）+ 耗时 + JSON 合法性 + items 数 + summary 长度。
// 注意：①为规避 undici 默认 headersTimeout 300s（非流式 >5min 生成会静默 fetch failed——首版实踩），
// 本探针用 **stream:true**（首包即回 headers）+ stream_options.include_usage 取 usage；
// ②vLLM prefix cache 会让后跑档 prompt 更快（时间对比带偏，看输出体量为主）；
// ③端点已实证「应用」该参数（effort-preflight：default 600(length) vs low 105(stop)）。
// 用法：node scripts/effort-revision-probe.mjs [default|low|high ...]（缺省三档全跑）
import { chatEndpoint } from './lib/probe-settings.mjs'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = chatEndpoint()
const MODEL = 'deepseek-v4-flash-vision-exp-uncensored'
const ROOT = process.env.HOME + '/Documents/织卷项目库/织卷smoke'

function fmStrip(text) {
  const m = text.match(/^---\n[\s\S]*?\n---\s*(\n|$)/)
  return m ? text.slice(m[0].length) : text
}
function clip(t, head, tail) {
  return t.length <= head + tail ? t : t.slice(0, head) + '\n……（中间省略）……\n' + t.slice(-tail)
}
function buildMaterial() {
  const parts = []
  const ch = fmStrip(readFileSync(join(ROOT, '正文/第02章_灯下.md'), 'utf8'))
  parts.push(`【当前章节】\n${clip(ch, 6000, 3000)}`)
  parts.push('\n【当前设定档案（节选）】')
  for (const dir of ['人物', '世界观']) {
    const dirPath = join(ROOT, dir)
    if (!readdirSync(dirPath).some((f) => f.endsWith('.md'))) continue
    for (const f of readdirSync(dirPath).filter((x) => x.endsWith('.md'))) {
      const t = readFileSync(join(dirPath, f), 'utf8')
      if (!t.trim()) continue
      parts.push(`\n### ${dir}/${f}\n${clip(t, 1200, 500)}`)
    }
  }
  return parts.join('\n')
}

const SYSTEM =
  '你是织卷的「分层修订师」。下面给出了当前章节全文与设定档案节选。\n' +
  '请按**故事层 → 场景层 → 词句层**的顺序给出本章的修订单（改稿时先定大方向，再进细节）：\n' +
  '- story：这一章的定位、动机、冲突、取舍是否有问题，怎么收才让全篇更好；\n' +
  '- scene：单个场景的进入/退出、切换、节奏、可信度、连续性问题；\n' +
  '- prose：具体到句子的改法（也可以直接给出替换后的写法片段）。\n' +
  '要求：只依据上面材料；每条都给出能操作的改法（suggest），不要空谈；同一条只归到最合适的一层；最多给 8 条。\n' +
  '格式纪律（重要）：你的整个回答只能是下面这个 JSON 对象，一个字都不要写在 JSON 之外（不要 markdown 围栏、不要开头结尾的话）；每条记录的各字段各用一句自然话说清，不要展开成段落，suggest 要具体但简短：\n' +
  '{"summary":"一句话：这一章现在最值得先改的是什么","items":[' +
  '{"severity":"high|medium|low","layer":"story|scene|prose","where":"正文中的位置（尽量给到句子级定位）",' +
  '"what":"问题的一句话现象","suggest":"可执行的修改指令或一两句替换写法",' +
  '"target":"若这条关联到某个设定文件给路径（人物/… 或 世界观/…），否则省略"}]}\n' +
  '如果没有值得写的就整体输出 {"summary":"","items":[]}。'

async function runOne(variant) {
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: buildMaterial() }
    ],
    max_tokens: 20480,
    seed: 42,
    stream: true,
    stream_options: { include_usage: true },
    ...(variant !== 'default' ? { reasoning_effort: variant } : {})
  }
  const t = Date.now()
  try {
    const resp = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!resp.ok || !resp.body) {
      console.log(JSON.stringify({ variant, status: resp.status, ms: Date.now() - t, error: 'non-ok resp' }))
      return
    }
    const reader = resp.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    let content = ''
    let reasoning = ''
    let usage = null
    let finish = null
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') continue
        try {
          const j = JSON.parse(payload)
          if (j.usage) usage = j.usage
          if (j.choices?.[0]?.finish_reason) finish = j.choices[0].finish_reason
          const d = j.choices?.[0]?.delta
          if (d?.reasoning_content) reasoning += d.reasoning_content
          if (d?.content) content += d.content
        } catch { /* 忽略碎块 */ }
      }
    }
    let ok = false; let items = 0; let sumLen = 0
    try {
      const cleaned = content.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
      const obj = JSON.parse(cleaned)
      ok = true
      items = Array.isArray(obj.items) ? obj.items.length : 0
      sumLen = typeof obj.summary === 'string' ? obj.summary.length : 0
    } catch { /* 解析失败 */ }
    console.log(JSON.stringify({
      variant, ms: Date.now() - t, finish,
      reasoningChars: reasoning.length, contentChars: content.length,
      usage, jsonOk: ok, items, summaryLen: sumLen,
      head: content.slice(0, 60)
    }))
  } catch (e) {
    console.log(JSON.stringify({ variant, error: e.message, ms: Date.now() - t }))
  }
}

const variants = process.argv.slice(2).length ? process.argv.slice(2) : ['default', 'low', 'high']
for (const v of variants) {
  await runOne(v)
}
