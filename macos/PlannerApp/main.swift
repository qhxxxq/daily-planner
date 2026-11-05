/**
 * 文件用途：Mac 原生应用外壳。
 * 创建窗口和 WKWebView，加载打包网页并接收文件桥接消息；处理本地文件操作、备份和 Apple 日历请求转发。
 */
import Cocoa
import EventKit
import UniformTypeIdentifiers
import WebKit

/** 顶部双击的窗口缩放使用短促的原生过渡，避免尺寸瞬间跳变。 */
final class PlannerWindow: NSWindow {
  override func animationResizeTime(_ newFrame: NSRect) -> TimeInterval { 0.20 }
}

/** 给左右边缘增加透明缩放把手，保留系统顶部、底部角落的原生行为。 */
final class WindowResizeEdge: NSView {
  static let hitWidth: CGFloat = 8
  var isLeftEdge = false
  var isEnabled: () -> Bool = { true }

  override func hitTest(_ point: NSPoint) -> NSView? {
    guard isEnabled(), let parent = superview else { return nil }
    let local = convert(point, from: parent)
    guard bounds.insetBy(dx: 0, dy: 14).contains(local) else { return nil }
    return self
  }

  override func resetCursorRects() {
    if isEnabled() { addCursorRect(bounds.insetBy(dx: 0, dy: 14), cursor: .resizeLeftRight) }
  }

  static func resizedFrame(_ initial: NSRect, delta: CGFloat, left: Bool, minimum: CGFloat, maximum: CGFloat) -> NSRect {
    let width = min(maximum, max(minimum, initial.width + (left ? -delta : delta)))
    return NSRect(x: left ? initial.maxX - width : initial.minX, y: initial.minY, width: width, height: initial.height)
  }

  override func mouseDown(with event: NSEvent) {
    guard isEnabled(), let window else { return }
    let initial = window.frame
    let start = window.convertPoint(toScreen: event.locationInWindow)
    while let next = window.nextEvent(matching: [.leftMouseDragged, .leftMouseUp]) {
      if next.type == .leftMouseUp { break }
      let pointer = window.convertPoint(toScreen: next.locationInWindow)
      let frame = Self.resizedFrame(initial, delta: pointer.x - start.x, left: isLeftEdge,
                                    minimum: window.minSize.width, maximum: window.maxSize.width)
      window.setFrame(frame, display: true)
    }
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKUIDelegate, WKNavigationDelegate, WKScriptMessageHandler {
  private let dataFilePathKey = "DailyPlannerDataFilePath"
  private var window: NSWindow!
  private var webView: WKWebView!
  private var draggableRects: [NSRect] = []
  private var blockedDragRects: [NSRect] = []
  private var fullScreenMenuItem: NSMenuItem!
  private var fullScreenTransition = false
  private var dragEventMonitor: Any?
  private var frameBeforeMaximize: NSRect?
  private var resizeEdges: [WindowResizeEdge] = []
  private let appleCalendarSyncManager = AppleCalendarSyncManager()

  func applicationDidFinishLaunching(_ notification: Notification) {
    installMainMenu()

    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .default()
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
    configuration.userContentController.add(self, name: "plannerFile")
    configuration.userContentController.add(self, name: "plannerWindow")

    webView = WKWebView(frame: .zero, configuration: configuration)
    webView.uiDelegate = self
    webView.navigationDelegate = self
    webView.allowsBackForwardNavigationGestures = true

    window = PlannerWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
      backing: .buffered,
      defer: false
    )
    window.title = "日程"
    window.delegate = self
    window.collectionBehavior.insert(.fullScreenPrimary)
    window.titleVisibility = .hidden
    window.titlebarAppearsTransparent = true
    window.backgroundColor = .white
    window.isMovableByWindowBackground = false
    if #available(macOS 11.0, *) {
      window.titlebarSeparatorStyle = .none
    }
    window.minSize = NSSize(width: 980, height: 640)
    window.setFrameAutosaveName("DailyPlannerMainWindow")
    if !window.setFrameUsingName("DailyPlannerMainWindow") {
      window.center()
    }

    let contentView = NSView(frame: window.contentView?.bounds ?? .zero)
    contentView.autoresizingMask = [.width, .height]
    window.contentView = contentView

    webView.translatesAutoresizingMaskIntoConstraints = false
    contentView.addSubview(webView)
    NSLayoutConstraint.activate([
      webView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
      webView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
      webView.topAnchor.constraint(equalTo: contentView.topAnchor),
      webView.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
    ])
    installWindowResizeEdges(in: contentView)

    window.makeKeyAndOrderFront(nil)
    installWindowDragMonitor()

    guard
      let resourceURL = Bundle.main.resourceURL,
      let indexURL = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web")
    else {
      showFatalError("无法找到应用资源。")
      return
    }

    webView.loadFileURL(indexURL, allowingReadAccessTo: resourceURL.appendingPathComponent("web"))
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    true
  }

  func applicationWillTerminate(_ notification: Notification) {
    if let dragEventMonitor {
      NSEvent.removeMonitor(dragEventMonitor)
    }
    webView?.configuration.userContentController.removeScriptMessageHandler(forName: "plannerFile")
    webView?.configuration.userContentController.removeScriptMessageHandler(forName: "plannerWindow")
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    publishWindowState()
  }

  func webView(
    _ webView: WKWebView,
    runJavaScriptAlertPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping () -> Void
  ) {
    let alert = NSAlert()
    alert.messageText = message
    alert.addButton(withTitle: "好")
    alert.beginSheetModal(for: window) { _ in completionHandler() }
  }

  func webView(
    _ webView: WKWebView,
    runJavaScriptConfirmPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping (Bool) -> Void
  ) {
    let alert = NSAlert()
    alert.messageText = message
    alert.addButton(withTitle: "确认")
    alert.addButton(withTitle: "取消")
    alert.beginSheetModal(for: window) { response in
      completionHandler(response == .alertFirstButtonReturn)
    }
  }

  func webView(
    _ webView: WKWebView,
    runJavaScriptTextInputPanelWithPrompt prompt: String,
    defaultText: String?,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping (String?) -> Void
  ) {
    let alert = NSAlert()
    alert.messageText = prompt
    alert.addButton(withTitle: "确认")
    alert.addButton(withTitle: "取消")

    let input = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
    input.stringValue = defaultText ?? ""
    alert.accessoryView = input

    alert.beginSheetModal(for: window) { response in
      completionHandler(response == .alertFirstButtonReturn ? input.stringValue : nil)
    }
  }

  func webView(
    _ webView: WKWebView,
    runOpenPanelWith parameters: WKOpenPanelParameters,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping ([URL]?) -> Void
  ) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection
    panel.canChooseDirectories = parameters.allowsDirectories
    panel.canChooseFiles = true
    panel.beginSheetModal(for: window) { response in
      completionHandler(response == .OK ? panel.urls : nil)
    }
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    if message.name == "plannerWindow", message.frameInfo.isMainFrame,
       let body = message.body as? [String: Any] {
      switch body["action"] as? String {
      case "updateDragRegions":
        draggableRects = windowRects(body["regions"])
        blockedDragRects = windowRects(body["blocked"])
      case "toggleFullScreen": toggleFullScreen(nil)
      case "setAppearance":
        let dark = body["dark"] as? Bool == true
        NSApp.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.backgroundColor = dark ? NSColor(calibratedWhite: 0.094, alpha: 1) : .white
      case "getState": publishWindowState()
      default: break
      }
      return
    }
    guard
      message.name == "plannerFile",
      let body = message.body as? [String: Any],
      let id = body["id"] as? String,
      let action = body["action"] as? String
    else { return }

    switch action {
    case "open":
      openDataFile(requestId: id)
    case "save":
      saveDataFile(requestId: id, body: body)
    case "restore":
      restoreDataFile(requestId: id)
    case "fetchIcs":
      fetchIcsFile(requestId: id, body: body)
    case "readAppleChanges", "applyAppleChanges":
      appleCalendarSyncManager.exchange(action: action, body: body) { [weak self] result in
        switch result {
        case .success(var value): value["ok"] = true; self?.respondToFileRequest(id, value)
        case .failure(let error):
          let nsError = error as NSError
          self?.respondToFileRequest(id, ["ok": false, "error": error.localizedDescription, "errorCode": "\(nsError.domain):\(nsError.code)"])
        }
      }
    case "recordSyncError":
      do {
        let directory = try backupDirectory().deletingLastPathComponent().appendingPathComponent("Diagnostics", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent("sync-errors.json")
        var entries = ((try? Data(contentsOf: url)).flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [[String: Any]]) ?? []
        if let entry = body["entry"] as? [String: Any] { entries.insert(entry, at: 0) }
        try JSONSerialization.data(withJSONObject: Array(entries.prefix(100)), options: [.prettyPrinted, .sortedKeys]).write(to: url, options: .atomic)
        respondToFileRequest(id, ["ok": true])
      } catch { respondToFileRequest(id, ["ok": false, "error": error.localizedDescription]) }
    case "backup":
      do { try backupData(body["text"] as? String ?? ""); respondToFileRequest(id, ["ok": true]) }
      catch { respondToFileRequest(id, ["ok": false, "error": error.localizedDescription]) }
    case "showBackups":
      do { NSWorkspace.shared.open(try backupDirectory()); respondToFileRequest(id, ["ok": true]) }
      catch { respondToFileRequest(id, ["ok": false, "error": error.localizedDescription]) }
    default:
      respondToFileRequest(id, ["ok": false, "error": "未知文件操作"])
    }
  }

  private func openDataFile(requestId id: String) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = false
    panel.canChooseDirectories = false
    panel.canChooseFiles = true
    panel.allowedContentTypes = [.json]
    panel.beginSheetModal(for: window) { [weak self] response in
      guard let self else { return }
      guard response == .OK, let url = panel.url else {
        self.respondToFileRequest(id, ["ok": true, "canceled": true])
        return
      }
      self.readAndRememberDataFile(url, requestId: id)
    }
  }

  private func saveDataFile(requestId id: String, body: [String: Any]) {
    let text = body["text"] as? String ?? ""
    let path = body["path"] as? String ?? ""
    if !path.isEmpty {
      writeDataFile(text, to: URL(fileURLWithPath: path), requestId: id)
      return
    }

    let panel = NSSavePanel()
    panel.allowedContentTypes = [.json]
    panel.nameFieldStringValue = body["suggestedName"] as? String ?? "daily-planner-data.json"
    panel.beginSheetModal(for: window) { [weak self] response in
      guard let self else { return }
      guard response == .OK, let url = panel.url else {
        self.respondToFileRequest(id, ["ok": true, "canceled": true])
        return
      }
      self.writeDataFile(text, to: url, requestId: id)
    }
  }

  private func restoreDataFile(requestId id: String) {
    guard let path = UserDefaults.standard.string(forKey: dataFilePathKey), !path.isEmpty else {
      respondToFileRequest(id, ["ok": true, "canceled": true])
      return
    }
    readAndRememberDataFile(URL(fileURLWithPath: path), requestId: id)
  }

  private func fetchIcsFile(requestId id: String, body: [String: Any]) {
    guard
      let text = body["url"] as? String,
      let url = URL(string: text),
      ["http", "https"].contains(url.scheme?.lowercased() ?? "")
    else {
      respondToFileRequest(id, ["ok": false, "error": "URL 格式不正确"])
      return
    }

    var request = URLRequest(url: url)
    request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    request.timeoutInterval = 30

    URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
      DispatchQueue.main.async {
        guard let self else { return }
        if let error {
          self.respondToFileRequest(id, ["ok": false, "error": error.localizedDescription])
          return
        }
        if let httpResponse = response as? HTTPURLResponse,
           !(200...299).contains(httpResponse.statusCode) {
          self.respondToFileRequest(id, ["ok": false, "error": "HTTP \(httpResponse.statusCode)"])
          return
        }
        guard
          let data,
          let text = String(data: data, encoding: .utf8)
        else {
          self.respondToFileRequest(id, ["ok": false, "error": "无法读取日历内容"])
          return
        }
        self.respondToFileRequest(id, ["ok": true, "text": text])
      }
    }.resume()
  }

  private func backupDirectory() throws -> URL {
    let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    let directory = base.appendingPathComponent("DailyPlanner/Backups", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
  }

  private func backupData(_ text: String) throws {
    guard let data = text.data(using: .utf8), let root = try JSONSerialization.jsonObject(with: data) as? [String: Any], root["events"] is [Any] else { throw CalendarSyncError.invalidData }
    let directory = try backupDirectory()
    let name = "planner-\(Int(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString.prefix(8)).json"
    try text.write(to: directory.appendingPathComponent(name), atomically: true, encoding: .utf8)
    let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
      .filter { $0.lastPathComponent.hasPrefix("planner-") && $0.pathExtension == "json" }
      .sorted { $0.lastPathComponent > $1.lastPathComponent }
    var days = Set<String>()
    for file in files.dropFirst(50) {
      let parts = file.deletingPathExtension().lastPathComponent.split(separator: "-")
      let timestamp = parts.count > 1 ? Double(parts[1]) ?? 0 : 0
      let date = Date(timeIntervalSince1970: timestamp / 1000)
      let day = ISO8601DateFormatter().string(from: date).prefix(10)
      let age = Date().timeIntervalSince(date)
      if age < 14 * 86400 && days.insert(String(day)).inserted { continue }
      try FileManager.default.removeItem(at: file)
    }
  }

  private func readAndRememberDataFile(_ url: URL, requestId id: String) {
    do {
      let text = try String(contentsOf: url, encoding: .utf8)
      UserDefaults.standard.set(url.path, forKey: dataFilePathKey)
      respondToFileRequest(id, [
        "ok": true,
        "name": url.lastPathComponent,
        "path": url.path,
        "text": text,
      ])
    } catch {
      respondToFileRequest(id, ["ok": false, "error": error.localizedDescription])
    }
  }

  private func writeDataFile(_ text: String, to url: URL, requestId id: String) {
    do {
      if FileManager.default.fileExists(atPath: url.path) {
        let old = try String(contentsOf: url, encoding: .utf8)
        if old != text { try backupData(old) }
      }
      try text.write(to: url, atomically: true, encoding: .utf8)
      UserDefaults.standard.set(url.path, forKey: dataFilePathKey)
      respondToFileRequest(id, [
        "ok": true,
        "name": url.lastPathComponent,
        "path": url.path,
      ])
    } catch {
      respondToFileRequest(id, ["ok": false, "error": error.localizedDescription])
    }
  }

  private func respondToFileRequest(_ id: String, _ response: [String: Any]) {
    guard
      let idData = try? JSONEncoder().encode(id),
      let idJSON = String(data: idData, encoding: .utf8),
      let responseData = try? JSONSerialization.data(withJSONObject: response),
      let responseJSON = String(data: responseData, encoding: .utf8)
    else { return }
    webView.evaluateJavaScript("window.__plannerFileBridgeResolve(\(idJSON), \(responseJSON))", completionHandler: nil)
  }

  private func showFatalError(_ message: String) {
    let alert = NSAlert()
    alert.messageText = message
    alert.alertStyle = .critical
    alert.runModal()
    NSApp.terminate(nil)
  }

  private func showInformation(_ message: String, detail: String) {
    let alert = NSAlert()
    alert.messageText = message
    alert.informativeText = detail
    alert.addButton(withTitle: "好")
    if window.attachedSheet == nil {
      alert.beginSheetModal(for: window)
    }
  }

  private func installMainMenu() {
    let mainMenu = NSMenu()

    let appMenuItem = NSMenuItem()
    mainMenu.addItem(appMenuItem)
    let appMenu = NSMenu()
    appMenuItem.submenu = appMenu
    appMenu.addItem(
      NSMenuItem(
        title: "退出日程",
        action: #selector(NSApplication.terminate(_:)),
        keyEquivalent: "q"
      )
    )
    appMenu.addItem(.separator())
    appMenu.addItem(
      NSMenuItem(
        title: "立即同步到 Apple 日历",
        action: #selector(syncAppleCalendarFromMenu(_:)),
        keyEquivalent: "s"
      )
    )

    let editMenuItem = NSMenuItem()
    mainMenu.addItem(editMenuItem)
    let editMenu = NSMenu(title: "编辑")
    editMenuItem.submenu = editMenu
    editMenu.addItem(NSMenuItem(title: "撤销", action: Selector(("undo:")), keyEquivalent: "z"))
    editMenu.addItem(NSMenuItem(title: "重做", action: Selector(("redo:")), keyEquivalent: "Z"))
    editMenu.addItem(.separator())
    editMenu.addItem(NSMenuItem(title: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x"))
    editMenu.addItem(NSMenuItem(title: "复制", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
    editMenu.addItem(NSMenuItem(title: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v"))
    editMenu.addItem(NSMenuItem(title: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))

    let viewMenuItem = NSMenuItem()
    mainMenu.addItem(viewMenuItem)
    let viewMenu = NSMenu(title: "显示")
    viewMenuItem.submenu = viewMenu
    fullScreenMenuItem = NSMenuItem(title: "进入全屏", action: #selector(toggleFullScreen(_:)), keyEquivalent: "f")
    fullScreenMenuItem.keyEquivalentModifierMask = [.control, .command]
    fullScreenMenuItem.target = self
    viewMenu.addItem(fullScreenMenuItem)

    NSApp.mainMenu = mainMenu
  }

  @objc private func syncAppleCalendarFromMenu(_ sender: Any?) {
    webView.evaluateJavaScript("window.__syncPlannerToAppleCalendar?.()", completionHandler: nil)
  }

  private func installWindowDragMonitor() {
    dragEventMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown]) { [weak self] event in
      guard let self, self.shouldStartWindowDrag(for: event) else { return event }
      if event.clickCount == 2 {
        self.toggleWindowMaximized()
      } else {
        self.window.performDrag(with: event)
      }
      return nil
    }
  }

  private func shouldStartWindowDrag(for event: NSEvent) -> Bool {
    guard event.window === window, window.attachedSheet == nil,
          !window.styleMask.contains(.fullScreen), !fullScreenTransition else { return false }
    let local = webView.convert(event.locationInWindow, from: nil)
    // 网页矩形使用左上原点；WebView 坐标是否翻转由 AppKit 决定。
    let point = NSPoint(x: local.x, y: webView.isFlipped ? local.y : webView.bounds.height - local.y)
    if point.x < WindowResizeEdge.hitWidth || point.x >= webView.bounds.width - WindowResizeEdge.hitWidth { return false }
    if point.x < 116 && point.y < 32 { return false }
    return draggableRects.contains { $0.contains(point) }
      && !blockedDragRects.contains { $0.contains(point) }
  }

  private func installWindowResizeEdges(in contentView: NSView) {
    for left in [true, false] {
      let edge = WindowResizeEdge(frame: NSRect(x: left ? 0 : contentView.bounds.width - WindowResizeEdge.hitWidth,
                                               y: 0, width: WindowResizeEdge.hitWidth, height: contentView.bounds.height))
      edge.isLeftEdge = left
      edge.autoresizingMask = left ? [.height, .maxXMargin] : [.height, .minXMargin]
      edge.isEnabled = { [weak self] in
        guard let self else { return false }
        return !self.fullScreenTransition && !self.window.styleMask.contains(.fullScreen) && self.window.attachedSheet == nil
      }
      contentView.addSubview(edge)
      resizeEdges.append(edge)
    }
  }

  private func toggleWindowMaximized() {
    guard !fullScreenTransition, !window.styleMask.contains(.fullScreen), window.attachedSheet == nil,
          let screen = window.screen else { return }
    let available = screen.visibleFrame
    let current = window.frame
    let fillsScreen = abs(current.minX - available.minX) < 1 && abs(current.minY - available.minY) < 1
      && abs(current.width - available.width) < 1 && abs(current.height - available.height) < 1
    if fillsScreen {
      var restored = frameBeforeMaximize ?? available.insetBy(dx: available.width * 0.1, dy: available.height * 0.1)
      restored.size.width = min(available.width, max(window.minSize.width, restored.width))
      restored.size.height = min(available.height, max(window.minSize.height, restored.height))
      restored.origin.x = min(max(restored.minX, available.minX), available.maxX - restored.width)
      restored.origin.y = min(max(restored.minY, available.minY), available.maxY - restored.height)
      window.setFrame(restored, display: true, animate: !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion)
      frameBeforeMaximize = nil
    } else {
      frameBeforeMaximize = current
      window.setFrame(available, display: true, animate: !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion)
    }
  }

  func windowDidResize(_ notification: Notification) {
    for edge in resizeEdges { window.invalidateCursorRects(for: edge) }
  }

  private func windowRects(_ value: Any?) -> [NSRect] {
    (value as? [[String: Double]] ?? []).compactMap { rect in
      guard let x = rect["x"], let y = rect["y"], let width = rect["width"], let height = rect["height"],
            [x, y, width, height].allSatisfy({ $0.isFinite }), width > 0, height > 0 else { return nil }
      return NSRect(x: x, y: y, width: width, height: height)
    }
  }

  @objc private func toggleFullScreen(_ sender: Any?) {
    guard !fullScreenTransition else { return }
    window.toggleFullScreen(sender)
  }

  func windowWillEnterFullScreen(_ notification: Notification) { fullScreenTransition = true }
  func windowWillExitFullScreen(_ notification: Notification) { fullScreenTransition = true }
  func windowDidEnterFullScreen(_ notification: Notification) { finishFullScreenTransition() }
  func windowDidExitFullScreen(_ notification: Notification) { finishFullScreenTransition() }
  func windowDidFailToEnterFullScreen(_ window: NSWindow) { finishFullScreenTransition() }
  func windowDidFailToExitFullScreen(_ window: NSWindow) { finishFullScreenTransition() }

  private func finishFullScreenTransition() {
    fullScreenTransition = false
    for edge in resizeEdges { window.invalidateCursorRects(for: edge) }
    publishWindowState()
  }

  private func publishWindowState() {
    let fullScreen = window.styleMask.contains(.fullScreen)
    fullScreenMenuItem.title = fullScreen ? "退出全屏" : "进入全屏"
    webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('planner-window-state', { detail: { fullScreen: \(fullScreen) } }))", completionHandler: nil)
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.activate(ignoringOtherApps: true)
app.run()
