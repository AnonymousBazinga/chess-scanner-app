"""Automatic-geometry inference ablation. Fixed variants, no reference labels.

Save every prediction rather than select the best using benchmark answers.
Fenify rotation ensemble maps each probability grid back to photo coordinates.
"""
import json
import sys
import time
import numpy as np
import torch
from PIL import Image
from torchvision.transforms import functional as TF
from gemini_audit import OUT,source
from run_openrouter import ROOT
from hybrid import CHARS,placement

def main():
    torch.set_num_threads(4);sys.path.insert(0,'/tmp/chess-vision-chessqueries')
    from chessqueries.models.predictor import Predictor
    fenify=torch.jit.load(str(ROOT/'fenify-3D/model.pt'),map_location='cpu').eval()
    v4=Predictor.from_checkpoint('/tmp/chess-vision-weights/cq-vit-s-644-v4-seed2-safetensors-fp16-r2.safetensors',device='cpu')
    with torch.inference_mode():
        for i in range(1,7):
            rows=[]
            for variant in ('original','auto-crop','auto-rectified'):
                path=source(i) if variant=='original' else OUT/f'image{i}-{variant}.png'
                im=Image.open(path).convert('RGB');views=[]
                for rotation in range(4):
                    t=time.monotonic();image=im.rotate(90*rotation,expand=True)
                    x=TF.normalize(TF.to_tensor(image.resize((400,400),Image.Resampling.BILINEAR)),[.485,.456,.406],[.229,.224,.225])
                    probs=fenify(x[None]).reshape(8,8,13).numpy()[::-1].copy()
                    if not np.allclose(probs.sum(-1),1,atol=1e-4):
                        probs=np.exp(probs-probs.max(-1,keepdims=True));probs/=probs.sum(-1,keepdims=True)
                    probs=np.rot90(probs,-rotation,axes=(0,1)).copy();views.append(probs)
                    x=torch.from_numpy(np.array(image)).permute(2,0,1).float()
                    logits=v4.model(v4._transform(x)[None]);p=logits.softmax(-1).reshape(8,8,13).numpy()
                    for model,prob in [('fenify',probs),('v4',p)]:
                        pred=placement([CHARS[k] for k in prob.argmax(-1).flatten()])
                        rows.append({'model':model,'variant':variant,'input_rotation_ccw':rotation*90,'placement':pred,'mean_max_probability':float(prob.max(-1).mean()),'seconds_combined':round(time.monotonic()-t,3),'coordinate_frame':'photo' if model=='fenify' else 'model inferred'})
                mean=np.mean(views,axis=0)
                rows.append({'model':'fenify-rotation-mean','variant':variant,'placement':placement([CHARS[k] for k in mean.argmax(-1).flatten()]),'coordinate_frame':'photo','mean_max_probability':float(mean.max(-1).mean())})
                print(i,variant,'done',flush=True)
            (OUT/f'normalized-models-image{i}.json').write_text(json.dumps(rows,indent=2)+'\n')

if __name__=='__main__':main()
