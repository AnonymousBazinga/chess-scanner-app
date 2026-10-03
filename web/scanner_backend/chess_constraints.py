"""Joint visual decoder. No image names, truth boards, or reference labels.

Visual probabilities are combined with a soft inventory prior and hard necessary
standard-chess constraints. Promoted pieces are supported. Orientation remains
ambiguous up to rotations; the reported frame is the input photo.
"""
import numpy as np
from scipy.optimize import milp, Bounds, LinearConstraint
from scipy.sparse import lil_matrix
CHARS='.PNBRQKpnbrqk'

def decode(prob, strength=1.0, lock_occupancy=False):
    p=np.asarray(prob,float).reshape(64,13);p=np.clip(p,1e-6,1);p/=p.sum(1,keepdims=True)
    # Temper extreme neural confidence. Alternatives below 1e-6 remain costly.
    cost=-np.log(p).ravel()/2
    # Eight excess inventory variables (Q,R,B,N for each side), penalized softly.
    n=840;cost=np.r_[cost,np.ones(8)*1.5*strength];rows=[];lo=[];hi=[]
    def add(items,lower=-np.inf,upper=np.inf):
        rows.append(items);lo.append(lower);hi.append(upper)
    for i in range(64):add({i*13+c:1 for c in range(13)},1,1)
    for color,offset in enumerate((0,6)):
        add({i*13+6+offset:1 for i in range(64)},1,1)
        add({i*13+c:1 for i in range(64) for c in range(1+offset,7+offset)},upper=16)
        add({i*13+1+offset:1 for i in range(64)},upper=8)
        for j,(c,base) in enumerate(((5,1),(4,2),(3,2),(2,2))):
            add({**{i*13+c+offset:1 for i in range(64)},832+color*4+j:-1},upper=base)
        add({**{i*13+1+offset:1 for i in range(64)},**{832+color*4+j:1 for j in range(4)}},upper=8)
    for i in range(64):
        r,c=divmod(i,8)
        for rr in range(max(0,r-1),min(8,r+2)):
            for cc in range(max(0,c-1),min(8,c+2)):
                j=rr*8+cc
                if i!=j:add({i*13+6:1,j*13+12:1},upper=1)
    mat=lil_matrix((len(rows),n))
    for r,items in enumerate(rows):
        for c,v in items.items():mat[r,c]=v
    upper=np.r_[np.ones(832),np.full(8,8.)]
    # This input is a candidate standard board orientation. Pawns cannot remain
    # on a promotion rank, but extra queens/rooks/bishops/knights are legal.
    for i in [*range(8),*range(56,64)]:upper[i*13+1]=upper[i*13+7]=0
    if lock_occupancy:
        for i in range(64):
            if p[i,0]>.5:upper[i*13+1:i*13+13]=0
            else:upper[i*13]=0
    result=milp(cost,integrality=np.r_[np.ones(832),np.zeros(8)],bounds=Bounds(np.zeros(n),upper),constraints=LinearConstraint(mat.tocsr(),lo,hi),options={'time_limit':8,'mip_rel_gap':.0001})
    if result.x is None:raise ValueError('No chess-consistent assignment')
    b=result.x[:832].reshape(64,13).argmax(1)
    original=p.argmax(1);changes=np.where(b!=original)[0].tolist()
    return b,{'objective':float(result.fun),'correction_cost':float(result.fun-np.min(cost[:832].reshape(64,13),1).sum()),'changed_indices':changes,'optimal':bool(result.success)}

def geometric_score(prob,objects):
    """Independent detected occupancy/color evidence; detector type is excluded."""
    b=prob.argmax(-1).reshape(64);value=0.;covered=set()
    for o in objects:
        idx=o['index'];covered.add(idx);v=int(b[idx]);conf=o['confidence']
        value+=conf*(1.0 if v==0 else .5 if (v<=6)!=(o['piece'].isupper()) else 0.)
    value+=.15*sum(v!=0 and i not in covered for i,v in enumerate(b))
    return value

def align_view(name,prob,objects):
    """Return the first minimum-cost frame; all geometry costs are nonnegative."""
    rotations=(0,) if name.startswith('fenify') else range(4)
    aligned=[(geometric_score(np.rot90(prob,k),objects),k,np.rot90(prob,k).copy()) for k in rotations]
    score,k,p=min(aligned,key=lambda v:v[0])
    return {'name':name,'p':p,'geometry_cost':score,'align_ccw':k}

def infer(posteriors,objects):
    if not objects:
        p=posteriors["v4_0"]
        try: b,meta=decode(p,lock_occupancy=2<=np.sum(p.argmax(-1)!=0)<=32)
        except ValueError: b,meta=decode(p,lock_occupancy=False)
        return b,{"fallback":"V4 + constraints; grid detector unavailable","orientation":"model inferred",**meta},p
    # Fenify retains the input frame; ChessQueries may canonicalize it.
    candidates=[align_view(name,p,objects) for name,p in posteriors.items()]
    # One view per architecture avoids counting correlated rotations as votes.
    selected=[]
    for group in ('fenify','v4','vitl'):
        options=[c for c in candidates if c['name'].startswith(group)]
        selected.append(min(options,key=lambda c:c['geometry_cost']))
    costs=np.array([s['geometry_cost'] for s in selected]);weights=np.exp(-(costs-costs.min())/2.0);weights/=weights.sum()
    mix=sum(w*s['p'] for w,s in zip(weights,selected))
    # Modest independent silhouette evidence; a missed detector never erases pieces.
    for o in objects:
        r,c=divmod(o['index'],8);alpha=.35*o['confidence'];evidence=np.full(13,.01)
        evidence[CHARS.index(o['piece'])]=.88
        mix[r,c]=(1-alpha)*mix[r,c]+alpha*evidence
    lock=2<=np.sum(mix.argmax(-1)!=0)<=32
    decoded=[]
    # Both pawn-axis orientations are tried. 180 degrees has identical hard
    # constraints; do not pretend game-facing orientation is proven by this.
    for k in (0,1):
        try:b,meta=decode(np.rot90(mix,k),lock_occupancy=lock)
        except ValueError:b,meta=decode(np.rot90(mix,k))
        back=np.rot90(b.reshape(8,8),-k).reshape(-1)
        decoded.append((meta['objective'],back,meta,k))
    _,board,meta,k=min(decoded,key=lambda v:v[0])
    return board,{'components':[{key:s[key] for key in ('name','geometry_cost','align_ccw')}|{'weight':float(w)} for w,s in zip(weights,selected)],'constraint_rotation_ccw':k*90,**meta,'orientation':'photo; game-facing direction not determined'},mix
