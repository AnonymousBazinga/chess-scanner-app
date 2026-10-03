"""CameraChess LeYOLO detection diagnostic; reference labels never enter inference.

Port of preprocessing/NMS/base rule from Pbatch/CameraChessWeb (AGPL-3.0),
commit 6410b636a5a20cf81987eb2151ede6664a0c4b07. Manual corners isolate piece
recognition; this is NOT a claim to reproduce its complete live-game tracker.
"""
import hashlib
import json
from pathlib import Path
import cv2
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageDraw
from geometry_audit import CORNERS
from gemini_audit import OUT,source
from run_openrouter import extract

LABELS='bknpqrBKNPQR'

def detect(im,session):
    w,h=im.size;scale=min(480/w,288/h);rw=round(w*scale);rh=round(h*scale)
    l=(480-rw)-(480-rw)//2;t=(288-rh)-(288-rh)//2
    # TensorFlow resizeBilinear's default samples from the origin, not half pixels.
    xs=np.arange(rw,dtype=np.float32)*w/rw;ys=np.arange(rh,dtype=np.float32)*h/rh
    xx,yy=np.meshgrid(xs,ys)
    resized=cv2.remap(np.asarray(im),xx,yy,cv2.INTER_LINEAR,borderMode=cv2.BORDER_REPLICATE)
    arr=np.full((288,480,3),114,np.float32);arr[t:t+rh,l:l+rw]=resized
    x=np.transpose(arr/255,(2,0,1))[None].astype(np.float16)
    pred=session.run(None,{session.get_inputs()[0].name:x})[0][0].T.astype(float)
    conf=pred[:,4:].max(1);cls=pred[:,4:].argmax(1)
    xywh=np.column_stack((pred[:,0]-pred[:,2]/2,pred[:,1]-pred[:,3]/2,pred[:,2],pred[:,3]))
    keep=cv2.dnn.NMSBoxes(xywh.tolist(),conf.tolist(),.1,.3)
    out=[]
    for i in np.asarray(keep).flatten():
        x,y,bw,bh=xywh[i];box=[(x-l)*w/rw,(y-t)*h/rh,(x+bw-l)*w/rw,(y+bh-t)*h/rh]
        out.append({'box':box,'class_index':int(cls[i]),'confidence':float(conf[i])})
    return out

def main():
    paths=[Path('/tmp/chess-vision-weights')/f'480{v}_leyolo_{name}.onnx' for v,name in [('M','pieces'),('L','xcorners')]]
    sessions=[ort.InferenceSession(str(p),providers=['CPUExecutionProvider']) for p in paths]
    provenance={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    for index in range(1,7):
        im=Image.open(source(index)).convert('RGB');pieces=detect(im,sessions[0]);corners=detect(im,sessions[1])
        hom=cv2.getPerspectiveTransform(np.float32(CORNERS[index]),np.float32([[0,0],[8,0],[8,8],[0,8]]))
        board=['.']*64;collisions=[];d=ImageDraw.Draw(im)
        for obj in pieces:
            x1,y1,x2,y2=obj['box'];p=LABELS[obj['class_index']];obj['piece']=p
            # Published base estimate. It assumes pieces stand upward in the photo.
            base=[(x1+x2)/2,y2-(x2-x1)/3];obj['base']=base
            c,r=np.floor(cv2.perspectiveTransform(np.float32([[base]]),hom)[0,0]).astype(int)
            if 0<=r<8 and 0<=c<8:
                obj['row_col']=[int(r),int(c)]
                if board[r*8+c]!='.':collisions.append([int(r),int(c)])
                else:board[r*8+c]=p
            d.rectangle(obj['box'],outline='#00bbff',width=2);d.text((x1,y1),f'{p} {obj["confidence"]:.2f}',fill='#ff0077');d.ellipse((base[0]-3,base[1]-3,base[0]+3,base[1]+3),fill='red')
        for obj in corners:
            x1,y1,x2,y2=obj['box'];x=(x1+x2)/2;y=(y1+y2)/2;d.ellipse((x-3,y-3,x+3,y+3),fill='#00ff22')
        im.save(OUT/f'leyolo-image{index}-detections.png')
        result={'image':index,'method':'LeYOLO with manual corners, published upright base rule','weights_sha256':provenance,'pieces':pieces,'corner_detections':corners,'collisions':collisions,'corners':CORNERS[index],'placement':extract(json.dumps({'ranks':[''.join(board[k:k+8]) for k in range(0,64,8)]}))}
        (OUT/f'leyolo-image{index}.json').write_text(json.dumps(result,indent=2)+'\n')
        print(index,len(pieces),len(corners),result['placement'],flush=True)

if __name__=='__main__':main()
