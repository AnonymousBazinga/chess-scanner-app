"""Storage conversion must preserve FP32 computation and restore on failure."""
import unittest
import torch
from scanner_backend.model import _expand_block, _compact_block

class BlockStorageTests(unittest.TestCase):
    def test_output_matches_fp32_and_weights_restore(self):
        layer=torch.nn.Linear(4,3).half();reference=torch.nn.Linear(4,3).float()
        reference.load_state_dict(layer.state_dict())
        initial=layer.weight.detach().clone()
        layer.register_forward_pre_hook(_expand_block)
        layer.register_forward_hook(_compact_block,always_call=True)
        x=torch.randn(2,4)
        with torch.inference_mode():
            self.assertTrue(torch.equal(reference(x),layer(x)))
            self.assertEqual(layer.weight.dtype,torch.float16)
            self.assertTrue(torch.equal(initial,layer.weight))
            with self.assertRaises(RuntimeError): layer(torch.randn(2,7))
            self.assertEqual(layer.weight.dtype,torch.float16)
