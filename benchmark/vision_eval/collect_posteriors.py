"""Capture raw model probabilities for a generic list of images; no labels read."""
import argparse,json,sys,time
from pathlib import Path
import numpy as np,torch
from PIL import Image,ImageOps
from torchvision.transforms import functional as TF
sys.path.insert(0,'/tmp/chess-vision-chessqueries')
from chessqueries.models.predictor import Predictor
from run_openrouter import ROOT

def collect(paths,out):
    torch.set_num_threads(4)
    fenify=torch.jit.load(str(ROOT/'fenify-3D/model.pt'),map_location='cpu').eval()
    v4=Predictor.from_checkpoint('/tmp/chess-vision-weights/cq-vit-s-644-v4-seed2-safetensors-fp16-r2.safetensors',device='cpu')
    vitl=Predictor.from_checkpoint('/tmp/chess-vision-weights/chessqueries-vitl-644-safetensors-fp16-r1.safetensors',device='cpu')
    out.mkdir(parents=True,exist_ok=True)
    with torch.inference_mode():
        for name,path in paths:
            dest=out/(name+'.npz')
            if dest.exists():continue
            im=ImageOps.exif_transpose(Image.open(path)).convert('RGB');data={};start=time.monotonic()
            for rot in range(4):
                image=im.rotate(rot*90,expand=True)
                x=TF.normalize(TF.to_tensor(image.resize((400,400),Image.Resampling.BILINEAR)),[.485,.456,.406],[.229,.224,.225])
                prob=fenify(x[None]).reshape(8,8,13).numpy()[::-1].copy()
                if not np.allclose(prob.sum(-1),1,atol=1e-4):prob=torch.from_numpy(prob).softmax(-1).numpy()
                data[f'fenify_{rot}']=np.rot90(prob,-rot).copy()
                x=torch.from_numpy(np.array(image)).permute(2,0,1).float()
                data[f'v4_{rot}']=v4.model(v4._transform(x)[None]).softmax(-1).reshape(8,8,13).numpy()
                if rot==0:data['vitl_0']=vitl.model(vitl._transform(x)[None]).softmax(-1).reshape(8,8,13).numpy()
            np.savez_compressed(dest,**data)
            print(name,round(time.monotonic()-start,1),flush=True)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--manifest',type=Path);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
    if a.manifest:paths=[(r['id'],Path(r['path'])) for r in json.loads(a.manifest.read_text())]
    else:
        from gemini_audit import source
        paths=[(f'image{i}',source(i)) for i in range(1,7)]
    collect(paths,a.out)
