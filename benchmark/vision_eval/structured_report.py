"""Reviewable actual outputs for the frozen recognizer and independent tests."""
import json,html,io,cv2,numpy as np
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
from gemini_audit import OUT,source
from run_openrouter import DEFAULT_OUT,expand,SQUARES
from audit_report import board_svg,evaluate,ROT,TITLES
root=DEFAULT_OUT/'chess-priors'
old=json.loads((OUT/'results.json').read_text())['records'];records=[]
for i,refrow in enumerate(old,1):
 actual=json.loads((root/f'api-image{i}.json').read_text());ref=refrow['reference'];p=expand(actual['placement']);base=np.rot90(np.array(expand(refrow['predictions']['fenify']['original_placement'])).reshape(8,8),ROT[i]).flatten().tolist()
 for key,board in [('new',p),('fenify',base),('reference',[ref.get(s,'.') if len(ref.get(s,'.'))==1 else '.' for s in SQUARES])]:
  (root/f'dev-{i}-{key}.svg').write_text(board_svg(board,ref,key=='reference'))
 im=Image.open(source(i)).convert('RGB').rotate(90*ROT[i],expand=True);im.thumbnail((800,800));im.save(root/f'dev-{i}-photo.jpg')
 records.append({'id':i,'title':TITLES[i],'scope':refrow['reference_scope'],'baseline':refrow['predictions']['fenify']['score']['confirmed_mismatches'],'new':actual['score']['confirmed_mismatches'],'wrong':actual['score']['wrong'],'seconds':actual['seconds'],'review':actual['review_squares']})
held=json.loads((root/'holdout-results.json').read_text())
for r in held['records']:
 ref={s:p for s,p in zip(SQUARES,expand(r['truth'])) if p!='.'};ident=r['id'];im=Image.open(root/'holdout'/f'{ident}.jpg');im.thumbnail((600,600));im.save(root/f'{ident}-thumb.jpg')
 for key in ('joint','fenify','v4'):
  p=np.rot90(np.array(list('.PNBRQKpnbrqk'))[np.array(r['predictions'][key]).reshape(8,8)],r['scores'][key]['display_rotation_ccw']//90).ravel().tolist();(root/f'{ident}-{key}.svg').write_text(board_svg(p,ref))
 (root/f'{ident}-ref.svg').write_text(board_svg(expand(r['truth']),ref,True))
# Score the isolated-piece experiment only where existing references verify identity.
single=[]
for i in range(1,7):
 objs=json.loads((OUT/f'leyolo-image{i}.json').read_text())['pieces'];h=cv2.getPerspectiveTransform(np.float32(json.loads((OUT/f'image{i}-auto-geometry.json').read_text())['corners']),np.float32([[0,0],[8,0],[8,8],[0,8]]));ref=old[i-1]['reference']
 grid=np.rot90(np.arange(64).reshape(8,8),ROT[i]);inverse={int(v):j for j,v in enumerate(grid.ravel())}
 for n in np.linspace(0,len(objs)-1,4,dtype=int):
  path=OUT/f'gemini-single-image{i}-object{n}.json';retry=path.with_name(path.stem+'-retry.json');path=retry if retry.exists() else path;row=json.loads(path.read_text());answer=json.loads(row['content']) if row.get('content') else {};o=objs[n]
  c,r=np.floor(cv2.perspectiveTransform(np.float32([[o['base']]]),h)[0,0]).astype(int);sq=SQUARES[inverse[int(r*8+c)]] if 0<=r<8 and 0<=c<8 else None;expected=ref.get(sq,'.');single.append({'image':i,'object':int(n),'square':sq,'expected':expected,'answer':answer,'file':f'../llm-audit/image{i}-single-object-{n}.png','raw':f'../llm-audit/{path.name}'})
(root/'single-piece-summary.json').write_text(json.dumps(single,indent=2)+'\n')
for row in single:
 large=OUT/f'gemini-image{row["image"]}-single-object-{row["object"]}-large.json'
 if large.exists():
  response=json.loads(large.read_text());row['enlarged_answer']=json.loads(response['content']) if response.get('content') else {};row['enlarged_raw']=f'../llm-audit/{large.name}'
(root/'upscaled-single-summary.json').write_text(json.dumps(single,indent=2)+'\n')
(root/'development-results.json').write_text(json.dumps(records,indent=2)+'\n')

def picture(path,label):return f'<figure><figcaption>{html.escape(label)}</figcaption><img loading="lazy" src="{path}"></figure>'
dev=''
for r in records:
 i=r['id'];dev+=f'<article id="image{i}"><h2>{i}. {r["title"]}</h2><p>{r["scope"]} · {r["seconds"]:.1f} seconds locally</p><div class="grid">'+picture(f'dev-{i}-photo.jpg','Your photo')+picture(f'dev-{i}-reference.svg','Reference · ? means unverified')+picture(f'dev-{i}-fenify.svg',f'Fenify alone · {r["baseline"]} confirmed errors')+picture(f'dev-{i}-new.svg',f'New decoder · {r["new"]} confirmed errors')+'</div><details><summary>Remaining differences and actual API response</summary><p><a href="api-image'+str(i)+'.json">Saved response</a></p><pre>'+html.escape(json.dumps(r['wrong'],indent=2))+'</pre></details></article>'
hold=''
for r in held['records']:
 i=r['id'];hold+=f'<article><h2>{i}</h2><div class="grid">'+picture(f'{i}-thumb.jpg','CVChess photo')+picture(f'{i}-ref.svg','Published reference')+picture(f'{i}-fenify.svg',f'Fenify alone · {r["scores"]["fenify"]["wrong"]} errors')+picture(f'{i}-joint.svg',f'Frozen decoder · {r["scores"]["joint"]["wrong"]} errors')+'</div></article>'
confirmation=json.loads((root/'confirmation-results.json').read_text());confirmed=''
for r in confirmation['records']:
 ident=r['id'];ref={s:p for s,p in zip(SQUARES,expand(r['truth'])) if p!='.'};im=Image.open(root/'holdout'/r['image']);im.thumbnail((600,600));im.save(root/f'{ident}-thumb.jpg')
 for key,board in [('new',expand(r['result']['placement'])),('ref',expand(r['truth'])),('fenify',np.rot90(np.array(expand(r['fenify']['placement'])).reshape(8,8),r['fenify']['display_rotation_ccw']//90).ravel().tolist())]:
  (root/f'{ident}-{key}.svg').write_text(board_svg(board,ref,key=='ref'))
 confirmed+=f'<article><h2>{ident}</h2><div class="grid">'+picture(f'{ident}-thumb.jpg','CVChess photo')+picture(f'{ident}-ref.svg','Published reference')+picture(f'{ident}-fenify.svg',f'Fenify · {r["fenify"]["wrong"]} errors allowing rotation')+picture(f'{ident}-new.svg',f'Actual API · {r["wrong"]} errors, no rotation')+'</div></article>'
pieces=''
for r in single:
 a=r['answer'];expected=r['expected'];label='Unverified type' if len(expected)!=1 else 'Matches reference' if a.get('piece')==expected else 'Disagrees with mapped reference'
 enlarged=r.get('enlarged_answer',{});large_label=enlarged.get('piece','No answer')
 pieces+=f'<article class="piece"><h3>Photo {r["image"]} · object {r["object"]} · {r["square"]}</h3>'+picture(r['file'],'One crop per request')+f'<p>Gemini: <b>{a.get("piece","No answer")}</b> · {label}</p><p>Enlarged to 512px: <b>{large_label}</b></p><p>{html.escape(a.get("shape",""))}</p><p><a href="{r["raw"]}">Native crop response</a> · <a href="{r.get("enlarged_raw",r["raw"])}">512px response</a></p></article>'
page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chess scanner · structured recognition</title><style>*{box-sizing:border-box}body{margin:0;background:#eeeee7;color:#223428;font:16px/1.55 system-ui}main{max-width:1800px;margin:auto;padding:28px}h1{font-size:40px;line-height:1.12;max-width:850px}h2{font-size:24px}p{max-width:1150px}a{color:#276438}article{padding:22px;background:white;border-radius:14px;margin:24px 0}nav{position:sticky;top:0;z-index:1;background:#223428;color:white;padding:14px;display:flex;gap:12px;flex-wrap:wrap}button{font:inherit;padding:9px 15px;border:0;border-radius:5px;cursor:pointer}button.active{background:#d4eab7}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px}figure{margin:0}figcaption{font-weight:650;min-height:48px}img{width:100%;height:350px;object-fit:contain}pre{white-space:pre-wrap;font-size:14px}.note{background:#fff4d6;padding:15px;border-left:4px solid #ab812a}.pieces{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.piece img{height:180px}.piece{margin:0;padding:15px}section[hidden]{display:none}.stats{display:flex;gap:30px;flex-wrap:wrap}.stats strong{display:block;font-size:35px}@media(max-width:1000px){.grid,.pieces{grid-template-columns:repeat(2,1fr)}nav{position:static}}@media(max-width:550px){.grid,.pieces{grid-template-columns:1fr}main{padding:15px}}</style><main><small>ACTUAL LOCAL API OUTPUTS · OCTOBER 2, 2026</small><h1>Visual recognition, with chess constraints.</h1><p>The new recognizer aligns several visual models with independently detected pieces, combines their probabilities, then solves the whole board together. It prioritizes occupancy evidence, limits pawns, separates kings, and allows promoted pieces. No example-specific moves or known positions enter inference.</p><div class="stats"><div><strong>56 → 9</strong>confirmed errors on your six photos</div><div><strong>24 / 24</strong>additional positions matched, allowing rotation</div><div><strong>12 / 12</strong>further API tests matched without rotation</div><div><strong>4–6 sec</strong>local inference on your photos</div></div><p class="note">Your six photos are development examples, and four have incomplete piece labels. The frozen decoder matched 24 additional CVChess positions; Fenify matched 0. V4 alone also matched all 24, so this test does not establish a benefit from the added constraints. These are different positions from one dataset, not 24 different chess sets. V4's training overlap with this dataset is unverified. Five frozen outputs needed rotation; the local API now preserves V4's inferred orientation. Twelve further disjoint positions then matched directly through the actual upload API, with no reference-selected rotations. Removing the chess constraints leaves nine total confirmed development errors as well: the constraints fix one error on the angled board but add one on the tiny board. Most of the improvement comes from alignment, model weighting and independent detection. No production deployment.</p><p><a href="http://127.0.0.1:8768/?scanner=structured">Try the new local scanner</a> · <a href="overview.png">Download visual comparison</a> · <a href="holdout-results.json">All 24 held-out results</a> · <a href="freeze.json">Frozen method and selection protocol</a> · <a href="constraint-ablation.json">With/without chess constraints</a> · <a href="../llm-audit/">Earlier experiments</a></p><nav><button class="active" data-tab="dev">Your 6 photos</button><button data-tab="held">24 additional positions</button><button data-tab="confirm">12 further API tests</button><button data-tab="single">One-piece Gemini test</button></nav><section id="dev">'''+dev+'''</section><section id="held" hidden><p>Both methods are scored after their best whole-board quarter-turn, with every square otherwise untouched. The decoder was frozen before these labels were scored. Raw-frame scores and every candidate remain in the JSON.</p>'''+hold+'''</section><section id="confirm" hidden><p>Twelve different positions selected with seed 20261003, after the coordinate-frame handoff fix. Actual 2048px upload API outputs are compared directly with the published FEN. No truth-selected rotation for the new decoder. Fenify is given its best quarter-turn.</p>'''+confirmed+'''</section><section id="single" hidden><p>24 tightly cropped automatic detections, one image per Gemini request. Each was also retested enlarged to 512px: both versions matched 10 of the 15 exactly labeled objects (nine other types unverified). Native crops received 23 answers and one timeout; enlarged crops received all 24 answers. Objects were selected by evenly spaced detection indices before answers were obtained. Square labels below are computed from the detector's base location; they are not supplied to Gemini. Unverified identities are excluded. This is a diagnosis, not the deployed recognition path.</p><div class="pieces">'''+pieces+'''</div></section></main><script>document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('main>section').forEach(s=>s.hidden=s.id!==b.dataset.tab);document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('active',x===b))});</script></html>'''
(root/'index.html').write_text(page)
import cairosvg
font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',19);large=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',28)
sheet=Image.new('RGB',(1520,2730),'#eeeee7');d=ImageDraw.Draw(sheet);d.text((22,20),'New local recognizer vs Fenify: all six photos',font=large,fill='#223428');d.text((22,65),'Photo | reference | Fenify alone | new decoder. Red = confirmed error; ? = unverified identity.',font=font,fill='#223428')
for n,r in enumerate(records):
 y=115+n*430;i=r['id'];d.text((22,y),f'{i}. {r["title"]}',font=large,fill='#223428')
 for col,key in enumerate(('photo','reference','fenify','new')):
  p=root/f'dev-{i}-{key}.{ "jpg" if key=="photo" else "svg"}'
  im=Image.open(p) if key=='photo' else Image.open(io.BytesIO(cairosvg.svg2png(url=str(p),output_width=340,output_height=340)))
  im=im.convert('RGB');im.thumbnail((340,340));sheet.paste(im,(22+col*380+(340-im.width)//2,y+42+(340-im.height)//2))
 for col,key in ((2,'baseline'),(3,'new')):d.text((22+col*380,y+385),f'{r[key]} confirmed errors',font=font,fill='#223428')
sheet.save(root/'overview.png');print(root/'index.html')
print('single-piece:',sum(len(r['expected'])==1 and r['answer'].get('piece')==r['expected'] for r in single),'correct of',sum(len(r['expected'])==1 for r in single),'with exact mapped reference')
