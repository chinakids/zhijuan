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
let seenEdit = false
let err = null
try {
  const r = await harness.run('用 zj_edit_doc 把 文件 正文/第01章_雾港.md（base 用 /Users/USER/Desktop/织卷/dsh-runtime/testwork）里“夜色里的雾港只有一盏渔灯还亮着。”改为“夜色里的雾港只剩一盏渔灯还孤零零地亮着。”，理由写“强化孤寂氛围”。直接调用工具。')
  for (const e of (r.events || [])) {
    const t = e.type
    if (t === 'tool/call' || t === 'tool/result') {
      const s = JSON.stringify(e)
      console.log('### ' + t + '  ' + s.slice(0, 900))
      if (t === 'tool/result' && s.includes('★ZJ_EDIT★')) seenEdit = true
    }
  }
  if (r.finalResponse) console.log('FINAL:', r.finalResponse.slice(0, 500))
  console.log('SEEN_EDIT_PAYLOAD:', seenEdit)
} catch (e) { err = e?.message || String(e) } finally { try { await harness.close() } catch {} }
if (err) { console.error('ERR', err); process.exit(1) }
