"""Generate an auditable local comparison; never publish uploaded images."""
import html
import json
from collections import Counter
from pathlib import Path
import chess
import chess.svg
from run_openrouter import ROOT, DEFAULT_OUT, expand, SQUARES

out=DEFAULT_OUT
baseline=json.loads((ROOT/'web/qa/out/accuracy-investigation/baseline-comparison.json').read_text())
responses=[json.loads(p.read_text()) for p in sorted((out/'responses').glob('*.json'))]
locals_=[r for p in sorted(out.glob('local-*.json')) for r in json.loads(p.read_text())]
historical=[]
for name in ['ChessQueries Lite INT8','ChessReD ResNeXt']:
    for i,r in enumerate(baseline['models'][name],1):
        historical.append({'model':name+' (previous run)','image':i,'status':'ok','placement':r['fen'],'score':{'occupancy_errors':r['occupied_empty_errors'],**({'wrong_squares':r['wrong_squares']} if 'wrong_squares' in r else {})},'seconds':r.get('seconds')})
allrows=historical+locals_+responses
(out/'all-results.json').write_text(json.dumps(allrows,indent=2)+'\n')

def board(row):
    if row['status']!='ok':return '<div class="failure">'+html.escape(row.get('error','No board returned'))[:900]+'</div>'
    placement=row['placement'];pieces=expand(placement)
    if row['image']==2:
        truth=expand(baseline['image2_manual_truth']);bad=[i for i,(a,b) in enumerate(zip(truth,pieces)) if a!=b]
    else:
        occupied=set(baseline['image1_occupied_squares']);bad=[i for i,(s,p) in enumerate(zip(SQUARES,pieces)) if (s in occupied)!=(p!='.')]
    fill={chess.square(i%8,7-i//8):'#ff626299' for i in bad}
    return chess.svg.board(chess.Board(placement+' w - - 0 1'),size=300,fill=fill)+f'<code>{html.escape(placement)}</code>'

def metric(row):
    if row['status']!='ok': return row['status'].replace('_',' ')
    s=row['score'];return f"{s['occupancy_errors']} occupancy errors" if row['image']==1 else f"{s['wrong_squares']} wrong squares"

cards=[]
for r in allrows:
    title=r['model']+(f" · attempt {r['trial']}" if 'trial' in r else '')
    seconds=f" · {r['seconds']:.1f}s" if isinstance(r.get('seconds'),(int,float)) else ''
    cards.append(f'<article data-image="{r["image"]}" data-status="{r["status"]}"><h3>{html.escape(title)}</h3><p>Image {r["image"]} · {metric(r)}{seconds}</p>{board(r)}</article>')

table=[]
for name in sorted({r['model'] for r in responses}):
    rr=[r for r in responses if r['model']==name]
    summary=[]
    for i in (1,2):
        ri=[r for r in rr if r['image']==i];ok=[r for r in ri if r['status']=='ok']
        key='occupancy_errors' if i==1 else 'wrong_squares'
        values=[r['score'][key] for r in ok]
        summary.append(f'{len(ok)}/{len(ri)} valid; errors: '+(', '.join(map(str,values)) if values else '—'))
    table.append(f'<tr><td>{html.escape(name)}</td><td>{summary[0]}</td><td>{summary[1]}</td></tr>')

page='''<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chess scanner model evaluation</title>
<style>body{margin:0;background:#f5f3ee;color:#292e29;font:16px/1.5 system-ui}main{max-width:1250px;margin:auto;padding:36px 24px}h1{font-size:38px;line-height:1.15}h2{margin-top:36px}h3{font-size:17px}p{max-width:900px}.photos,.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:20px}.photos img{height:370px;max-width:100%;object-fit:contain;background:white}article{padding:18px;background:#fff;border:1px solid #ddd9ce;border-radius:10px}article svg{width:100%;height:auto}code{display:block;overflow-wrap:anywhere;font-size:12px;margin-top:12px}.failure{font-size:13px;padding:16px;background:#fff2eb;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;font-size:14px}td,th{border-bottom:1px solid #ddd;padding:10px;text-align:left}select{font:inherit;padding:8px;margin:8px}small{color:#596359}.note{border-left:4px solid #aa7423;padding:12px 18px;background:#fffae8}</style>
<main><small>OCTOBER 2, 2026 · TWO-IMAGE DIAGNOSTIC</small><h1>No reliable replacement yet.</h1>
<p>ChessQueries ViT-L is closest on image 2: <strong>2 wrong squares</strong>, versus Fenify-3D’s 4 and the deployed Lite model’s 16. It still misses the occupied-square pattern badly on image 1. Free vision LLMs did not provide a reliable improvement.</p>
<p class="note"><strong>The two columns measure different things.</strong> Image 1 has only occupied/empty reference labels; zero occupancy errors does not mean the pieces are correct. Image 2 has a manually transcribed full piece-placement reference. Two images cannot establish general accuracy. Repeated API attempts used different prompts/settings and are not independent accuracy trials.</p>
<div class="photos"><figure><img src="images/image-1.jpg"><figcaption>Image 1: top-down stock-photo screenshot. Occupancy only.</figcaption></figure><figure><img src="images/image-2.jpg"><figcaption>Image 2: angled wooden board. Full piece-placement scoring.</figcaption></figure></div>
<h2>Specialized models</h2><table><tr><th>Model</th><th>Image 1: occupancy errors</th><th>Image 2: wrong squares</th></tr>
<tr><td>Fenify-3D (rerun)</td><td>0</td><td>4</td></tr><tr><td>ChessQ Lite V4 (new release)</td><td>23</td><td>3</td></tr><tr><td>ChessQueries ViT-L</td><td>24</td><td>2</td></tr><tr><td>ChessQueries ViT-B</td><td>27</td><td>10</td></tr><tr><td>ChessCog (compatibility runner)</td><td>Board not located</td><td>26</td></tr><tr><td>Current ChessQueries Lite INT8 (previous run)</td><td>25</td><td>16</td></tr><tr><td>ChessReD ResNeXt (previous run)</td><td>28</td><td>39</td></tr></table>
<h2>Free OpenRouter endpoints</h2><p>Every returned cost field was zero. Inkling and Inkling Small rejected this API harness (403). Qwen and both Gemma endpoints hit shared-provider rate limits. Nemotron returned a capacity error or stalled; three requests were cancelled. Blank or malformed responses are failures, not zero-error predictions.</p><table><tr><th>Endpoint</th><th>Image 1</th><th>Image 2</th></tr>'''+''.join(table)+'''</table>
<h2>Inspect every result</h2><p>Red squares mark reference disagreements. For image 1, piece identities are <strong>not</strong> graded. Durations exclude local model loading and are single-request observations.</p><label>Image <select id="image"><option value="all">Both</option><option value="1">1 · top-down</option><option value="2">2 · angled</option></select></label><label>Results <select id="status"><option value="ok">Valid boards</option><option value="all">All attempts, including failures</option></select></label><div class="cards">'''+''.join(cards)+'''</div><h2>Evidence and limits</h2><p>Inputs were recovered from the prior local report. Exact bytes, model hashes, visible responses, scores, prompts, environment, and runtime compatibility changes are preserved in this folder. No production website changes were made. Larger/newer ChessQueries weights carry a noncommercial license; verify suitability before commercial use.</p><p><a href="all-results.json">All machine-readable results</a> · <a href="provenance.json">Protocols and provenance</a> · <a href="https://huggingface.co/joelseytre/chessqueries">ChessQueries releases</a> · <a href="https://huggingface.co/joelseytre/chessq-lite">ChessQ Lite V4</a> · <a href="https://github.com/georg-wolflein/chesscog">ChessCog</a> · <a href="https://openrouter.ai/thinkingmachines/inkling:free">Inkling access conditions</a></p></main>
<script>function filter(){for(const card of document.querySelectorAll('article')){card.hidden=(document.querySelector('#image').value!=='all'&&card.dataset.image!==document.querySelector('#image').value)||(document.querySelector('#status').value!=='all'&&card.dataset.status!=='ok')}}document.querySelectorAll('select').forEach(s=>s.onchange=filter);filter();</script>'''
(out/'comparison.html').write_text(page)
print(out/'comparison.html')
print('API responses',len(responses),'statuses',dict(Counter(r['status'] for r in responses)))
print('Reported cost',sum((r.get('response',{}).get('usage') or {}).get('cost',0) or 0 for r in responses))
