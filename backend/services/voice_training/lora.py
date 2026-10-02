"""Low-rank adapters on mlx-audio's Whisper, merged into the weights for use.

Training adds a LoRA pair to every attention projection and MLP layer of the
encoder and decoder. At load, ``apply`` merges each pair into its base layer,
so the model the app runs has turbo's exact shape and speed.
"""

import hashlib
import json
import math
from pathlib import Path

ADAPTER_FILE = "adapter.safetensors"
CONFIG_FILE = "adapter_config.json"
RANK = 16
TARGETS = ("query", "key", "value", "out")
_LoRA = None


def _lora_class():
    """The LoRA layer, defined on first use so importing this module needs no MLX."""
    global _LoRA
    if _LoRA is not None:
        return _LoRA
    import mlx.core as mx
    import mlx.nn as nn

    class LoRA(nn.Module):
        def __init__(self, base, rank, alpha):
            super().__init__()
            out_dims, in_dims = base.weight.shape
            self.base = base
            self.scale = alpha / rank
            self.a = mx.random.normal((in_dims, rank)) * (1 / math.sqrt(in_dims))
            self.b = mx.zeros((rank, out_dims))

        def __call__(self, x):
            y = self.base(x)
            z = (x.astype(mx.float32) @ self.a) @ self.b
            return y + (self.scale * z).astype(y.dtype)

        def merged(self):
            weight = self.base.weight.astype(mx.float32) + self.scale * (self.a @ self.b).T
            layer = nn.Linear(weight.shape[1], weight.shape[0], bias="bias" in self.base)
            layer.weight = weight.astype(self.base.weight.dtype)
            if "bias" in self.base:
                layer.bias = self.base.bias
            return layer

    _LoRA = LoRA
    return LoRA


def _slots(model):
    """(parent, attribute) for every adapted layer, in a stable order."""
    for block in model.encoder.blocks:
        yield from ((block.attn, name) for name in TARGETS)
        yield from ((block, name) for name in ("mlp1", "mlp2"))
    for block in model.decoder.blocks:
        yield from ((block.attn, name) for name in TARGETS)
        if block.cross_attn is not None:
            yield from ((block.cross_attn, name) for name in TARGETS)
        yield from ((block, name) for name in ("mlp1", "mlp2"))


def add(model, rank=RANK):
    """Freeze ``model`` and add trainable LoRA pairs. Returns the pairs."""
    lora_layer = _lora_class()
    model.freeze()
    pairs = []
    for parent, name in _slots(model):
        pair = lora_layer(getattr(parent, name), rank, 2 * rank)
        setattr(parent, name, pair)
        pairs.append(pair)
    for pair in pairs:
        pair.unfreeze()
        pair.base.freeze()
    return pairs


def merge(model):
    """Replace every LoRA pair with one plain layer holding the merged weights."""
    lora_layer = _lora_class()
    for parent, name in _slots(model):
        layer = getattr(parent, name)
        if isinstance(layer, lora_layer):
            setattr(parent, name, layer.merged())


def save(model, directory: Path, info: dict):
    import mlx.core as mx
    from mlx.utils import tree_flatten

    directory.mkdir(parents=True, exist_ok=True)
    mx.save_safetensors(str(directory / ADAPTER_FILE), dict(tree_flatten(model.trainable_parameters())))
    (directory / CONFIG_FILE).write_text(json.dumps({"rank": RANK, **info}, indent=2))


def load_into(model, directory: Path):
    """Add LoRA pairs and load an adapter's weights into them, every key checked."""
    import mlx.core as mx
    from mlx.utils import tree_flatten

    config = json.loads((Path(directory) / CONFIG_FILE).read_text())
    add(model, config.get("rank", RANK))
    weights = mx.load(str(Path(directory) / ADAPTER_FILE))
    expected = {name for name, _ in tree_flatten(model.trainable_parameters())}
    if set(weights) != expected:
        raise ValueError("The voice adapter doesn't match this speech model")
    model.load_weights(list(weights.items()), strict=False)


def apply(model, directory: Path):
    """Merge an adapter into ``model`` for recognition."""
    load_into(model, directory)
    merge(model)
    model.eval()
    return model


def digests(directory: Path) -> tuple[str, str]:
    directory = Path(directory)
    return (
        hashlib.sha256((directory / ADAPTER_FILE).read_bytes()).hexdigest(),
        hashlib.sha256((directory / CONFIG_FILE).read_bytes()).hexdigest(),
    )
