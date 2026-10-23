"""Run the actual frozen GUI without AI requests, using disposable app storage."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--target',required=True,choices=['windows-x64','macos-arm64','macos-x64'])
args=parser.parse_args()
executable=ROOT/'dist'/args.target/('AgentHub/AgentHub.exe' if sys.platform=='win32' else 'AgentHub.app/Contents/MacOS/AgentHub')
reports=ROOT/'runtime/desktop-smoke'
reports.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(prefix='agent-hub-smoke-') as folder:
    # Exercise spaces and non-ASCII paths and reopen the same persisted data root.
    root=Path(folder)/'test data 한글'
    for iteration in (1,2):
        report=reports/f'{args.target}-{iteration}.json'
        result=subprocess.run([str(executable),'--data-dir',str(root),'--smoke-report',str(report)],timeout=90)
        data=json.loads(report.read_text(encoding='utf-8')) if report.exists() else {}
        if result.returncode or not data.get('ok') or not data.get('shutdown'):
            raise RuntimeError(f'Native smoke failed ({result.returncode}): {data}')
        print(json.dumps(data,ensure_ascii=True))
    assert (root/'database/queue.sqlite3').is_file()
