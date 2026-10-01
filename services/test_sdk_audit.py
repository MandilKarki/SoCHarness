import unittest
from pathlib import Path
from sdk_audit import MANIFEST, validate_manifest, framework_metadata, cell_metadata
from sdk_release_check import check_release
from unittest.mock import patch
from inventory import ROWS

class SDKAuditTests(unittest.TestCase):
    def test_every_adapter_has_matching_pin_and_evidence_files(self):
        self.assertEqual(validate_manifest(Path(__file__).resolve().parents[1]),[])

    def test_grid_has_unique_versioned_cells_and_no_inferred_live_parity(self):
        ids=set()
        for runtime in MANIFEST['sdks']:
            for row in ROWS:
                cell=cell_metadata(runtime,row[0],'gap')
                self.assertNotIn(cell['mapping_id'],ids)
                ids.add(cell['mapping_id'])
                self.assertIsNone(cell['implementation'])
        self.assertEqual(len(ids),11*42)
        self.assertEqual(cell_metadata('openai','tools','native')['live_status'],'not live-tested')
        self.assertEqual(cell_metadata('openai','loop','native')['live_status'],'connectivity smoke only')

    def test_detects_drift_and_absence(self):
        self.assertEqual(framework_metadata('openai','999')['version_state'],'version drift')
        self.assertEqual(framework_metadata('openai',None)['version_state'],'not installed')
        self.assertEqual(framework_metadata('openai','0.22.3')['version_state'],'matches pin')

    def test_network_failure_is_unknown_not_current(self):
        with patch('urllib.request.urlopen',side_effect=TimeoutError()):
            self.assertEqual(check_release(('openai',MANIFEST['sdks']['openai']))['status'],'unknown')

    def test_unknown_upstream_api_never_invented(self):
        cell=cell_metadata('openai','external_mcp','gap')
        self.assertIn('not mapped',cell['upstream_api'])
        self.assertIsNone(cell['contract_suite'])
