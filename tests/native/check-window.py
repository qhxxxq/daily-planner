# 文件用途：验证生产窗口拖动、最大化及边缘缩放；使用内存窗口，不打开数据文件或同步日历。
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[2]
source = (root / 'macos/PlannerApp/main.swift').read_text().split('let app = NSApplication.shared')[0]
harness = r'''
extension AppDelegate {
  func verifyWindowDrag() {
    window = PlannerWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
                      styleMask: [.titled, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
    window.isReleasedWhenClosed = false
    webView = WKWebView(frame: window.contentView!.bounds)
    window.contentView!.addSubview(webView)
    draggableRects = windowRects([["x": 0.0, "y": 0.0, "width": 1280.0, "height": 72.0]])
    blockedDragRects = windowRects([["x": 950.0, "y": 16.0, "width": 220.0, "height": 32.0]])
    func event(_ x: CGFloat, _ y: CGFloat, number: Int? = nil) -> NSEvent {
      let local = NSPoint(x: x, y: webView.isFlipped ? y : webView.bounds.height - y)
      let location = webView.convert(local, to: nil)
      return NSEvent.mouseEvent(with: .leftMouseDown, location: location, modifierFlags: [], timestamp: 0,
                               windowNumber: number ?? window.windowNumber, context: nil,
                               eventNumber: 1, clickCount: 1, pressure: 1)!
    }
    precondition(shouldStartWindowDrag(for: event(440, 55)), "日期标题下沿应可拖动")
    precondition(shouldStartWindowDrag(for: event(640, 36)), "原先排除的中间空白应可拖动")
    precondition(shouldStartWindowDrag(for: event(1200, 36)), "右侧空白应可拖动")
    precondition(shouldStartWindowDrag(for: event(30, 55)), "侧栏工具栏空白应可拖动")
    precondition(!shouldStartWindowDrag(for: event(30, 15)), "系统窗口按钮不得拦截")
    precondition(!shouldStartWindowDrag(for: event(1000, 30)), "搜索框不得拦截")
    precondition(!shouldStartWindowDrag(for: event(440, 100)), "时间轴不得拖动窗口")
    precondition(!shouldStartWindowDrag(for: event(7, 55)), "左侧加宽把手应优先缩放")
    precondition(!shouldStartWindowDrag(for: event(1273, 55)), "右侧加宽把手应优先缩放")
    fullScreenTransition = true
    precondition(!shouldStartWindowDrag(for: event(440, 55)), "全屏动画期间禁止拖动")
    fullScreenTransition = false
    blockedDragRects.append(NSRect(x: 0, y: 0, width: 1280, height: 820))
    precondition(!shouldStartWindowDrag(for: event(440, 55)), "模态遮罩不得穿透")
    precondition(windowRects([["x": Double.nan, "y": 0.0, "width": 20.0, "height": 20.0]]).isEmpty)
    precondition(windowRects([["x": 0.0, "y": 0.0, "width": -20.0, "height": 20.0]]).isEmpty)
    installWindowResizeEdges(in: window.contentView!)
    let left = resizeEdges[0]
    let right = resizeEdges[1]
    precondition(left.hitTest(NSPoint(x: 7, y: 100)) === left)
    precondition(left.hitTest(NSPoint(x: 9, y: 100)) == nil)
    precondition(left.hitTest(NSPoint(x: 7, y: 5)) == nil, "底角交给原生窗口")
    precondition(right.hitTest(NSPoint(x: 1273, y: 100)) === right)
    fullScreenTransition = true
    precondition(left.hitTest(NSPoint(x: 7, y: 100)) == nil)
    fullScreenTransition = false
    let initial = NSRect(x: 100, y: 80, width: 1200, height: 720)
    let growLeft = WindowResizeEdge.resizedFrame(initial, delta: -40, left: true, minimum: 980, maximum: 2000)
    precondition(growLeft == NSRect(x: 60, y: 80, width: 1240, height: 720))
    let shrinkLeft = WindowResizeEdge.resizedFrame(initial, delta: 500, left: true, minimum: 980, maximum: 2000)
    precondition(shrinkLeft.width == 980 && shrinkLeft.maxX == initial.maxX)
    let growRight = WindowResizeEdge.resizedFrame(initial, delta: 40, left: false, minimum: 980, maximum: 2000)
    precondition(growRight == NSRect(x: 100, y: 80, width: 1240, height: 720))
    let shrinkRight = WindowResizeEdge.resizedFrame(initial, delta: -500, left: false, minimum: 980, maximum: 2000)
    precondition(shrinkRight.width == 980 && shrinkRight.minX == initial.minX)
    precondition(WindowResizeEdge.resizedFrame(initial, delta: 2000, left: false, minimum: 980, maximum: 2000).width == 2000)
    let available = NSScreen.main!.visibleFrame
    window.setFrame(available.insetBy(dx: available.width * 0.15, dy: available.height * 0.15), display: false)
    let original = window.frame
    toggleWindowMaximized()
    precondition(window.frame == available && !window.styleMask.contains(.fullScreen), "最大化不进入全屏")
    toggleWindowMaximized()
    precondition(window.frame == original, "再次双击恢复原来位置和大小")
    fullScreenTransition = true
    toggleWindowMaximized()
    precondition(window.frame == original)
    print("PASS: 26 production window drag, maximize and resize checks; no data-file or calendar access")
  }
}
_ = NSApplication.shared
let testDelegate = AppDelegate()
testDelegate.verifyWindowDrag()
'''
with tempfile.TemporaryDirectory() as tmp:
    script = Path(tmp) / 'main.swift'
    script.write_text(source + harness)
    binary = Path(tmp) / 'check-window'
    subprocess.run([
        'swiftc', '-framework', 'Cocoa', '-framework', 'EventKit', '-framework', 'WebKit',
        '-framework', 'UniformTypeIdentifiers', str(root / 'macos/PlannerApp/AppleCalendarSync.swift'),
        str(script), '-o', str(binary),
    ], check=True)
    subprocess.run([str(binary)], check=True)
