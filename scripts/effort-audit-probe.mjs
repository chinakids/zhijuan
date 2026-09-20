// 织卷 · reasoning_effort 对全卷检查类子任务（audit 一致性巡查 / perspectives 多视角审视）think 长度与质量的影响实测
// （2026-09-20 智能层，候选 5「检查类任务开 low 档」关键未知项——revision 已实测质量等价（21:00 轮，effort-revision-probe），
//  audit/perspectives 是 15min 档最重任务且 think 占用极端（perspectives 曾 32K+ 字符 think），low 档质量未知，须实测后决策）。
// 本探针=同构材料（volumeBrief：正文 chapterBodyBlock 同源 + 设定档 clip(WCTX_CAPS.char=4000,800)）+ 真机同款 system prompt，
// 直调 vLLM 分档对比。判定：finish/耗时/think 体量（reasoning chars）/输出体量/JSON 合法性/items 数/severity 分布；质量等价=
// 两档命中同类问题（人工对读 items.what；探针同时把完整 content 落盘 /tmp/effort-audit-<kind>-<variant>.json 供对读）。
// 注意：①必须 stream（undici 非流式 headersTimeout 300s 会让长生成静默 fetch failed——effort-revision-probe 首版实踩）；
// ②vLLM prefix cache 让后跑档 prompt 更快（时间对比带偏，以输出体量/内容为主）；
// ③端点已实证「应用」该参数（effort-preflight：default 600(length) vs low 105(stop)）；
// ④本端点的流式 delta 不产出 reasoning_content（usage 也无 reasoning_tokens，00:00 轮记录同）——think 长度以
//   completion_tokens 与 content 字符数差为代理（同一档位两跑内可比；跨档位比较看 items/内容质量而非 token 绝对数）。
// ⑤单样本结论注意：发现集内容随采样有差异（seed=42 固定但同 seed 不同档位输出亦不同），质量判据=「核心 high 命中+结构合法+发现密度」。
// 用法：node scripts/effort-audit-probe.mjs <consistency|perspectives> <default|low>
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'http://127.0.0.1:8888/v1/chat/completions'
const MODEL = 'deepseek-v4-flash-vision-exp-uncensored'
const ROOT = process.env.HOME + '/Documents/织卷项目库/织卷smoke'

function stripFm(raw) {
  const m = raw.match(/^---\n[\s\S]*?\n---\n/)
  return m ? raw.slice(m[0].length) : raw
}
function clip(t, head, tail) {
  return t.length <= head + tail ? t : t.slice(0, head) + '\n……（此处为节省篇幅省略中部）……\n' + t.slice(-tail)
}
const CHAPTER_CAP = 12000
function chapterBodyBlock(body, rel) {
  if (body.length <= CHAPTER_CAP) return body
  return body.slice(-CHAPTER_CAP) + `\n……（本章已超 ${CHAPTER_CAP} 字符预算：装配的是结尾部分，前文 ${body.length - CHAPTER_CAP} 字符已省略；要看前面内容请用 zj_read_doc 读 ${rel}）……`
}
function sortedChapters() {
  const dir = join(ROOT, '正文')
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const m = f.match(/^第(\d+)章/)
      return { file: f, no: m ? Number(m[1]) : 9999 }
    })
    .sort((a, b) => a.no - b.no)
}
function volumeBrief() {
  const parts = []
  parts.push('【全部章节正文（按章节顺序，每章与创作上下文同口径：预算内全量，超长保尾并在省略处注明）】')
  for (const c of sortedChapters()) {
    const raw = readFileSync(join(ROOT, '正文/' + c.file), 'utf8')
    const body = stripFm(raw)
    if (!body.trim()) continue
    parts.push(`\n### 第${c.no}章（正文/${c.file}）\n${chapterBodyBlock(body, '正文/' + c.file)}`)
  }
  parts.push('\n【当前设定档案】')
  for (const dir of ['人物', '世界观']) {
    const dirPath = join(ROOT, dir)
    if (!readdirSync(dirPath).some((f) => f.endsWith('.md'))) continue
    for (const f of readdirSync(dirPath).filter((x) => x.endsWith('.md'))) {
      const t = readFileSync(join(dirPath, f), 'utf8')
      if (!t.trim()) continue
      parts.push(`\n### ${dir}/${f}\n${clip(t, 4000, 800)}`)
    }
  }
  return parts.join('\n')
}

const AUDIT_SYSTEM =
  '你是织卷的「一致性巡查员」。下面给出了作品的全卷正文摘录与当前全部设定档案。\n' +
  '请按设定逐条对照正文，找出并只列出确有依据的问题：\n' +
  '- 设定冲突：正文某处写的与人物档案或世界观一致（颜色、年龄、称谓、器物、地点、能力等）；\n' +
  '- 时间线破损：先后顺序、时长、日期的矛盾；\n' +
  '- 伏笔异状：某句话或物件像是伏笔却无处回收，或前文已埋的本应在这里呼应却忘了；\n' +
  '- 人物漂移：性格、说话方式、关系与档案或与前文明显相悖。\n' +
  '要求：只根据上面材料判断，不要臆测；每条都要能在材料里有对应依据；不要提出材料里没有的“改进建议”。\n' +
  '注意：各章正文与设定档案已在材料中完整给出（被裁章节/档案会在省略处注明，材料为节段摘录）。优先直接依据材料判断，不要整卷重新读取；仅当某处明确注明被省略、或证据确实不足时，才用 zj_read_doc 读取对应文件（路径见各小节标题）核对，不要臆测。\n' +
  '输出且只输出一个 JSON 对象（不要 markdown 围栏、不要任何前后缀文字）：\n' +
  '{"summary":"一段话总结当前最刺眼的一到两个问题","items":[' +
  '{"severity":"high|medium|low","type":"setting-conflict|timeline|foreshadow|character-drift",' +
  '"where":"出现位置（章节名或文件，尽量给到能定位的信息）","what":"问题的一句话现象",' +
  '"suggest":"可落地修改的一句话建议","target":"建议写进的目标文件（如 人物/林西.md；给不出则不带这个字段）"}]}\n' +
  '没有发现就 items 空数组。'

const PERSPECTIVE_SYSTEM =
  '你是织卷的「多视角审读团」。下面给出了这部作品的正文摘录与现有设定档案。\n' +
  '请以三种立场，各自代表一位真实读者把全文各读一遍，找出这种立场下最值得写的问题：\n' +
  '- viewer=角色粉：只关心人物立不立得住——行为是否与档案相符、动机是否牵强、关系是否写得含糊；\n' +
  '- viewer=设定党：只关心设定自洽——设定冲突、时间线破损、伏笔不回收；\n' +
  '- viewer=节奏读者：只关心读得顺不顺——节奏拖沓、信息重复、该收不收。\n' +
  '要求：每条都要能回到上面材料，不要臆测；同一条只归到最合适的一位；每条各字段用一句自然话说清，不要展开成段落；最多给 10 条。\n' +
  '注意：各章正文与设定档案已在材料中完整给出（被裁章节/档案会在省略处注明，材料为节段摘录）。优先直接依据材料判断，不要整卷重新读取；仅当某处明确注明被省略、或证据确实不足时，才用 zj_read_doc 读取对应文件（路径见各小节标题）核对，不要臆测。\n' +
  '格式纪律（重要）：你的整个回答只能是下面这个 JSON 对象，一个字都不要写在 JSON 之外（不要 markdown 围栏、不要开头结尾的话）：\n' +
  '{"summary":"一句话：三重眼光看完后全书最值得先处理的一件事","items":[' +
  '{"viewer":"角色粉|设定党|节奏读者","severity":"high|medium|low",' +
  '"type":"character|setting|pacing|structure|foreshadow",' +
  '"where":"出现位置（尽量给到能定位的信息）","what":"问题的一句话现象","suggest":"一句话改法",' +
  '"target":"若这条关联到某个设定文件给路径（人物/… 或 世界观/…），否则给空串"}]}\n' +
  '没有发现就整体输出 {"summary":"","items":[]}。'

const [kind, variant] = process.argv.slice(2)
if (!['consistency', 'perspectives'].includes(kind) || !['default', 'low'].includes(variant)) {
  console.log('用法: node scripts/effort-audit-probe.mjs <consistency|perspectives> <default|low>')
  process.exit(1)
}
const system = kind === 'consistency' ? AUDIT_SYSTEM : PERSPECTIVE_SYSTEM
const tail = kind === 'consistency' ? '请给出巡查报告 JSON。' : '请给出多视角审读报告 JSON。'

const body = {
  model: MODEL,
  messages: [
    { role: 'system', content: system },
    { role: 'user', content: volumeBrief() + '\n\n' + tail }
  ],
  max_tokens: 20480,
  seed: 42,
  stream: true,
  stream_options: { include_usage: true },
  ...(variant !== 'default' ? { reasoning_effort: variant } : {})
}
const t = Date.now()
try {
  const resp = await fetch(BASE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!resp.ok || !resp.body) {
    console.log(JSON.stringify({ kind, variant, status: resp.status, ms: Date.now() - t, error: 'non-ok resp' }))
    process.exit(0)
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
  writeFileSync(`/tmp/effort-audit-${kind}-${variant}.json`, content, 'utf8')
  let ok = false; let items = 0; let sumLen = 0; const sev = {}
  try {
    const cleaned = content.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    const obj = JSON.parse(cleaned)
    ok = true
    if (Array.isArray(obj.items)) {
      items = obj.items.length
      for (const it of obj.items) { if (it?.severity) sev[it.severity] = (sev[it.severity] || 0) + 1 }
    }
    sumLen = typeof obj.summary === 'string' ? obj.summary.length : 0
  } catch { /* 解析失败 */ }
  console.log(JSON.stringify({
    kind, variant, ms: Date.now() - t, finish,
    reasoningChars: reasoning.length, contentChars: content.length,
    usage: usage ? { completion_tokens: usage.completion_tokens, prompt_tokens: usage.prompt_tokens } : null,
    jsonOk: ok, items, summaryLen: sumLen, severity: sev,
    head: content.slice(0, 80)
  }))
} catch (e) {
  console.log(JSON.stringify({ kind, variant, error: e.message, ms: Date.now() - t }))
}
