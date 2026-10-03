"""Six-photo audit with fixed coordinate transforms and untouched raw responses."""
import ast
import html
import io
import json
from pathlib import Path
import chess
import chess.svg
import numpy as np
from PIL import Image,ImageDraw,ImageFont
from gemini_audit import OUT,source
from run_openrouter import DEFAULT_OUT,SQUARES,expand

# Reuse the existing pure renderer functions, without running its report builder.
tree=ast.parse(Path(__file__).with_name('batch_visual.py').read_text())
pure=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in ('describe','evaluate','board_svg')]
exec(compile(ast.Module(body=pure,type_ignores=[]),'batch_visual-renderer','exec'))
_describe=describe
def describe(p):
    return 'occupied (color and type unverified)' if len(p)==12 else _describe(p)

ROT={1:0,2:0,3:1,4:3,5:2,6:3}
TITLES={1:'Original Getty board',2:'Angled carved board',3:'Yellow / black set',4:'Sparse Alamy board',5:'Small Shutterstock board',6:'Warm shadowed board'}
METHODS={'v4':'ChessQ Lite V4 alone','gemini':'Gemini Flash Lite · whole photo','flash':'Gemini Flash Preview · whole photo','inkling':'Inkling · actual supported client','objects':'Automatic piece crops + Gemini','grid':'Gemini + manually marked grid (diagnostic)','select':'Automatic geometry + model selection (candidate)','aligned':'Aligned voting (candidate)','leyolo':'LeYOLO + manual corners (diagnostic)'}

def main():
    refs={r['id']:r['reference'] for r in json.loads((DEFAULT_OUT/'new-batch-review/results.json').read_text())['records']}
    refs[1]={s:'PNBRQKpnbrqk' for s in 'a1 a2 a3 a8 b5 b8 c1 c4 c7 c8 d1 d2 d6 d8 e1 e3 e5 e8 f4 f7 g1 g8 h1 h2 h3 h6 h8'.split()}
    refs[2]={s:p for s,p in zip(SQUARES,expand('r2q1rk1/pbp2pbp/1pn1pnp1/3p4/4P3/1PNP1NP1/PBP2PBP/R2Q1RK1')) if p!='.'}
    records=[]
    for i in range(1,7):
        photo=Image.open(source(i)).convert('RGB').rotate(90*ROT[i],expand=True);photo.save(OUT/f'image{i}-comparison.jpg')
        ref=refs[i];b=[ref.get(s,'.') if len(ref.get(s,'.'))==1 else '.' for s in SQUARES]
        reference_svg=board_svg(b,ref,True)
        if i==1:reference_svg=reference_svg.replace('fill="#fff"','fill="#b5b5b5"')
        (OUT/f'image{i}-reference.svg').write_text(reference_svg)
        specs={
          'gemini':(f'gemini-3.1-flash-lite-generate-image{i}-whole-r1.json',True),
          'flash':(f'gemini-3-flash-preview-generate-image{i}-whole-r1.json',True),
          'inkling':(f'inkling-claude-code-image{i}-r2.json',True),
          'objects':(f'gemini-3.1-flash-lite-image{i}-objects-summary.json',True),
          'grid':(f'gemini-3.1-flash-lite-image{i}-manual-grid.json',True),
          'select':(f'evidence-selection-image{i}.json',True),
          'aligned':(f'aligned-image{i}.json',False),
          'leyolo':(f'leyolo-image{i}.json',True)}
        preds={}
        if i<=2:
            base={m:json.loads((DEFAULT_OUT/f'local-{name}.json').read_text())[i-1] for m,name in [('fenify','fenify-3D'),('v4','ChessQ_Lite_V4')]}
        else:
            comp=json.loads((DEFAULT_OUT/f'new-image-{i}/hybrid-original.json').read_text())['components'];base={m:{'placement':comp[m]} for m in ('fenify','v4')}
        for key in ['fenify','v4',*specs]:
            if key in base:r=base[key];rotate=key=='fenify';raw=None
            else:
                raw,rotate=specs[key];path=OUT/raw
                r=json.loads(path.read_text()) if path.exists() else {'error':'Not completed','status':'not_completed'}
            pred={'raw':raw,'status':r.get('status','ok'),'seconds':r.get('seconds'),'content':r.get('content','')}
            if 'placement' in r:
                board=expand(r['placement'])
                if rotate:board=np.rot90(np.array(board).reshape(8,8),ROT[i]).flatten().tolist()
                file=f'image{i}-{key}.svg';(OUT/file).write_text(board_svg(board,ref))
                pred.update(svg=file,original_placement=r['placement'],display_rotation_ccw=ROT[i]*90 if rotate else 0,score=evaluate(board,ref))
                if key=='objects':pred['incomplete']=r['classified']!=r['objects'];pred['coverage']=f"{r['classified']} of {r['objects']} detected objects classified"
            else:pred['error']=r.get('error','Response is not a valid 8 × 8 board; retained below without repair.')
            preds[key]=pred
        records.append({'id':i,'title':TITLES[i],'reference_scope':'Occupancy only; all identities unverified' if i==1 else 'Full manual reference' if i in (2,4) else 'Partial manual reference; amber identities unverified','reference':ref,'predictions':preds})
    data={'records':records,'methods':METHODS,'coordinate_note':'Photo-relative outputs are rotated by the known input-view transform solely for comparison. No piece is moved independently or reclassified. V4 and aligned-vote outputs retain their inferred frames. Board orientation remains a separate product problem.','status':'No tested candidate is a reliable six-photo replacement.'}
    (OUT/'results.json').write_text(json.dumps(data,indent=2)+'\n')
    options=''.join(f'<option value="{k}">{v}</option>' for k,v in METHODS.items())
    sections=''.join(f'''<section id="image{i}"><h2>{i}. {html.escape(TITLES[i])}</h2><p>{records[i-1]['reference_scope']}</p><div class="views"><figure><figcaption>Photo · comparison orientation</figcaption><img src="image{i}-comparison.jpg" alt="Input photo"><a href="image{i}-auto-boundary.png">Automatic board boundary</a> · <a href="leyolo-image{i}-detections.png">Detected pieces</a></figure><figure><figcaption>Manual reference · ? = unverified</figcaption><img src="image{i}-reference.svg" alt="Reference"></figure><figure><figcaption>Fenify-3D alone · same original photo</figcaption><img src="image{i}-fenify.svg" alt="Fenify prediction"><p class="baseline"></p></figure><figure><figcaption class="label"></figcaption><img class="prediction" alt="Exact model output"><p class="metric"></p><p class="coverage"></p></figure></div><details><summary>Exact response, input and square differences</summary><div class="details"></div></details></section>''' for i in range(1,7))
    page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chess scanner · six-photo model audit</title><style>*{box-sizing:border-box}body{background:#eeeee7;color:#243327;font:16px/1.5 system-ui;margin:0}main{max-width:1800px;margin:auto;padding:30px 22px}h1{font-size:38px;line-height:1.15}h2{font-size:25px}p{max-width:1150px}.note{border-left:4px solid #a37c28;background:#fff4d6;padding:14px 18px}.controls{position:sticky;top:0;z-index:2;background:#243327;color:white;padding:14px;border-radius:8px}select{font:inherit;margin-left:12px;padding:8px;max-width:100%}section{scroll-margin-top:90px;padding:22px;background:white;border-radius:12px;margin:26px 0}.views{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px}figure{margin:0;min-width:0}figcaption{font-weight:650;min-height:48px}img{width:100%;height:370px;object-fit:contain;background:#fafaf5}figure p{font-size:14px}a{color:#356538}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:420px;overflow:auto;background:#f4f4ed;padding:12px}table{border-collapse:collapse}td,th{padding:6px 12px;text-align:left;border-bottom:1px solid #ddd}.metric{font-weight:650}details{margin-top:18px}@media(max-width:950px){.views{grid-template-columns:repeat(2,minmax(0,1fr))}.controls{position:static}}@media(max-width:550px){.views{grid-template-columns:1fr}h1{font-size:29px}}</style><main><small>OCTOBER 2, 2026 · SIX ORIGINAL PHOTOS · RAW RESPONSES PRESERVED</small><h1>Chessboard recognition: the full audit.</h1><p>Inkling now runs through its supported client. Gemini was retested with temperature 1, high thinking and explicit high image detail. Separate trials isolate board geometry and piece classification. All outputs below are actual predictions, without manual piece corrections.</p><p class="note">Red = confirmed disagreement. Amber / ? = identity not verified, never counted as correct piece recognition. Fenify and photo-relative LLM outputs are rotated only for display beside the reference; this removes orientation-only penalties. Several photos do not have complete type labels. These six images are now development examples, not an independent accuracy estimate.</p><p>Gemini Pro API access returned zero free quota; its browser upload acknowledgement is pending. Newer Flash endpoints returned capacity errors. These are access failures, not accuracy measurements. The candidate selector and aligned voting still regress on some photos. No candidate has been deployed.</p><p><a href="results.json">All scored outputs</a> · <a href="overview.png">Static six-photo comparison</a> · <a href="../new-batch-review/">Previous untouched-output review</a></p><div class="controls"><label>Compare Fenify with <select id="method">'''+options+'''</select></label></div>'''+sections+'''</main><script>const DATA='''+json.dumps(data).replace('<','\u003c')+''';const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));function metric(s){return s.confirmed_mismatches+' confirmed mismatches · '+s.occupancy_errors+' occupied/empty errors'+(s.unverified.length?' · '+s.unverified.length+' types unverified':'')}function update(){let k=document.querySelector('#method').value;for(const r of DATA.records){const el=document.querySelector('#image'+r.id),p=r.predictions[k];el.querySelector('.baseline').textContent=metric(r.predictions.fenify.score);el.querySelector('.label').textContent=DATA.methods[k];let img=el.querySelector('.prediction');img.hidden=!p.svg;if(p.svg)img.src=p.svg;el.querySelector('.metric').textContent=p.score?metric(p.score):'No valid board: '+(typeof p.error==='string'?p.error:JSON.stringify(p.error));el.querySelector('.coverage').textContent=(p.incomplete?'INCOMPLETE: ':'')+(p.coverage||'');el.querySelector('.details').innerHTML=(p.raw?'<a href="'+esc(p.raw)+'">Saved request and response JSON</a>':'')+'<pre>'+esc(p.content||p.original_placement||JSON.stringify(p.error))+'</pre>'+(p.score?'<table><tr><th>Square</th><th>Reference</th><th>Output</th></tr>'+p.score.wrong.map(w=>'<tr><td>'+esc(w.square)+'</td><td>'+esc(w.expected)+'</td><td>'+esc(w.predicted)+'</td></tr>').join('')+'</table>':'')}}document.querySelector('#method').addEventListener('change',update);update();</script></html>'''
    (OUT/'index.html').write_text(page)
    import cairosvg
    regular=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',18);heading=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',28)
    sheet=Image.new('RGB',(1500,2750),'#eeeee7');d=ImageDraw.Draw(sheet)
    d.text((25,20),'Six-photo audit: automatic piece crops + Gemini vs Fenify',font=heading,fill='#243327')
    d.text((25,60),'Red = confirmed error. Amber / ? = unverified type. Geometry alone does not solve recognition.',font=regular,fill='#243327')
    for n,r in enumerate(records):
        i=r['id'];y=110+n*435;d.text((25,y),f'{i}. {r["title"]}',font=heading,fill='#243327')
        images=[OUT/f'image{i}-comparison.jpg',OUT/f'image{i}-reference.svg',OUT/f'image{i}-fenify.svg',OUT/f'image{i}-objects.svg']
        for col,path in enumerate(images):
            im=Image.open(io.BytesIO(cairosvg.svg2png(url=str(path),output_width=340,output_height=340))) if path.suffix=='.svg' else Image.open(path)
            im=im.convert('RGB');im.thumbnail((340,340));sheet.paste(im,(25+col*370+(340-im.width)//2,y+40+(340-im.height)//2))
        for col,key in [(2,'fenify'),(3,'objects')]:
            p=r['predictions'][key];s=p['score'];d.text((25+370*col,y+382),f"{s['confirmed_mismatches']} confirmed; {s['occupancy_errors']} occupancy",font=regular,fill='#243327')
            if p.get('incomplete'):d.text((25+370*col,y+403),'INCOMPLETE response',font=regular,fill='#9a2b19')
    sheet.save(OUT/'overview.png')
    print(OUT/'index.html')
    for r in records:print(r['id'],{k:p.get('score',{}).get('confirmed_mismatches',p['status']) for k,p in r['predictions'].items()})

if __name__=='__main__':main()
