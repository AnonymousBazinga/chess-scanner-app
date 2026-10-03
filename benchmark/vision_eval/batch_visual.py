"""Visual audit of four new, unchanged-hybrid tests with partial manual labels."""
import html
import io
import json
from pathlib import Path
import re
import chess
import chess.svg
from PIL import Image,ImageDraw,ImageFont
from run_openrouter import DEFAULT_OUT,SQUARES,expand

OUT=DEFAULT_OUT/'new-batch-review';OUT.mkdir(exist_ok=True)
PIECES='PNBRQKpnbrqk'

def reference(fen):return {s:p for s,p in zip(SQUARES,expand(fen)) if p!='.'}

refs={
 3:reference('r2k1bnr/p1qppppp/bpn5/2p5/3P2Q1/4P3/PPP2PPP/RNB1KBNR'),
 4:reference('r4rk1/p1b3p1/8/8/8/7P/1P4N1/2KR4'),
 5:{},6:{}
}
# Set-valued royal labels acknowledge unconventional shapes. No ground truth
# is chosen using model predictions; these labels do not enter inference.
refs[3].update(d8='kq',c7='kq',e1='KQ',g4='KQ')
for color,squares in [('white','c8 h8 a7 h6 e5 b4 a3 g3 b2 d2 c1 e1'),('black','e7 g7 a6 c6 c3 e3 h3 h1')]:
    for s in squares.split():refs[5][s]='PNBRQK' if color=='white' else 'pnbrqk'
for s in 'a8 f8 h8'.split():refs[6][s]='bnrqk'
for s in 'c8 g8'.split():refs[6][s]='r'
for s in 'a7 b7 c7 f7 g7 h5'.split():refs[6][s]='p'
for s in 'c6 f6'.split():refs[6][s]='n'
for s in 'g4 b3 a2 c2 e2 f2 h2'.split():refs[6][s]='P'
for s in 'f3 b1'.split():refs[6][s]='N'
for s in 'c1 g1'.split():refs[6][s]='R'
for s in 'd1 f1 h1'.split():refs[6][s]='BQRK'

INFO={
 3:('1 · Yellow / black set','The previous photo. Royal identities are partly uncertain; occupancy and colours are checked.','90° counterclockwise'),
 4:('2 · Sparse Alamy board','All 11 visible pieces are manually transcribed. The bishop is on c7 in this comparison frame.','90° clockwise'),
 5:('3 · Small Shutterstock image','Only 390 × 280 pixels. All 20 occupied squares and their colours are checked; piece types remain unverified.','180°'),
 6:('4 · Warm, shadowed board','All 27 occupied squares checked. Several royal/bishop shapes are ambiguous; obvious pawns, rooks and knights are labelled.','90° clockwise')
}

def describe(p):
    if p=='.':return 'empty'
    if len(p)>1:return ('white' if p[0].isupper() else 'black')+' '+('/'.join(chess.piece_name(chess.Piece.from_symbol(c).piece_type) for c in p) if len(p)<6 else 'piece (type unverified)')
    return ('white ' if p.isupper() else 'black ')+chess.piece_name(chess.Piece.from_symbol(p).piece_type)

def evaluate(board,ref):
    wrong=[];unverified=[];occupancy=[]
    for square,piece in zip(SQUARES,board):
        expected=ref.get(square,'.')
        if (expected!='.')!=(piece!='.'):occupancy.append(square)
        if piece not in expected:wrong.append({'square':square,'expected':describe(expected),'predicted':describe(piece)})
        elif len(expected)>1:unverified.append(square)
    return {'confirmed_mismatches':len(wrong),'occupancy_errors':len(occupancy),'wrong':wrong,'unverified':unverified,
            'white_kings':board.count('K'),'black_kings':board.count('k'),'predicted_pieces':sum(p!='.' for p in board)}

def board_svg(board,ref,is_reference=False):
    # Render exact output; never insert missing kings or repair positions.
    parts=['<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">',
           '<rect width="400" height="400" fill="#fbfaf5"/>']
    for i,square in enumerate(SQUARES):
        x=20+(i%8)*45;y=20+(i//8)*45;expected=ref.get(square,'.');p=board[i]
        mismatch=not is_reference and p not in expected
        uncertain=len(expected)>1 and (is_reference or not mismatch)
        color='#e4e7d8' if (i//8+i%8)%2==0 else '#8da076'
        if mismatch:color='#eda18f'
        elif uncertain:color='#f2d793'
        title=f'{square}: '+('reference '+describe(expected) if is_reference else f'output {describe(p)}; reference {describe(expected)}')
        parts.append(f'<g><title>{html.escape(title)}</title><rect x="{x}" y="{y}" width="45" height="45" fill="{color}"/>')
        if is_reference and len(expected)>1:
            white=expected[0].isupper();parts.append(f'<circle cx="{x+22.5}" cy="{y+22.5}" r="15" fill="'+('#fff' if white else '#26302a')+'" stroke="#50584b"/><text x="'+str(x+22.5)+'" y="'+str(y+29)+'" text-anchor="middle" font-family="sans-serif" font-size="22" fill="'+('#26302a' if white else '#fff')+'">?</text>')
        elif p!='.':
            svg=chess.svg.piece(chess.Piece.from_symbol(p),size=42)
            svg=svg.replace('<svg ',f'<svg x="{x+1.5}" y="{y+1.5}" ',1)
            parts.append(svg)
        parts.append('</g>')
    for i,c in enumerate('abcdefgh'):
        parts.append(f'<text x="{42.5+i*45}" y="395" text-anchor="middle" font-family="sans-serif" font-size="14">{c}</text>')
    for i in range(8):parts.append(f'<text x="10" y="{49+i*45}" text-anchor="middle" font-family="sans-serif" font-size="14">{8-i}</text>')
    return ''.join(parts)+'</svg>'

records=[]
for index in (3,4,5,6):
    source=DEFAULT_OUT/f'new-image-{index}';preds={}
    for variant in ('original','rotated'):
        row=json.loads((source/f'hybrid-{variant}.json').read_text())
        methods={'hybrid':row['placement'],**row['components']}
        for model,fen in methods.items():
            board=expand(fen);key=f'{variant}-{model}';score=evaluate(board,refs[index]);file=f'image-{index}-{key}.svg'
            (OUT/file).write_text(board_svg(board,refs[index]))
            preds[key]={'placement':fen,'score':score,'svg':file,'seconds':row['seconds'] if model=='hybrid' else None}
    refboard=[v if len(v)==1 else '.' for s in SQUARES for v in [refs[index].get(s,'.')]]
    (OUT/f'image-{index}-reference.svg').write_text(board_svg(refboard,refs[index],True))
    records.append({'id':index,'title':INFO[index][0],'note':INFO[index][1],'manual_rotation':INFO[index][2],
                    'reference':refs[index],'predictions':preds,'source_sha256':json.loads((source/'hybrid-original.json').read_text())['image_sha256']})

data={'method_unchanged':True,'coordinate_convention':'Comparison photographs are rotated as stated; their top-left square is called a8, irrespective of printed border labels. All model FENs are shown exactly as returned in that fixed comparison frame.','scoring':'Every unlisted square is verified empty. A multi-character reference is a set of allowed identities, not a selected piece. Red means a confirmed mismatch (including orientation); amber means exact identity remains unverified. Missing king counts are shown separately.','records':records}
(OUT/'results.json').write_text(json.dumps(data,indent=2)+'\n')

cards=[]
for r in records:
    i=r['id']
    cards.append(f'''<section id="image-{i}" data-id="{i}"><h2>{r['title']}</h2><p>{r['note']}</p><div class="views">
<figure><figcaption>Photo · rotated for comparison</figcaption><a href="../new-image-{i}/original.png" target="_blank"><img class="photo" src="../new-image-{i}/white-at-bottom.png" alt="Comparison photo"></a><small>Click to see the untouched original. Comparison rotation: {r['manual_rotation']}.</small></figure>
<figure><figcaption>Manual reference · ? = uncertain type</figcaption><img src="image-{i}-reference.svg" alt="Partially labelled manual reference"></figure>
<figure class="fenify-panel"><figcaption class="fenify-title">Fenify-3D alone · untouched input</figcaption><img class="fenify-prediction" src="image-{i}-original-fenify.svg" alt="Exact standalone Fenify-3D prediction"><strong class="fenify-metric"></strong><code class="fenify-fen"></code><details><summary>Fenify mistakes and king counts</summary><div class="fenify-details"></div></details></figure>
<figure><figcaption class="prediction-title">Exact hybrid output · untouched input</figcaption><img class="prediction" src="image-{i}-original-hybrid.svg" alt="Exact model prediction"><strong class="metric"></strong><code class="fen"></code></figure></div>
<details><summary>See square-by-square mistakes and king counts</summary><div class="details"></div></details></section>''')

page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hybrid scanner — four-photo visual audit</title><style>
*{box-sizing:border-box}body{margin:0;background:#eeeee7;color:#253127;font:16px/1.5 system-ui}main{max-width:1450px;margin:auto;padding:32px 22px}h1{font-size:38px;line-height:1.15;max-width:1000px}p{max-width:1100px}.note{background:#fff5d9;border-left:4px solid #9b761e;padding:14px 18px}.controls{position:sticky;top:0;z-index:2;display:flex;gap:16px;flex-wrap:wrap;padding:12px 16px;background:#253127;color:white;border-radius:8px}select{font:inherit;padding:7px;margin-left:8px;max-width:100%}section{background:#fff;padding:20px;border-radius:12px;margin:24px 0}h2{margin-top:0}.views{display:grid;grid-template-columns:1fr 1fr 1fr;gap:18px}figure{margin:0;min-width:0}figcaption{font-weight:650;margin-bottom:8px}figure img{width:100%;height:390px;object-fit:contain;background:#fbfaf5}small{display:block;color:#66715f}code{display:block;overflow-wrap:anywhere;font-size:12px;margin:9px 0}strong.metric{display:block;font-size:15px}.legend{display:flex;gap:24px;flex-wrap:wrap}.swatch{display:inline-block;width:16px;height:16px;vertical-align:middle;margin-right:6px}table{border-collapse:collapse;width:100%;font-size:14px}td,th{text-align:left;padding:7px;border-bottom:1px solid #ddd}details{margin-top:16px}.details{overflow:auto}.links a{margin-right:18px}a{color:#365b32}@media(max-width:850px){.views{grid-template-columns:1fr}figure img{height:350px}h1{font-size:29px}.controls{position:static}}</style>
<main><small>OCTOBER 2, 2026 · NEW TEST PHOTOS · MODEL AND VOTING RULES UNCHANGED</small><h1>The hybrid does not generalize to these photos.</h1><p>These are the four photos you just supplied: the yellow/black set, then the three additional images. The default view shows exactly what the hybrid returned from each untouched upload. The comparison photo is rotated only to make a8–h1 easier to inspect.</p>
<p class="note">Orientation is part of the failure. Fenify often follows image orientation while the other models can infer a different orientation, so their square votes can refer to different physical squares. The rotation-assisted runs are separate diagnostic requests, not automatic fixes. No predicted board was repaired. Uncertain reference identities are marked ?, never guessed for a better score.</p>
<div class="legend"><span><i class="swatch" style="background:#eda18f"></i>Confirmed mismatch, including orientation</span><span><i class="swatch" style="background:#f2d793"></i>Piece identity unverified</span><span><i class="swatch" style="background:#8da076"></i>Matches verified reference</span></div>
<p class="links"><a href="overview.png">Open all-four comparison image</a><a href="results.json">Raw predictions and reference labels</a></p>
<div class="controls"><label>Input <select id="variant"><option value="original">Untouched photo — actual test</option><option value="rotated">Manually rotated — diagnostic only</option></select></label><label>Prediction <select id="model"><option value="hybrid">Three-model hybrid</option><option value="fenify">Fenify alone</option><option value="vitl">ChessQueries ViT-L alone</option><option value="v4">ChessQ Lite V4 alone</option></select></label></div>
'''+''.join(cards)+'''<p>Each reference uses the displayed comparison orientation, not necessarily the handwritten board labels. Empty squares and piece colours are checked on all four photos. Exact piece types are only graded when visually supported. The two earlier development images remain separate from this new test batch.</p></main>
<script>const DATA='''+json.dumps(data).replace('<','\\u003c')+''';function esc(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}function update(){const variant=document.querySelector('#variant').value,model=document.querySelector('#model').value;for(const r of DATA.records){const p=r.predictions[variant+'-'+model],s=p.score,el=document.querySelector('#image-'+r.id);el.querySelector('.prediction').src=p.svg;el.querySelector('.prediction-title').textContent=(model==='hybrid'?'Exact hybrid output':model+' output')+' · '+(variant==='original'?'untouched input':'manual rotation');el.querySelector('.metric').textContent=s.confirmed_mismatches+' confirmed square mismatches · '+s.occupancy_errors+' occupied/empty errors'+(s.unverified.length?' · '+s.unverified.length+' identities unverified':'');el.querySelector('.fen').textContent=p.placement;el.querySelector('.details').innerHTML='<p>Predicted '+s.predicted_pieces+' pieces. Kings: '+s.white_kings+' white / '+s.black_kings+' black. '+(s.white_kings!==1||s.black_kings!==1?'This is not a valid standard chess position.':'')+'</p><table><tr><th>Square</th><th>Visible reference</th><th>Model returned</th></tr>'+s.wrong.map(x=>'<tr><td>'+esc(x.square)+'</td><td>'+esc(x.expected)+'</td><td>'+esc(x.predicted)+'</td></tr>').join('')+'</table>';}}document.querySelectorAll('select').forEach(x=>x.addEventListener('change',update));update();</script></html>'''
(OUT/'index.html').write_text(page)

# Standalone Fenify is always visible, independent of the comparison selector.
page=page.replace('max-width:1450px','max-width:1800px').replace('grid-template-columns:1fr 1fr 1fr;','grid-template-columns:repeat(4,minmax(0,1fr));')
page=page.replace('The hybrid does not generalize to these photos.</h1>','Fenify-3D alone vs. the hybrid.</h1>')
page=page.replace('The default view shows exactly what the hybrid returned from each untouched upload.','Fenify-3D now has its own permanent column beside the hybrid. Both receive the same input; its result contains no voting or corrections from other models.')
page=page.replace('<label>Prediction <select','<label>Compare Fenify with <select')
page=page.replace('<option value="fenify">Fenify alone</option>','')
page=page.replace('<a href="overview.png">Open all-four comparison image</a>','<a href="fenify-vs-hybrid-original.png">Fenify vs hybrid · original inputs</a><a href="fenify-vs-hybrid-rotated.png">Fenify vs hybrid · rotated inputs</a>')
page=page.replace("el.querySelector('.prediction').src=p.svg;", """const fp=r.predictions[variant+'-fenify'],fs=fp.score;
el.querySelector('.fenify-prediction').src=fp.svg;
el.querySelector('.fenify-title').textContent='Fenify-3D alone · '+(variant==='original'?'untouched input':'manual rotation');
el.querySelector('.fenify-metric').textContent=fs.confirmed_mismatches+' confirmed square mismatches · '+fs.occupancy_errors+' occupied/empty errors'+(fs.unverified.length?' · '+fs.unverified.length+' identities unverified':'');
el.querySelector('.fenify-fen').textContent=fp.placement;
el.querySelector('.fenify-details').innerHTML='<p>Predicted '+fs.predicted_pieces+' pieces. Kings: '+fs.white_kings+' white / '+fs.black_kings+' black.</p><table><tr><th>Square</th><th>Reference</th><th>Fenify returned</th></tr>'+fs.wrong.map(x=>'<tr><td>'+esc(x.square)+'</td><td>'+esc(x.expected)+'</td><td>'+esc(x.predicted)+'</td></tr>').join('')+'</table>';
el.querySelector('.prediction').src=p.svg;""")
(OUT/'index.html').write_text(page)

def make_overview(variant=None):
    import cairosvg
    font='/System/Library/Fonts/Helvetica.ttc'
    regular=ImageFont.truetype(font,19);heading=ImageFont.truetype(font,29);small=ImageFont.truetype(font,16)
    sheet=Image.new('RGB',(1520,1910),'#f1f2eb');d=ImageDraw.Draw(sheet)
    title='Hybrid scanner: four new photos, unchanged model' if variant is None else 'Fenify-3D alone vs. hybrid: '+('untouched uploads' if variant=='original' else 'manually rotated inputs')
    d.text((28,20),title,font=heading,fill='#243327')
    d.text((28,61),'Red = confirmed mismatch. Amber / ? = unverified identity. Rotated runs are manual diagnostics.',font=regular,fill='#40523d')
    headers=['Photo (comparison orientation)','Manual reference','Hybrid: untouched upload','Hybrid: manual rotation'] if variant is None else ['Photo (comparison orientation)','Manual reference','Fenify-3D ONLY','Three-model hybrid']
    for col,t in enumerate(headers):d.text((28+col*375,100),t,font=regular,fill='#243327')
    for n,r in enumerate(records):
        i=r['id'];y=145+n*430;d.text((28,y),r['title'],font=heading,fill='#243327')
        im=Image.open(DEFAULT_OUT/f'new-image-{i}/white-at-bottom.png').convert('RGB');im.thumbnail((345,335))
        sheet.paste(im,(28+(345-im.width)//2,y+42+(335-im.height)//2))
        files=[f'image-{i}-reference.svg',f'image-{i}-original-hybrid.svg',f'image-{i}-rotated-hybrid.svg'] if variant is None else [f'image-{i}-reference.svg',f'image-{i}-{variant}-fenify.svg',f'image-{i}-{variant}-hybrid.svg']
        for col,file in enumerate(files,1):
            b=cairosvg.svg2png(url=str(OUT/file),output_width=345,output_height=345)
            board=Image.open(io.BytesIO(b)).convert('RGB');sheet.paste(board,(28+col*375,y+36))
        cases=[(2,'original-hybrid'),(3,'rotated-hybrid')] if variant is None else [(2,variant+'-fenify'),(3,variant+'-hybrid')]
        for col,key in cases:
            s=r['predictions'][key]['score']
            d.text((28+col*375,y+384),f"{s['confirmed_mismatches']} confirmed mismatches; {s['occupancy_errors']} occupancy",font=small,fill='#243327')
    d.text((28,1870),'Open the interactive report to inspect each square and compare the individual models.',font=regular,fill='#40523d')
    sheet.save(OUT/('overview.png' if variant is None else f'fenify-vs-hybrid-{variant}.png'))

make_overview()
make_overview('original')
make_overview('rotated')
print(OUT/'index.html')
for r in records:
    print(r['id'],{k:{x:v['score'][x] for x in ['confirmed_mismatches','occupancy_errors','white_kings','black_kings']} for k,v in r['predictions'].items()})
