"""Read-only, bounded test command suggestions; never imports project code."""
import ast
import json
from pathlib import Path
import sys
import tomllib
from .pipeline_workspace import command_line


def discover(source):
    if not isinstance(source,str) or not source.strip():raise ValueError('대상 저장소 경로를 입력해 주세요.')
    root=Path(source).expanduser().resolve()
    if not root.is_dir():raise ValueError('대상 폴더를 찾을 수 없습니다.')
    warnings=[];suggestions=[]
    def read(name):
        p=root/name
        if not p.exists():return ''
        if p.is_symlink() or not p.resolve().is_relative_to(root) or not p.is_file() or p.stat().st_size>262144:
            warnings.append(name+' 파일은 안전한 크기의 일반 파일이 아니어서 건너뛰었습니다.');return ''
        try:return p.read_text(encoding='utf-8-sig')
        except (OSError,UnicodeError):warnings.append(name+' 파일을 읽지 못했습니다.');return ''
    def add(label,command,evidence):
        try:command_line(command);available=True;reason=''
        except ValueError as exc:available=False;reason=str(exc)
        suggestions.append(dict(label=label,command=command,evidence=evidence,available=available,reason=reason))
    package=read('package.json')
    if package:
        try:
            data=json.loads(package);scripts=data.get('scripts',{}) if isinstance(data,dict) else {}
            if isinstance(scripts,dict):
                for name,script in scripts.items():
                    if not isinstance(script,str) or not script.strip():continue
                    if name!='test' and name not in ('test:unit','test:ci','test:integration','test:e2e'):continue
                    if 'no test specified' in script.lower() or '--watch' in script or 'vitest'==script.strip():
                        warnings.append('npm '+name+': 기본 예제 또는 계속 실행되는 명령일 수 있어 추천에서 제외했습니다.');continue
                    add('npm · '+name,'npm test' if name=='test' else 'npm run '+name,'package.json → scripts.'+name+' = '+script[:300])
        except (ValueError,TypeError):warnings.append('package.json 형식을 읽지 못했습니다.')
    config=read('pyproject.toml');pytest=False
    if config:
        try:pytest='pytest' in tomllib.loads(config).get('tool',{})
        except (ValueError,TypeError,AttributeError):warnings.append('pyproject.toml 형식을 읽지 못했습니다.')
    if read('pytest.ini') or '[tool:pytest]' in read('setup.cfg'):pytest=True
    unittest_dirs=[];sample_count=0
    for folder in ('tests','test','.'):
        base=root/folder
        if not base.is_dir() or base.is_symlink():continue
        found=False
        # Only direct test files: bounded inspection, no dependencies or symlinks traversed.
        for p in base.glob('test*.py'):
            sample_count+=1
            if sample_count>80:break
            code=read(p.relative_to(root).as_posix())
            try:tree=ast.parse(code)
            except SyntaxError:continue
            for n in ast.walk(tree):
                if isinstance(n,ast.Import):
                    pytest|=any(x.name=='pytest' for x in n.names)
                    found|=any(x.name=='unittest' for x in n.names)
                elif isinstance(n,ast.ImportFrom):
                    pytest|=n.module=='pytest';found|=n.module=='unittest'
        if found:unittest_dirs.append(folder)
    py='"'+sys.executable+'"'
    if pytest:add('Python · pytest',py+' -m pytest','pytest 설정 또는 테스트 파일의 pytest import')
    for folder in unittest_dirs:add('Python · unittest ('+folder+')',py+' -m unittest discover -s '+folder+' -q',folder+' 내 테스트 파일의 unittest import')
    if not suggestions:warnings.append('지원하는 테스트 설정을 찾지 못했습니다. 프로젝트 문서의 검증 명령을 직접 입력하세요.')
    return dict(source=str(root),suggestions=suggestions,warnings=warnings,note='설정에서 찾은 후보입니다. 테스트 범위와 의존성 설치 여부는 확인하지 않았습니다. 선택한 명령은 작업 사본에서 실행됩니다.')
