/**
 * 文件用途：数值范围约束。
 * 把输入数值限制在给定上下界内；用于界面尺寸、时间及数量等有边界的计算。
 */
export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
