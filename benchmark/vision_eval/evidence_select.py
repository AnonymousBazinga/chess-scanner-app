"""Development candidate: select a whole-board proposal by independent detections.

Frozen scoring rule before six-photo scoring: missing a detected object costs its
confidence; wrong color costs half its confidence; unsupported occupied cells
cost .15. Piece type is deliberately excluded. No manual labels/corners.
"""
import json
import cv2
import numpy as np
from gemini_audit import OUT
from run_openrouter import expand,extract

def fen(board):return extract(json.dumps({'ranks':[''.join(board[k:k+8]) for k in range(0,64,8)]}))

def select(rows,objects,corners):
    hom=cv2.getPerspectiveTransform(np.float32(corners),np.float32([[0,0],[8,0],[8,8],[0,8]]))
    evidence={}
    for o in objects:
        c,r=np.floor(cv2.perspectiveTransform(np.float32([[o['base']]]),hom)[0,0]).astype(int)
        if 0<=r<8 and 0<=c<8:
            idx=int(r*8+c)
            if idx not in evidence or o['confidence']>evidence[idx]['confidence']:evidence[idx]=o
    candidates=[]
    for row in rows:
        board=np.array(expand(row['placement'])).reshape(8,8)
        rotations=[0] if row['coordinate_frame']=='photo' else range(4)
        for k in rotations:
            b=np.rot90(board,k).flatten().tolist();loss=0
            for idx,p in enumerate(b):
                o=evidence.get(idx)
                if o:
                    if p=='.':loss+=o['confidence']
                    elif p.isupper()!=o['piece'].isupper():loss+=.5*o['confidence']
                elif p!='.':loss+=.15
            candidates.append({'loss':float(loss),'placement':fen(b),'model':row['model'],'variant':row['variant'],'input_rotation_ccw':row.get('input_rotation_ccw'),'output_rotation_ccw':k*90,'mean_max_probability':row['mean_max_probability']})
    candidates.sort(key=lambda r:(r['loss'],-r['mean_max_probability']))
    return {'placement':candidates[0]['placement'],'selected':candidates[0],'candidates':candidates,'evidence_squares':len(evidence),'coordinate_frame':'photo','method':'automatic-grid-independent-detection-proposal-selection','experimental':True}

def main():
    for i in range(1,7):
        rows=json.loads((OUT/f'normalized-models-image{i}.json').read_text());objs=json.loads((OUT/f'leyolo-image{i}.json').read_text())['pieces'];corners=json.loads((OUT/f'image{i}-auto-geometry.json').read_text())['corners']
        result={'image':i,**select(rows,objs,corners)}
        (OUT/f'evidence-selection-image{i}.json').write_text(json.dumps(result,indent=2)+'\n');print(i,result['selected'],flush=True)

if __name__=='__main__':main()
