import json
from pathlib import Path
import unittest
import test_pipeline
from agent_hub import pipeline_workspace as ws
from agent_hub.publication import git

class PublicationTests(unittest.TestCase):
 setUp=test_pipeline.PipelineTests.setUp
 tearDown=test_pipeline.PipelineTests.tearDown
 body=test_pipeline.PipelineTests.body
 start=test_pipeline.PipelineTests.start
 adapter=test_pipeline.PipelineTests.adapter
 run_until_end=test_pipeline.PipelineTests.run_until_end
 def completed(self):
  git(self.source,'config','user.name','Hub Test');git(self.source,'config','user.email','hub-test@example.invalid');git(self.source,'config','commit.gpgsign','false')
  return self.run_until_end(self.start(testCommand=''))
 def execute(self,p,action='apply',message='test: apply result'):
  view=self.p.publication.preview(p['id'])
  return self.p.publication.execute({'id':p['id'],'token':view['token'],'action':action,'message':message,'confirmed':True})
 def test_preview_is_readonly_and_apply_only_stages_exact_patch(self):
  p=self.completed();before=ws.fingerprint(self.source,p['base']);v=self.p.publication.preview(p['id'])
  self.assertEqual(before,ws.fingerprint(self.source,p['base']));self.assertIn('maths.py',v['files']);self.assertIn('return sum',v['diff'])
  result=self.execute(p);self.assertEqual(result['stage'],'applied');self.assertEqual(git(self.source,'rev-parse','HEAD').decode().strip(),p['base'])
  self.assertEqual(git(self.source,'diff','--cached','--name-only').decode().strip(),'maths.py')
  self.assertFalse(git(self.source,'diff','--name-only').strip());self.assertTrue(self.p.discussion_context(self.h.scope(self.cfg),'t',p['id'])['original_applied'])
 def test_apply_then_commit_then_local_remote_push(self):
  remote=self.root/'remote.git';git(self.root,'init','--bare',str(remote));git(self.source,'remote','add','origin',str(remote));branch=git(self.source,'branch','--show-current').decode().strip();git(self.source,'push','origin','HEAD:refs/heads/'+branch)
  p=self.completed();self.execute(p);result=self.execute(p,'commit');self.assertEqual(result['stage'],'committed')
  self.assertFalse(git(self.source,'status','--porcelain').strip());self.assertEqual(git(self.source,'rev-parse','HEAD^').decode().strip(),p['base'])
  result=self.execute(p,'push');self.assertEqual(result['stage'],'pushed');self.assertEqual(git(remote,'rev-parse','refs/heads/'+branch).decode().strip(),result['commit'])
  self.assertEqual(git(self.source,'rev-list','--count',p['base']+'..HEAD').decode().strip(),'1')
 def test_dirty_source_and_changed_head_rejected(self):
  p=self.completed();(self.source/'unrelated.txt').write_text('keep')
  with self.assertRaises(ValueError):self.p.publication.preview(p['id'])
  git(self.source,'add','unrelated.txt');git(self.source,'commit','-m','unrelated')
  with self.assertRaises(ValueError):self.p.publication.preview(p['id'])
 def test_explicit_confirmation_and_stale_preview(self):
  p=self.completed();v=self.p.publication.preview(p['id']);body={'id':p['id'],'token':v['token'],'action':'apply','confirmed':False}
  with self.assertRaises(ValueError):self.p.publication.execute(body)
  body['confirmed']=True;self.p.publication.preview(p['id'])
  with self.assertRaises(ValueError):self.p.publication.execute(body)
  self.assertFalse(git(self.source,'status','--porcelain').strip())
 def test_added_staged_change_never_committed(self):
  p=self.completed();self.execute(p);(self.source/'private.txt').write_text('unrelated');git(self.source,'add','private.txt')
  with self.assertRaises(ValueError):self.execute(p,'commit')
  self.assertEqual(git(self.source,'rev-parse','HEAD').decode().strip(),p['base'])
 def test_push_rejects_diverged_remote_before_mutation(self):
  remote=self.root/'remote.git';git(self.root,'init','--bare',str(remote));git(self.source,'remote','add','origin',str(remote));branch=git(self.source,'branch','--show-current').decode().strip();git(self.source,'push','origin','HEAD:refs/heads/'+branch)
  p=self.completed();other=self.root/'other';git(self.root,'clone',str(remote),str(other));git(other,'config','user.name','Other');git(other,'config','user.email','other@example.invalid');git(other,'config','commit.gpgsign','false');(other/'other.txt').write_text('new');git(other,'add','.');git(other,'commit','-m','other');git(other,'push','origin','HEAD:refs/heads/'+branch)
  with self.assertRaises(ValueError):self.execute(p,'push')
  self.assertEqual(git(self.source,'rev-parse','HEAD').decode().strip(),p['base']);self.assertFalse(git(self.source,'status','--porcelain').strip())
 def test_active_project_and_changed_patch_are_rejected(self):
  p=self.completed();v=self.p.publication.preview(p['id']);pid=self.start(parentId=p['id'],testCommand='')
  with self.assertRaises(ValueError):self.p.publication.execute({'id':p['id'],'token':v['token'],'action':'apply','confirmed':True})
  self.p.cancel(pid);patch=self.h.root/'artifacts'/p['id']/'changes.patch';patch.write_bytes(patch.read_bytes()+b'\n')
  with self.assertRaises(ValueError):self.p.publication.execute({'id':p['id'],'token':v['token'],'action':'apply','confirmed':True})
 def test_readonly_and_foreign_scope_rejected(self):
  p=self.completed();self.h.config.value={**self.cfg,'observer':'different'}
  with self.assertRaises(ValueError):self.p.publication.preview(p['id'])

 def test_binary_addition_and_deletion_apply_exact_tree(self):
  def change(*args):
   ctx=args[2]['pipeline']
   if ctx['phase']=='implement':
    (Path(ctx['workspace'])/'maths.py').unlink()
    (Path(ctx['workspace'])/'image.bin').write_bytes(bytes(range(256))*4)
    (Path(ctx['workspace'])/'new.txt').write_text('new')
   return {'task':ctx['task'],'status':'done','reply':'변경 검토 완료','messages':[]}
  p=self.run_until_end(self.start(testCommand=''),change);self.assertEqual(p['status'],'completed',p['reason'])
  result=self.execute(p);self.assertEqual(result['stage'],'applied');self.assertFalse((self.source/'maths.py').exists());self.assertEqual((self.source/'image.bin').read_bytes(),bytes(range(256))*4)
 def test_git_commit_and_push_preserve_user_hooks(self):
  from unittest.mock import patch
  from types import SimpleNamespace
  with patch('agent_hub.publication.subprocess.run',return_value=SimpleNamespace(returncode=0,stdout=b'')) as run:
   git(self.source,'commit','-m','message');self.assertNotIn('core.hooksPath=/dev/null',run.call_args.args[0])
   git(self.source,'push','origin','HEAD');self.assertNotIn('core.hooksPath=/dev/null',run.call_args.args[0])
