import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
const RT = '/Users/USER/Desktop/织卷/dsh-runtime'
const BIN = RT + '/node_modules/@deepseek-ai/dsh/lib/bin.js'
const h = new DeepSeekHarness({
  launch: { command: process.execPath, args: [BIN, '--profile', 'sdk'], cwd: RT },
  provider: 'local-vllm', model: 'deepseek-v4-flash-0731', maxTokens: 2048,
})
const SID = 'zj-same-session-probe'
function watch(tag) {
  return (n) => {
    if (n.method === 'session.event') {
      const t = n.params?.event?.type
      console.log(tag, 'EVT', t)
    } else console.log(tag, 'MISC', n.method)
  }
}
try {
  const r1 = await h.run('说一句：你是织卷。只回这一句。', { sessionId: SID, onNotification: watch('r1') })
  console.log('R1 final:', JSON.stringify(r1.finalResponse?.slice(0, 60)))
  const r2 = await h.run('再回一句：好的，主人。', { sessionId: SID, onNotification: watch('r2') })
  console.log('R2 final:', JSON.stringify(r2.finalResponse?.slice(0, 60)))
} catch (e) {
  console.error('ERR', e?.message || e, e?.causes ? JSON.stringify(e.causes) : '')
} finally {
  try { await h.close() } catch {}
}
