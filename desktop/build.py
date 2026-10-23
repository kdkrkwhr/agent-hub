"""Build on the destination OS/CPU. Outputs an app plus a platform installer."""
import argparse
import hashlib
from importlib.metadata import distributions
import json
from pathlib import Path
import platform
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'src'))
from agent_hub import __version__


def run(*args):
    subprocess.run(list(map(str, args)), cwd=ROOT, check=True)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--app-only', action='store_true')
    args=parser.parse_args()
    if sys.platform not in ('win32','darwin'):
        parser.error('Build on Windows or macOS, not by cross compilation.')
    target='windows-x64' if sys.platform=='win32' else 'macos-'+('arm64' if platform.machine()=='arm64' else 'x64')
    if sys.platform=='win32' and platform.machine().lower() not in ('amd64','x86_64'):
        parser.error('This preview requires an x64 Windows build runner.')
    out=ROOT/'dist'/target
    out.mkdir(parents=True,exist_ok=True)
    args_build=[sys.executable,'-m','PyInstaller','--noconfirm','--clean','--windowed','--onedir',
        '--name','AgentHub','--distpath',str(out),'--workpath',str(ROOT/'build'/target),
        '--specpath',str(ROOT/'build'),'--paths',str(ROOT/'src'),
        '--collect-all','agent_hub','--collect-all','webview',
        '--add-data',str(ROOT/'LICENSE')+':licenses',
        '--add-data',str(ROOT/'THIRD_PARTY_NOTICES.md')+':licenses',
        '--exclude-module','PyQt5','--exclude-module','PyQt6','--exclude-module','PySide2',
        '--exclude-module','PySide6','--exclude-module','gi']
    # Preserve dependency license texts as part of each standalone distribution.
    notices=ROOT/'build'/'dependency-licenses'
    notices.mkdir(parents=True,exist_ok=True)
    versions=[]
    for dist in distributions():
        name=dist.metadata['Name']
        if name.lower()=='agent-hub-radio':continue
        versions.append({'name':name,'version':dist.version})
        for file in dist.files or []:
            if any(word in file.name.lower() for word in ('license','copying','notice')):
                source=Path(dist.locate_file(file))
                if source.is_file():
                    dest=notices/name/str(file).replace('/','_').replace('\\','_')
                    dest.parent.mkdir(parents=True,exist_ok=True)
                    shutil.copyfile(source,dest)
    (notices/'DEPENDENCIES.json').write_text(json.dumps(versions,indent=2),encoding='utf-8')
    args_build+=['--add-data',str(notices)+':licenses/dependencies']
    if sys.platform=='win32':args_build+=['--icon',str(ROOT/'src/agent_hub/static/icon.ico')]
    else:args_build+=['--osx-bundle-identifier','io.github.kdkrkwhr.agenthub','--target-architecture',platform.machine()]
    run(*args_build,ROOT/'desktop/entry.py')
    if args.app_only:return
    if sys.platform=='win32':
        compiler=shutil.which('ISCC') or next((str(p) for p in [Path('C:/Program Files (x86)/Inno Setup 6/ISCC.exe'),Path('C:/Program Files/Inno Setup 6/ISCC.exe')] if p.is_file()),None)
        if not compiler:raise RuntimeError('Inno Setup 6 is required to create the Windows installer.')
        run(compiler,'/DAppVersion='+__version__,'/DBundleDir='+str(out/'AgentHub'),'/DOutputDir='+str(out),ROOT/'desktop/windows.iss')
    else:
        stage=ROOT/'build'/('dmg-'+target)
        stage.mkdir(parents=True,exist_ok=True)
        # ditto preserves the app bundle's symlinks and ad-hoc signatures.
        run('ditto',out/'AgentHub.app',stage/'Agent Hub Radio.app')
        applications=stage/'Applications'
        if not applications.is_symlink():applications.symlink_to('/Applications')
        run('hdiutil','create','-volname','Agent Hub Radio','-srcfolder',stage,'-ov','-format','UDZO',out/f'AgentHub-{__version__}-{target}.dmg')
    files=sorted([*out.glob('*.exe'),*out.glob('*.dmg')])
    (out/'SHA256SUMS.txt').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n' for p in files),encoding='utf-8')


if __name__=='__main__':main()
