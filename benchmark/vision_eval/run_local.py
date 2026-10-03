"""Local model comparison; upstream checkouts and weights are supplied explicitly."""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import sys
import time

import numpy as np
import torch
import torchvision
from PIL import Image

from run_openrouter import ROOT, DEFAULT_OUT, score

def main():
    p = argparse.ArgumentParser()
    p.add_argument('model', choices=['fenify','chessqueries','chesscog'])
    p.add_argument('--checkpoint', type=Path)
    p.add_argument('--source',type=Path)
    p.add_argument('--label')
    args=p.parse_args()
    torch.set_num_threads(4)
    if args.source: sys.path.insert(0,str(args.source))
    if args.model=='fenify':
        namespace={'torch':torch,'torchvision':torchvision,'ROOT':ROOT,'PIECES':'.PNBRQKpnbrqk','Image':Image}
        tree=ast.parse((ROOT/'benchmark/run.py').read_text())
        nodes=[n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.ClassDef)) and n.name in ['Fenify','to_placement']]
        exec(compile(ast.Module(body=nodes,type_ignores=[]),str(ROOT/'benchmark/run.py'),'exec'),namespace)
        model=namespace['Fenify']()
        args.checkpoint=ROOT/'fenify-3D/model.pt'
        predict=lambda path:namespace['to_placement'](model.predict(Image.open(path)))
    elif args.model=='chessqueries':
        from chessqueries.models.predictor import Predictor
        model=Predictor.from_checkpoint(args.checkpoint,device='cpu')
        predict=lambda path:model.predict([path])[0].fen.split()[0]
    else:
        from chesscog.recognition.recognition import ChessRecognizer
        model=ChessRecognizer()
        predict=lambda path:model.predict(np.asarray(Image.open(path).convert('RGB')))[0].board_fen()
    rows=[]
    for i in (1,2):
        image=DEFAULT_OUT/'images'/f'image-{i}.jpg'
        row={'model':args.label or args.model,'image':i,'image_sha256':hashlib.sha256(image.read_bytes()).hexdigest(),'device':'cpu','torch':torch.__version__,'torchvision':torchvision.__version__,'numpy':np.__version__}
        if args.checkpoint: row['model_sha256']=hashlib.sha256(args.checkpoint.read_bytes()).hexdigest()
        start=time.monotonic()
        try:
            placement=predict(image)
            row.update(placement=placement,score=score(placement,i),status='ok')
        except Exception as exc:
            row.update(status='error',error=f'{type(exc).__name__}: {exc}')
        row['seconds']=round(time.monotonic()-start,3)
        print(json.dumps(row),flush=True)
        rows.append(row)
    slug=(args.label or args.model).replace(' ','_').replace('/','_')
    (DEFAULT_OUT/f'local-{slug}.json').write_text(json.dumps(rows,indent=2)+'\n')

if __name__=='__main__':main()
