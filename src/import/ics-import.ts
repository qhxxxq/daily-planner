/**
 * 文件用途：ICS 日历解析与有限重复展开。
 * 使用本地 ICAL.js 读取事件和时区，限制重复次数及总事件数；解析失败时抛错，由调用方决定是否写入状态。
 */
/* 本地解析并限制展开规模；ICAL.js 处理重复规则和文件内嵌 VTIMEZONE。 */
import ICAL from '../../vendor/ical.cjs';
const MAX_OCCURRENCES = 1000,
  MAX_EVENTS = 5000;
const fail = (message) => {
  throw Object.assign(new Error(`ICS 导入未完成：${message}。未导入任何日程。`), {
    code: 'ICS_IMPORT',
  });
};
const pad = (value) => String(value).padStart(2, '0');
const day = (time) => `${time.year}-${pad(time.month)}-${pad(time.day)}`;
const clock = (time) => `${pad(time.hour)}:${pad(time.minute)}`;

// Use the OS IANA database when a publisher omits VTIMEZONE. Resolve each
// occurrence separately, so a recurring 09:00 stays at 09:00 across DST.
function ianaZone(tzid) {
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: tzid,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    fail(`无法识别时区 ${tzid}，请导出包含 VTIMEZONE 的日历`);
  }
  const wallAt = (instant) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]),
    );
    return Date.UTC(
      +parts.year,
      +parts.month - 1,
      +parts.day,
      +parts.hour,
      +parts.minute,
      +parts.second,
    );
  };
  const zone = new ICAL.Timezone({ tzid });
  zone.utcOffset = (time) => {
    const wall = Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);
    const offsets = new Set(
      [-2, -1, 0, 1, 2].map((days) => {
        const instant = wall + days * 86400000;
        return wallAt(instant) - instant;
      }),
    );
    const candidates = [...offsets]
      .map((offset) => wall - offset)
      .filter((instant) => wallAt(instant) === wall)
      .sort((a, b) => a - b);
    if (!candidates.length)
      fail(`${tzid} 的 ${day(time)} ${clock(time)} 位于夏令时跳过的时段，请先调整原日历`);
    return (wall - candidates[0]) / 1000;
  };
  return zone;
}

function localTime(time) {
  if (time.isDate || time.zone === ICAL.Timezone.localTimezone)
    return { date: day(time), time: clock(time) };
  return localInstant(time.toUnixTime() * 1000);
}

function localInstant(instant) {
  const date = new Date(instant);
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

function parse(text, sourceId, uuid = () => crypto.randomUUID()) {
  try {
    return parseCalendar(text, sourceId, uuid);
  } catch (error) {
    if (error.code === 'ICS_IMPORT') throw error;
    fail('文件内容无法完整解析，请检查日期和重复规则后重试');
  }
}

function parseCalendar(text, sourceId, uuid) {
  if (String(text).length > 5 * 1024 * 1024) fail('文件超过 5 MB，请分批导入');
  // The upstream parser coerces INTERVAL=0 to 1; reject before that coercion.
  for (const line of String(text)
    .replace(/\r?\n[ \t]/g, '')
    .split(/\r?\n/)) {
    if (!/^RRULE:/i.test(line)) continue;
    const interval = line.slice(6).match(/(?:^|;)INTERVAL=([^;]*)/i)?.[1];
    if (interval !== undefined && (!/^\d+$/.test(interval) || +interval < 1 || +interval > 1000))
      fail('重复间隔必须为 1–1000 的整数');
  }
  const calendar = new ICAL.Component(ICAL.parse(text));
  if (calendar.name !== 'vcalendar') fail('文件缺少 VCALENDAR');
  const zones = new Map(),
    originalLookup = calendar.getTimeZoneByID.bind(calendar);
  calendar.getTimeZoneByID = (tzid) => {
    const embedded = originalLookup(tzid);
    if (embedded) return embedded;
    if (!zones.has(tzid)) zones.set(tzid, ianaZone(tzid));
    return zones.get(tzid);
  };
  const components = calendar.getAllSubcomponents('vevent');
  if (components.length > MAX_EVENTS) fail(`事件超过 ${MAX_EVENTS} 条，请分批导入`);
  const masters = components.filter((c) => !c.hasProperty('recurrence-id'));
  const exceptions = components.filter((c) => c.hasProperty('recurrence-id'));
  const masterIds = new Set();
  for (const component of masters) {
    const uid = component.getFirstPropertyValue('uid');
    if (uid && masterIds.has(uid)) fail(`日程 ${uid} 包含多个主版本，请先整理原日历`);
    if (uid) masterIds.add(uid);
  }
  for (const component of exceptions) {
    if (!masterIds.has(component.getFirstPropertyValue('uid'))) fail('存在没有主系列的重复例外');
    if (component.getFirstProperty('recurrence-id').getParameter('range'))
      fail('暂不支持 THISANDFUTURE 重复例外，请先导出独立日程');
  }
  const events = [],
    warnings = [],
    timezones = new Set();
  for (const component of components) {
    for (const property of component.getAllProperties()) {
      const tzid = property.getParameter('tzid');
      if (tzid) {
        calendar.getTimeZoneByID(tzid);
        timezones.add(tzid);
      }
      if (['dtstart', 'dtend', 'recurrence-id', 'exdate', 'rdate'].includes(property.name)) {
        if (property.type === 'period') fail('暂不支持 RDATE 的 PERIOD 写法，请先导出独立日程');
        // Validate raw jCal first: ICAL.Time normalizes February 30 to March.
        for (const raw of property.jCal.slice(3)) {
          const match = String(raw).match(
            /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})Z?)?$/,
          );
          if (
            !match ||
            +match[1] < 1900 ||
            +match[1] > 2200 ||
            +match[2] < 1 ||
            +match[2] > 12 ||
            +match[3] < 1 ||
            +match[3] > ICAL.Time.daysInMonth(+match[2], +match[1]) ||
            +(match[4] || 0) > 23 ||
            +(match[5] || 0) > 59 ||
            +(match[6] || 0) > 59
          )
            fail('存在无效或超出 1900–2200 年范围的日期');
        }
        for (const time of property.getValues()) {
          if (
            !(time instanceof ICAL.Time) ||
            time.year < 1900 ||
            time.year > 2200 ||
            time.month < 1 ||
            time.month > 12 ||
            time.day < 1 ||
            time.day > ICAL.Time.daysInMonth(time.month, time.year) ||
            time.hour > 23 ||
            time.minute > 59 ||
            time.second > 59
          )
            fail('存在无效或超出 1900–2200 年范围的日期');
        }
      }
    }
  }
  for (const component of masters) {
    if (component.getFirstPropertyValue('status') === 'CANCELLED') continue;
    if (!component.hasProperty('dtstart')) fail('有日程缺少开始日期');
    if (component.hasProperty('exrule')) fail('暂不支持 EXRULE，请改用 EXDATE');
    const rules = component.getAllProperties('rrule').map((property) => {
      const raw = property.jCal[3];
      if ('interval' in raw && (!Number.isInteger(raw.interval) || raw.interval < 1))
        fail('重复间隔必须为正整数');
      return property.getFirstValue();
    });
    if (rules.length > 1) fail('暂不支持同一日程中的多个 RRULE');
    for (const rule of rules) {
      if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(rule.freq))
        fail('仅支持按天、周、月或年重复');
      if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > 1000)
        fail('重复间隔无效或过大');
      if (
        rule.count !== null &&
        (!Number.isInteger(rule.count) || rule.count < 1 || rule.count > MAX_OCCURRENCES)
      )
        fail(`每个系列最多导入 ${MAX_OCCURRENCES} 次`);
      // Keep expansion bounded and predictable; complex contracting rules can
      // otherwise search many years inside a single iterator.next() call.
      const allowed = rule.freq === 'WEEKLY' ? ['BYDAY'] : [];
      if (Object.keys(rule.parts).some((part) => !allowed.includes(part)))
        fail('暂不支持此复杂重复规则；支持普通日/周/月/年重复及每周指定星期');
      if ((rule.parts.BYDAY || []).some((value) => !/^(MO|TU|WE|TH|FR|SA|SU)$/.test(value)))
        fail('每周重复的星期规则无效');
    }
    const related = exceptions.filter(
      (c) => c.getFirstPropertyValue('uid') === component.getFirstPropertyValue('uid'),
    );
    const cancelled = related
      .filter((c) => c.getFirstPropertyValue('status') === 'CANCELLED')
      .map((c) => c.getFirstPropertyValue('recurrence-id'));
    const series = new ICAL.Event(component, {
      exceptions: related.filter((c) => c.getFirstPropertyValue('status') !== 'CANCELLED'),
      strictExceptions: true,
    });
    const recurring = series.isRecurring();
    const groupId = recurring ? uuid() : '';
    const unbounded = rules.some((rule) => !rule.isFinite());
    const limit = series.startDate.clone();
    limit.year += 2;
    if (unbounded)
      warnings.push(
        `“${series.summary || '未命名日程'}”没有结束日期，本次仅导入开始日起两年内（不含 ${day(limit)}）的重复项`,
      );
    const iterator = recurring ? series.iterator() : null;
    let index = 0,
      occurrence;
    while ((occurrence = recurring ? iterator.next() : index === 0 ? series.startDate : null)) {
      if (unbounded && occurrence.compare(limit) >= 0) break;
      if (index >= MAX_OCCURRENCES)
        fail(`单个系列超过 ${MAX_OCCURRENCES} 次，请缩小原日历的日期范围`);
      if (cancelled.some((time) => time.compare(occurrence) === 0)) {
        index++;
        continue;
      }
      const details = recurring
        ? series.getOccurrenceDetails(occurrence)
        : { item: series, startDate: series.startDate, endDate: series.endDate };
      const recurrenceIndex = index++;
      if (details.item.component.getFirstPropertyValue('status') === 'CANCELLED') continue;
      const start = details.startDate,
        end = details.endDate;
      const fixedDuration =
        recurring &&
        details.item === series &&
        component.hasProperty('dtend') &&
        !start.isDate &&
        start.zone !== ICAL.Timezone.localTimezone
          ? series.duration.toSeconds()
          : null;
      const duration = fixedDuration ?? end.subtractDateTz(start).toSeconds();
      if (start.isDate !== end.isDate || duration < 0 || (start.isDate && duration === 0))
        fail('有日程的结束日期无效或日期类型不一致');
      const first = localTime(start),
        last =
          fixedDuration === null
            ? localTime(end)
            : localInstant(start.toUnixTime() * 1000 + fixedDuration * 1000);
      if (start.isDate) {
        const inclusive = end.clone();
        inclusive.adjust(-1, 0, 0, 0);
        last.date = day(inclusive);
      } else if (duration === 0) {
        // Preserve the app's existing default for events without a duration.
        const fallback = start.clone();
        fallback.adjust(0, 0, 30, 0);
        Object.assign(last, localTime(fallback));
      }
      events.push({
        id: uuid(),
        title: details.item.summary || series.summary || '导入日程',
        date: first.date,
        endDate: last.date,
        start: start.isDate ? '00:00' : first.time,
        end: start.isDate ? '00:00' : last.time,
        allDay: start.isDate,
        notes: details.item.description || '',
        sourceId,
        type: 'schedule',
        status: 'open',
        completed: false,
        tags: [],
        travelTime: 0,
        children: [],
        recurrenceGroupId: groupId,
        recurrenceIndex: recurring ? recurrenceIndex : null,
      });
      if (events.length > MAX_EVENTS) fail(`展开后超过 ${MAX_EVENTS} 条，请分批导入`);
    }
  }
  return { events, warnings, timezones: [...timezones] };
}
export { parse };
