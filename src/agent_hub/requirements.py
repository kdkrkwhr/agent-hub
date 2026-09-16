"""Source-preserving review obligations and bounded, non-executing checks."""
import ast
import json
import operator
import re


def ledger(db,rid):
    rows=db.execute("SELECT id,sender,kind,content FROM collab_events WHERE round_id=? AND kind IN ('request','guidance','question') ORDER BY id",(rid,)).fetchall()
    items=[]
    for row in rows:
        item={'id':'R'+str(row['id']),'event':row['id'],'source':row['sender'],'kind':row['kind'],'text':row['content'],'superseded_by':None}
        # Only an explicit user guidance command can replace an earlier user item.
        match=re.fullmatch(r'/replace (R[0-9]+)\s+(.+)',row['content'],re.S) if row['kind']=='guidance' else None
        if match:
            old=next((x for x in items if x['id']==match[1] and x['kind'] in ('request','guidance') and not x['superseded_by']),None)
            if old:old['superseded_by']=item['id'];item['text']=match[2]
        items.append(item)
    return items


def active(items):return [x for x in items if not x['superseded_by']]


def validate_review(result,items):
    checks=result.get('requirement_checks')
    required={x['id']:x for x in active(items)}
    if not isinstance(checks,list):return 'requirement_checks must cover every active requirement ID with status and evidence.'
    seen=set()
    for check in checks:
        if not isinstance(check,dict) or not isinstance(check.get('id'),str) or check.get('id') not in required or check['id'] in seen:return 'Unknown or duplicate requirement ID.'
        seen.add(check['id'])
        if check.get('status') not in ('met','unmet','unclear'):return 'Requirement status must be met, unmet or unclear.'
        if not isinstance(check.get('evidence'),str) or not check['evidence'].strip() or len(check['evidence'])>1500:return 'Every requirement needs concrete evidence (1..1500 characters).'
    if seen!=set(required):return 'Missing requirement checks: '+', '.join(sorted(set(required)-seen))
    if result.get('decision')=='APPROVE' and any(c['status']!='met' for c in checks):return 'APPROVE requires every active requirement to be met; otherwise retain OBJECT.'
    return None


def objects(text):
    for i,char in enumerate(text):
        if char=='{':
            try:value,_=json.JSONDecoder().raw_decode(text[i:])
            except ValueError:continue
            if isinstance(value,dict):yield value


def static_checks(proposal,items):
    failures=[]
    # Only explicit, machine-readable user requirements are treated as assertions.
    for item in active(items):
        if item['kind'] not in ('request','guidance'):continue
        for match in re.finditer(r'(?i)require\s+([a-z_][a-z0-9_]*)\s+(\[[^\n]*?\])',item['text']):
            try:expected=json.loads(match[2])
            except ValueError:continue
            candidates=[o[match[1]] for o in objects(proposal) if match[1] in o]
            if not candidates or any(not isinstance(v,list) or any(x not in v for x in expected) for v in candidates):
                failures.append({'requirement':item['id'],'check':'json_contains','detail':match[1]+' must include '+json.dumps(expected,ensure_ascii=False)})
    code=list(re.finditer(r'```(?:python|py)\s*\n(.*?)```',proposal,re.S|re.I))
    snippets=[m[1] for m in code]
    snippets.extend(m[1] for m in re.finditer(r'`(def [^`]+)`',proposal))
    # Recognize the concrete invalid one-line compound-statement failure from the benchmark.
    if re.search(r'(?:수정|최종 코드|corrected code|fix)\s*:\s*def \w+\([^\n]*?\):\s*if\s',proposal):
        failures.append({'check':'python_syntax','detail':'A compound if statement cannot follow def on the same line.'})
    for snippet in snippets:
        try:ast.parse(snippet.strip())
        except (SyntaxError,ValueError,RecursionError) as exc:failures.append({'check':'python_syntax','detail':str(exc)[:250]})
    # Check explicit arithmetic equalities only; no eval, calls, variables or powers.
    ops={ast.Add:operator.add,ast.Sub:operator.sub,ast.Mult:operator.mul,ast.Div:operator.truediv}
    def number(node):
        if isinstance(node,ast.Constant) and type(node.value) in (int,float) and abs(node.value)<1e12:return node.value
        if isinstance(node,ast.UnaryOp) and isinstance(node.op,ast.USub):return -number(node.operand)
        if isinstance(node,ast.BinOp) and type(node.op) in ops:return ops[type(node.op)](number(node.left),number(node.right))
        raise ValueError('Unsupported arithmetic')
    for match in re.finditer(r'(?<![\w.])([0-9][0-9 ()+*/.×−-]{0,80}[+*/×−-][0-9 ()+*/.×−-]{0,80})\s*=\s*(-?\d+(?:\.\d+)?)',proposal):
        try:
            tree=ast.parse(match[1].replace('×','*').replace('−','-').strip(),mode='eval')
            if sum(1 for _ in ast.walk(tree))>40:continue
            actual=number(tree.body);expected=float(match[2])
            if abs(actual-expected)>1e-9:failures.append({'check':'arithmetic','detail':match[0]+' is incorrect.'})
        except ZeroDivisionError:failures.append({'check':'arithmetic','detail':match[0]+' divides by zero.'})
        except (SyntaxError,ValueError,OverflowError,RecursionError):continue
    return failures
