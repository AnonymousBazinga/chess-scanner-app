"""Prints QA results (failures, text attachments, screenshot thumbnails) to stdout.

Thumbnails are emitted as base64 JPEG between markers so results can be
reviewed from the job log alone.
"""
import base64
import json
import subprocess
import sys
from pathlib import Path

qa = Path(sys.argv[1])

for name in ("expected.json", "summary.json"):
    path = qa / name
    if path.exists():
        print(f"--- {name}\n{path.read_text()}")

manifest_path = qa / "manifest.json"
if not manifest_path.exists():
    sys.exit(0)

for test in json.loads(manifest_path.read_text()):
    print(f"\n##### {test.get('testIdentifier')}")
    for att in test.get("attachments", []):
        file = qa / att["exportedFileName"]
        label = att.get("suggestedHumanReadableName", file.name)
        if label.startswith(("Debug description", "Synthesized Event")):
            continue
        if file.suffix == ".txt":
            print(f"--- {label}\n{file.read_text(errors='replace')[:4000]}")
        elif file.suffix == ".png":
            thumb = file.with_suffix(".thumb.jpg")
            subprocess.run(["sips", "-Z", "560", "-s", "format", "jpeg", "-s", "formatOptions", "45",
                            str(file), "--out", str(thumb)], capture_output=True)
            data = base64.b64encode(thumb.read_bytes()).decode()
            print(f"@@IMG-BEGIN {label}")
            for i in range(0, len(data), 4000):
                print(data[i:i + 4000])
            print("@@IMG-END")
