import torch
import torch.nn as nn
import coremltools as ct
import numpy as np
from torchvision.models import efficientnet_v2_s

class FenifyModel(nn.Module):
    def __init__(self):
        super().__init__()
        self.resnet = efficientnet_v2_s()
        self.outputs = nn.Linear(1000, 832)

    def forward(self, x):
        x = self.resnet(x)
        x = torch.relu(x)
        x = self.outputs(x)
        # Use fixed reshape to avoid dynamic int ops
        x = x.view(1, 64, 13)
        x = torch.softmax(x, dim=2)
        return x

print("Building eager model...")
eager_model = FenifyModel()
eager_model.eval()

print("Loading weights from TorchScript model...")
scripted = torch.jit.load("model.pt", map_location="cpu")
scripted_state = scripted.state_dict()
eager_state = eager_model.state_dict()
loaded = 0
for key in eager_state:
    if key in scripted_state and eager_state[key].shape == scripted_state[key].shape:
        eager_state[key] = scripted_state[key]
        loaded += 1
eager_model.load_state_dict(eager_state)
print(f"Loaded {loaded}/{len(eager_state)} parameters")

# Verify
example_input = torch.randn(1, 3, 400, 400)
with torch.no_grad():
    scripted_out = scripted(example_input)
    eager_out = eager_model(example_input)
print(f"Max diff: {(scripted_out - eager_out).abs().max().item():.8f}")

# Use torch.export for CoreML conversion (recommended for coremltools 9.0+)
print("Exporting with torch.export...")
with torch.no_grad():
    exported = torch.export.export(eager_model, (example_input,))
    exported = exported.run_decompositions({})

print("Converting to CoreML...")
mlmodel = ct.convert(
    exported,
    inputs=[ct.TensorType(name="input_image", shape=(1, 3, 400, 400))],
    outputs=[ct.TensorType(name="output")],
    convert_to="mlprogram",
    minimum_deployment_target=ct.target.iOS17,
)

mlmodel.author = "fenify-3D (Logan Spears)"
mlmodel.short_description = "Chess board recognition. Input: ImageNet-normalized 400x400 RGB. Output: (1, 64, 13) piece probabilities."
mlmodel.version = "1.0"

output_path = "FenifyChessRecognizer.mlpackage"
mlmodel.save(output_path)
print(f"Saved to {output_path}")

# Verify CoreML
print("\nVerifying CoreML...")
loaded_ml = ct.models.MLModel(output_path)
coreml_out = loaded_ml.predict({"input_image": example_input.numpy().astype(np.float32)})["output"]
print(f"CoreML shape: {coreml_out.shape}")
print(f"Max diff CoreML vs PyTorch: {np.max(np.abs(coreml_out - scripted_out.numpy())):.6f}")

# End-to-end
print("\nEnd-to-end test...")
from PIL import Image
import torchvision.transforms.v2 as T

img = Image.open("readme-assets/prediction_example.png")
transform = T.Compose([
    T.Resize((400, 400)),
    T.Lambda(lambda im: im.convert("RGB")),
    T.ToTensor(),
    T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])
x_batch = transform(img).unsqueeze(0)

with torch.no_grad():
    pt_board = torch.argmax(scripted(x_batch).squeeze(), dim=1).reshape(8, 8)
coreml_board = np.argmax(
    loaded_ml.predict({"input_image": x_batch.numpy().astype(np.float32)})["output"].reshape(64, 13), axis=1
).reshape(8, 8)

piece_chars = ['.', 'P', 'N', 'B', 'R', 'Q', 'K', 'p', 'n', 'b', 'r', 'q', 'k']
print("PyTorch:")
for r in range(7, -1, -1):
    print(f"  {r+1}: {' '.join(piece_chars[pt_board[r][f].item()] for f in range(8))}")
print("CoreML:")
for r in range(7, -1, -1):
    print(f"  {r+1}: {' '.join(piece_chars[coreml_board[r][f]] for f in range(8))}")
print(f"Match: {np.array_equal(pt_board.numpy(), coreml_board)}")
