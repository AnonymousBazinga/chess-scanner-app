"""Local image-only recognizer: automatic geometry, visual fusion, joint decoding.

No references, example hashes, known positions or Gemini responses are read.
Weights and upstream source locations are supplied as normal model dependencies.
"""
from pathlib import Path
import sys,time
import cv2,numpy as np,onnxruntime as ort,torch
from PIL import ImageOps
from torchvision.transforms import functional as TF
from chess_constraints import infer,CHARS
from vision_geometry import detect,rectify,LABELS
from hybrid import placement

def canonicalize(board,details):
    """Undo the V4-to-photo transform, preserving its native chess orientation."""
    components=details.get('components',[])
    v4=next((c for c in components if c['name'].startswith('v4')),None)
    k=(-v4['align_ccw'])%4 if v4 else 0
    return np.rot90(np.asarray(board).reshape(8,8),k).reshape(-1),k

class StructuredRecognizer:
    def __init__(self,fenify,source,vitl,v4,weights):
        torch.set_num_threads(4);sys.path.insert(0,str(source))
        from chessqueries.models.predictor import Predictor
        self.fenify=torch.jit.load(str(fenify),map_location='cpu').eval()
        self.v4=Predictor.from_checkpoint(str(v4),device='cpu');self.vitl=Predictor.from_checkpoint(str(vitl),device='cpu')
        options=ort.SessionOptions();options.intra_op_num_threads=2
        self.detectors=[ort.InferenceSession(str(Path(weights)/n),sess_options=options,providers=['CPUExecutionProvider']) for n in ('480M_leyolo_pieces.onnx','480L_leyolo_xcorners.onnx')]

    @torch.inference_mode()
    def probabilities(self,image):
        data={}
        for rot in range(4):
            im=image.rotate(90*rot,expand=True)
            # Match the frozen collector's explicit bilinear resize.
            from PIL import Image
            x=TF.normalize(TF.to_tensor(im.resize((400,400),Image.Resampling.BILINEAR)),[.485,.456,.406],[.229,.224,.225])
            p=self.fenify(x[None]).reshape(8,8,13).numpy()[::-1].copy()
            if not np.allclose(p.sum(-1),1,atol=1e-4):p=torch.from_numpy(p).softmax(-1).numpy()
            data[f'fenify_{rot}']=np.rot90(p,-rot).copy()
            x=torch.from_numpy(np.array(im)).permute(2,0,1).float()
            data[f'v4_{rot}']=self.v4.model(self.v4._transform(x)[None]).softmax(-1).reshape(8,8,13).numpy()
            if rot==0:data['vitl_0']=self.vitl.model(self.vitl._transform(x)[None]).softmax(-1).reshape(8,8,13).numpy()
        return data

    def predict(self,image):
        start=time.monotonic();image=ImageOps.exif_transpose(image).convert('RGB')
        pieces=detect(image,self.detectors[0]);corners=detect(image,self.detectors[1]);objects=[]
        try:
            _,geometry=rectify(image,corners);h=cv2.getPerspectiveTransform(np.float32(geometry['corners']),np.float32([[0,0],[8,0],[8,8],[0,8]]))
            for o in pieces:
                l,t,r,b=o['box'];base=[(l+r)/2,b-(r-l)/3]
                x,y=np.floor(cv2.perspectiveTransform(np.float32([[base]]),h)[0,0]).astype(int)
                if 0<=x<8 and 0<=y<8:objects.append({**o,'piece':LABELS[o['class_index']],'index':int(y*8+x)})
            geometry['status']='ok'
        except ValueError as exc:geometry={'status':'unavailable','reason':str(exc)}
        posteriors=self.probabilities(image);board,details,mix=infer(posteriors,objects)
        canonical,k=canonicalize(board,details);chars=np.array(list(CHARS));fen=placement(chars[canonical])
        # Agreement is a review signal, never a calibrated accuracy guarantee.
        probs=np.rot90(mix,k).reshape(64,13);ranks=np.sort(probs,axis=1)
        review=[i for i,p in enumerate(canonical) if p!=probs[i].argmax() or ranks[i,-1]-ranks[i,-2]<.3]
        return {'placement':fen,'fen':fen+' w - - 0 1','seconds':round(time.monotonic()-start,3),'method':'structured-visual-v2','experimental':True,'photo_placement':placement(chars[board]),'canonical_rotation_ccw':k*90,'geometry':geometry,'details':details,'review_squares':['abcdefgh'[i%8]+str(8-i//8) for i in review],'orientation_note':'Uses the selected ChessQ view orientation; confirm orientation in the editor. Side to move and castling rights cannot be recovered from a photo.'}
