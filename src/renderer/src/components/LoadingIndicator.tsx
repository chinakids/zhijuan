import { cn } from '../lib/utils'

interface LoadingIndicatorProps {
  /** 渲染尺寸（px）。视觉阶梯：12（行内小态）/14（进行中徽标）/16（页级）/20+ */
  size?: number
  className?: string
}

/**
 * 织卷定制加载指示器（F-20260912-02 方向：SVG+动画提升质感）。
 * 设计：细底环（--hair-strong）+ 青黛行走弧（--accent、圆头、约 25% 弧长），1.2s 匀速旋转；
 * 对照 Apple HIG Progress indicators：spinner 应「小而克制/保持一致」，故不做花哨形变；
 * 颜色全走 tokens（style 属性承载 CSS 变量——SVG presentation attribute 不解析 var()，EmptyArt 已踩）；
 * 动效门控：tokens.css 的 .zj-ind-arc 在 prefers-reduced-motion 下静止（HIG：让动效可取消）。
 */
export default function LoadingIndicator({ size = 16, className }: LoadingIndicatorProps) {
  const strokeWidth = Math.max(1.5, size / 8)
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      data-zj-ind
      className={cn('shrink-0', className)}
      style={{ width: size, height: size }}
    >
      {/* 底环：让行走弧不孤独，同时保持「精密克制」的观感 */}
      <circle cx="12" cy="12" r="10" strokeWidth={strokeWidth} style={{ stroke: 'var(--hair-strong)' }} />
      {/* 行走弧：青黛 accent，圆头细线 */}
      <circle
        className="zj-ind-arc"
        cx="12"
        cy="12"
        r="10"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray="15.7 47.2"
        style={{ stroke: 'var(--accent)' }}
      />
    </svg>
  )
}
