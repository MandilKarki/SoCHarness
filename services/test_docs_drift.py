import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import docs_drift


class DocsDriftTests(unittest.TestCase):
    def test_extracts_imports_aliases_and_attributes(self):
        code = '''from agents import (Agent, GuardrailFunctionOutput,
                    Runner as R)
from agents.extensions import handoff_filters
import asyncio
# from commented import Nope
R.run(agent); handoff_filters.remove_all_tools'''
        refs = set(docs_drift.python_refs(code))
        for ref in [('agents', 'Agent', None), ('agents', 'GuardrailFunctionOutput', None), ('agents', 'Runner', None),
                    ('agents', 'Runner', 'run'), ('agents.extensions', 'handoff_filters', 'remove_all_tools'),
                    ('asyncio', None, None)]:
            self.assertIn(ref, refs)
        self.assertFalse(any(r[0] == 'commented' for r in refs))
        self.assertEqual(docs_drift.ts_refs('import { generateText, type ToolSet, tool as t } from "ai";'),
                         [('ai', 'generateText', None), ('ai', 'tool', None)])

    def test_learning_content_is_fully_scanned(self):
        snippets = list(docs_drift.snippets())
        langs = [docs_drift.language(code) for *_, code in snippets]
        self.assertGreater(langs.count('python'), 50)
        self.assertGreater(langs.count('ts'), 20)
        owners = {owner for _, owner, _ in snippets}
        self.assertTrue({'openai', 'claude', 'google_adk', 'approval', 'loop'} <= owners)

    def test_probe_separates_drift_from_absent_packages(self):
        with tempfile.TemporaryDirectory() as tmp:
            pkg = Path(tmp)/'fakesdk'
            (pkg/'sub').mkdir(parents=True)
            (pkg/'__init__.py').write_text('class Agent:\n    def run(self): pass\n')
            (pkg/'sub'/'__init__.py').write_text('')
            refs = [['fakesdk', 'Agent', 'run'], ['fakesdk', 'Gone', None], ['fakesdk', 'Agent', 'nope'],
                    ['fakesdk.sub', None, None], ['fakesdk.moved', 'X', None], ['nosuchpkg_xyz', 'A', None]]
            with patch.dict(os.environ, {'PYTHONPATH': tmp + os.pathsep + os.environ.get('PYTHONPATH', '')}):
                result = docs_drift.probe_python(refs)
        status = {k: v[0] for k, v in result.items()}
        self.assertEqual(status[('fakesdk', 'Agent', 'run')], 'ok')
        self.assertEqual(status[('fakesdk', 'Gone', None)], 'missing')
        self.assertEqual(status[('fakesdk', 'Agent', 'nope')], 'missing')
        self.assertEqual(status[('fakesdk.sub', None, None)], 'ok')
        self.assertEqual(status[('fakesdk.moved', 'X', None)], 'missing')
        self.assertEqual(status[('nosuchpkg_xyz', 'A', None)], 'not_installed')


if __name__ == '__main__':
    unittest.main()
