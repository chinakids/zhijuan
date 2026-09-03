// dsh-runtime 独立冒烟：边车 + zj-core + 真模型读文档
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'

const RT = '/Users/USER/Desktop/织卷/dsh-runtime'
const BIN = RT + '/node_modules/@deepseek-ai/dsh/lib/bin.js'

const harness = new DeepSeekHarness({
  launch: { command: process.execPath, args: [BIN, '--profile', 'sdk'], cwd: RT },
  provider: 'local-vllm',
  model: 'deepseek-v4-flash-0731',
  maxTokens: 2048,
})

const t0 = Date.now()
try {
  const r = await harness.run(
    '请用 zj_read_doc 工具读取：base=/Users/USER/Desktop/织卷/dsh-runtime/testwork，file=正文/第01章_雾港.md，然后只回复这一章的切片名和场景一句话。',
    {
      onNotification: (n) => {
        const p = n.params || {}
        if (n.method === 'session.event' && p?.event?.type === 'tool/call') {
          const ev = p.event
          console.log('  →工具调用:', ev.name ?? ev.tool?.name ?? JSON.stringify(ev).slice(0, 120))
        }
      }
    }
  )
  console.log('== 最终回复:', (r.finalResponse || '').slice(0, 400))
  const ev = r.events || []
  const tools = ev.filter((e) => e.type === 'tool/call').map((e) => e.name ?? e.tool?.name)
  console.log('== 调用的工具:', JSON.stringify(tools))
  console.log('events:', ev.length, 'elapsed ms:', Date.now() - t0)
} catch (e) {
  console.error('ERR:', e?.message || e)
  if (e?.causes) console.error('causes:', e.causes.map((c) => String(c?.message || c)).join(' | '))
} finally {
  try { await harness.close() } catch {}
}
