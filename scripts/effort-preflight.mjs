// 织卷 · reasoning_effort 预检：本机 vLLM 是否「应用」该参数（非仅 200 接受）。
// 快探针：小任务三档对比 usage.completion_tokens 与耗时——若三档 tokens 几乎相同 = 后端未应用（仅透传）。
// 用法：node scripts/effort-preflight.mjs
import { chatEndpoint } from './lib/probe-settings.mjs'
const base = chatEndpoint()
const MODEL = 'deepseek-v4-flash-vision-exp-uncensored'
async function run(effort, label) {
  const body = {
    model: MODEL,
    messages: [{ role: 'user', content: '简述三体小说的基本设定，不超过100字。' }],
    max_tokens: 600,
    ...(effort ? { reasoning_effort: effort } : {})
  }
  const t = Date.now()
  try {
    const resp = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const j = await resp.json()
    const u = j.usage || {}
    const delta = Date.now() - t
    console.log(`[${label}] ${resp.status} ${delta}ms completion=${u.completion_tokens} prompt=${u.prompt_tokens} reasoning=${u.reasoning_tokens ?? '-'} finish=${j.choices?.[0]?.finish_reason}`)
  } catch (e) {
    console.log(`[${label}] ERR ${e.message}`)
  }
}
await run(undefined, 'default')
await run('low', 'low')
await run('high', 'high')
