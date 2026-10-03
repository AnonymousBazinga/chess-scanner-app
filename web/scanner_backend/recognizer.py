"""Local image-only recognizer: automatic geometry, visual fusion, joint decoding.

No references, example hashes, known positions or Gemini responses are read.
Weights and upstream source locations are supplied as normal model dependencies.
"""
from functools import cached_property
from pathlib import Path
import time
import cv2,numpy as np,onnxruntime as ort,torch
from PIL import ImageOps
from torchvision.transforms import functional as TF
from .chess_constraints import infer,align_view,CHARS
from .vision_geometry import detect,fit_grid,LABELS
from .notation import placement

def canonicalize(board,details):
    """Undo the V4-to-photo transform, preserving its native chess orientation."""
    components=details.get('components',[])
    v4=next((c for c in components if c['name'].startswith('v4')),None)
    k=(-v4['align_ccw'])%4 if v4 else 0
    return np.rot90(np.asarray(board).reshape(8,8),k).reshape(-1),k

class StructuredRecognizer:
    def __init__(self, weights):
        torch.set_num_threads(1)
        from .model import load_model, transform
        self.weights = weights = Path(weights)
        self.v4 = load_model(weights / 'cq-vit-s-644-v4-seed2-safetensors-fp16-r2.safetensors', torch.float32)
        self.transform = transform
        options = ort.SessionOptions(); options.intra_op_num_threads = 1
        self.detectors = [ort.InferenceSession(str(weights / n), sess_options=options, providers=['CPUExecutionProvider']) for n in ('480M_leyolo_pieces.onnx', '480L_leyolo_xcorners.onnx')]

    @cached_property
    def fenify(self):
        return torch.jit.load(str(self.weights / 'fenify.pt'), map_location='cpu').eval()

    @cached_property
    def vitl(self):
        from .model import memory_bounded_vitl
        return memory_bounded_vitl(self.weights / 'chessqueries-vitl-644-safetensors-fp16-r1.safetensors')

    @torch.inference_mode()
    def probabilities(self,image,objects):
        # The missing-geometry decoder consumes only this view. Do not load or
        # run eight other views whose outputs it would discard.
        if not objects:
            x=self.transform(torch.from_numpy(np.array(image)).permute(2,0,1).float())[None]
            return {'v4_0':self.v4(x).softmax(-1).reshape(8,8,13).numpy()}
        data={};pending={'fenify','v4'}
        def record(group,rot,p):
            name=f'{group}_{rot}';data[name]=p
            # The original selector keeps the first minimum. Zero is a proven
            # lower bound, so no later view can replace this one (even on ties).
            if align_view(name,p,objects)['geometry_cost']==0:pending.discard(group)
        for rot in range(4):
            if not pending:break
            im=image.rotate(90*rot,expand=True)
            # Match the frozen collector's explicit bilinear resize.
            from PIL import Image
            if 'fenify' in pending:
                x=TF.normalize(TF.to_tensor(im.resize((400,400),Image.Resampling.BILINEAR)),[.485,.456,.406],[.229,.224,.225])
                p=self.fenify(x[None]).reshape(8,8,13).numpy()[::-1].copy()
                if not np.allclose(p.sum(-1),1,atol=1e-4):p=torch.from_numpy(p).softmax(-1).numpy()
                record('fenify',rot,np.rot90(p,-rot).copy())
            # Release the full-resolution float tensor before transformer inference.
            if 'v4' in pending or rot==0:
                x=self.transform(torch.from_numpy(np.array(im)).permute(2,0,1).float())[None]
            if 'v4' in pending:record('v4',rot,self.v4(x).softmax(-1).reshape(8,8,13).numpy())
            if rot==0:data['vitl_0']=self.vitl(x).softmax(-1).reshape(8,8,13).numpy()
        return data

    def predict(self,image):
        start=time.monotonic();image=ImageOps.exif_transpose(image).convert('RGB')
        corners=detect(image,self.detectors[1]);objects=[]
        try:
            geometry=fit_grid(image,corners)
        except ValueError as exc:geometry={'status':'unavailable','reason':str(exc)}
        else:
            pieces=detect(image,self.detectors[0])
            h=cv2.getPerspectiveTransform(np.float32(geometry['corners']),np.float32([[0,0],[8,0],[8,8],[0,8]]))
            for o in pieces:
                l,t,r,b=o['box'];base=[(l+r)/2,b-(r-l)/3]
                x,y=np.floor(cv2.perspectiveTransform(np.float32([[base]]),h)[0,0]).astype(int)
                if 0<=x<8 and 0<=y<8:objects.append({**o,'piece':LABELS[o['class_index']],'index':int(y*8+x)})
            geometry['status']='ok'
        posteriors=self.probabilities(image,objects);board,details,mix=infer(posteriors,objects)
        canonical,k=canonicalize(board,details);chars=np.array(list(CHARS));fen=placement(chars[canonical])
        # Agreement is a review signal, never a calibrated accuracy guarantee.
        probs=np.rot90(mix,k).reshape(64,13);ranks=np.sort(probs,axis=1)
        review=[i for i,p in enumerate(canonical) if p!=probs[i].argmax() or ranks[i,-1]-ranks[i,-2]<.3]
        return {'placement':fen,'fen':fen+' w - - 0 1','seconds':round(time.monotonic()-start,3),'method':'structured-visual-v2','experimental':True,'photo_placement':placement(chars[board]),'canonical_rotation_ccw':k*90,'geometry':geometry,'details':details,'review_squares':['abcdefgh'[i%8]+str(8-i//8) for i in review],'orientation_note':'Uses the selected ChessQ view orientation; confirm orientation in the editor. Side to move and castling rights cannot be recovered from a photo.'}
