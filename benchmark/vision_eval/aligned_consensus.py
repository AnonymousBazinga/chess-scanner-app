"""Candidate only: align model grids by piece-color centroids before voting.

This convention puts the light-piece centroid closest to the bottom. It is not
proof of actual chess coordinates and can be ambiguous in scattered positions.
No reference labels or sample-specific branches are used.
"""
from collections import Counter
import numpy as np

def orient(board):
    grid=np.array(board).reshape(8,8)
    choices=[]
    for k in range(4):
        b=np.rot90(grid,k)
        w=[r for r in range(8) for c in range(8) if b[r,c].isupper()]
        dark=[r for r in range(8) for c in range(8) if b[r,c].islower()]
        choices.append(float(np.mean(w)-np.mean(dark)) if w and dark else 0.)
    k=int(np.argmax(choices));margin=sorted(choices)[-1]-sorted(choices)[-2]
    return np.rot90(grid,k).flatten().tolist(),{'rotation_ccw':90*k,'color_separation':choices[k],'orientation_margin':margin}

def combine(boards):
    aligned=[orient(b) for b in boards]
    output=[];uncertain=[]
    for i in range(64):
        votes=[b[0][i] for b in aligned];counts=Counter(votes)
        # Occupancy is a vote as well. Prefer V4, then ViT-L, then Fenify on ties.
        order=[votes[2],votes[1],votes[0]]
        p=max(order,key=lambda x:counts[x]);output.append(p)
        if len(counts)>1:uncertain.append(i)
    return output,{'alignment':[b[1] for b in aligned],'disputed_indices':uncertain}
