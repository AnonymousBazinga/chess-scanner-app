"""Pinned upstream architecture with memory-efficient checkpoint loading.

Build on the meta device to avoid allocating a second full ViT-L at cold start.
ViT-L blocks retain FP16 storage between calls but compute in FP32, as do
all image preprocessing and probability fusion.
"""
import sys
from pathlib import Path
import torch
from safetensors import safe_open
from safetensors.torch import load_file
from torchvision import transforms

sys.path.insert(0, str(Path(__file__).parent / 'vendor'))
from chessqueries.models.chessqueries_model import ChessQueriesModel

transform = transforms.Compose([
    transforms.Lambda(lambda x: x / 255.0),
    transforms.Resize((644, 644), antialias=True),
    transforms.Normalize([.485, .456, .406], [.229, .224, .225]),
])

def load_model(path, dtype):
    with safe_open(str(path), framework='pt', device='cpu') as f:
        meta = f.metadata()
    with torch.device('meta'):
        model = ChessQueriesModel(
            encoder_name=meta['encoder_name'], pretrained=False,
            freeze_encoder=meta['freeze_encoder'] == 'true',
            decoder_layers=int(meta['decoder_layers']), nheads=int(meta['nheads']),
            aux_heads=meta['aux_heads'] == 'true',
            drop_path_rate=float(meta['drop_path_rate']), head_type=meta['head_type'],
        )
    state = load_file(str(path), device='cpu')
    model.load_state_dict(state, strict=True, assign=True)
    return model.to(dtype=dtype).eval()

def memory_bounded_vitl(path):
    """Keep inactive encoder blocks in their original FP16 storage format.

    Every block computes in FP32, then returns its unchanged weights to FP16.
    The released checkpoint is already FP16, so this loses no weight information
    versus the original all-FP32 inference. Only one enlarged block is resident
    at once. The API lock makes the temporary dtype mutations request-safe.
    """
    model = load_model(path, torch.float16)
    blocks = model.encoder.blocks
    # Convert the decoder and small encoder components, leaving blocks compact.
    for name, child in model.named_children():
        if name != 'encoder': child.float()
    for name, child in model.encoder.named_children():
        if name != 'blocks': child.float()
    for param in model.encoder.parameters(recurse=False):
        if param.is_floating_point(): param.data = param.data.float()
    for name, buffer in model.encoder.named_buffers(recurse=False):
        if buffer.is_floating_point(): setattr(model.encoder, name, buffer.float())
    for block in blocks:
        block.register_forward_pre_hook(_expand_block)
        block.register_forward_hook(_compact_block, always_call=True)
    return model


def _expand_block(module, args):
    # Retain original mmap-backed tensors; converting back would allocate a
    # second copy of the checkpoint while its original mapping is still live.
    module._compact_parameters = [(p, p.data) for p in module.parameters()]
    module._compact_buffers = [(child, name, value) for child in module.modules()
                               for name, value in child.named_buffers(recurse=False)]
    module.float()


def _compact_block(module, args, result):
    for param, original in getattr(module, '_compact_parameters', []):
        param.data = original
    for child, name, original in getattr(module, '_compact_buffers', []):
        setattr(child, name, original)
    module._compact_parameters = []
    module._compact_buffers = []
