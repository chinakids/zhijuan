// 织卷 · vLLM 端点 reasoning_effort 支持性探针（2026-09-19 智能层，候选 2 第一步证据链资产）。
// 背景：DeepSeek 官方 API（api-docs.deepseek.com/api/create-chat-completion）thinking 模式
// 支持 reasoning_effort（none/low/high/max，默认 high）；dsh-llm-deepseek 已实现 reasoningEffort
// 但 AgentOptions 无此字段=per-session 需三层 vendored patch。本探针验证 OpenAI 兼容端点
// （127.0.0.1:8888）是否接受该附加参数（200=接受）。
// 用法：node scripts/effort-probe.mjs
// 判定口径：三态（不带 / low / high）均 status=200 且返回正常→端点支持；400/500 附加参数被拒→不支持。
// 注意：耗时差为小样本噪音（单 token 级请求），不作「effort 生效」证据——效力验证需大样本（候选 2 后续）。
import { chatEndpoint } from './lib/probe-settings.mjs'
const base = chatEndpoint()
async function tryEffort(effort, label) {
  const body = {
    model: 'deepseek-v4-flash-vision-exp-uncensored',
    messages: [{ role: 'user', content: '只回复 OK 两个字。' }],
    max_tokens: 64,
    ...(effort ? { reasoning_effort: effort } : {})
  }
  const t = Date.now()
  try {
    const resp = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const txt = await resp.text()
    console.log(`[${label}] status=${resp.status} ${Date.now() - t}ms head=${txt.slice(0, 200)}`)
  } catch (e) {
    console.log(`[${label}] ERR ${e.message}`)
  }
}
await tryEffort(undefined, 'no-effort')
await tryEffort('low', 'effort-low')
await tryEffort('high', 'effort-high')
