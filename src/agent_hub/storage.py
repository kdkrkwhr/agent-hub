"""Versioned data paths; legacy data roots stay readable until explicitly migrated."""
import json
import os
from pathlib import Path

LOCATIONS={'config.json':'config/config.json','queue.sqlite3':'database/queue.sqlite3','runs':'logs/runs','model-catalog.json':'cache/model-catalog.json','codex-boundary-trust.json':'config/codex-boundary-trust.json','window-profile':'cache/window-profile'}

def path(root,name):
    root=Path(root)
    return root/(LOCATIONS.get(name,name) if (root/'storage.json').exists() else name)

def root_for_run(folder):
    folder=Path(folder)
    for parent in folder.parents:
        if (parent/'storage.json').exists() or (parent/'queue.sqlite3').exists():return parent
    return folder.parent.parent

def initialize(root):
    from .config import atomic_json
    root=Path(root);root.mkdir(parents=True,exist_ok=True)
    if (root/'config.json').exists() or (root/'queue.sqlite3').exists():raise ValueError('기존 데이터는 먼저 이전해야 합니다.')
    for name in ('config','database','logs/runs','logs/server','workspaces','artifacts','backups','cache','coral'):(root/name).mkdir(parents=True,exist_ok=True)
    atomic_json(root/'storage.json',{'version':2})

def pointer_path():
    from .config import default_data_directory
    return default_data_directory().parent/'AgentHubLauncher'/'location.json'

def remembered():
    p=pointer_path()
    if not p.exists():return None
    value=Path(json.loads(p.read_text(encoding='utf-8'))['data_directory'])
    if not (value/'storage.json').is_file():raise RuntimeError('저장 폴더를 찾을 수 없습니다. --data-dir로 위치를 지정하세요.')
    return value

def remember(root):
    from .config import atomic_json
    root=Path(root).resolve()
    if not (root/'storage.json').is_file():raise ValueError('새 데이터 구조가 필요합니다.')
    atomic_json(pointer_path(),{'data_directory':str(root)})

def choose(default):
    try:
        import tkinter as tk
        from tkinter import filedialog
        app=tk.Tk();app.withdraw()
        try:value=filedialog.askdirectory(title='AGENT HUB 데이터 저장 폴더 선택',initialdir=str(Path(default).parent),mustexist=False)
        finally:app.destroy()
    except Exception as exc:raise RuntimeError('폴더 선택기를 열 수 없습니다. --data-dir로 저장 위치를 지정하세요.') from exc
    if not value:raise RuntimeError('저장 폴더 선택을 취소했습니다.')
    root=Path(value).resolve()
    if root.exists() and any(root.iterdir()) and not (root/'storage.json').exists():raise RuntimeError('빈 폴더 또는 기존 AGENT HUB 저장 폴더를 선택하세요.')
    initialize(root);remember(root);return root
