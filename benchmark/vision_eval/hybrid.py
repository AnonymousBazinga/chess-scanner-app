"""Experimental recognizer for arbitrary photos; no benchmark labels in inference."""
import argparse
from collections import Counter
import json
from pathlib import Path
import sys
import time

import numpy as np
from PIL import Image, ImageOps
import torch
from torchvision.transforms import functional as TF

CHARS = '.PNBRQKpnbrqk'
SQUARES = [f'{f}{r}' for r in range(8,0,-1) for f in 'abcdefgh']

def placement(board):
    ranks=[]
    for start in range(0,64,8):
        rank='';empty=0
        for piece in board[start:start+8]:
            if piece=='.':empty+=1;continue
            if empty:rank+=str(empty);empty=0
            rank+=piece
        if empty:rank+=str(empty)
        ranks.append(rank)
    return '/'.join(ranks)

def combine(boards):
    """Fenify occupancy, nonempty majority identity, Fenify wins ties.

    Every disagreement is reported, including unanimous auxiliary occupancy
    disagreement. Agreement is not a calibrated confidence estimate.
    """
    if len(boards)!=3 or any(len(b)!=64 or any(p not in CHARS for p in b) for b in boards):
        raise ValueError('Expected three 64-square boards')
    result=[];disagreements=[]
    for i,square in enumerate(SQUARES):
        votes=[b[i] for b in boards]
        winner='.'
        if votes[0]!='.':
            counts=Counter(p for p in votes if p!='.')
            winner=max(counts,key=lambda p:(counts[p],p==votes[0]))
        result.append(winner)
        if len(set(votes))>1:disagreements.append({'square':square,'votes':votes,'selected':winner})
    return result,disagreements

class HybridRecognizer:
    def __init__(self, fenify, source, vitl, v4):
        torch.set_num_threads(4)
        sys.path.insert(0,str(source))
        from chessqueries.models.predictor import Predictor
        self.fenify=torch.jit.load(str(fenify),map_location='cpu').eval()
        self.aux=[Predictor.from_checkpoint(p,device='cpu') for p in (vitl,v4)]

    @torch.inference_mode()
    def predict(self,image):
        start=time.monotonic()
        image=ImageOps.exif_transpose(image).convert('RGB')
        x=TF.to_tensor(image.resize((400,400),Image.Resampling.BILINEAR))
        x=TF.normalize(x,[.485,.456,.406],[.229,.224,.225])
        classes=self.fenify(x[None]).reshape(8,8,13).argmax(-1).numpy()[::-1].reshape(-1)
        boards=[[CHARS[i] for i in classes]]
        x=torch.from_numpy(np.asarray(image).copy()).permute(2,0,1).float()
        for predictor in self.aux:
            labels=predictor.model.predict_labels(predictor._transform(x)[None]).reshape(-1).cpu().tolist()
            boards.append([CHARS[i] for i in labels])
        board,disagreements=combine(boards)
        fen=placement(board)
        return {'placement':fen,'fen':fen+' w - - 0 1','seconds':round(time.monotonic()-start,3),
                'disagreements':disagreements,'components':dict(zip(['fenify','vitl','v4'],map(placement,boards))),
                'method':'fenify-occupancy-three-model-identity-vote','experimental':True}

def model_arguments(parser):
    parser.add_argument('--fenify',type=Path,default=Path(__file__).resolve().parents[2]/'fenify-3D/model.pt')
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--vitl',type=Path,required=True)
    parser.add_argument('--v4',type=Path,required=True)

def from_args(args):return HybridRecognizer(args.fenify,args.source,args.vitl,args.v4)

if __name__=='__main__':
    p=argparse.ArgumentParser();model_arguments(p);p.add_argument('images',nargs='+',type=Path);args=p.parse_args()
    model=from_args(args)
    for path in args.images:
        with Image.open(path) as im:print(json.dumps({'image':str(path),**model.predict(im)}),flush=True)
