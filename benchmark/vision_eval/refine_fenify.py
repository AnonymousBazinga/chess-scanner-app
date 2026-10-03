"""Diagnostic Fenify refinement without any reference labels in inference.

Fixed augmentation set: horizontal reflection, three exposures and grayscale.
All predictions are mapped back to the original square coordinates.
"""
import json
import time
from collections import Counter
import numpy as np
import torch
import torchvision.transforms.functional as TF
from PIL import Image, ImageEnhance, ImageOps
from run_openrouter import ROOT,DEFAULT_OUT,SQUARES,score,expand
from direct_vision import fen_from_map

OUT=DEFAULT_OUT/'followup';OUT.mkdir(exist_ok=True)
CHARS='.PNBRQKpnbrqk'
torch.set_num_threads(4)
model=torch.jit.load(str(ROOT/'fenify-3D/model.pt'),map_location='cpu').eval()
mean=torch.tensor([.485,.456,.406]).view(3,1,1)
std=torch.tensor([.229,.224,.225]).view(3,1,1)

def predict(image,flip=False):
    x=TF.to_tensor(image.resize((400,400),Image.Resampling.BILINEAR))
    with torch.inference_mode():v=model(((x-mean)/std)[None]).reshape(8,8,13).numpy()[::-1].copy()
    if flip:v=v[:,::-1].copy()
    if not (np.all(v>=0) and np.allclose(v.sum(-1),1,atol=1e-4)):
        v=np.exp(v-v.max(-1,keepdims=True));v/=v.sum(-1,keepdims=True)
    return v.reshape(64,13)

def to_fen(classes):return fen_from_map({s:CHARS[int(c)] for s,c in zip(SQUARES,classes) if c})

def one_king_each(probs,occupied):
    logs=np.log(np.maximum(probs,1e-12));logs[:,0]=-1e9
    logs[:,[6,12]]=-1e9
    fallback=logs.argmax(-1);best=logs.max(-1)
    gains=np.log(np.maximum(probs[:,[6,12]],1e-12))-best[:,None]
    gains[~occupied]=-1e9
    choices=gains[:,0,None]+gains[None,:,1];np.fill_diagonal(choices,-1e9)
    w,b=np.unravel_index(choices.argmax(),choices.shape)
    result=fallback.copy();result[w]=6;result[b]=12;result[~occupied]=0
    return result

allrows=[]
for index in (1,2):
    image=Image.open(DEFAULT_OUT/'images'/f'image-{index}.jpg').convert('RGB')
    start=time.monotonic();base=predict(image);occupied=base.argmax(-1)!=0
    predictions=[]
    for flip in (False,True):
        for exposure in (.75,1.,1.25):
            for gray in (False,True):
                im=ImageEnhance.Brightness(image).enhance(exposure)
                if gray:im=ImageOps.grayscale(im).convert('RGB')
                if flip:im=ImageOps.mirror(im)
                predictions.append(predict(im,flip))
    avg=np.mean(predictions,axis=0)
    fixed=avg.copy();fixed[:,0]=0;fixed=fixed.argmax(-1);fixed[~occupied]=0
    methods={'fenify-12-view-mean':avg.argmax(-1),'fenify-12-view-fixed-occupancy':fixed,'fenify-12-view-one-king-each':one_king_each(avg,occupied)}
    # Simple identity vote across existing models, with Fenify occupancy. Ties
    # retain Fenify. This is exploratory, not independently validated selection.
    existing=[json.loads((DEFAULT_OUT/f'local-{name}.json').read_text())[index-1] for name in ['fenify-3D','ChessQueries_ViT-L','ChessQ_Lite_V4']]
    boards=[expand(r['placement']) for r in existing]
    voted=[]
    for i,sq in enumerate(SQUARES):
        if not occupied[i]:voted.append(0);continue
        counts=Counter(b[i] for b in boards if b[i]!='.')
        winner=max(counts,key=lambda c:(counts[c],c==boards[0][i]))
        voted.append(CHARS.index(winner))
    methods['fenify-occupancy-three-model-identity-vote']=voted
    for name,classes in methods.items():
        placement=to_fen(classes)
        row={'model':name,'image':index,'placement':placement,'score':score(placement,index),'seconds_total_tta':round(time.monotonic()-start,3),'status':'ok'}
        allrows.append(row);print(json.dumps(row),flush=True)
    np.savez_compressed(OUT/f'fenify-probabilities-{index}.npz',baseline=base,augmented=np.array(predictions),mean=avg)
    occupied_details={sq:[{'piece':CHARS[k],'prob':round(float(avg[i,k]),4)} for k in avg[i].argsort()[-4:][::-1]] for i,sq in enumerate(SQUARES) if occupied[i]}
    (OUT/f'fenify-piece-options-{index}.json').write_text(json.dumps(occupied_details,indent=2)+'\n')
(OUT/'fenify-refinement.json').write_text(json.dumps(allrows,indent=2)+'\n')
