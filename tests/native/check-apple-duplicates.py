# 文件用途：原生日历重复标识检查。
# 复用生产 Swift 检测逻辑构造重复标识场景，验证受阻记录识别，不执行真实日历同步。
"""Exercise production duplicate detection without calendar access or writes."""
from pathlib import Path
import subprocess, tempfile
root = Path(__file__).resolve().parents[2]
source = (root / 'macos/PlannerApp/AppleCalendarSync.swift').read_text()
harness = r'''
extension AppleCalendarSyncManager {
  func verifyDuplicates() {
    let records: [[String: Any]] = [
      ["plannerId": "a", "remoteId": "r1", "sourceId": "s1"],
      ["plannerId": "b", "remoteId": "r2", "sourceId": "s1"],
      ["plannerId": "a", "remoteId": "r3", "sourceId": "s2"]
    ]
    precondition(duplicatePlannerIds(records) == ["a"])
    precondition(duplicatePlannerIds([records[0], ["plannerId": "a", "remoteId": "copy", "sourceId": "s1"]]) == ["a"])
    precondition(duplicatePlannerIds(Array(records.reversed())) == ["a"])
    precondition(duplicatePlannerIds(Array(records.prefix(2))).isEmpty)
    print("PASS: production duplicate identity detection within/across calendars; no EventKit access")
  }
}
AppleCalendarSyncManager().verifyDuplicates()
'''
with tempfile.TemporaryDirectory() as tmp:
    script = Path(tmp) / 'main.swift'
    script.write_text(source + harness)
    subprocess.run(['swift', str(script)], check=True)
