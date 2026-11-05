# 文件用途：原生提醒转换检查。
# 通过 Swift 检查提醒类型及转换结果，不把测试事件保存到系统日历。
"""Exercise the production alarm adapters using in-memory EventKit objects only."""
from pathlib import Path
import subprocess, tempfile
root = Path(__file__).resolve().parents[2]
source = (root / 'macos/PlannerApp/AppleCalendarSync.swift').read_text()
harness = r'''
extension AppleCalendarSyncManager {
  func verifyReminders() throws {
    for zone in ["Australia/Melbourne", "America/Los_Angeles", "UTC"] {
      NSTimeZone.default = TimeZone(identifier: zone)!
      dayFormatter.timeZone = NSTimeZone.default
      timeFormatter.timeZone = NSTimeZone.default
      dateTimeFormatter.timeZone = NSTimeZone.default
      for day in ["2026-10-04", "2026-04-05", "2026-03-08", "2026-11-01"] {
        let event = EKEvent(eventStore: eventStore)
        event.isAllDay = true; event.timeZone = nil
        event.startDate = eventStartDate(["date": day, "allDay": true])!
        event.endDate = Calendar.current.date(byAdding: .day, value: 1, to: event.startDate)!
        let wall: [String: Any] = ["kind": "day", "dayOffset": 0, "time": "09:00"]
        try applyReminders([wall], to: event)
        precondition(timeFormatter.string(from: event.startDate.addingTimeInterval(event.alarms![0].relativeOffset)) == "09:00")
        precondition(NSDictionary(dictionary: alarmFields(event.alarms![0], event: event)).isEqual(to: wall))
      }
    }
    let event = EKEvent(eventStore: eventStore)
    event.startDate = Date(); event.endDate = Date().addingTimeInterval(3600)
    try applyReminders([["kind":"relative", "offset": -900.0], ["kind":"absolute", "timestamp": 1800000000.0]], to: event)
    precondition(event.alarms!.count == 2)
    let values = event.alarms!.map { alarmFields($0, event: event) }
    try applyReminders(values, to: event)
    precondition(event.alarms!.contains { $0.relativeOffset == -900 })
    precondition(event.alarms!.contains { $0.absoluteDate?.timeIntervalSince1970 == 1800000000 })
    let special = EKAlarm(relativeOffset: -300)
    special.structuredLocation = EKStructuredLocation(title: "Campus")
    event.alarms = [special]
    let original = alarmFields(special, event: event)
    try applyReminders([original], to: event)
    precondition(event.alarms![0].structuredLocation?.title == "Campus")
    do { try applyReminders([["kind":"unsupported", "identity":"changed"]], to: event); fatalError("unmatched opaque alarm accepted") } catch {}
    try applyReminders([], to: event)
    precondition((event.alarms ?? []).isEmpty)
    print("PASS: production alarms; multiple/absolute/opaque preservation, cancellation, all-day wall time across 3 zones and DST; no calendar writes")
  }
}
try AppleCalendarSyncManager().verifyReminders()
'''
with tempfile.TemporaryDirectory() as tmp:
    script = Path(tmp) / 'main.swift'
    script.write_text(source + harness)
    subprocess.run(['swift', str(script)], check=True)
