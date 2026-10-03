"""Within-board DINO appearance agreement; no labels are supplied."""
import json,sys,torch,numpy as np
from PIL import Image
from torchvision.transforms import functional as TF
sys.path.insert(0,'/tmp/chess-vision-chessqueries')
from chessqueries.models.predictor import Predictor
from gemini_audit import OUT,source
from run_openrouter import DEFAULT_OUT
root=DEFAULT_OUT/'chess-priors';torch.set_num_threads(4)
model=Predictor.from_checkpoint('/tmp/chess-vision-weights/cq-vit-s-644-v4-seed2-safetensors-fp16-r2.safetensors',device='cpu')
with torch.inference_mode():
 for i in range(1,7):
  objs=json.loads((OUT/f'leyolo-image{i}.json').read_text())['pieces'];im=Image.open(source(i)).convert('RGB');xs=[]
  for o in objs:
   crop=im.crop(tuple(map(round,o['box']))).resize((224,224));xs.append(TF.normalize(TF.to_tensor(crop),[.485,.456,.406],[.229,.224,.225]))
  f=model.model.encoder(torch.stack(xs));f=torch.nn.functional.normalize(f,dim=1).numpy();np.save(root/f'image{i}-appearance.npy',f)
  print(i,len(objs),flush=True)
