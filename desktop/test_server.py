"""Isolated browser-test backend: replace CLI calls, never use user accounts."""
import json
from pathlib import Path
import sys
import tempfile
import time
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from agent_hub.desktop_app import running_hub


def fake(agent,config,packet,writable,folder,cancel,live,emit):
    request=packet.get('request','')
    emit('text',{'text':'Fixture agent is working.'})
    # A small delay makes running and Stop observable without external calls.
    if cancel.wait(1.5):raise RuntimeError('Fixture cancelled')
    if writable:
        workspace=Path(packet['context_bucket']['workspace_snapshot']['current_directory'])
        (workspace/'note.txt').write_text('edited in copy\n',encoding='utf-8')
    return {'reply':'Fixture response <script>window.injected=true</script>','exit_code':0}


with tempfile.TemporaryDirectory(prefix='agent-hub-browser-') as folder:
    source=Path(folder)/'project 한글';source.mkdir()
    (source/'note.txt').write_text('original\n',encoding='utf-8')
    with patch('agent_hub.adapters.discover',return_value=['fixture']),patch('agent_hub.manual_runner.execute',side_effect=fake):
        with running_hub(Path(folder)/'app data') as (_,origin):
            print(json.dumps({'origin':origin,'source':str(source)}),flush=True)
            sys.stdin.readline()
