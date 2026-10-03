"""Automatic board geometry and object detection, without reference annotations.
Detector preprocessing adapted from Pbatch/CameraChessWeb (AGPL-3.0).
"""
import cv2
import numpy as np
from scipy.cluster.vq import kmeans2
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

def fit_grid(image, detections):
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
    return {'corners':corners.tolist(),'inliers':int(mask.sum()),'detected_points':len(points),'median_reprojection_px':float(np.median(error)), 'max_reprojection_px':float(error.max())}
