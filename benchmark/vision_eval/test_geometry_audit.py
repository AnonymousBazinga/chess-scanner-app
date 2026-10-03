"""Checks for coordinate transforms, distinct from model-accuracy measurements."""
import unittest
import cv2
import numpy as np
from PIL import Image
from grid_normalize import rectify
from aligned_consensus import orient
from evidence_select import select
from run_openrouter import extract
import json

class GeometryChecks(unittest.TestCase):
    def test_missing_intersection_does_not_shift_board(self):
        corners=np.float32([[140,90],[930,110],[1030,810],[80,820]])
        hom=cv2.getPerspectiveTransform(np.float32([[0,0],[8,0],[8,8],[0,8]]),corners)
        grid=np.float32([[[x,y] for y in range(1,8) for x in range(1,8) if (x,y)!=(1,1)]])
        pts=cv2.perspectiveTransform(grid,hom)[0]
        detections=[{'box':[float(x-2),float(y-2),float(x+2),float(y+2)]} for x,y in pts]
        _,info=rectify(Image.new('RGB',(1100,900)),detections)
        np.testing.assert_allclose(info['corners'],corners,atol=.01)
        self.assertEqual(info['inliers'],48)

    def test_rejects_insufficient_geometry(self):
        with self.assertRaises(ValueError):rectify(Image.new('RGB',(500,500)),[])

    def test_vote_orientation_preserves_piece_identity(self):
        b=np.full((8,8),'.');b[0,1]='k';b[1,3]='p';b[6,2]='N';b[7,4]='K'
        for k in range(4):
            aligned,meta=orient(np.rot90(b,k).flatten().tolist())
            self.assertEqual(aligned,b.flatten().tolist())

    def test_detector_evidence_aligns_model_output(self):
        b=np.full((8,8),'.');b[1,2]='p';b[6,4]='N'
        f=extract(json.dumps({'ranks':[''.join(r) for r in np.rot90(b,1)]}))
        proposals=[{'placement':f,'coordinate_frame':'model inferred','model':'test','variant':'original','mean_max_probability':.9}]
        objects=[{'base':[250,150],'piece':'p','confidence':.9},{'base':[450,650],'piece':'N','confidence':.9}]
        result=select(proposals,objects,[[0,0],[800,0],[800,800],[0,800]])
        self.assertEqual(result['selected']['loss'],0)
        self.assertEqual(result['placement'],extract(json.dumps({'ranks':[''.join(r) for r in b]})))

if __name__=='__main__':unittest.main()
