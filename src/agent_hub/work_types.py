"""Task purpose, independent of execution mode; no extra model call."""
import re
LABELS={'auto':'자동','research':'조사·분석','development':'기능 개발','improvement':'수정·개선','documentation':'문서 정리'}
GUIDANCE={
 'research':'Read-only investigation. Return the conclusion, supporting evidence and remaining uncertainty. Do not edit files or execute tests.',
 'development':'Implement only the requested behavior. Completion requires the requested behavior and relevant validation evidence; distinguish skipped tests.',
 'improvement':'Identify the cause, make the smallest relevant fix and check regressions. Performance claims require before/after evidence; do not invent measurements.',
 'documentation':'Update the requested documents consistently with the actual implementation. Check examples and links; do not change unrelated product behavior.'}
def resolve(value,text,mode):
 if not isinstance(value,str) or value not in LABELS:raise ValueError('지원하지 않는 작업 유형입니다.')
 if value!='auto':return value
 if mode=='inspect':return 'research'
 text=text.casefold()
 if re.search(r'문서|readme|가이드|documentation',text):return 'documentation'
 if re.search(r'버그|오류|수정|개선|최적화|성능|\b(fix|bug|optimi[sz]e)\b',text):return 'improvement'
 return 'development'
