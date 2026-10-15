import os
from pathlib import Path
import subprocess
import sys
import unittest


class HelpEncodingTests(unittest.TestCase):
    def test_help_survives_a_legacy_output_encoding(self):
        env = dict(os.environ, PYTHONIOENCODING='cp1252', PYTHONPATH=str(Path(__file__).resolve().parents[1] / 'src'))
        env.pop('PYTHONUTF8', None)
        result = subprocess.run([sys.executable, '-m', 'agent_hub', 'chat', '--help'],
                                env=env, capture_output=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(b'agent-hub chat', result.stdout)


if __name__ == '__main__':
    unittest.main()
