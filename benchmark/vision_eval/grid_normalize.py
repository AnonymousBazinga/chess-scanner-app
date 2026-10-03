"""Automatic grid rectification using LeYOLO intersections, no manual geometry.

Fits a projective 7x7 internal lattice and rejects inconsistent detections.
Current implementation handles grids with separable image rows/columns; returns
an error for heavy rotations/skew instead of manufacturing corner coordinates.
"""
import json
from pathlib import Path
import cv2
import numpy as np
from PIL import Image,ImageDraw
from scipy.cluster.vq import kmeans2
from gemini_audit import OUT,source

def rectify(image, detections):
    points=np.float32([[(v['box'][0]+v['box'][2])/2,(v['box'][1]+v['box'][3])/2] for v in detections])
    if len(points)<35:raise ValueError('Not enough grid evidence')
    groups=[]
    for axis in (0,1):
        initial=np.quantile(points[:,axis],np.linspace(.05,.95,7))[:,None]
        centers,_=kmeans2(points[:,axis,None],initial,minit='matrix',iter=40)
        centers=np.sort(centers.flatten())
        groups.append(np.argmin(abs(points[:,axis,None]-centers[None,:]),1)+1)
    cells=np.float32(np.stack(groups,1))
    if len(np.unique(cells,axis=0))<35:raise ValueError('Grid assignments ambiguous')
    hom,mask=cv2.findHomography(cells,points,cv2.RANSAC,max(image.size)*.008)
    if hom is None or mask.sum()<35:raise ValueError('Grid fit rejected')
    projected=cv2.perspectiveTransform(cells[None],hom)[0]
    error=np.linalg.norm(projected-points,axis=1)
    corners=cv2.perspectiveTransform(np.float32([[[0,0],[8,0],[8,8],[0,8]]]),hom)[0]
    area=abs(cv2.contourArea(corners));iw,ih=image.size
    if area<iw*ih*.08 or area>iw*ih*1.2:raise ValueError('Implausible board area')
    # The manual-corner diagnostic is never imported or consulted here.
    matrix=cv2.getPerspectiveTransform(corners,np.float32([[0,0],[800,0],[800,800],[0,800]]))
    warped=Image.fromarray(cv2.warpPerspective(np.asarray(image),matrix,(800,800),borderMode=cv2.BORDER_REPLICATE))
    return warped,{'corners':corners.tolist(),'inliers':int(mask.sum()),'detected_points':len(points),'median_reprojection_px':float(np.median(error)), 'max_reprojection_px':float(error.max())}

def main():
    for i in range(1,7):
        row=json.loads((OUT/f'leyolo-image{i}.json').read_text());im=Image.open(source(i)).convert('RGB')
        try:
            warped,info=rectify(im,row['corner_detections']);warped.save(OUT/f'image{i}-auto-rectified.png')
            # Bounding crop retains original perspective and projecting heads.
            corners=np.array(info['corners']);lo=corners.min(0);hi=corners.max(0);span=hi-lo
            box=[max(0,int(lo[0]-.05*span[0])),max(0,int(lo[1]-.2*span[1])),min(im.width,int(hi[0]+.05*span[0])),min(im.height,int(hi[1]+.05*span[1]))]
            im.crop(box).save(OUT/f'image{i}-auto-crop.png');info['crop_box']=box
            d=ImageDraw.Draw(im);d.line([tuple(x) for x in np.vstack((corners,corners[0]))],fill='#00ddff',width=4);im.save(OUT/f'image{i}-auto-boundary.png');info['status']='ok'
        except ValueError as exc:info={'status':'error','error':str(exc)}
        (OUT/f'image{i}-auto-geometry.json').write_text(json.dumps(info,indent=2)+'\n');print(i,info,flush=True)

if __name__=='__main__':main()
