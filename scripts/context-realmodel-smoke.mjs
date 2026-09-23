// 织卷 · 真模型端到端走查——「第2章创作能看到第1章沉淀」（无 GUI）
// 场景：第1章沉淀的世界状态（写在旧无前缀名 世界观/<切片>.md，新名 切片_*.md 为模板空壳——agent冒烟 现状复刻），
//       第2章切片无设定文件 → context §6.5 回退链（本切片→上一章切片）应把上一幕事实装配给真模型。
// 走查目标：真模型 runChat 第2章，只凭上下文回答「环境该是什么状态」——模型答出 雾/栈桥/凌晨 = 回退链装配被读到。
// 用法：cd ~/Desktop/织卷 && node scripts/context-realmodel-smoke.mjs
import { writeProbeSettings } from './lib/probe-settings.mjs'
import { build as esbuild } from 'esbuild'
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'zj-realmodel-'))
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = join(tmp, 'userdata')
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
// 库根指向临时目录；llm 配置走默认（local → 127.0.0.1:8888/v1）
writeProbeSettings({ libraryRoot: join(tmp, 'lib') })

const lib = join(tmp, 'lib')
const pid = '走查smoke'
const P = (rel) => join(lib, pid, rel)
mkdirSync(P('人物'), { recursive: true })
mkdirSync(P('世界观'), { recursive: true })
mkdirSync(P('正文'), { recursive: true })

// ① 第1章：正文不写环境事实（雾/栈桥/凌晨全都不在正文，防止模型从正文作答）；涉及人物为空，排除人物档案干扰
writeFileSync(
  P('正文/第01章_雾港栈桥.md'),
  [
    '---', '章号: 1', '题名: 雾港栈桥', '切片: 第一幕_雾港之夜', '涉及人物: []', '---', '',
    '陈默来找林晓。他们沿着岸边慢慢走，一路没怎么说话。走到尽头，林晓忽然问了一句什么，声音被风带走，他没听清。' +
      '他停下来，她却没有停。等他说完那句「明天再谈」，天已经蒙蒙亮了。', ''
  ].join('\n'),
  'utf-8'
)
// ② 世界观：新名=模板空壳（ensureWorldSliceFile 产物）；旧无前缀名=第1章沉淀的事实（agent冒烟 现状复刻）
writeFileSync(
  P('世界观/切片_第一幕_雾港之夜.md'),
  '# 切片：第一幕_雾港之夜\n\n> 本切片的世界状态（规则、事件、环境）。正文保存时的切片同步会把本切片的新状态写入这里；长期不变设定请放《总纲》。\n',
  'utf-8'
)
writeFileSync(
  P('世界观/第一幕_雾港之夜.md'),
  '# 切片：第一幕_雾港之夜\n\n- 凌晨两点，大雾，近海能见度不足百步\n- 栈桥灯柱亮着昏黄的光，海面一片灰白\n',
  'utf-8'
)
// ③ 第2章：切片=第二幕，无任何设定文件 → 触发回退链
writeFileSync(
  P('正文/第02章_灯下.md'),
  ['---', '章号: 2', '题名: 灯下', '切片: 第二幕_灯下', '涉及人物: []', '---', '', '第二天夜里，陈默又去了那个地方。', ''].join('\n'),
  'utf-8'
)

// ④ bundle 主进程 agent 引擎（electron → stub）
const out = join(tmp, 'bundle.mjs')
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
const events = []
console.log('=== 开始 runChat（第2章 / 回退链走查）：', new Date().toISOString())
const rid = 'realmodel-' + Date.now()
await mod.runChat(
  {
    requestId: rid,
    projectId: pid,
    chapterRel: '正文/第02章_灯下.md',
    chapterTitle: '灯下',
    prompt:
      '第2章开头要写环境。请只用上面【当前创作上下文】里给你的信息回答，不要调用任何工具读文件：' +
      '此时（第二幕）的天气与场景应该是什么状态？用一句自然话说清，并注明这信息来自上下文里的哪块。',
    quote: null
  },
  (e) => {
    events.push(e)
    if (e.type === 'delta') process.stdout.write(e.text)
    else if (e.type === 'meta') console.log('\n[工具]', e.tool)
    else if (e.type === 'meta-done') console.log('[工具完成]', e.message.slice(0, 60))
    else if (e.type === 'error') console.error('\n[错误]', e.message)
  }
)
console.log('\n=== 完成，事件数:', events.length)
await mod.shutdown()

const final = events.filter((e) => e.type === 'final').map((e) => e.text).join('\n')
console.log('\n[最终回复]\n' + final)
const tools = events.filter((e) => e.type === 'meta').map((e) => e.tool)
console.log('\n调用工具:', JSON.stringify(tools))

// ⑤ 断言：模型从上下文（回退链装配的上一幕切片设定）答出了环境事实；且未依赖工具读盘
const keys = ['雾', '栈桥', '凌晨', '能见度']
const hit = keys.filter((k) => final.includes(k))
const readByTool = events.some((e) => e.type === 'meta' && e.tool === 'zj_read_doc')
const pass = hit.length >= 2 && !readByTool
console.log('\n命中关键词:', JSON.stringify(hit))
console.log('工具读了盘:', readByTool)
console.log(pass ? 'REALMODEL SMOKE OK' : 'REALMODEL SMOKE FAILED')
rmSync(tmp, { recursive: true, force: true })
process.exit(pass ? 0 : 1)
