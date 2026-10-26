// 织卷 electron-builder afterPack hook（macOS）：完整 .app 已生成、DMG 未创建时，
// 清理 Electron 预置签名在重打包后失效而成的「残缺签名」，得到干净 unsigned 产物。
// 背景/方案见 scripts/macos-signature-audit.sh（移植自 daily_stock_analysis#2101）。
const path = require('node:path')
const { execFileSync } = require('node:child_process')

exports.default = async function afterPackMacos(context) {
  if (context.electronPlatformName !== 'darwin') {
    return
  }
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const auditScript = path.resolve(__dirname, 'macos-signature-audit.sh')
  execFileSync('bash', [auditScript, 'normalize', appPath], { stdio: 'inherit' })
}
