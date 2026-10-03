"""Independent physical-piece detector from the Reddit practitioner's repository."""
import json,time,torch,cv2,numpy as np
from pathlib import Path
from rfdetr import RFDETRSmall
from PIL import Image,ImageDraw
from gemini_audit import OUT,source
from run_openrouter import DEFAULT_OUT
from hybrid import placement
root=DEFAULT_OUT/'chess-priors';torch.set_num_threads(4)
path='/tmp/chess-vision-dynamic/chess-model-rfdetr.pth'
# Explicitly inspect model checkpoint metadata; this is the upstream published file.
checkpoint=torch.load(path,map_location='cpu',weights_only=False);args=checkpoint['args'];names=list(args.get('class_names',[]) if isinstance(args,dict) else args.class_names)
print('classes',names,flush=True)
model=RFDETRSmall(device='cpu',pretrain_weights=path,num_classes=len(names))
for i in range(1,7):
 im=Image.open(source(i)).convert('RGB');start=time.monotonic();detections=model.predict(im,threshold=.35);rows=[];d=ImageDraw.Draw(im)
 for box,cls,conf in zip(detections.xyxy,detections.class_id,detections.confidence):
  name=names[int(cls)];rows.append({'box':box.tolist(),'class':name,'confidence':float(conf)})
  d.rectangle(box.tolist(),outline='red',width=2);d.text((box[0],box[1]),name,fill='#00ddff')
 im.save(root/f'rfdetr-image{i}.jpg');(root/f'rfdetr-image{i}.json').write_text(json.dumps({'detections':rows,'seconds':time.monotonic()-start},indent=2));print(i,len(rows),flush=True)
