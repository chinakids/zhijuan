// 项目级上下文注入 · 真模型冒烟（vLLM 直连，不经引擎）
// 验证：buildProjectContext 装配出的【项目概览】块放进 prompt 后，模型能基于它答出仅存于
// project.md/世界观总纲 的信息（证明装配块对模型可读有效——runChat 无章分支即注入此块）。
// 用法：cd ~/Desktop/织卷 && node scripts/project-ctx-live.mjs
import { build as esbuild } from 'esbuild'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rmSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = '/tmp/zj-smoke-projectctx-live'
rmSync(process.env.ZJ_USERDATA, { recursive: true, force: true })
const out = '/tmp/project-ctx-live-bundle.mjs'

await esbuild({
  stdin: {
    contents: `export { buildProjectContext } from ${JSON.stringify(resolve(root, 'src/main/agent/context.ts'))};`,
    resolveDir: root,
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: out,
  alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
  external: ['node:*'],
  logLevel: 'warning'
})

const { buildProjectContext } = await import(pathToFileURL(out).href)
const ctx = await buildProjectContext('织卷smoke')
const overview = ctx.blocks.join('\n\n')

// 只给「项目概览」，不给任何其它来源——答对 ⇒ 只能来自装配块
const prompt = `以下是某个小说作品的项目概览（来自织卷工作台）：

${overview}

提示：你不需要调用任何工具，也看不到别的文件。请只用以上信息回答：
这个作品的故事发生在哪座城市？主角陈默负责的片区以什么为主？世界观里提到的「点灯」是什么规则？
只用一两句话回答。`

const body = {
  model: 'deepseek-v4-flash-vision-exp-uncensored',
  messages: [
    { role: 'system', content: '你是织卷创作工作台的创作 agent 助手，回答直接、无套话。' },
    { role: 'user', content: prompt }
  ],
  temperature: 0.3,
  max_tokens: 1500
}

console.log('=== 真模型：项目概览注入可读性 ===')
const t0 = Date.now()
const res = await fetch('http://127.0.0.1:8888/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
})
if (!res.ok) throw new Error('vLLM 返回 ' + res.status + ': ' + (await res.text()).slice(0, 200))
const data = await res.json()
const answer = data.choices?.[0]?.message?.content ?? ''
console.log('耗时', ((Date.now() - t0) / 1000).toFixed(1) + 's')
if (!answer) console.log('原始响应片段:', JSON.stringify(data).slice(0, 1200))
console.log('模型回答:', answer.slice(0, 300))

let pass = 0
const assert = (name, cond) => {
  if (!cond) throw new Error('断言失败: ' + name)
  pass++
  console.log('  ✓ ' + name)
}
assert('答出城市「雾港」（只能来自项目概览）', answer.includes('雾港'))
assert('答出主角片区「学校周边」', answer.includes('学校') && answer.includes('片区'))
assert('答出总纲规则（路灯由市政维修处统一维护）', answer.includes('路灯') && answer.includes('市政'))

console.log(`\n=== 结果: ${pass} 断言全过 ===`)
process.exit(0)
