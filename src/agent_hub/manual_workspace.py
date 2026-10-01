"""Manual workspaces: existing Git copies or stdlib-only folder snapshots."""
import difflib
import fnmatch
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import zipfile

from . import pipeline_workspace as git_workspace
from .pipeline_workspace import command_line, run_check
from .config import atomic_json

DEFAULT_IGNORES = ('.git', '.hg', '.svn', 'node_modules', '.venv', 'venv', '__pycache__',
                   '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', '.gradle',
                   '.env', '.env.*', '.aws', '.ssh')
MAX_FILE_BYTES = 32 * 1024 * 1024
MAX_TREE_BYTES = 256 * 1024 * 1024
MAX_ENTRIES = 20000


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode('utf-8')).hexdigest()


def read_file(path):
    with Path(path).open('rb') as stream:
        data = stream.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise ValueError('파일 32MB 한도를 초과했습니다. .agent-hub-ignore로 불필요한 경로를 제외하세요.')
    return data


def is_folder(base):
    return base is None or base.startswith('folder:')


def project_key(source):
    # Match existing pipeline project identities without requiring the Git executable.
    for parent in (source, *source.parents):
        marker = parent / '.git'
        if marker.is_dir():
            return os.path.normcase(str(marker.resolve()))
        if marker.is_file():
            value = marker.read_text(encoding='utf-8').strip()
            if value.startswith('gitdir: '):
                directory = (parent / value[8:]).resolve()
                common = directory / 'commondir'
                if common.is_file():
                    directory = (directory / common.read_text(encoding='utf-8').strip()).resolve()
                return os.path.normcase(str(directory))
    return os.path.normcase(str(source))


def source_info(value, mode='auto'):
    if not isinstance(value, str) or not value.strip():
        raise ValueError('작업할 폴더 경로를 입력하세요.')
    source = Path(value).expanduser().resolve()
    if not source.is_dir():
        raise ValueError('대상 폴더를 찾을 수 없습니다.')
    if mode not in ('auto', 'folder'):
        raise ValueError('지원하지 않는 작업 폴더 방식입니다.')
    project = project_key(source)
    has_git = any((p / '.git').exists() for p in (source, *source.parents))
    if mode == 'auto' and has_git and shutil.which('git'):
        try:
            return git_workspace.source_info(str(source))
        except ValueError as exc:
            if str(exc).startswith('미커밋 변경'):
                raise ValueError('미커밋 변경이 있습니다. --folder 옵션이나 chat.cmd로 현재 파일 상태를 복사해 시작할 수 있습니다.') from None
            raise
    return str(source), project, None


def ignores(source):
    path = Path(source) / '.agent-hub-ignore'
    patterns = list(DEFAULT_IGNORES)
    if path.exists():
        safe_file(Path(source), path)
        if path.stat().st_size > 65536:
            raise ValueError('.agent-hub-ignore는 64KB 이하여야 합니다.')
        for line in path.read_text(encoding='utf-8-sig').splitlines():
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if line.startswith('!') or '\\' in line or '..' in line.split('/'):
                raise ValueError('.agent-hub-ignore에는 /로 구분한 상대 경로·glob만 입력하세요. ! 재포함은 지원하지 않습니다.')
            patterns.append(line.strip('/'))
    return patterns


def safe_file(root, path):
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 1024):
        raise ValueError('폴더 사본에서는 심볼릭 링크·정션을 지원하지 않습니다: ' + str(path.relative_to(root)))
    if not path.resolve().is_relative_to(root) or not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)):
        raise ValueError('작업 폴더 안의 일반 파일·디렉터리만 지원합니다.')
    return info


def scan(root, patterns, directories=None):
    root = Path(root).absolute()
    if not root.is_dir():
        raise ValueError('작업 사본 폴더를 찾을 수 없습니다.')
    safe_file(root, root)
    root = root.resolve()
    files, omitted, total, entries = {}, [], 0, 0
    pending = [root]
    while pending:
        directory = pending.pop()
        for path in sorted(directory.iterdir()):
            name = path.relative_to(root).as_posix()
            entries += 1
            if entries > MAX_ENTRIES:
                raise ValueError('작업 폴더의 파일·디렉터리가 20,000개를 초과했습니다. .agent-hub-ignore로 불필요한 경로를 제외하세요.')
            if any(fnmatch.fnmatch(name if '/' in p else path.name, p) for p in patterns):
                omitted.append(name)
                continue
            info = safe_file(root, path)
            if stat.S_ISDIR(info.st_mode):
                if directories is not None:
                    directories.append(name)
                pending.append(path)
                continue
            total += info.st_size
            if info.st_size > MAX_FILE_BYTES or total > MAX_TREE_BYTES:
                raise ValueError('파일 32MB 또는 폴더 256MB 한도를 초과했습니다. .agent-hub-ignore로 불필요한 경로를 제외하세요.')
            data = read_file(path)
            if len(data) != info.st_size:
                raise ValueError('폴더 확인 중 파일 크기가 바뀌었습니다. 다시 시도하세요.')
            files[name] = {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data), 'mode': stat.S_IMODE(info.st_mode)}
    return files, sorted(omitted)


def metadata(folder, base):
    if base is None:
        raise ValueError('작업 사본 준비가 완료되지 않았습니다. 새 세션을 시작하세요.')
    value = json.loads((Path(folder).parent / 'baseline.json').read_text(encoding='utf-8'))
    if 'folder:' + digest(value) != base:
        raise ValueError('보관된 시작 스냅샷 정보가 변경되었습니다. 새 세션을 시작하세요.')
    return value


def prepare(source, base, target):
    if not is_folder(base):
        return base, git_workspace.prepare(source, base, target)
    source, target = Path(source).resolve(), Path(target).resolve()
    if target.exists() or target.is_relative_to(source):
        raise ValueError('작업 사본은 원본 폴더 밖의 새 경로여야 합니다. --data-dir로 별도 데이터 폴더를 지정하세요.')
    patterns = ignores(source)
    directories = []
    initial, omitted = scan(source, patterns, directories)
    target.mkdir(parents=True)
    for name in directories:
        (target / name).mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(target.parent / 'baseline.zip', 'x', zipfile.ZIP_DEFLATED) as archive:
        for name, info in initial.items():
            original = source / name
            safe_file(source, original)
            data = read_file(original)
            if hashlib.sha256(data).hexdigest() != info['sha256']:
                raise ValueError('복사 중 원본이 변경되었습니다. 새 세션으로 다시 시작하세요.')
            destination = target / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
            destination.chmod(info['mode'])
            archive.writestr(name, data)
    if scan(source, patterns)[0] != initial or scan(target, patterns)[0] != initial:
        raise ValueError('복사 중 파일이 변경되었습니다. 새 세션으로 다시 시작하세요.')
    value = {'files': initial, 'ignore_patterns': patterns, 'omitted_paths': omitted}
    base = 'folder:' + digest(value)
    atomic_json(target.parent / 'baseline.json', value)
    return base, digest(initial)


def fingerprint(folder, base):
    if not is_folder(base):
        return git_workspace.fingerprint(folder, base)
    return digest(scan(folder, metadata(folder, base)['ignore_patterns'])[0])


def files(folder, base):
    if not is_folder(base):
        return git_workspace.files(folder)
    value = metadata(folder, base)
    current, _ = scan(folder, value['ignore_patterns'])
    return [(name, Path(folder) / name) for name in sorted(set(value['files']) | set(current))]


def changes(folder, base):
    if not is_folder(base):
        names = git_workspace.git(folder, 'diff', '--no-renames', '--name-only', '-z', 'HEAD').decode('utf-8').split('\0')
        names += git_workspace.git(folder, 'ls-files', '--others', '--exclude-standard', '-z').decode('utf-8').split('\0')
        return sorted(set(n for n in names if n))
    value = metadata(folder, base)
    current, _ = scan(folder, value['ignore_patterns'])
    return sorted(n for n in set(value['files']) | set(current) if value['files'].get(n) != current.get(n))


def diff(folder, base, names):
    if not names:
        return ''
    if not is_folder(base):
        return git_workspace.git(folder, 'diff', '--no-renames', '--no-ext-diff', '--no-textconv', 'HEAD', '--',
                                  *[':(literal)' + n for n in names]).decode('utf-8', errors='replace')
    value = metadata(folder, base)
    chunks = []
    with zipfile.ZipFile(Path(folder).parent / 'baseline.zip') as archive:
        for name in names:
            path = Path(folder) / name
            if path.exists():
                safe_file(Path(folder).resolve(), path)
            previous = archive.read(name) if name in value['files'] else b''
            if name in value['files'] and hashlib.sha256(previous).hexdigest() != value['files'][name]['sha256']:
                raise ValueError('보관된 시작 파일이 변경되었습니다: ' + name)
            current = read_file(path) if path.exists() else b''
            try:
                if b'\0' in previous or b'\0' in current:
                    continue
                lines = difflib.unified_diff(previous.decode('utf-8').splitlines(keepends=True),
                    current.decode('utf-8').splitlines(keepends=True),
                    fromfile='a/' + name if name in value['files'] else '/dev/null',
                    tofile='b/' + name if path.exists() else '/dev/null')
                for line in lines:
                    chunks.append(line if line.endswith('\n') else line + '\n\\ No newline at end of file\n')
            except UnicodeError:
                continue  # Binary content is carried by the ZIP and change manifest.
    return ''.join(chunks)


def export(folder, base, dest, report):
    if not is_folder(base):
        return git_workspace.export(folder, base, dest, report)
    value = metadata(folder, base)
    current, _ = scan(folder, value['ignore_patterns'])
    before = digest(current)
    names = sorted(n for n in set(value['files']) | set(current) if value['files'].get(n) != current.get(n))
    entries = [{'path': n, 'status': 'deleted' if n not in current else 'added' if n not in value['files'] else 'modified',
                'before': value['files'].get(n), 'after': current.get(n)} for n in names]
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    (dest / 'changes.patch').write_text(diff(folder, base, names), encoding='utf-8', newline='')
    (dest / 'report.md').write_text(report, encoding='utf-8')
    atomic_json(dest / 'manifest.json', {'workspace_kind': 'folder', 'base_snapshot': base, 'fingerprint': before,
                                       'files': names, 'changes': entries, 'ignore_patterns': value['ignore_patterns']})
    with zipfile.ZipFile(dest / 'changed-files.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in names:
            if name in current:
                safe_file(Path(folder).resolve(), Path(folder) / name)
                archive.write(Path(folder) / name, 'files/' + name)
        archive.write(dest / 'manifest.json', 'manifest.json')
    if fingerprint(folder, base) != before:
        raise ValueError('결과물 생성 중 파일이 바뀌었습니다. 다시 내보내세요.')
    return {'files': names, 'fingerprint': before,
            'artifacts': ['changes.patch', 'changed-files.zip', 'report.md', 'manifest.json']}
