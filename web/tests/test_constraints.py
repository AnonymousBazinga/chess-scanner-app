import unittest
import numpy as np
from scanner_backend.chess_constraints import infer, CHARS

class MissingGeometryTests(unittest.TestCase):
    def test_infeasible_occupancy_can_relax(self):
        p=np.full((8,8,13),1e-5);p[:,:,0]=.9
        p[3,3,0]=p[3,4,0]=1e-5
        p[3,3,CHARS.index('K')]=.99;p[3,4,CHARS.index('k')]=.99
        board,meta,_=infer({'v4_0':p},[])
        white=np.flatnonzero(board==CHARS.index('K'));black=np.flatnonzero(board==CHARS.index('k'))
        self.assertEqual(len(white),1);self.assertEqual(len(black),1)
        a,b=divmod(int(white[0]),8),divmod(int(black[0]),8)
        self.assertGreater(max(abs(a[0]-b[0]),abs(a[1]-b[1])),1)
