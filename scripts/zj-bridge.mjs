// 织卷 · 无头全栈验收用 bridge：把主进程 agent 引擎（真边车+真模型+工具读文件）
// 接到本地 WebSocket，供无头页面把 agent 请求转到真实链路（锁屏时 Electron renderer 起不来时的正规替代）。
// 用法：cd ~/Desktop/织卷 && LOCAL_LLM_KEY=local ZJ_APP_PATH=$PWD node scripts/zj-bridge.mjs
import { build as esbuild } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
// 固定 userData，使主进程 answerDir() 与边车插件 ZJ_USER_ANSWER_DIR 指向同一目录（回灌一致）
process.env.ZJ_USERDATA = '/tmp/zj-bridge-userdata'
const out = '/tmp/zj-bridge-engine.mjs'

await esbuild({
  entryPoints: [resolve(root, 'src/main/agent/engine.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: out,
  alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
  external: ['node:*'],
  logLevel: 'warning'
})

const mod = await import(pathToFileURL(out).href)
const { WebSocketServer } = createRequire('/tmp/zj-cdp/')('ws')
const PORT = Number(process.env.ZJ_BRIDGE_PORT || 8810)
const wss = new WebSocketServer({ port: PORT })

// devShim 示例项目 → 真实验收项目 的映射
const PROJECT_MAP = { 'demo-aseya': 'agent冒烟' }

console.log('[bridge] 边车上电准备中… true 引擎已加载，WS 监听', PORT)

wss.on('connection', (ws) => {
  console.log('[bridge] 页面接入')
  ws.on('message', async (raw) => {
    let msg
    try { msg = JSON.parse(String(raw)) } catch (e) { return }
    if (msg.type === 'send') {
      const input = { ...msg.input }
      const real = PROJECT_MAP[input.projectId]
      if (real) input.projectId = real
      if (!input.requestId) input.requestId = 'bridge-' + Date.now()
      const emit = (e) => {
        try { ws.send(JSON.stringify({ type: 'event', event: e })) } catch {}
      }
      try {
        await mod.runChat(input, emit)
      } catch (e) {
        emit({ requestId: input.requestId, type: 'error', message: String(e?.message || e).slice(0, 300) })
      }
    } else if (msg.type === 'cancel') {
      mod.abortRequest(String(msg.requestId))
    } else if (msg.type === 'answer') {
      // 用户回答某个 ask 批次：写答案文件，边车插件轮询到后回灌模型
      const mkdirSync = (await import('node:fs')).mkdirSync
      const writeFileSync = (await import('node:fs')).writeFileSync
      const join = (await import('node:path')).join
      const dir = join('/tmp/zj-bridge-userdata', 'agent-answers')
      mkdirSync(dir, { recursive: true })
      try {
        writeFileSync(join(dir, String(msg.batch) + '.json'), JSON.stringify({ answers: msg.answers ?? [] }), 'utf-8')
        ws.send(JSON.stringify({ type: 'answer-ok', batch: msg.batch }))
      } catch (e) {
        ws.send(JSON.stringify({ type: 'answer-err', error: String(e?.message || e) }))
      }
    } else if (msg.type === 'status') {
      try { ws.send(JSON.stringify({ type: 'status', data: { online: true, engine: 'bridge->harness', model: 'deepseek-v4-flash-vision-exp-uncensored' } })) } catch {}
    }
  })
})

process.on('SIGINT', async () => { await mod.shutdown(); process.exit(0) })
console.log('[bridge] ready on ws://127.0.0.1:' + PORT)
