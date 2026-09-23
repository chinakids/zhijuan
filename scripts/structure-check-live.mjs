// 织卷 · 双线结构点巡检真模型冒烟（无 GUI）：临时双线项目（真实文件）+ 真边车 + 真模型。
// 种子按 Weiland 双线法则设计：过去线=早线（第2章转折/第4章收束钩子），主线=晚线（第1章开局/第3章中点/第5章高潮），
// 早线在第4章收束 < 晚线高潮第5章 → 期望模型报过去线 settled（Weiland⑥），且两线结构点分布各有所指。
// 用法：cd ~/Desktop/织卷 && LOCAL_LLM_KEY=local node scripts/structure-check-live.mjs
import { writeProbeSettings } from './lib/probe-settings.mjs'
import { build as esbuild } from 'esbuild'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = '/tmp/zj-smoke-scheck'
rmSync(process.env.ZJ_USERDATA, { recursive: true, force: true })
const LIB = '/tmp/zj-scheck-lib'
rmSync(LIB, { recursive: true, force: true })
const PJ = '结构巡检demo'

// 项目文件（盘上真文件；章卡/导演板格式与真机生成同构）
const ch = (no, name, slice, persons, line, title) =>
  '---\n章号: ' + no + '\n题名: ' + title + '\n切片: ' + slice + (line ? '\n时间线: ' + line : '') + '\n时间: 2026 年\n涉及人物: [' + persons + ']\n---\n\n# ' + title + '\n\n（正文略——结构点巡检只依据章卡与导演板，不读正文）\n'
const card = (no, name, slice, title, line, oneLine, beats, progress, hooks) =>
  '---\n章号: ' + no + '\n题名: ' + title + '\n切片: ' + slice + (line ? '\n时间线: ' + line : '') + '\n状态: 已回建\n---\n> 对应正文：正文/' + name + '.md\n' +
  '# 章卡 · 第' + no + '章\n\n## 一句话定位\n' + oneLine + '\n\n## 关键事件\n' + beats.map((b) => '- ' + b).join('\n') + '\n\n## 人物进展\n' + progress + '\n\n## 钩子 / 要还的债\n' + hooks.map((h) => '- ' + h).join('\n') + '\n'
const board = (no, name, title, task, beats, peak, axes, red, hooks) =>
  '# 导演板 · 第' + no + '章 ' + title + '\n\n## 本章戏剧任务\n' + task + '\n\n## 情绪弧分段\n' + beats.join('\n') + '\n\n## 波峰\n' + peak + '\n\n## 人物行为轴\n' + axes.map((a) => '- ' + a).join('\n') + '\n\n## 写作红线（不许破）\n' + red.map((r) => '- ' + r).join('\n') + '\n\n## 钩子（要还的债 / 可新埋）\n' + hooks.map((h) => '- ' + h).join('\n') + '\n'

const FILES = {
  '正文/第01章_夜航.md': ch(1, '第01章_夜航', '今_夜航', '沈藏, 阿七', '', '夜航'),
  '正文/第02章_旧信.md': ch(2, '第02章_旧信', '昔_旧信', '周晚, 苏晚', '过去线', '旧信'),
  '正文/第03章_灯塔.md': ch(3, '第03章_灯塔', '今_灯塔', '沈藏, 阿七', '', '灯塔'),
  '正文/第04章_雨夜.md': ch(4, '第04章_雨夜', '昔_雨夜', '周晚, 苏晚', '过去线', '雨夜'),
  '正文/第05章_破晓.md': ch(5, '第05章_破晓', '今_破晓', '沈藏, 阿七', '', '破晓'),
  '大纲/第01章_夜航.md': card(1, '第01章_夜航', '今_夜航', '夜航', '', '旧灯与泛黄船票登场，把主角拖回十年前的海难。', ['阿七在候船厅翻到一串旧钥匙', '守塔人沈藏点破：灯是阿七自己熄的', '一张十年前船票出现'], '沈藏从淡漠变得动摇，阿七开始主动追查。', ['船票指向的那片海域还藏着什么']),
  '大纲/第02章_旧信.md': card(2, '第02章_旧信', '昔_旧信', '旧信', '过去线', '三十年前邮差周晚把一封没寄出的信交给苏晚，立下灯塔之约。', ['周晚在雨夜把旧信塞进苏晚的信箱', '两人在灯塔下立下「灯亮着就有人等」的约定', '苏晚决定留在镇上'], '苏晚从想走变为留下来，周晚的信是动机。', ['「灯亮着就有人等」的约定能不能守住']),
  '大纲/第03章_灯塔.md': card(3, '第03章_灯塔', '今_灯塔', '灯塔', '', '灯塔真相揭开一半：灯一直是阿七自己熄灭的，沈藏只是替她守着秘密。', ['阿七登塔逼问熄灭的理由', '沈藏说出海难当晚的真相一半', '阿七发现灯芯有被换过的新痕'], '阿七愤怒而困惑，沈藏退守到最后一步。', ['「灯是谁下令熄的」还没揭']),
  '大纲/第04章_雨夜.md': card(4, '第04章_雨夜', '昔_雨夜', '雨夜', '过去线', '雨夜长堤，周晚把回信放进苏晚信箱——三十年前那封信的谜底收束。', ['周晚把回信放进苏晚的信箱', '老灯塔在风暴夜第一次亮起', '苏晚拿着回信离开镇子'], '周晚终于寄出迟到的回信，苏晚释然离开。', ['旧信之谜已收束：回信到了'], '约定以另一种方式守住了。'),
  '大纲/第05章_破晓.md': card(5, '第05章_破晓', '今_破晓', '破晓', '', '全书高潮：灯塔在破晓前最后熄灭，阿七看清船票指向的航线。', ['阿七在破晓前最后一次熄灯', '沈藏说出海难当晚的全部真相', '阿七看清船票指向的航线'], '阿七与沈藏达成和解，主动接下守塔的灯。', ['新航线指向新故事（为下一卷留钩）']),
  '大纲/第01章_夜航_导演.md': board(1, '第01章_夜航', '夜航', '把主角从「忘了的事」推向「主动追查」。', ['1. **推进**：候船厅旧灯出现，阿七被勾住', '2. **白热化**：沈藏当面点破灯是阿七自己熄的', '3. **拉锯**：两人对峙，谁也不退'], '第 2 段 · 沈藏点破的一瞬', ['- **阿七（试探）**：从迷糊到攥住钥匙不撒手', '- **沈藏（被压）**：习惯性淡漠，但最后松了口'], ['不要把守塔人写成纯粹的恶人'], ['船票的来历要留到后面'],
  ),
  '大纲/第02章_旧信_导演.md': board(2, '第02章_旧信', '旧信', '用一封旧信把苏晚从「离开」拉回「留下」，立下灯塔之约。', ['1. **推进**：雨夜送信，周晚欲言又止', '2. **白热化**：苏晚读信后冲到灯塔下对峙', '3. **低谷**：约定立下，但两人都知道会变'], '第 2 段 · 灯塔下的约定', ['- **周晚（突破）**：从不敢寄信到当面交信', '- **苏晚（放开）**：从想走到决定留下'], ['不要让旧信显得廉价'], ['「灯亮着就有人等」——为第4章收束埋伏。']
  ),
  '大纲/第03章_灯塔_导演.md': board(3, '第03章_灯塔', '灯塔', '把秘密揭开一半，让阿七从怀疑转为逼问。', ['1. **推进**：登塔，逼问熄灯理由', '2. **白热化**：沈藏说出海难当晚的真相一半', '3. **收紧**：灯芯新痕让追问更急'], '第 2 段 · 真相一半落地', ['- **阿七（试探）**：从逼问到开始理解', '- **沈藏（被压）**：防线退到最后一个名字'], ['不要在这一章把真相说全'], ['「灯是谁下令熄的」——留到第5章。']
  ),
  '大纲/第04章_雨夜_导演.md': board(4, '第04章_雨夜', '雨夜', '还掉旧信的债：回信送达，约定以另一种方式守住。', ['1. **推进**：雨夜长堤，周晚带着回信', '2. **白热化**：风暴夜老灯塔第一次亮起', '3. **收束**：苏晚读信释然，离开镇子'], '第 2 段 · 风暴夜灯塔亮起', ['- **周晚（放开）**：终于把回信放进信箱', '- **苏晚（通透）**：读信后释然离开'], ['不要给过去线的收束加新悬念'], ['旧信之谜在此收束——早线结束。']
  ),
  '大纲/第05章_破晓_导演.md': board(5, '第05章_破晓', '破晓', '全卷高潮：熄灭的灯与看清的航线，收束主线、开启新卷。', ['1. **推进**：破晓前阿七最后一次熄灯', '2. **白热化**：沈藏说出全部真相', '3. **收束**：灯塔交接，船票指向新航线'], '第 2 段 · 沈藏说出名字的一瞬', ['- **阿七（突破）**：从追问者成为守灯人', '- **沈藏（放下）**：把灯交出去'], ['不要让和解显得轻巧'], ['新航线为下一卷留钩。']
  )
}

const entry = '/tmp/zj-scheck-entry.mts'
writeFileSync(
  entry,
  [
    `import { runStructureCheck } from '${root}/src/main/agent/structure-check'`,
    `import { closeHarness } from '${root}/src/main/agent/runtime'`,
    `import { writeFileSync, mkdirSync } from 'node:fs'`,
    `import { join } from 'node:path'`,
    '',
    `const LIB = ${JSON.stringify(LIB)}`,
    `const PJ = ${JSON.stringify(PJ)}`,
    `mkdirSync(join(LIB, PJ, '正文'), { recursive: true })`,
    `mkdirSync(join(LIB, PJ, '大纲'), { recursive: true })`,
    `mkdirSync(join(LIB, PJ, '人物'), { recursive: true })`,
    `mkdirSync(join(LIB, PJ, '世界观'), { recursive: true })`,
    `const FILES = ${JSON.stringify(FILES)}`,
    `for (const [rel, body] of Object.entries(FILES)) writeFileSync(join(LIB, PJ, rel), body, 'utf-8')`,
    '',
    "console.log('== 双线结构点巡检 structure-check（真模型）==', PJ)",
    'const t = Date.now()',
    'let exitCode = 1',
    'try {',
    "  const r = await runStructureCheck(PJ)",
    "  console.log('[OK ' + ((Date.now() - t) / 1000).toFixed(1) + 's] ' + JSON.stringify(r).slice(0, 3000))",
    '  if (r.ok) {',
    "    const res = r.result",
    "    const known = new Set(['主线', '过去线'])",
    "    if (!res.summary) { console.log('[FAIL] summary 为空'); exitCode = 2 }",
    "    else if (!res.lines.length) { console.log('[FAIL] lines 为空（应有主线/过去线分布）'); if (r.lastRaw) console.log('[DIAG] ' + r.lastRaw.slice(0, 1500)); exitCode = 2 }",
    "    else if (!res.lines.every((l) => known.has(l.name))) { console.log('[FAIL] 出现未知线名: ' + res.lines.map((l) => l.name).join(',')); exitCode = 2 }",
    "    else if (!res.lines.every((l) => l.points.length && l.points.every((p) => p.chapter && p.role && p.note))) { console.log('[FAIL] 存在缺字段的结构点'); exitCode = 2 }",
    "    else if (!res.lines.some((l) => l.name === '主线' && l.points.some((p) => p.role.includes('高潮') || p.role.includes('中点')))) { console.log('[FAIL] 主线未见高潮/中点结构点'); exitCode = 2 }",
    "    else if (!res.ends.length) { console.log('[FAIL] ends 为空（双线项目应报早线收束状态）'); if (r.lastRaw) console.log('[DIAG] ' + r.lastRaw.slice(0, 1500)); exitCode = 2 }",
    "    else if (!res.ends.every((e) => known.has(e.line) && (e.status === 'settled' || e.status === 'loose') && e.evidence)) { console.log('[FAIL] ends 字段不完整'); exitCode = 2 }",
    "    else { console.log('[PASS] 结构点分布与早线收束检查均产出；ends=' + JSON.stringify(res.ends.map((e) => ({ line: e.line, status: e.status })))) ; exitCode = 0 }",
    '  } else exitCode = 1',
    '} catch (e) {',
    "  console.log('[ERR ' + ((Date.now() - t) / 1000).toFixed(1) + 's] ' + String(e?.message || e).slice(0, 400))",
    '  exitCode = 1',
    '} finally {',
    '  await closeHarness()',
    '  process.exit(exitCode)',
    '}'
  ].join('\n'),
  'utf-8'
)

await esbuild({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: '/tmp/zj-scheck-bundle.mjs',
  alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
  external: ['node:*'],
  logLevel: 'warning'
})

// settings：libraryRoot 指向临时库（防污染真实项目库）
mkdirSync('/tmp/zj-smoke-scheck', { recursive: true })
writeProbeSettings({ libraryRoot: LIB, workspace: LIB }, "/tmp/zj-smoke-scheck")

const r = spawnSync('node', ['/tmp/zj-scheck-bundle.mjs'], {
  env: { ...process.env, LOCAL_LLM_KEY: 'local', ZJ_USERDATA: process.env.ZJ_USERDATA },
  encoding: 'utf-8',
  timeout: 10 * 60 * 1000
})
process.stdout.write(r.stdout || '')
if (r.stderr) process.stderr.write(r.stderr?.toString() || '')
process.exit(r.status ?? 1)
