"""Summarizes QA results from an exported xcresult.

Prints failures and text attachments, and with --export DIR also writes
named, downscaled screenshots plus results.txt into DIR so they can be
published (CI pushes DIR to refs/qa/latest for review).
"""
import argparse
import json
import re
import shutil
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("qa_dir", type=Path)
parser.add_argument("--export", type=Path)
parser.add_argument("--crash-dir", type=Path)
args = parser.parse_args()

qa = args.qa_dir
report: list[str] = []


def emit(text: str = "") -> None:
    print(text)
    report.append(text)


for name in ("expected.json", "summary.json"):
    path = qa / name
    if path.exists():
        emit(f"--- {name}\n{path.read_text()}")

manifest_path = qa / "manifest.json"
tests = json.loads(manifest_path.read_text()) if manifest_path.exists() else []
if args.export:
    args.export.mkdir(parents=True, exist_ok=True)

for test in tests:
    test_name = test.get("testIdentifier", "unknown").split("/")[-1].replace("()", "")
    emit(f"\n##### {test_name}")
    for att in test.get("attachments", []):
        file = qa / att["exportedFileName"]
        label = att.get("suggestedHumanReadableName", file.name)
        if label.startswith(("Debug description", "Synthesized Event")):
            continue
        clean = re.sub(r"_\d+_[0-9A-F-]{36}", "", label)
        if file.suffix == ".txt":
            emit(f"--- {clean}\n{file.read_text(errors='replace')[:4000]}")
        elif file.suffix == ".mp4" and args.export:
            # Xcode records each test's screen; keep it so the flow can be watched.
            shutil.copy(file, args.export / f"{test_name}--recording.mp4")
        elif file.suffix == ".png" and args.export:
            out = args.export / f"{test_name}--{Path(clean).stem}.jpg"
            subprocess.run(["sips", "-Z", "900", "-s", "format", "jpeg", "-s", "formatOptions", "70",
                            str(file), "--out", str(out)], capture_output=True)

if args.crash_dir and args.crash_dir.exists():
    for crash in sorted(args.crash_dir.glob("*Chess*"))[-2:]:
        emit(f"\n=== CRASH {crash.name}\n{crash.read_text(errors='replace')[:20000]}")

log = qa / "xcodebuild.log"
if log.exists():
    errors = [l for l in log.read_text(errors="replace").splitlines()
              if re.search(r"error:|\*\* (BUILD|TEST) (FAILED|SUCCEEDED)|XCTAssert|failed \(", l)]
    emit("\n--- xcodebuild errors/failures\n" + "\n".join(errors[:200]))

if args.export:
    (args.export / "results.txt").write_text("\n".join(report))
    if log.exists():
        shutil.copy(log, args.export / "xcodebuild.log")
