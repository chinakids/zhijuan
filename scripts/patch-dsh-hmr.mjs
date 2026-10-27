#!/usr/bin/env node
// 织卷 · dsh-runtime 引擎启动补丁（2026-10-26 修复「no adapter registered for provider」根因）
// 背景：dsh-app-boot 的 watchUserPatches 调 hmr.registerConfig(...)，但激活的
//      @deepseek-ai/cordis-plugin-hmr(1.0.20) 无 registerConfig 方法 → 引擎注册 LLM 适配器前崩溃退出
//      → dsh-llm 报 no adapter（setting 引擎离线）。给 dsh-app-boot 注入 registerConfig 守卫跳过 HMR，
//      引擎随后正常注册 zj-* 路由（子代理实测：注入后引擎可启动并真正请求 DeepSeek）。
// 幂等：已存在守卫则跳过；dsh-runtime 被重装/覆盖后重打包会自动重新注入。
// 位置：放 electron-builder 打包前调用（npm build 前置）；dsh-runtime 依赖树 gitignore。
// 退出码（2026-10-27 起不静默）：
//   0 = 注入成功 / 已存在 / 没装引擎（dsh-runtime/node_modules 不存在，CI 编译与本地开发容错）
//   1 = 装了引擎却找不到 dsh-app-boot 或注入点 —— 版本漂了，必须红，别打包出 NO_ADAPTER 的 dmg
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// 目标树可换（2026-10-27）：ZHJUAN_DSH_RUNTIME=<dir> 时给那棵树打补丁（验证全新安装用）。
const rtBase = process.env.ZHJUAN_DSH_RUNTIME
  ? resolve(process.env.ZHJUAN_DSH_RUNTIME)
  : join(root, 'dsh-runtime')
const bootDir = join(rtBase, 'node_modules', '@deepseek-ai', 'dsh-app-boot')
const target = join(bootDir, 'lib', 'index.js')

// 引擎没装（依赖树缺失）：dev 容错，静默放行。装了就必须对上注入点。
if (!existsSync(join(rtBase, 'node_modules'))) {
  console.log('[patch-dsh-hmr] 未发现 dsh-runtime/node_modules（引擎未安装），跳过')
  process.exit(0)
}
if (!existsSync(target)) {
  console.error('[patch-dsh-hmr] 引擎已安装但缺 dsh-app-boot/lib/index.js：' + target)
  console.error('[patch-dsh-hmr] 依赖树不完整，重跑 bash dsh-runtime/install.sh')
  process.exit(1)
}
let src = readFileSync(target, 'utf8')
if (src.includes('typeof hmr.registerConfig !== "function"')) {
  console.log('[patch-dsh-hmr] registerConfig 守卫已存在，跳过')
  process.exit(0)
}
const needle = 'const register = hmr.registerConfig(filename,'
if (!src.includes(needle)) {
  let ver = '(未知)'
  try {
    ver = JSON.parse(readFileSync(join(bootDir, 'package.json'), 'utf8')).version
  } catch {}
  console.error('[patch-dsh-hmr] 已安装 dsh-app-boot@' + ver + '，但找不到注入点：' + needle)
  console.error('[patch-dsh-hmr] 上游改了 watchUserPatches → 更新 scripts/patch-dsh-hmr.mjs 的 needle；')
  console.error('[patch-dsh-hmr] 否则引擎会在注册 LLM 适配器前崩（no adapter registered）。')
  process.exit(1)
}
src = src.replace(needle, 'if (typeof hmr.registerConfig !== "function") return async () => {};\n\t' + needle)
writeFileSync(target, src)
console.log('[patch-dsh-hmr] 已注入 registerConfig 守卫（修复 NO_ADAPTER）')
