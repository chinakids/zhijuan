/**
 * 流式增量缓冲合并（帧级节流）。
 *
 * 背景：LLM 流式输出以高频小增量到达（长 reasoning 思考可达每秒数十次），
 * 若每个增量直接 setState，React 每帧被渲染风暴占满（社区实测 commit 52ms→5ms，
 * 见 dev.to/nainikmehta/how-to-fix-llm-streaming-lag-and-react-render-storms-13ee）。
 * 本模块把增量积攒到下一帧（默认 requestAnimationFrame）只 flush 一次，
 * 渲染/追加频率被钳在帧率（≤ 显示刷新率）；flushNow 用于流结束/停止时清空残余，保证尾段不丢。
 *
 * 纯逻辑不依赖 React/浏览器（schedule/cancel 可注入），便于单测。
 */
export interface StreamBuffer {
  /** 追加一个增量；首次追加会调度一次 flush（后续高频追加只累积不重复调度） */
  push(chunk: string): void
  /** 立即冲刷残余（流结束/停止/覆盖前调用；已调度未执行的 flush 会被取消） */
  flushNow(): void
}

export function createStreamBuffer(
  flush: (text: string) => void,
  schedule: (cb: () => void) => unknown = (cb) => requestAnimationFrame(cb),
  cancel: (h: unknown) => void = (h) => cancelAnimationFrame(h as number)
): StreamBuffer {
  let pending = ''
  let timer: unknown = null
  const drain = () => {
    timer = null
    if (pending) {
      const t = pending
      pending = ''
      flush(t)
    }
  }
  return {
    push(chunk) {
      pending += chunk
      if (timer == null) timer = schedule(drain)
    },
    flushNow() {
      if (timer != null) {
        cancel(timer)
        timer = null
      }
      drain()
    }
  }
}
