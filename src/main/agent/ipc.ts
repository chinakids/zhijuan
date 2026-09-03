// ===== 织卷 · agent IPC 路由（主进程） =====
import { ipcMain, BrowserWindow } from 'electron'
import { runChat, runSync, abortRequest, type AgentOutEvent } from './engine'
import { runAudit, type AuditKind } from './audit'
import { ensureHarness, closeHarness, answerDir } from './runtime'
import { getSettings } from '../store'
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { AskAnswer } from '../../shared/types'

export interface AgentSendInput {
  requestId: string
  projectId: string
  chapterRel: string | null
  chapterTitle: string
  prompt: string
  quote?: string | null
  history?: { role: 'user' | 'assistant'; content: string }[]
}

function broadcast(e: AgentOutEvent) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('agent:event', e)
  }
}

export function registerAgentIpc() {
  // 发一条创作消息（流式事件通过 agent:event 推给所有窗口，按 requestId 认领）
  ipcMain.handle('agent:send', async (_e, input: AgentSendInput) => {
    await runChat(input, broadcast)
    return { ok: true }
  })
  // 展示性停止：不再转发该请求的后续事件，模型在边上跑完以保持会话一致
  ipcMain.handle('agent:cancel', (_e, requestId: string) => {
    abortRequest(requestId)
    return true
  })
  // 切片同步（设定补丁）
  ipcMain.handle('agent:sync', (_e, projectId: string, chapterRel: string) => runSync(projectId, chapterRel))
  // 用户回答某个 ask 批次（写答案文件 → 写作引擎插件轮询回灌模型循环）
  ipcMain.handle('agent:answer', (_e, batch: string, answers: AskAnswer[]) => {
    if (!batch) return { ok: false, error: 'missing batch' }
    try {
      const dir = answerDir()
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, batch + '.json'), JSON.stringify({ answers }), 'utf-8')
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) }
    }
  })
  // 全卷检查子任务（一致性巡查 / 冷读报告）
  ipcMain.handle('agent:audit', (_e, projectId: string, kind: AuditKind) => runAudit(projectId, kind))
  // 引擎状态（设置页用）
  ipcMain.handle('agent:status', async () => {
    const err = await ensureHarness()
    const s = getSettings()
    return { online: !err, engine: s.agentEngine, model: s.llm?.model, message: err }
  })
}

export function shutdownAgent() {
  void closeHarness()
}
