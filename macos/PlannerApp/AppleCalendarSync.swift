/**
 * 文件用途：EventKit 日历同步适配。
 * 管理访问权限、受管日历、快照和批量写入；转换日期与提醒格式，检查重复标识并将结果回传网页。
 */
import Cocoa
import EventKit

final class AppleCalendarSyncManager {
  private let syncQueue = DispatchQueue(label: "com.qhxxxq.daily-planner.apple-sync", qos: .utility)
  private lazy var eventStore = EKEventStore()
  private let accessRequest: ((@escaping (Bool, Error?) -> Void) -> Void)?

  init(accessRequest: ((@escaping (Bool, Error?) -> Void) -> Void)? = nil) {
    self.accessRequest = accessRequest
  }
  private let sourceCalendarMappingKey = "DailyPlannerAppleSourceCalendarMapping"
  private let eventMappingKey = "DailyPlannerAppleEventMapping"
  private var lastSnapshot: String?
  private var lastToken: String?

  // 所有 EventKit 请求在同步队列执行，回执切回主线程交给 WebView；写入前复核令牌与快照，防止远端已变化仍按旧计划写入。
  func exchange(action: String, body: [String: Any], completion: @escaping (Result<[String: Any], Error>) -> Void) {
    syncQueue.async { [weak self] in
      guard let self else { return }
      self.requestCalendarAccess { [weak self] granted, error in
        guard let self else { return }
        self.syncQueue.async {
          let result: Result<[String: Any], Error>
          do {
            if let error { throw error }
            guard granted else { throw CalendarSyncError.permissionDenied }
            guard let text = body["text"] as? String, let data = text.data(using: .utf8),
                  let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw CalendarSyncError.invalidData }
            if action == "applyAppleChanges" {
              let current = try self.snapshot(root)
              guard let token = body["token"] as? String, token == self.lastToken,
                    try self.canonical(current) == self.lastSnapshot else { throw CalendarSyncError.changedDuringSync }
              let operations = body["operations"] as? [[String: Any]] ?? []
              let blocked = Set(current["unsupportedIds"] as? [String] ?? [])
              guard !operations.contains(where: { blocked.contains($0["plannerId"] as? String ?? "") }) else {
                throw CalendarSyncError.changedDuringSync
              }
              try self.apply(root, operations: operations)
            }
            var value = try self.snapshot(root)
            self.lastSnapshot = try self.canonical(value)
            self.lastToken = UUID().uuidString
            value["token"] = self.lastToken
            result = .success(value)
          } catch { result = .failure(error) }
          DispatchQueue.main.async { completion(result) }
        }
      }
    }
  }

  private func canonical(_ value: [String: Any]) throws -> String {
    String(data: try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), encoding: .utf8)!
  }

  private func requestCalendarAccess(completion: @escaping (Bool, Error?) -> Void) {
    dispatchPrecondition(condition: .onQueue(syncQueue))
    if let accessRequest { accessRequest(completion); return }
    if #available(macOS 14.0, *) {
      eventStore.requestFullAccessToEvents { granted, error in
        completion(granted, error)
      }
    } else {
      eventStore.requestAccess(to: .event) { granted, error in
        completion(granted, error)
      }
    }
  }

  // 读取受管日历并生成网页可比较的快照，同时标注不支持或重复身份的事件，供合并层暂停相关写入。
  private func snapshot(_ root: [String: Any]) throws -> [String: Any] {
    dispatchPrecondition(condition: .onQueue(syncQueue))
    guard let sources = root["sources"] as? [[String: Any]], let local = root["events"] as? [[String: Any]] else { throw CalendarSyncError.invalidData }
    let defaults = UserDefaults.standard
    let mapping = defaults.dictionary(forKey: sourceCalendarMappingKey) as? [String: String] ?? [:]
    let eventMapping = defaults.dictionary(forKey: eventMappingKey) as? [String: String] ?? [:]
    let baseline = (root["appleSync"] as? [String: Any])?["baseline"] as? [String: [String: Any]] ?? [:]
    var legacyNotes = defaults.dictionary(forKey: "DailyPlannerLegacyNotes") as? [String: [String: String]] ?? [:]
    let localById = Dictionary(local.compactMap { value -> (String, [String: Any])? in
      guard let id = value["id"] as? String else { return nil }; return (id, value)
    }, uniquingKeysWith: { first, _ in first })
    var plannerByRemoteId = Dictionary(eventMapping.map { ($0.value, $0.key) }, uniquingKeysWith: { first, _ in first })
    for (id, value) in baseline {
      if let remoteId = value["remoteId"] as? String, plannerByRemoteId[remoteId] == nil { plannerByRemoteId[remoteId] = id }
    }
    var records: [[String: Any]] = []
    var unsupported: [String] = []
    var calendarIds: [String: String] = [:]
    for source in sources where source["archived"] as? Bool != true && source["appleSyncEnabled"] as? Bool != false {
      guard let sourceId = source["id"] as? String else { continue }
      guard let calendarId = mapping[sourceId] else {
        if baseline.values.contains(where: { ($0["local"] as? [String: Any])?["sourceId"] as? String == sourceId }) { throw CalendarSyncError.calendarUnavailable }
        continue
      }
      // 账户或日历暂时不可用不等于事件全部被删除，不能据此清空本地数据。
      guard let calendar = eventStore.calendar(withIdentifier: calendarId), calendar.allowsContentModifications else { throw CalendarSyncError.calendarUnavailable }
      calendarIds[sourceId] = calendarId
      let start = Calendar.current.date(byAdding: .year, value: -2, to: Date())!
      let end = Calendar.current.date(byAdding: .year, value: 2, to: Date())!
      var found: [String: EKEvent] = [:]
      for event in eventStore.events(matching: eventStore.predicateForEvents(withStart: start, end: end, calendars: [calendar])) {
        found[event.calendarItemIdentifier] = event
      }
      // 对已映射事件逐个查询，覆盖发现时间窗口之外仍需要跟踪的日程。
      let relevantIds = Set(local.filter { $0["sourceId"] as? String == sourceId }.compactMap { $0["id"] as? String })
        .union(baseline.filter { ($0.value["local"] as? [String: Any])?["sourceId"] as? String == sourceId }.keys)
      for id in relevantIds {
        if let identifier = eventMapping[id] ?? baseline[id]?["remoteId"] as? String, let event = eventStore.calendarItem(withIdentifier: identifier) as? EKEvent {
          // 移入非受管日历的事件留待人工处理，不能按旧归属自动覆盖。
          if event.calendar.calendarIdentifier != calendarId {
            let belongsToEnabledSource = sources.contains { candidate in
              candidate["archived"] as? Bool != true && candidate["appleSyncEnabled"] as? Bool != false &&
                mapping[candidate["id"] as? String ?? ""] == event.calendar.calendarIdentifier
            }
            if !belongsToEnabledSource { unsupported.append(id) }
            continue
          }
          found[event.calendarItemIdentifier] = event
        }
      }
      for event in found.values {
        let identifier = event.calendarItemIdentifier
        let urlId = event.url?.scheme == "dailyplanner" && event.url?.host == "event" ? event.url?.lastPathComponent : nil
        let plannerId = plannerByRemoteId[identifier] ?? urlId ?? "apple-\(identifier)"
        if event.hasRecurrenceRules || event.isDetached { unsupported.append(plannerId); continue }
        let original = localById[plannerId]
        var notes = event.notes ?? ""
        // 识别旧版本自动追加的备注后缀，防止应用专属字段混入可编辑备注。
        if legacyNotes[identifier] == nil, baseline[plannerId] == nil, let original,
           notes == (appleCalendarNotes(original) ?? "") {
          let plain = (original["notes"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
          legacyNotes[identifier] = ["raw": notes, "plain": original["notes"] as? String ?? "", "suffix": String(notes.dropFirst(plain.count))]
        }
        if let legacy = legacyNotes[identifier] {
          if notes == legacy["raw"] { notes = legacy["plain"] ?? "" }
          else if let suffix = legacy["suffix"], !suffix.isEmpty, notes.hasSuffix(suffix) { notes = String(notes.dropLast(suffix.count)) }
        }
        let endDate = event.isAllDay ? event.endDate.addingTimeInterval(-1) : event.endDate!
        records.append([
          "plannerId": plannerId, "remoteId": identifier, "sourceId": sourceId,
          "title": event.title ?? "未命名日程", "date": dayFormatter.string(from: event.startDate),
          "endDate": dayFormatter.string(from: endDate), "start": event.isAllDay ? "00:00" : timeFormatter.string(from: event.startDate),
          "end": event.isAllDay ? "00:00" : timeFormatter.string(from: event.endDate),
          "allDay": event.isAllDay, "notes": notes,
          "reminders": (event.alarms ?? []).map { alarmFields($0, event: event) },
          "modified": event.lastModifiedDate?.timeIntervalSince1970 ?? 0
        ])
      }
    }
    defaults.set(legacyNotes, forKey: "DailyPlannerLegacyNotes")
    let duplicates = duplicatePlannerIds(records)
    unsupported.append(contentsOf: duplicates)
    return ["events": records.sorted {
              let left = ($0["plannerId"] as? String ?? "", $0["remoteId"] as? String ?? "")
              let right = ($1["plannerId"] as? String ?? "", $1["remoteId"] as? String ?? "")
              return left < right
            },
            "unsupportedIds": Array(Set(unsupported)).sorted(), "duplicateIds": duplicates, "calendarIds": calendarIds]
  }

  // 复制事件也会复制 URL 标识；检测到重复时必须阻止自动任选一条写回。
  private func duplicatePlannerIds(_ records: [[String: Any]]) -> [String] {
    var seen = Set<String>()
    var duplicates = Set<String>()
    for record in records {
      guard let id = record["plannerId"] as? String else { continue }
      if !seen.insert(id).inserted { duplicates.insert(id) }
    }
    return duplicates.sorted()
  }

  // 先完成日历准备，再暂存事件增删改并统一提交；提交成功后保存身份映射，失败时重置 EventKit 暂存状态。
  private func apply(_ root: [String: Any], operations: [[String: Any]]) throws {
    dispatchPrecondition(condition: .onQueue(syncQueue))
    let defaults = UserDefaults.standard
    var sourceMapping = defaults.dictionary(forKey: sourceCalendarMappingKey) as? [String: String] ?? [:]
    var eventMapping = defaults.dictionary(forKey: eventMappingKey) as? [String: String] ?? [:]
    let sources = root["sources"] as? [[String: Any]] ?? []
    var savedEvents: [String: EKEvent] = [:]
    // 先完成日历创建和属性更新，再暂存事件操作；否则日历的立即提交
    // 会顺带提交尚未准备完整的事件批次。
    for source in sources where source["archived"] as? Bool != true && source["appleSyncEnabled"] as? Bool != false {
      guard let sourceId = source["id"] as? String else { continue }
      _ = try getOrCreateCalendar(sourceId: sourceId, name: source["name"] as? String ?? "日程", color: source["color"] as? String, mapping: &sourceMapping)
      defaults.set(sourceMapping, forKey: sourceCalendarMappingKey)
    }
    do {
      for op in operations {
        guard let id = op["plannerId"] as? String else { throw CalendarSyncError.invalidData }
        let remoteId = op["remoteId"] as? String ?? eventMapping[id]
        let existing = remoteId.flatMap { eventStore.calendarItem(withIdentifier: $0) as? EKEvent }
        if op["kind"] as? String == "delete" {
          if let existing { try eventStore.remove(existing, span: .thisEvent, commit: false) }
          eventMapping.removeValue(forKey: id)
          continue
        }
        guard let fields = op["fields"] as? [String: Any], let sourceId = fields["sourceId"] as? String,
              let _ = sources.first(where: { $0["id"] as? String == sourceId && $0["archived"] as? Bool != true && $0["appleSyncEnabled"] as? Bool != false }),
              let start = eventStartDate(fields), let end = eventEndDate(fields, startDate: start) else { throw CalendarSyncError.invalidData }
        guard let calendarId = sourceMapping[sourceId], let calendar = eventStore.calendar(withIdentifier: calendarId) else { throw CalendarSyncError.calendarUnavailable }
        let event = existing ?? EKEvent(eventStore: eventStore)
        event.calendar = calendar; event.title = fields["title"] as? String
        event.isAllDay = fields["allDay"] as? Bool == true
        event.timeZone = event.isAllDay ? nil : .current
        event.startDate = start; event.endDate = end
        event.notes = fields["notes"] as? String; event.url = plannerEventURL(id)
        try applyReminders(fields["reminders"] as? [[String: Any]] ?? [], to: event)
        try eventStore.save(event, span: .thisEvent, commit: false)
        savedEvents[id] = event
      }
      try eventStore.commit()
      for (id, event) in savedEvents { eventMapping[id] = event.calendarItemIdentifier }
      defaults.set(eventMapping, forKey: eventMappingKey)
    } catch { eventStore.reset(); throw error }
  }

  // 特殊提醒只序列化为不可编辑的身份信息，写回时复用原始 EKAlarm；
  // 不能从简化 JSON 重建位置、邮件或其他动作提醒。
  private func alarmFields(_ alarm: EKAlarm, event: EKEvent) -> [String: Any] {
    if alarm.structuredLocation != nil || alarm.proximity.rawValue != 0 || alarm.type != .display || alarm.emailAddress != nil || alarm.soundName != nil {
      let location = alarm.structuredLocation
      let identity: [String: Any] = ["type": alarm.type.rawValue, "proximity": alarm.proximity.rawValue,
        "email": alarm.emailAddress ?? "", "sound": alarm.soundName ?? "",
        "location": location?.title ?? "", "latitude": location?.geoLocation?.coordinate.latitude ?? 0,
        "longitude": location?.geoLocation?.coordinate.longitude ?? 0, "radius": location?.radius ?? 0,
        "absolute": alarm.absoluteDate?.timeIntervalSince1970 ?? 0, "offset": alarm.relativeOffset]
      let data = try! JSONSerialization.data(withJSONObject: identity, options: [.sortedKeys])
      return ["kind": "unsupported", "identity": String(data: data, encoding: .utf8)!]
    }
    if let date = alarm.absoluteDate { return ["kind": "absolute", "timestamp": date.timeIntervalSince1970] }
    if event.isAllDay {
      let date = event.startDate.addingTimeInterval(alarm.relativeOffset)
      let days = Calendar.current.dateComponents([.day], from: Calendar.current.startOfDay(for: event.startDate), to: Calendar.current.startOfDay(for: date)).day!
      return ["kind": "day", "dayOffset": days, "time": timeFormatter.string(from: date)]
    }
    return ["kind": "relative", "offset": alarm.relativeOffset]
  }

  private func applyReminders(_ values: [[String: Any]], to event: EKEvent) throws {
    var originals = event.alarms ?? []
    let alarms: [EKAlarm] = try values.map { value in
      switch value["kind"] as? String {
      case "relative":
        guard let offset = value["offset"] as? Double, offset.isFinite else { throw CalendarSyncError.invalidData }
        return EKAlarm(relativeOffset: offset)
      case "day":
        guard let days = value["dayOffset"] as? Int, abs(days) < 3660, let time = value["time"] as? String else { throw CalendarSyncError.invalidData }
        let parts = time.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2, (0...23).contains(parts[0]), (0...59).contains(parts[1]),
          let day = Calendar.current.date(byAdding: .day, value: days, to: Calendar.current.startOfDay(for: event.startDate)),
          let date = Calendar.current.date(bySettingHour: parts[0], minute: parts[1], second: 0, of: day) else { throw CalendarSyncError.invalidData }
        return EKAlarm(relativeOffset: date.timeIntervalSince(event.startDate))
      case "absolute":
        guard let timestamp = value["timestamp"] as? Double, timestamp.isFinite else { throw CalendarSyncError.invalidData }
        return EKAlarm(absoluteDate: Date(timeIntervalSince1970: timestamp))
      case "unsupported":
        guard let index = originals.firstIndex(where: { NSDictionary(dictionary: alarmFields($0, event: event)).isEqual(to: value) }) else { throw CalendarSyncError.invalidData }
        return originals.remove(at: index)
      default: throw CalendarSyncError.invalidData
      }
    }
    event.alarms = alarms
  }

  private func getOrCreateCalendar(
    sourceId: String,
    name: String,
    color: String?,
    mapping: inout [String: String]
  ) throws -> EKCalendar {
    let title = name
    if
      let identifier = mapping[sourceId],
      let calendar = eventStore.calendar(withIdentifier: identifier),
      calendar.allowsContentModifications
    {
      var changed = false
      if calendar.title != title {
        calendar.title = title
        changed = true
      }
      if let cgColor = color.flatMap(calendarColor), !colorsMatch(calendar.cgColor, cgColor) {
        calendar.cgColor = cgColor
        changed = true
      }
      if changed {
        try eventStore.saveCalendar(calendar, commit: true)
      }
      return calendar
    }

    let defaultSource = eventStore.defaultCalendarForNewEvents?.source
    let source =
      eventStore.sources.first(where: {
        $0.sourceType == .calDAV && $0.title.localizedCaseInsensitiveContains("iCloud")
      })
      ?? (defaultSource?.sourceType == .calDAV ? defaultSource : nil)
      ?? eventStore.sources.first(where: { $0.sourceType == .calDAV })

    guard let source else {
      throw CalendarSyncError.noWritableCalendarSource
    }

    let calendar = EKCalendar(for: .event, eventStore: eventStore)
    calendar.title = title
    calendar.source = source
    calendar.cgColor = color.flatMap(calendarColor)
      ?? NSColor(calibratedRed: 0.43, green: 0.37, blue: 0.96, alpha: 1).cgColor
    try eventStore.saveCalendar(calendar, commit: true)
    mapping[sourceId] = calendar.calendarIdentifier
    return calendar
  }

  private func calendarColor(_ hex: String) -> CGColor? {
    let text = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    guard text.hasPrefix("#"), text.count == 7 else { return nil }
    let value = String(text.dropFirst())
    guard let rgb = Int(value, radix: 16) else { return nil }
    return NSColor(
      calibratedRed: CGFloat((rgb >> 16) & 0xff) / 255,
      green: CGFloat((rgb >> 8) & 0xff) / 255,
      blue: CGFloat(rgb & 0xff) / 255,
      alpha: 1
    ).cgColor
  }

  private func colorsMatch(_ first: CGColor?, _ second: CGColor) -> Bool {
    guard let first, let a = first.components, let b = second.components, a.count >= 3, b.count >= 3 else {
      return false
    }
    return zip(a.prefix(3), b.prefix(3)).allSatisfy { abs($0 - $1) < 0.01 }
  }

  private func eventStartDate(_ event: [String: Any]) -> Date? {
    guard let date = event["date"] as? String else { return nil }
    if event["allDay"] as? Bool == true {
      return dayFormatter.date(from: date)
    }
    let time = event["start"] as? String ?? "00:00"
    return dateTimeFormatter.date(from: "\(date) \(time)")
  }

  private func eventEndDate(_ event: [String: Any], startDate: Date) -> Date? {
    let endDateText = event["endDate"] as? String ?? event["date"] as? String ?? ""
    if event["allDay"] as? Bool == true {
      guard let inclusiveEnd = dayFormatter.date(from: endDateText) else { return nil }
      // EventKit 会将全天结束值归一到传入日期的结束；这里传最后覆盖日，
      // 不能直接使用 ICS 的次日零点，否则可能多覆盖一天。
      return inclusiveEnd >= startDate ? inclusiveEnd : nil
    }
    let endTime = event["end"] as? String ?? "00:30"
    guard let parsedEnd = dateTimeFormatter.date(from: "\(endDateText) \(endTime)") else { return nil }
    return parsedEnd > startDate ? parsedEnd : startDate.addingTimeInterval(30 * 60)
  }

  private func appleCalendarNotes(_ event: [String: Any]) -> String? {
    var sections: [String] = []
    if let notes = (event["notes"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !notes.isEmpty {
      sections.append(notes)
    }
    if let tags = event["tags"] as? [String], !tags.isEmpty {
      sections.append("标签：\(tags.joined(separator: "、"))")
    }
    if event["type"] as? String == "todo" {
      let status = event["status"] as? String ?? ((event["completed"] as? Bool == true) ? "done" : "open")
      let label = ["open": "未完成", "done": "已完成", "abandoned": "已放弃"][status] ?? status
      sections.append("待办状态：\(label)")
    }
    if let travelTime = event["travelTime"] as? Int, travelTime > 0 {
      sections.append("行程时间：\(travelTime) 分钟")
    }
    return sections.isEmpty ? nil : sections.joined(separator: "\n\n")
  }

  private func plannerEventURL(_ plannerId: String) -> URL? {
    var components = URLComponents()
    components.scheme = "dailyplanner"
    components.host = "event"
    components.path = "/\(plannerId)"
    return components.url
  }

  private lazy var timeFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = .current
    formatter.dateFormat = "HH:mm"
    return formatter
  }()

  private lazy var dayFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = .current
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter
  }()

  private lazy var dateTimeFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = .current
    formatter.dateFormat = "yyyy-MM-dd HH:mm"
    return formatter
  }()
}

enum CalendarSyncError: LocalizedError {
  case changedDuringSync
  case calendarUnavailable
  case permissionDenied
  case invalidData
  case noWritableCalendarSource

  var errorDescription: String? {
    switch self {
    case .changedDuringSync:
      return "Apple 日历在同步期间发生变化，已停止写入，请重试。"
    case .calendarUnavailable:
      return "专用 Apple 日历暂不可用。请检查 iCloud 账户及日历；本次不会删除本地日程。"
    case .permissionDenied:
      return "未获得日历访问权限。请在“系统设置 → 隐私与安全性 → 日历”中允许“日程”访问。"
    case .invalidData:
      return "日程数据格式不正确。"
    case .noWritableCalendarSource:
      return "没有找到可写入的 iCloud 日历账户。请先在系统日历中启用 iCloud。"
    }
  }
}

private extension String {
  var nonEmpty: String? { isEmpty ? nil : self }
}
