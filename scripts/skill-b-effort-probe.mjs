// 织卷 · skill-live 场景 B（显式 /技能名）生成阶段超时对照探针（2026-09-23 智能层，候选 1）
// 背景：21:00 轮 skill-live B 两次 12min 超时；会话日志（22:01 次）实锤最终生成 step 380s 纯 think
// （reasoning 4.2 万字符、text 0 字符）=think 无度。本探针=同一 prompt 直调 vLLM，default vs low 对照，
// 判定 low 是否压住 think 并正常产出正文（治本候选=runChat 显式技能调用传 reasoning_effort:'low'）。
// prompt 与 22:01 会话 user/message 完全一致（真实注入文本），尾部仅补一句「材料齐备无需工具」
// （近似工具结果收集完毕后的第 4 步状态——工具链本身不是超时点）。
// 用法：node scripts/skill-b-effort-probe.mjs [default|low|high]（缺省 default low）
import { chatEndpoint } from './lib/probe-settings.mjs'
import { writeFileSync, appendFileSync } from 'node:fs'

const BASE = chatEndpoint()
const MODEL = 'deepseek-v4-flash-vision-exp-uncensored'

const PROMPT = [
  '你是「织卷」创作工作台的创作 agent，协助作者（用户）写作。',
  '',
  '【输出纪律】用户请求是续写、扩写、改写、润色、按要点成文等创作行动时：只输出正文本身，不加任何说明、解释、思路、字数标注、标题或前后缀；用户请求是提问、评价、讨论、规划（如「这段怎样」「哪里要改」）时：正常给出分析。说明性文字会混入正文、需要作者手动删除，所以拿不准时默认按创作行动输出正文。',
  '',
  '【作品根目录】/var/folders/rq/98_kmkt90gn4q2hb3src41gr0000gn/T/zj-skilllive-pecUOK/lib/技能探针项目',
  '【当前打开章节】正文/第01章_夜航.md',
  '提示 web_client 工作：需要资料时用 zj_* 工具读，不要猜测。base 永远是上下文给出的【作品根目录】，不要自己编。',
  '要修改或新增正文内容时，用 zj_edit_doc 生成“修改方案”（不写盘，作者在界面上采纳后才会写入）；不要在答复里给出整篇替换文本让作者自己复制。',
  '',
  '【可用技能】（作者沉淀的写作方法/流程；与需求匹配时说明「按<技能名>来做」，或直接输入 /技能名 调用；命中技能的内容已自动提供，无需再用工具加载）',
  '- 倒叙开篇法：从人物高光时刻落笔再回叙起因，制造悬念与代入感（触发词：倒叙/开篇）',
  '',
  '【当前创作上下文】以下是当前章节与其相关设定的装配内容，可直接作为事实使用；需要看更完整的文件时再用 zj_* 工具读取对应的【作品根目录】下路径。',
  '【当前章节：正文/第01章_夜航.md】',
  '',
  '轮船靠岸的时候已经是后半夜。他沿着栈桥往码头深处走，浪声很大。',
  '',
  '他靠在小艇上，望着港口。',
  '',
  '',
  '【技能：倒叙开篇法】',
  '遵循以下步骤：',
  '1. 先写人物最高光的一幕（结果/冲突顶点），用一句留白切回起因',
  '2. 回叙中埋下与高光呼应的细节（物象、台词、天气）',
  '3. 结尾回到高光时刻，用一个动作收束，不做解释',
  '',
  '更多例子见 references/示例.md。',
  '（参数：要点：先写他被雨困在候船厅的一幕）',
  '（技能正文已完整给出，无需再读取技能文件；子文件在 skills/倒叙开篇法/ 下，需要时用 zj_read_doc 读取）',
  '',
  '（按技能《倒叙开篇法》执行）',
  '要点：先写他被雨困在候船厅的一幕',
  '',
  '（注：创作所需材料已全部齐备，直接输出正文，勿再调用任何工具。）'
].join('\n')

async function runOne(variant) {
  const body = {
    model: MODEL,
    messages: [{ role: 'user', content: PROMPT }],
    max_tokens: 4096,
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
    const STRUCTURE = /三天前|皮箱|灯塔/
    const record = {
      variant, ms: Date.now() - t, finish,
      reasoningChars: reasoning.length, contentChars: content.length,
      usage, structure: STRUCTURE.test(content),
      head: content.slice(0, 80)
    }
    console.log(JSON.stringify(record, null, 2))
    appendFileSync('/tmp/zj-skillb-effort.log', JSON.stringify(record) + '\n')
    // 落一份正文留证
    if (content) writeFileSync(`/tmp/zj-skillb-${variant}-content.txt`, content, 'utf-8')
  } catch (e) {
    console.log(JSON.stringify({ variant, error: e.message, ms: Date.now() - t }))
  }
}

const variants = process.argv.slice(2).length ? process.argv.slice(2) : ['default', 'low']
for (const v of variants) await runOne(v)
