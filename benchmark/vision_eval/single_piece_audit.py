"""Blind one-object-per-request ablation; deterministic coverage across six photos."""
import concurrent.futures, getpass, json
import numpy as np
from PIL import Image
from gemini_audit import OUT, source, request

PROMPT='''This image is a tight bounding-box crop of one physical chess piece. Identify the dominant complete object, ignoring fragments at the edges. Use its silhouette and head. Return JSON {"piece":"P","alternatives":["B"],"shape":"brief observable shape","uncertain":false}. Use PNBRQK for light pawn, knight, bishop, rook, queen, king; lowercase for dark. Do not infer its square or position. If the set is unfamiliar, give the best visual identification and mark uncertainty. A horse/question-mark head suggests knight, small rounded head pawn, crenellated tower rook, slit/mitre bishop. Kings and queens vary between sets.'''

def main():
    key=getpass.getpass('Gemini key (hidden): ');tasks=[]
    for i in range(1,7):
        objects=json.loads((OUT/f'leyolo-image{i}.json').read_text())['pieces'];im=Image.open(source(i)).convert('RGB')
        for n in np.linspace(0,len(objects)-1,4,dtype=int):
            p=OUT/f'image{i}-single-object-{n}.png';im.crop(tuple(map(round,objects[n]['box']))).save(p)
            tasks.append((i,int(n),p))
    def run(t):
        i,n,p=t;r=request(key,'gemini-3.1-flash-lite',[p],PROMPT,'generate',OUT/f'gemini-single-image{i}-object{n}.json')
        print(json.dumps({'image':i,'object':n,'status':r['status'],'content':r.get('content'), 'error':r.get('error')}),flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(run,tasks))
if __name__=='__main__':main()
