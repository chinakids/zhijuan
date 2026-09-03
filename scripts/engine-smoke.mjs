// 引擎冒烟（无 GUI）：把主进程 agent 模块 bundle 成纯 node，跑真实边车 + 真模型的一轮聊天。
// 用法：cd ~/Desktop/织卷 && LOCAL_LLM_KEY=local node scripts/engine-smoke.mjs
import { build as esbuild } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root // 让 bundle 后的 app.getAppPath() 拿到仓库根
const out = '/tmp/zj-engine-smoke.mjs'

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
const rid = 'smoke-' + Date.now()
const events = []
console.log('=== 开始 runChat:', new Date().toISOString())
await mod.runChat(
  {
    requestId: rid,
    projectId: 'agent冒烟',
    chapterRel: '正文/第01章_雾港.md',
    chapterTitle: '雾港',
    prompt: '用 zj_read_doc 读当前打开的章节，然后概括这一章的场景和主要人物，控制在 80 字内。',
    quote: null
  },
  (e) => {
    events.push(e)
    if (e.type === 'delta') process.stdout.write(e.text)
    else if (e.type === 'meta') console.log('\n[工具]', e.tool)
    else if (e.type === 'meta-done') console.log('[工具完成]', e.message.slice(0, 60))
    else if (e.type === 'final') console.log('\n[最终回复]', e.text)
    else if (e.type === 'error') console.error('\n[错误]', e.message)
    else console.log('\n[事件]', e.type)
  }
)
console.log('\n=== 完成，事件数:', events.length)
const tools = events.filter((e) => e.type === 'meta').map((e) => e.tool)
console.log('调用工具:', JSON.stringify(tools))
console.log('事件类型:', JSON.stringify(events.map((e) => e.type)))
await mod.shutdown()
