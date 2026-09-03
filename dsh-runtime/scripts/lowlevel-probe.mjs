// 低阶协议探针：直接 HarnessClient + prompt + subscribeSessionTree，看 session.event 是否全程可收
import { HarnessClient } from '@deepseek-ai/dsh-sdk-client'

const RT = '/Users/USER/Desktop/织卷/dsh-runtime'
const BIN = RT + '/node_modules/@deepseek-ai/dsh/lib/bin.js'
const client = new HarnessClient({
  command: process.execPath,
  args: [BIN, '--profile', 'sdk'],
  cwd: RT,
})
const SID = 'zj-lowlevel-probe'
let got = 0
const kinds = new Set()
try {
  client.start()
  await client.initialize({ cwd: RT, provider: 'local-vllm', model: 'deepseek-v4-flash-0731', maxTokens: 2048 })
  const sub = client.subscribeSessionTree(SID)
  const pump = (async () => {
    for await (const n of sub) {
      if (n.method === 'session.event') {
        const t = n.params?.event?.type
        if (t) { kinds.add(t); got++ }
        if (t === 'assistant/chunk') {
          const c = n.params.event.data?.chunk
          if (c?.type === 'text-delta') process.stdout.write(c.text)
        }
      }
      if (n.method === 'session.status' && n.params?.sessionId === SID && n.params?.status === 'idle') return
    }
  })()
  await client.prompt(SID, [{ type: 'text', text: '回复：明白。只回这两个字。' }])
  await pump
  sub.close()
  console.log('\nGOT events:', got, 'kinds:', [...kinds].join(','))
} catch (e) {
  console.error('ERR', e?.message || e)
  if (e?.causes) console.error('causes', JSON.stringify(e.causes))
} finally {
  try { await client.close() } catch {}
}
