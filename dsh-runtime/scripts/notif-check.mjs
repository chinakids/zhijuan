import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
const RT = '/Users/USER/Desktop/织卷/dsh-runtime'
const BIN = RT + '/node_modules/@deepseek-ai/dsh/lib/bin.js'
const h = new DeepSeekHarness({
  launch: { command: process.execPath, args: [BIN, '--profile', 'sdk'], cwd: RT },
  provider: 'local-vllm', model: 'deepseek-v4-flash-0731', maxTokens: 2048,
})
try {
  const r = await h.run('用 zj_read_doc 读 base=/Users/USER/Documents/织卷项目库/agent冒烟 file=正文/第01章_雾港.md，然后一句话概括。', {
    onNotification: (n) => {
      if (n.method === 'session.event') {
        const p = n.params || {}
        const t = p?.event?.type
        if (t === 'assistant/chunk' || t === 'tool/call' || t === 'assistant/message') {
          console.log('NOTIF', t, JSON.stringify(p.event).slice(0, 160))
        }
      }
    },
  })
  console.log('FINAL:', (r.finalResponse || '').slice(0, 200))
  console.log('FINEVENTS:', (r.events || []).filter((e) => e.type === 'assistant/message').length)
} catch (e) {
  console.error('ERR', e?.message || e)
} finally {
  try { await h.close() } catch {}
}
