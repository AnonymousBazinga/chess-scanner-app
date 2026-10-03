import json,cv2,numpy as np,onnxruntime as ort
from PIL import Image,ImageOps
from pathlib import Path
from leyolo_audit import detect,LABELS
from grid_normalize import rectify
from run_openrouter import DEFAULT_OUT
root=DEFAULT_OUT/'chess-priors'
sessions=[ort.InferenceSession('/tmp/chess-vision-weights/'+n,providers=['CPUExecutionProvider']) for n in ['480M_leyolo_pieces.onnx','480L_leyolo_xcorners.onnx']]
for item in json.loads((root/'holdout-manifest.json').read_text()):
 dest=root/(item['id']+'-geometry.json')
 if dest.exists():continue
 im=ImageOps.exif_transpose(Image.open(item['path'])).convert('RGB');pieces=detect(im,sessions[0]);corners=detect(im,sessions[1]);objects=[]
 try:
  _,info=rectify(im,corners);h=cv2.getPerspectiveTransform(np.float32(info['corners']),np.float32([[0,0],[8,0],[8,8],[0,8]]))
  for o in pieces:
   l,t,r,b=o['box'];base=[(l+r)/2,b-(r-l)/3];x,y=np.floor(cv2.perspectiveTransform(np.float32([[base]]),h)[0,0]).astype(int)
   if 0<=x<8 and 0<=y<8:objects.append({**o,'piece':LABELS[o['class_index']],'index':int(y*8+x)})
  info['status']='ok'
 except ValueError as exc:info={'status':'failed','error':str(exc)}
 dest.write_text(json.dumps({'geometry':info,'objects':objects},indent=2)+'\n')
 print(item['id'],info['status'],len(objects),flush=True)
