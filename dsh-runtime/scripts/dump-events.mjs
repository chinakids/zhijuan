import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
const RT = '/Users/USER/Desktop/织卷/dsh-runtime'
const BIN = RT + '/node_modules/@deepseek-ai/dsh/lib/bin.js'
const harness = new DeepSeekHarness({
  launch: { command: process.execPath, args: [BIN, '--profile', 'sdk'], cwd: RT },
  provider: 'local-vllm', model: 'deepseek-v4-flash-0731', maxTokens: 2048,
})
const seen = {}
function dump(ev) {
  const t = ev.type
  if (!seen[t]) { seen[t] = 1; console.log('### 类型:', t); console.log(JSON.stringify(ev).slice(0, 900)) }
}
try {
  const r = await harness.run('用 zj_read_doc 读 base=/Users/USER/Desktop/织卷/dsh-runtime/testwork file=正文/第01章_雾港.md，说一句这章的切片。')
  for (const e of (r.events || [])) dump(e)
} catch (e) { console.error('ERR', e?.message || e) } finally { try { await harness.close() } catch {} }
