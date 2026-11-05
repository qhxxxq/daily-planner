/**
 * 文件用途：ICS 导入回归。
 * 用日历样本覆盖时间、时区、重复规则和非法输入，检查解析结果及失败边界。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.TZ = 'Australia/Melbourne';
import * as importer from '../../src/import/ics-import.js';
const calendar = (...parts) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', ...parts, 'END:VCALENDAR'].join('\r\n');
const event = (body, uid = 'a') =>
  ['BEGIN:VEVENT', `UID:${uid}`, 'SUMMARY:课程', body, 'END:VEVENT'].join('\r\n');
const parse = (...parts) => importer.parse(calendar(...parts), 'source');
const timed = 'DTSTART:20260926T090000\r\nDTEND:20260926T100000';
test('TZID converts New York to Melbourne rather than treating it as local time', () => {
  const result = parse(
    event(
      'DTSTART;TZID=America/New_York:20260926T090000\r\nDTEND;TZID=America/New_York:20260926T100000',
    ),
  );
  assert.deepEqual(
    result.events.map((e) => [e.date, e.start, e.endDate, e.end]),
    [['2026-09-26', '23:00', '2026-09-27', '00:00']],
  );
  assert.deepEqual(result.timezones, ['America/New_York']);
});
test('UTC converts to the device timezone and floating times retain their wall clock', () => {
  assert.equal(
    parse(event('DTSTART:20260926T090000Z\r\nDTEND:20260926T100000Z')).events[0].start,
    '19:00',
  );
  assert.equal(parse(event(timed)).events[0].start, '09:00');
});
test('weekly recurrence converts each occurrence across destination DST', () => {
  const result = parse(
    event(
      'DTSTART;TZID=America/New_York:20260926T090000\r\nDTEND;TZID=America/New_York:20260926T100000\r\nRRULE:FREQ=WEEKLY;COUNT=3',
    ),
  );
  assert.deepEqual(
    result.events.map((e) => [e.date, e.start]),
    [
      ['2026-09-26', '23:00'],
      ['2026-10-03', '23:00'],
      ['2026-10-11', '00:00'],
    ],
  );
  assert.equal(new Set(result.events.map((e) => e.recurrenceGroupId)).size, 1);
  assert.equal(new Set(result.events.map((e) => e.id)).size, 3);
});
test('source DST is resolved for each occurrence independently', () => {
  const result = parse(
    event(
      'DTSTART;TZID=America/New_York:20261025T090000\r\nDTEND;TZID=America/New_York:20261025T100000\r\nRRULE:FREQ=WEEKLY;COUNT=3',
    ),
  );
  assert.deepEqual(
    result.events.map((e) => e.start),
    ['00:00', '01:00', '01:00'],
  );
});
test('weekly BYDAY, EXDATE, RDATE and a moved exception preserve the actual instances', () => {
  const result = parse(
    event(
      'DTSTART:20260921T090000\r\nDTEND:20260921T100000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4\r\nEXDATE:20260923T090000\r\nRDATE:20261002T090000',
    ),
    event('RECURRENCE-ID:20260928T090000\r\nDTSTART:20260929T110000\r\nDTEND:20260929T120000'),
  );
  assert.deepEqual(
    result.events.map((e) => [e.date, e.start]),
    [
      ['2026-09-21', '09:00'],
      ['2026-09-29', '11:00'],
      ['2026-09-30', '09:00'],
      ['2026-10-02', '09:00'],
    ],
  );
});
test('exceptions attach only to their own series and cancelled instances are excluded', () => {
  const result = parse(
    event(timed + '\r\nRRULE:FREQ=DAILY;COUNT=2'),
    event(timed + '\r\nRRULE:FREQ=DAILY;COUNT=2', 'b'),
    event(
      'RECURRENCE-ID:20260927T090000\r\nDTSTART:20260927T090000\r\nDTEND:20260927T100000\r\nSTATUS:CANCELLED',
    ),
  );
  assert.equal(result.events.length, 3);
});
test('all-day exclusive end dates and multi-day recurring dates remain inclusive in the app', () => {
  const result = parse(
    event('DTSTART;VALUE=DATE:20261003\r\nDTEND;VALUE=DATE:20261006\r\nRRULE:FREQ=WEEKLY;COUNT=2'),
  );
  assert.deepEqual(
    result.events.map((e) => [e.date, e.endDate, e.start, e.end]),
    [
      ['2026-10-03', '2026-10-05', '00:00', '00:00'],
      ['2026-10-10', '2026-10-12', '00:00', '00:00'],
    ],
  );
});
test('UNTIL is inclusive and an endless series returns an explicit bounded-import warning', () => {
  assert.equal(parse(event(timed + '\r\nRRULE:FREQ=DAILY;UNTIL=20260928T090000')).events.length, 3);
  const result = parse(event(timed + '\r\nRRULE:FREQ=WEEKLY'));
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /两年/);
  assert.ok(result.events.length > 100 && result.events.length < 106);
  assert.ok(result.events.every((e) => e.date < '2028-09-26'));
});
test('basic monthly/yearly rules expand without flattening calendar dates', () => {
  const monthly = parse(event(timed + '\r\nRRULE:FREQ=MONTHLY;COUNT=3')).events;
  assert.deepEqual(
    monthly.map((e) => e.date),
    ['2026-09-26', '2026-10-26', '2026-11-26'],
  );
  assert.deepEqual(
    parse(event(timed + '\r\nRRULE:FREQ=YEARLY;COUNT=2')).events.map((e) => e.date),
    ['2026-09-26', '2027-09-26'],
  );
});
test('unknown zones, unsupported rules and overly large series fail explicitly', () => {
  for (const body of [
    timed.replaceAll('DTSTART:', 'DTSTART;TZID=Unknown/Zone:'),
    timed + '\r\nRRULE:FREQ=HOURLY;COUNT=2',
    timed + '\r\nRRULE:FREQ=WEEKLY;COUNT=1001',
    timed + '\r\nRRULE:FREQ=MONTHLY;BYDAY=1MO;COUNT=3',
  ]) {
    assert.throws(
      () => parse(event(body)),
      (error) => error.code === 'ICS_IMPORT' && /未导入任何日程/.test(error.message),
    );
  }
});
test('embedded custom VTIMEZONE is honored and never leaks into subsequent imports', () => {
  const zone =
    'BEGIN:VTIMEZONE\r\nTZID:Custom/Plus2\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:+0200\r\nTZOFFSETTO:+0200\r\nEND:STANDARD\r\nEND:VTIMEZONE';
  const body =
    'DTSTART;TZID=Custom/Plus2:20260926T090000\r\nDTEND;TZID=Custom/Plus2:20260926T100000';
  assert.equal(parse(zone, event(body)).events[0].start, '17:00');
  assert.throws(() => parse(event(body)), /无法识别时区/);
});
test('folded lines and escaped text are preserved', () => {
  const body = timed + '\r\nDESCRIPTION:第一行\\n第二行\\,内容\\;结尾\r\n 续行';
  assert.equal(parse(event(body)).events[0].notes, '第一行\n第二行,内容;结尾续行');
});
test('IANA spring-forward nonexistent times fail rather than shifting silently', () => {
  assert.throws(
    () =>
      parse(
        event(
          'DTSTART;TZID=America/New_York:20260308T023000\r\nDTEND;TZID=America/New_York:20260308T033000',
        ),
      ),
    /夏令时跳过/,
  );
});
test('cancelled master does not import and orphan exceptions fail clearly', () => {
  assert.equal(parse(event(timed + '\r\nSTATUS:CANCELLED')).events.length, 0);
  assert.throws(() => parse(event(timed + '\r\nRECURRENCE-ID:20260926T090000')), /没有主系列/);
});

test('invalid raw dates, empty all-day spans and zero intervals never silently normalize', () => {
  for (const body of [
    'DTSTART:20260230T090000\r\nDTEND:20260230T100000',
    'DTSTART;VALUE=DATE:20260926\r\nDTEND;VALUE=DATE:20260926',
    timed + '\r\nRRULE:FREQ=DAILY;INTERVAL=0;COUNT=2',
  ]) {
    assert.throws(
      () => parse(event(body)),
      (error) => error.code === 'ICS_IMPORT',
    );
  }
});

test('a cancelled exception can omit DTSTART and DTEND', () => {
  const result = parse(
    event(timed + '\r\nRRULE:FREQ=DAILY;COUNT=2'),
    event('RECURRENCE-ID:20260927T090000\r\nSTATUS:CANCELLED'),
  );
  assert.equal(result.events.length, 1);
});
test('recurring explicit DTEND preserves elapsed duration across a source DST transition', () => {
  const result = parse(
    event(
      'DTSTART;TZID=America/New_York:20260308T013000\r\nDTEND;TZID=America/New_York:20260308T033000\r\nRRULE:FREQ=WEEKLY;COUNT=2',
    ),
  );
  assert.deepEqual(
    result.events.map((e) => [e.start, e.end]),
    [
      ['17:30', '18:30'],
      ['16:30', '17:30'],
    ],
  );
});
