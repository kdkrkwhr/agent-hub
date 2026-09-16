import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from agent_hub.test_commands import discover


class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
    def write(self,name,text):
        p=self.root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text,encoding='utf-8')
    def test_npm_never_runs_script(self):
        self.write('package.json',json.dumps({'scripts':{'test':'node test.js','test:ci':'vitest run','dev':'vite'}}))
        with patch('subprocess.run',side_effect=AssertionError('No execution')),patch('subprocess.Popen',side_effect=AssertionError('No execution')):
            data=discover(str(self.root))
        self.assertEqual([x['command'] for x in data['suggestions']],['npm test','npm run test:ci'])
    def test_filters_placeholder_and_watch(self):
        self.write('package.json',json.dumps({'scripts':{'test':'echo "Error: no test specified" && exit 1','test:unit':'vitest --watch'}}))
        self.assertFalse(discover(str(self.root))['suggestions'])
    def test_unittest_and_pytest_detected_without_import(self):
        self.write('tests/test_example.py','import unittest\nraise RuntimeError("must never import")')
        self.write('pyproject.toml','[tool.pytest.ini_options]\ntestpaths=["tests"]')
        data=discover(str(self.root));commands=[x['command'] for x in data['suggestions']]
        self.assertEqual(len(commands),2);self.assertTrue(any('-m unittest discover -s tests -q' in c for c in commands))
    def test_malformed_oversized_and_empty(self):
        self.write('package.json','{');self.write('pyproject.toml','broken = [');self.write('pytest.ini','x'*262145)
        data=discover(str(self.root));self.assertFalse(data['suggestions']);self.assertGreaterEqual(len(data['warnings']),3)
    def test_unavailable_executable_keeps_explanation(self):
        self.write('package.json','{"scripts":{"test":"node test.js"}}')
        with patch('agent_hub.test_commands.command_line',side_effect=ValueError('missing npm')):data=discover(str(self.root))
        self.assertFalse(data['suggestions'][0]['available']);self.assertEqual(data['suggestions'][0]['reason'],'missing npm')
    def test_invalid_directory(self):
        for source in ('',None,str(self.root/'missing')):
            with self.assertRaises(ValueError):discover(source)
    def test_symlink_outside_not_read(self):
        with tempfile.TemporaryDirectory() as other:
            target=Path(other)/'secret.json';target.write_text('{"scripts":{"test":"node private.js"}}')
            try:(self.root/'package.json').symlink_to(target)
            except OSError:self.skipTest('symlinks not permitted')
            self.assertFalse(discover(str(self.root))['suggestions'])
