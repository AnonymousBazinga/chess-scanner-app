"""Manual-corner diagnostic. All 64 cells queried; no occupancy/identity labels.

This establishes whether geometry assistance helps before building a detector.
It is explicitly not an end-to-end automatic scanner benchmark.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import getpass
import json
import cv2
import numpy as np
from PIL import Image,ImageDraw,ImageFont
from gemini_audit import OUT, source, request
from run_openrouter import extract

# Only board boundary coordinates, in original-image pixels. No piece labels.
CORNERS={1:[[75,89],[1148,104],[1141,1160],[77,1157]],
2:[[211,103],[997,105],[1045,697],[164,692]],
3:[[39,40],[582,32],[588,595],[17,589]],
4:[[186,111],[1071,110],[1175,873],[122,867]],
5:[[104,41],[284,39],[286,219],[102,220]],
6:[[188,52],[621,53],[620,481],[188,480]]}

def grid(im,index):
    hom=cv2.getPerspectiveTransform(np.float32([[0,0],[8,0],[8,8],[0,8]]),np.float32(CORNERS[index]))
    def point(x,y):return tuple(map(float,cv2.perspectiveTransform(np.float32([[[x,y]]]),hom)[0,0]))
    annotated=im.copy();d=ImageDraw.Draw(annotated)
    font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',max(10,round(im.width/85)))
    for i in range(9):
        d.line([point(i,0),point(i,8)],fill='#16a6e0',width=2)
        d.line([point(0,i),point(8,i)],fill='#16a6e0',width=2)
    for r in range(8):
        for c in range(8):
            x,y=point(c+.04,r+.04);label=f'{r},{c}';box=d.textbbox((x,y),label,font=font)
            d.rectangle(box,fill='white');d.text((x,y),label,font=font,fill='black')
    return annotated,point

def main():
    p=argparse.ArgumentParser();p.add_argument('--images',type=int,nargs='+',default=[2]);p.add_argument('--mode',choices=['grid','panels'],default='grid');p.add_argument('--model',default='gemini-3.1-flash-lite');args=p.parse_args()
    key=getpass.getpass('Gemini key (hidden, memory only): ')
    OUT.mkdir(exist_ok=True)
    for index in args.images:
        im=Image.open(source(index)).convert('RGB');annotated,point=grid(im,index)
        path=OUT/f'image{index}-manual-grid.png';annotated.save(path)
        if args.mode=='grid':
            prompt='The first image is an unchanged chess photo. The second adds a manually located grid with cell labels row,column, from 0,0 at top left to 7,7 at bottom right. Transcribe every cell. Only the BASE contact with the board determines a piece\'s cell. A tall head above a cell is not its occupant. Use the original for shape/color and the labeled grid for location. Ignore printed border coordinates. No rotation. Return JSON {"ranks":[8 strings of 8 characters],"uncertain_squares":[]}. Each string is one row left-to-right; . is empty; PNBRQK light pawn/knight/bishop/rook/queen/king, lowercase dark. Never assume a legal position or standard inventory.'
            row=request(key,args.model,[source(index),path],prompt,'generate',OUT/f'{args.model}-image{index}-manual-grid.json')
            print(index,'grid',row.get('status'),row.get('placement'),row.get('error'),flush=True)
            continue
        tasks=[]
        font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',25)
        for r in range(8):
            sheet=Image.new('RGB',(1280,720),'white');d=ImageDraw.Draw(sheet)
            for c in range(8):
                poly=[point(c,r),point(c+1,r),point(c+1,r+1),point(c,r+1)]
                xs=[v[0] for v in poly];ys=[v[1] for v in poly];w=max(xs)-min(xs);h=max(ys)-min(ys)
                box=[max(0,int(min(xs)-.25*w)),max(0,int(min(ys)-1.55*h)),min(im.width,int(max(xs)+.25*w)),min(im.height,int(max(ys)+.55*h))]
                crop=im.crop(box);cd=ImageDraw.Draw(crop)
                cd.line([(x-box[0],y-box[1]) for x,y in poly+[poly[0]]],fill='#06d2ff',width=max(2,int(im.width/400)))
                crop.thumbnail((305,312));x=c%4*320;y=c//4*360
                sheet.paste(crop,(x+(320-crop.width)//2,y+38+(312-crop.height)//2));d.text((x+10,y+3),f'Target {c}',font=font,fill='black')
            path=OUT/f'image{index}-row{r}-target-panels.png';sheet.save(path)
            prompt='Eight panels from the same chess photo. In each panel, identify ONLY the piece whose BASE rests INSIDE the CYAN quadrilateral. The quadrilateral is the target square. A neighboring piece whose head projects into it is NOT its occupant. If no base rests in it, return . even if a head or shadow covers it. Use the unmarked original photo (second image) only for visual context. Do not infer a standard position or legal inventory. Return JSON {"targets":"........","uncertain_targets":[]} with exactly 8 characters in target order 0 to 7. Symbols: PNBRQK for light pawn/knight/bishop/rook/queen/king; pnbrqk dark; . empty.'
            tasks.append((r,path,prompt))
        def run(t):
            r,path,prompt=t
            row=request(key,args.model,[path,source(index)],prompt,'generate',OUT/f'{args.model}-image{index}-panels-row{r}.json')
            print(index,r,row.get('status'),row.get('content'),row.get('error'),flush=True)
            return r,row
        rows={}
        with ThreadPoolExecutor(max_workers=2) as pool:
            for r,row in pool.map(run,tasks):
                try:
                    value=json.loads(row['content'])['targets']
                    if len(value)!=8 or any(c not in '.PNBRQKpnbrqk' for c in value):raise ValueError('invalid row')
                    rows[r]=value
                except (ValueError,KeyError):pass
        result={'image':index,'model':args.model,'mode':'manual-corner-target-panels','corners':CORNERS[index],'complete_rows':len(rows),'status':'incomplete'}
        if len(rows)==8:result.update(status='ok',placement=extract(json.dumps({'ranks':[rows[r] for r in range(8)]})))
        (OUT/f'{args.model}-image{index}-panels-summary.json').write_text(json.dumps(result,indent=2)+'\n');print(result,flush=True)

if __name__=='__main__':main()
