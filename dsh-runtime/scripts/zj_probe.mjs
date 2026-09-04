import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
const RT = '/Users/USER/Desktop/织卷/dsh-runtime'
const BIN = RT + '/node_modules/@deepseek-ai/dsh/lib/bin.js'
const harness = new DeepSeekHarness({
  launch: {
    command: process.execPath, args: [BIN, '--profile', 'sdk', '--patch', RT + '/run/llm.override.patch.yml'], cwd: RT,
    env: { ...process.env, DSH_HOME: RT + '/dshhome' },
    requestTimeoutMs: 480000
  },
  provider: 'local-vllm', model: 'deepseek-v4-flash-0731', maxTokens: 2048,
})
function dump(ev) {
  const t = ev.type
  // 只打我们关心的类型，全 JSON
  if (/(turn|assistant|tool)/.test(t)) {
    const s = JSON.stringify(ev)
    if (s.length > 1600) {
      console.log('### ' + t + '  ' + s.slice(0, 700))
      console.log('    …截断… ' + s.slice(-700))
    } else {
      console.log('### ' + t + '  ' + s)
    }
  }
}
let err = null
try {
  const r = await harness.run('用 zj_read_doc 读取 file=正文/第01章_雾港.md（base 用 /Users/USER/Desktop/织卷/dsh-runtime/testwork），然后慢慢想清楚再告诉我这一章的切片名是什么。不要问问题，直接做。')
  for (const e of (r.events || [])) dump(e)
  if (r.finalResponse) console.log('FINAL:', r.finalResponse.slice(0, 1200))
} catch (e) { err = e?.message || String(e) } finally { try { await harness.close() } catch {} }
if (err) { console.error('ERR', err) }
