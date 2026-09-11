// 思考过程真机探针：把一整轮 runChat 的 think 事件原样打出来，看 reasoning 有没有内容、事件到不到渲染层
// 用法：cd ~/Desktop/织卷 && LOCAL_LLM_KEY=local node scripts/think-probe.mjs
import { build as esbuild } from 'esbuild'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
// 干净 userData：防残留 settings 把 libraryRoot 指到已删除目录
process.env.ZJ_USERDATA = '/tmp/zj-smoke-think-probe'
rmSync(process.env.ZJ_USERDATA, { recursive: true, force: true })
const out = '/tmp/zj-think-probe.mjs'

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
const rid = 'thinkprobe-' + Date.now()
let thinkChars = 0
let thinkChunks = 0
const metaFlow = []
console.log('=== 思考探针开始', new Date().toISOString())
await mod.runChat(
  {
    requestId: rid,
    projectId: 'agent冒烟',
    chapterRel: '正文/第01章_雾港.md',
    chapterTitle: '雾港',
    prompt: '读一下当前章节，然后认真想一想这一章的核心冲突是什么，想完再回答，控制在 60 字内。先想再做。',
    quote: null
  },
  (e) => {
    if (e.type === 'think') {
      thinkChunks++
      thinkChars += (e.text ?? '').length
      if (thinkChunks <= 5) process.stdout.write('[think#' + thinkChunks + '] ' + (e.text ?? '').slice(0, 120) + '\n')
    } else if (e.type === 'meta') {
      metaFlow.push(e.tool)
      process.stdout.write('\n[meta] ' + e.tool + (e.args ? ' · ' + e.args : '') + '\n')
    } else if (e.type === 'meta-done') process.stdout.write('[meta-done] ' + (e.message ?? '').slice(0, 50) + '\n')
    else if (e.type === 'delta') process.stdout.write(e.text)
    else if (e.type === 'final') process.stdout.write('\n[最终] ' + e.text.slice(0, 300) + '\n')
    else if (e.type === 'error') process.stdout.write('\n[错误] ' + e.message + '\n')
  }
)
console.log('\n=== 统计: think事件数=' + thinkChunks + ' 思考总字数=' + thinkChars + ' 工具流=' + JSON.stringify(metaFlow))
process.exit(0)
