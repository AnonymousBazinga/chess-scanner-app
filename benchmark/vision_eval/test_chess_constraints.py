import unittest
import numpy as np
from chess_constraints import decode,CHARS
from structured_recognizer import canonicalize

def probability(pieces):
 p=np.full((64,13),1e-6);p[:,0]=.99
 for square,piece in pieces.items():
  i=(8-int(square[1]))*8+'abcdefgh'.index(square[0]);p[i,:]=1e-6;p[i,CHARS.index(piece)]=.99
 return p.reshape(8,8,13)

class ChessConstraintsTest(unittest.TestCase):
 def test_promoted_queens_remain_allowed(self):
  p=probability({'a1':'K','h8':'k','d4':'Q','f6':'Q'});b,_=decode(p,lock_occupancy=True)
  self.assertEqual(sum(b==CHARS.index('Q')),2)
 def test_never_creates_piece_to_satisfy_king(self):
  p=probability({'a1':'Q','h8':'k'});b,_=decode(p,lock_occupancy=True)
  self.assertEqual(set(np.where(b!=0)[0]),{7,56});self.assertEqual(b[56],CHARS.index('K'))
 def test_no_adjacent_kings(self):
  p=probability({'a1':'K','a2':'k','h8':'q'});b,_=decode(p,lock_occupancy=True)
  w=np.argwhere(b.reshape(8,8)==6)[0];d=np.argwhere(b.reshape(8,8)==12)[0]
  self.assertGreater(np.max(abs(w-d)),1)
 def test_orientation_transform_is_inverted(self):
  board=np.arange(64).reshape(8,8)
  for k in range(4):
   photo=np.rot90(board,k);back,_=canonicalize(photo,{'components':[{'name':'v4_0','align_ccw':k}]})
   np.testing.assert_array_equal(back,board.ravel())
if __name__=='__main__':unittest.main()
