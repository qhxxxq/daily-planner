/**
 * 文件用途：浏览器回归测试入口。
 * 加载生产启动模块并向测试环境暴露内部函数；由构建脚本单独打包，不随生产应用入口导出。
 */
import '../../src/app.js';
import { runtime } from '../../src/app/runtime.js';
import * as feature0 from '../../src/app/events.js';
import * as feature1 from '../../src/app/persistence.js';
import * as feature2 from '../../src/app/queries.js';
import * as feature3 from '../../src/app/service-worker.js';
import * as feature4 from '../../src/domain/clone.js';
import * as feature5 from '../../src/domain/colors.js';
import * as feature6 from '../../src/domain/date-time.js';
import * as feature7 from '../../src/domain/event-layout.js';
import * as feature8 from '../../src/domain/event-time.js';
import * as feature9 from '../../src/domain/events.js';
import * as feature10 from '../../src/domain/html.js';
import * as feature11 from '../../src/domain/math.js';
import * as feature12 from '../../src/domain/tags.js';
import * as feature13 from '../../src/platform/files.js';
import * as feature14 from '../../src/ui/apple-sync.js';
import * as feature15 from '../../src/ui/calendar.js';
import * as feature16 from '../../src/ui/clipboard.js';
import * as feature17 from '../../src/ui/clock.js';
import * as feature19 from '../../src/ui/color-menu.js';
import * as feature20 from '../../src/ui/daily-todos.js';
import * as feature21 from '../../src/ui/date-time-picker.js';
import * as feature22 from '../../src/ui/drafts.js';
import * as feature23 from '../../src/ui/editor.js';
import * as feature24 from '../../src/ui/event-cards.js';
import * as feature25 from '../../src/ui/event-create.js';
import * as feature26 from '../../src/ui/event-drag.js';
import * as feature27 from '../../src/ui/event-save.js';
import * as feature28 from '../../src/ui/import.js';
import * as feature29 from '../../src/ui/menus.js';
import * as feature30 from '../../src/ui/navigation.js';
import * as feature31 from '../../src/ui/recovery.js';
import * as feature32 from '../../src/ui/reminders.js';
import * as feature33 from '../../src/ui/render.js';
import * as feature34 from '../../src/ui/search.js';
import * as feature35 from '../../src/ui/shortcuts.js';
import * as feature36 from '../../src/ui/sidebar.js';
import * as feature37 from '../../src/ui/source-actions.js';
import * as feature38 from '../../src/ui/source-menu.js';
import * as feature39 from '../../src/ui/status.js';
import * as feature40 from '../../src/ui/tag-actions.js';
import * as feature41 from '../../src/ui/tag-picker.js';
import * as feature42 from '../../src/ui/themes.js';
import * as feature43 from '../../src/ui/timeline-geometry.js';
import * as feature44 from '../../src/ui/undo.js';
import * as windowControls from '../../src/platform/window.js';
import * as PlannerAppleSync from '../../src/sync/apple-sync.js';
Object.assign(
  window,
  feature0,
  feature1,
  feature2,
  feature3,
  feature4,
  feature5,
  feature6,
  feature7,
  feature8,
  feature9,
  feature10,
  feature11,
  feature12,
  feature13,
  feature14,
  feature15,
  feature16,
  feature17,
  feature19,
  feature20,
  feature21,
  feature22,
  feature23,
  feature24,
  feature25,
  feature26,
  feature27,
  feature28,
  feature29,
  feature30,
  feature31,
  feature32,
  feature33,
  feature34,
  feature35,
  feature36,
  feature37,
  feature38,
  feature39,
  feature40,
  feature41,
  feature42,
  feature43,
  feature44,
  windowControls,
  { PlannerAppleSync, __testState: () => runtime.state },
);
