# 文件用途：原生日历请求队列检查。
# 复用生产 Swift 队列逻辑检查任务串行顺序，防止多个桥接请求交错执行。
"""Exercise the production exchange queue with injected permission, without accessing calendars."""
from pathlib import Path
import subprocess, tempfile
root = Path(__file__).resolve().parents[2]
source = (root/'macos/PlannerApp/AppleCalendarSync.swift').read_text()
harness = r'''
var requests = 0
var callbacks = 0
let manager = AppleCalendarSyncManager(accessRequest: { completion in
  precondition(!Thread.isMainThread, "Permission orchestration must be off the UI thread")
  requests += 1
  completion(true, nil)
})
for _ in 0..<20 {
  manager.exchange(action: "readAppleChanges", body: ["text": "invalid-json"]) { result in
    precondition(Thread.isMainThread, "WebView callback must be delivered on the UI thread")
    guard case .failure = result else { fatalError("Invalid data must fail before accessing EventKit") }
    callbacks += 1
  }
}
let deadline = Date().addingTimeInterval(10)
while callbacks < 20 && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.01)) }
precondition(requests == 20 && callbacks == 20)
print("PASS: production exchange dispatches 20 requests off the UI thread and returns all errors on the main thread; no EventKit access")
'''
with tempfile.TemporaryDirectory() as temp:
    script = Path(temp)/'main.swift'; script.write_text(source+harness)
    subprocess.run(['swift', str(script)], check=True)
