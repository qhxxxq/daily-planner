/**
 * 文件用途：应用公共配置。
 * 集中定义存储键、时间轴尺寸、同步延迟和主题色板；修改这些常量会影响对应模块的默认行为。
 */
// 正式状态、编辑草稿与界面偏好使用独立存储键，避免互相覆盖。
export const STORAGE_KEY = 'daily-planner-state-v1';
export const DRAFT_STORAGE_KEY = 'daily-planner-editor-drafts-v1';
export const UI_PREFS_KEY = 'daily-planner-ui-prefs-v1';
export const FILE_HANDLE_DB_NAME = 'daily-planner-file-handles';
export const FILE_HANDLE_STORE = 'handles';
export const FILE_HANDLE_KEY = 'primary-data-file';
// 布局尺寸：侧栏宽度单位为像素，时间轴范围单位为小时。
export const SIDEBAR_MIN_WIDTH = 188;
export const SIDEBAR_MAX_WIDTH = 360;
export const START_HOUR = 0;
export const END_HOUR = 24;
export const HOUR_HEIGHT = 48;
export const DEFAULT_SCROLL_HOUR = 8;
export const DATA_FILE_NAME = 'daily-planner-data.json';
// 定时器使用毫秒；TOTAL_MINUTES 用于把时间换算到整日坐标。
export const NOW_LINE_UPDATE_INTERVAL_MS = 30 * 1000;
export const TOTAL_MINUTES = (END_HOUR - START_HOUR) * 60;
export const EVENT_GUTTER_PX = 2;
export const NESTED_CHILD_LEFT_INDENT_PX = 10;
export const NESTED_CHILD_RIGHT_GAP_PX = 6;
// 列表默认色与标签主题色板；主题切换通过相同主题 ID 查找配色。
export const palette = ['#7b7ff4', '#f06cae', '#76a9ff', '#b17cff', '#ff9bb8', '#8fc7ff'];
export const tagColorPalettes = {
  dark: ['#efa7c5', '#d690b1', '#c6a8d9', '#a9b9d6', '#99c3bb', '#d8bb99', '#e5a6af'],
  coral: [
    '#f48ea3',
    '#e9b44c',
    '#68b7a1',
    '#7da2f8',
    '#b58cff',
    '#ee8fc1',
    '#82bfd7',
    '#d59a6f',
    '#91bd6b',
    '#d67f98',
  ],
  mono: [
    '#6d5ff5',
    '#8ea1ff',
    '#7280a7',
    '#9a88ff',
    '#6ea6c9',
    '#b47adf',
    '#7886b8',
    '#5f9f96',
    '#9a8a66',
    '#b0718d',
  ],
};
export const themes = [
  {
    id: 'dark',
    name: '黑粉色',
    colors: ['#f7d6e4', '#efa7c5', '#694554'],
    calendarColors: ['#efa7c5', '#d690b1', '#c6a8d9', '#a9b9d6', '#99c3bb', '#d8bb99'],
  },
  {
    id: 'coral',
    name: '樱花粉',
    colors: ['#fff8f7', '#ffb1c0', '#924659'],
    calendarColors: ['#ffb1c0', '#924659', '#d97991', '#ff9eb0', '#b86778', '#ffd9df'],
  },
  {
    id: 'mono',
    name: '黑紫色',
    colors: ['#e8edff', '#6d5ff5', '#3a3033'],
    calendarColors: ['#3a3033', '#6d5ff5', '#7280a7', '#9a88ff', '#596275', '#8ea1ff'],
  },
];
