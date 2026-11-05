/**
 * 文件用途：颜色转换与配色辅助。
 * 计算标签、完成状态等颜色及 CSS 变量；同时提供将标签变量写入传入元素的界面辅助方法。
 */
import { clamp } from './math.js';

export function stringHash(value) {
  return [...String(value || 'tag')].reduce(
    (hash, char) => ((hash << 5) - hash + char.codePointAt(0)) >>> 0,
    2166136261,
  );
}

export function hexToRgb(hex) {
  const clean = String(hex || '#7b7ff4').replace('#', '');
  const value =
    clean.length === 3
      ? clean
          .split('')
          .map((char) => char + char)
          .join('')
      : clean;
  return {
    r: parseInt(value.slice(0, 2), 16) || 123,
    g: parseInt(value.slice(2, 4), 16) || 127,
    b: parseInt(value.slice(4, 6), 16) || 244,
  };
}

export function hexToRgba(hex, alpha) {
  const rgb = hexToRgb(hex);
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

export function getRgbText(color) {
  const rgb = hexToRgb(color);
  return `${rgb.r}, ${rgb.g}, ${rgb.b}`;
}

export function applyTagCssVars(element, color) {
  const palette = getTagPalette(color);
  Object.entries(palette).forEach(([name, value]) => {
    element.style.setProperty(`--${kebabCase(name)}`, value);
  });
}

export function getTagCssText(color) {
  return Object.entries(getTagPalette(color))
    .map(([name, value]) => `--${kebabCase(name)}:${value}`)
    .join(';');
}

export function getTagPalette(color) {
  const rgb = hexToRgb(color);
  const rgbText = `${rgb.r}, ${rgb.g}, ${rgb.b}`;
  const selectedText = readableMutedColor(rgb, 0.82);
  const textColor = mixRgbString(selectedText, { r: 255, g: 255, b: 255 }, 0.18);
  return {
    tagColor: color,
    tagRgb: rgbText,
    tagBg: `rgba(${rgbText}, 0.10)`,
    tagBorder: `rgba(${rgbText}, 0.28)`,
    tagHoverBg: `rgba(${rgbText}, 0.15)`,
    tagHoverBorder: `rgba(${rgbText}, 0.38)`,
    tagTextColor: textColor,
    tagSelectedBg: `rgba(${rgbText}, 0.20)`,
    tagSelectedBorder: `rgba(${rgbText}, 0.48)`,
    tagSelectedTextColor: selectedText,
  };
}

export function readableMutedColor(rgb, neutralAmount = 0.76) {
  const neutral = { r: 98, g: 66, b: 78 };
  const deep = { r: 70, g: 45, b: 56 };
  const muted = mixRgbObject(rgb, neutral, neutralAmount);
  const luminance = (0.2126 * muted.r + 0.7152 * muted.g + 0.0722 * muted.b) / 255;
  return rgbObjectToCss(luminance > 0.46 ? mixRgbObject(muted, deep, 0.34) : muted);
}

export function mixRgbString(color, target, amount) {
  return rgbObjectToCss(mixRgbObject(parseCssColor(color), target, amount));
}

export function mixRgbObject(from, to, amount) {
  const mix = (a, b) => Math.round(a + (b - a) * amount);
  return { r: mix(from.r, to.r), g: mix(from.g, to.g), b: mix(from.b, to.b) };
}

export function rgbObjectToCss(rgb) {
  return `rgb(${clamp(rgb.r, 0, 255)}, ${clamp(rgb.g, 0, 255)}, ${clamp(rgb.b, 0, 255)})`;
}

export function getCompletedPalette(baseColor, normalTitleColor, normalMetaColor) {
  return {
    completedBg: `linear-gradient(135deg, ${hexToRgba(baseColor, 0.11)}, ${hexToRgba(baseColor, 0.08)})`,
    completedBorder: hexToRgba(baseColor, 0.27),
    completedLine: hexToRgba(baseColor, 0.42),
    completedTitle: mixColor(normalTitleColor, '#ffffff', 0.32),
    completedMeta: mixColor(normalMetaColor, '#ffffff', 0.42),
    completedCheckBg: 'rgba(255, 255, 255, 0.78)',
    completedCheckBorder: mixColor(normalTitleColor, '#ffffff', 0.42),
    completedCheckColor: mixColor(normalTitleColor, '#ffffff', 0.36),
  };
}

export function mixColor(color, targetColor, amount) {
  const from = parseCssColor(color);
  const to = parseCssColor(targetColor);
  const mix = (a, b) => Math.round(a + (b - a) * amount);
  return `rgb(${mix(from.r, to.r)}, ${mix(from.g, to.g)}, ${mix(from.b, to.b)})`;
}

export function parseCssColor(color) {
  const text = String(color || '').trim();
  if (text.startsWith('#')) return hexToRgb(text);
  const match = text.match(/rgba?\(([^)]+)\)/);
  if (!match) return hexToRgb('#7b7ff4');
  const [r, g, b] = match[1].split(',').map((part) => Number.parseFloat(part.trim()));
  return {
    r: clamp(Math.round(r || 0), 0, 255),
    g: clamp(Math.round(g || 0), 0, 255),
    b: clamp(Math.round(b || 0), 0, 255),
  };
}

export function kebabCase(value) {
  return String(value).replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

export function darkenHex(hex) {
  const rgb = hexToRgb(hex);
  return `rgb(${Math.max(0, rgb.r - 62)}, ${Math.max(0, rgb.g - 62)}, ${Math.max(0, rgb.b - 62)})`;
}
