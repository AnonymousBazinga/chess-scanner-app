"""Safe pruning must preserve decisions, including uncertain or missing geometry."""
import unittest
from unittest.mock import Mock, patch
import cv2
import numpy as np
import torch
from PIL import Image
from scanner_backend.recognizer import StructuredRecognizer
from scanner_backend.vision_geometry import fit_grid

class PruningTests(unittest.TestCase):
    def test_missing_geometry_runs_only_v4_without_loading_other_models(self):
        model=StructuredRecognizer.__new__(StructuredRecognizer)
        model.transform=lambda x: torch.zeros(3,4,4)
        model.v4=Mock(return_value=torch.zeros(1,64,13))
        result=model.probabilities(Image.new('RGB',(80,60)),[])
        self.assertEqual(list(result),['v4_0'])
        model.v4.assert_called_once()
        self.assertNotIn('fenify',model.__dict__)
        self.assertNotIn('vitl',model.__dict__)

    def test_missing_grid_skips_piece_detection(self):
        model=StructuredRecognizer.__new__(StructuredRecognizer)
        model.detectors=['pieces','corners']
        p=np.full((8,8,13),1/13)
        model.probabilities=Mock(return_value={'v4_0':p})
        with patch('scanner_backend.recognizer.detect',return_value=[]) as detector, patch('scanner_backend.recognizer.infer',return_value=(np.zeros(64,dtype=int),{},p)):
            result=model.predict(Image.new('RGB',(80,60)))
        self.assertEqual(detector.call_count,1)
        self.assertEqual(detector.call_args.args[1],'corners')
        self.assertEqual(result['geometry']['status'],'unavailable')
        self.assertEqual(model.probabilities.call_args.args[1],[])

    def test_grid_fit_preserves_corners_without_rendering_unused_image(self):
        corners=np.float32([[140,90],[930,110],[1030,810],[80,820]])
        hom=cv2.getPerspectiveTransform(np.float32([[0,0],[8,0],[8,8],[0,8]]),corners)
        grid=np.float32([[[x,y] for y in range(1,8) for x in range(1,8) if (x,y)!=(1,1)]])
        points=cv2.perspectiveTransform(grid,hom)[0]
        detections=[{'box':[float(x-2),float(y-2),float(x+2),float(y+2)]} for x,y in points]
        with patch('cv2.warpPerspective',side_effect=AssertionError('Unused image warp')):
            result=fit_grid(Image.new('RGB',(1100,900)),detections)
        np.testing.assert_allclose(result['corners'],corners,atol=.01)
        self.assertEqual(result['inliers'],48)

    @staticmethod
    def stub_model():
        model=StructuredRecognizer.__new__(StructuredRecognizer)
        model.transform=lambda x:torch.zeros(3,4,4)
        p=np.full((8,8,13),1e-6,dtype=np.float32);p[:,:,0]=.99
        for i,c in [(3,12),(14,7),(49,1),(60,6)]:
            p.reshape(64,13)[i]=1e-6;p.reshape(64,13)[i,c]=.99
        p/=p.sum(-1,keepdims=True)
        model.fenify=Mock(return_value=torch.from_numpy(p[::-1].copy()).reshape(1,64,13))
        logits=torch.from_numpy(np.log(p)).reshape(1,64,13)
        model.v4=Mock(return_value=logits);model.vitl=Mock(return_value=logits)
        objects=[{'index':i,'piece':c,'confidence':.9} for i,c in [(3,'k'),(14,'p'),(49,'P'),(60,'K')]]
        return model,p,objects

    def test_zero_score_stops_each_rotation_search_at_first_tie(self):
        model,p,objects=self.stub_model()
        result=model.probabilities(Image.new('RGB',(80,60)),objects)
        self.assertEqual(list(result),['fenify_0','v4_0','vitl_0'])
        for network in (model.fenify,model.v4,model.vitl):network.assert_called_once()

    def test_even_tiny_nonzero_score_keeps_searching(self):
        model,p,objects=self.stub_model()
        # No view with only four pieces can explain these five distinct objects.
        objects.append({'index':25,'piece':'P','confidence':1e-12})
        result=model.probabilities(Image.new('RGB',(80,60)),objects)
        self.assertEqual(len(result),9)
        self.assertEqual(model.fenify.call_count,4)
        self.assertEqual(model.v4.call_count,4)
        model.vitl.assert_called_once()

    def test_models_stop_independently_after_a_later_perfect_view(self):
        model,p,objects=self.stub_model()
        wrong=p.copy();wrong[1,6]=p[0,0]
        model.v4.side_effect=[torch.from_numpy(np.log(wrong)).reshape(1,64,13),torch.from_numpy(np.log(p)).reshape(1,64,13)]
        result=model.probabilities(Image.new('RGB',(80,60)),objects)
        self.assertEqual(list(result),['fenify_0','v4_0','vitl_0','v4_1'])
        self.assertEqual(model.v4.call_count,2)
        model.fenify.assert_called_once();model.vitl.assert_called_once()
