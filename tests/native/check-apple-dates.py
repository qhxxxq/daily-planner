# 文件用途：原生全天日期转换检查。
# 抽取生产 Swift 赋值逻辑，在多个时区和夏令时日期创建内存事件验证；不保存到系统日历。
"""Exercise production date conversion and EventKit setters without saving events."""
from pathlib import Path
import subprocess, tempfile
root = Path(__file__).resolve().parents[2]
source = (root / 'macos/PlannerApp/AppleCalendarSync.swift').read_text().split('private extension String')[0]
# Use the exact production assignment sequence; no calendar fetch, access request or save.
assignment = source.split('        event.isAllDay = fields["allDay"]')[1].split('        event.notes')[0]
assignment = 'event.isAllDay = fields["allDay"]' + assignment
harness = '''
extension AppleCalendarSyncManager {
  func verifyDates() {
    for zone in ["Australia/Melbourne", "America/Los_Angeles", "UTC"] {
      NSTimeZone.default = TimeZone(identifier: zone)!
      dayFormatter.timeZone = NSTimeZone.default
      dateTimeFormatter.timeZone = NSTimeZone.default
      for (first, last) in [("2026-09-22", "2026-09-22"), ("2026-10-03", "2026-10-05"), ("2026-04-05", "2026-04-05")] {
        let event = EKEvent(eventStore: eventStore)
        let fields: [String: Any] = ["date": first, "endDate": last, "allDay": true]
        for _ in 0..<3 {
          let start = eventStartDate(fields)!, end = eventEndDate(fields, startDate: start)!
          ASSIGNMENT
          precondition(dayFormatter.string(from: event.startDate) == first)
          precondition(dayFormatter.string(from: event.endDate.addingTimeInterval(-1)) == last)
        }
      }
    }
    print("PASS: production EventKit all-day setters, 3 zones, single/multi-day, DST, repeated updates; no calendar writes")
  }
}
AppleCalendarSyncManager().verifyDates()
'''.replace('ASSIGNMENT', assignment)
with tempfile.TemporaryDirectory() as tmp:
    script = Path(tmp) / 'main.swift'; script.write_text(source + harness)
    subprocess.run(['swift', str(script)], check=True)
