"""Optional desktop window; all functional UI also runs in a normal browser."""
import os
from pathlib import Path
import subprocess
import webbrowser

def open_window(url,root):
    if os.name=='nt':
        for env,fallback in [('ProgramFiles(x86)','C:/Program Files (x86)'),('ProgramFiles','C:/Program Files')]:
            edge=Path(os.environ.get(env,fallback))/'Microsoft/Edge/Application/msedge.exe'
            if edge.is_file():
                subprocess.Popen([str(edge),'--app='+url,'--window-size=1320,900',
                    '--user-data-dir='+str(root/'window-profile'),'--no-first-run'])
                return
    webbrowser.open(url)
