"""Follow-up report; preserves the original evaluation and raw failures."""
import html
import json
from collections import Counter
import chess
import chess.svg
from run_openrouter import DEFAULT_OUT, SQUARES, expand

out=DEFAULT_OUT/'followup'
hybrid=json.loads((out/'hybrid-fresh-validation.json').read_text())
fenify=json.loads((DEFAULT_OUT/'local-fenify-3D.json').read_text())
refined=json.loads((out/'fenify-refinement.json').read_text())
direct=[json.loads(p.read_text()) for p in sorted(out.glob('*-r1.json'))]
crops=[json.loads(p.read_text()) for p in sorted(out.glob('*-crops-score-image*.json'))]
mooncrops=[json.loads(p.read_text()) for p in sorted(out.glob('moondream-crop-score-image*.json'))]
summary={'hybrid_fresh':hybrid,'fenify':fenify,'fenify_refinements':refined,'direct_providers':direct,'gemini_geometry_assisted':crops,'moondream_geometry_assisted':mooncrops}
(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')

def metric(row):
    if row.get('status','ok')!='ok':return html.escape(row.get('status','error'))
    s=row.get('score',{})
    return str(s.get('wrong_squares',s.get('occupancy_errors','—')))

def svg(row):
    errors=row.get('score',{}).get('errors',[])
    fill={chess.parse_square(e['square']):'#ed715688' for e in errors}
    return chess.svg.board(chess.Board(row['placement']+' w - - 0 1'),size=360,fill=fill)

cards=[]
for index in (1,2):
    row=next(r for r in hybrid if r['image']==index and r['variant']=='original')
    cards.append(f'<section><h2>Image {index}</h2><div class="pair"><img src="../images/image-{index}.jpg" alt="Original photo {index}">{svg(row)}</div><p><strong>{metric(row)} '+('occupied/empty errors; piece identities not fully verified.' if index==1 else 'wrong squares. All 32 pieces match the manual reference.')+f'</strong></p><code>{html.escape(row["placement"])}</code><details><summary>Model disagreements ({len(row["disagreements"])})</summary><pre>{html.escape(json.dumps(row["disagreements"],indent=2))}</pre></details></section>')

table=[]
for row in direct:
    table.append('<tr>'+''.join('<td>'+html.escape(str(v))+'</td>' for v in [row['model'],row['image'],row['mode'],row['status'],metric(row),round(row.get('seconds',0),1)])+'</tr>')
for row in crops:
    table.append('<tr>'+''.join('<td>'+html.escape(str(v))+'</td>' for v in [row['model'],row['image'],'manual corner crop sheets',row['status'],metric(row),'—'])+'</tr>')

page='''<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chess scanner — working hybrid prototype</title>
<style>body{background:#f3f1e9;color:#20291e;font:16px/1.55 system-ui;margin:0}main{max-width:1120px;margin:auto;padding:32px 24px}h1{font-size:38px;line-height:1.12;max-width:850px}h2{font-size:23px}p{max-width:900px}.note{padding:16px;border-left:4px solid #8a6c2b;background:#fff9e5}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}.pair img,.pair svg{width:100%;height:420px;object-fit:contain;background:white}section{padding:20px;background:white;border-radius:12px;margin:24px 0}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:9px;border-bottom:1px solid #d6d9ce}code,pre{font-size:12px;overflow-wrap:anywhere;white-space:pre-wrap}.button{display:inline-block;background:#536e35;color:white;padding:12px 20px;border-radius:8px;text-decoration:none}.scroll{overflow:auto}@media(max-width:650px){.pair{grid-template-columns:1fr}.pair img,.pair svg{height:340px}h1{font-size:29px}}</style>
<main><small>OCTOBER 2, 2026 · FOLLOW-UP EXPERIMENT</small><h1>The hybrid reads the angled board exactly.</h1>
<p>Fenify supplies occupied squares. Fenify, ChessQueries ViT-L and ChessQ Lite V4 vote on the identity of each occupied piece; ties retain Fenify. Reference labels are used only for scoring. The same code accepts arbitrary photos through the existing scanner UI.</p>
<a class="button" href="http://127.0.0.1:8766/?scanner=hybrid">Open local scanner</a>
<p class="note">This is a local experimental backend. The hosted site has not changed. Image 1 has verified occupancy only; its king/queen identities remain unresolved. These two development examples and their small transformations are not an independent accuracy benchmark.</p>
<table><tr><th>Method</th><th>Image 1 occupancy errors</th><th>Image 2 wrong squares</th></tr><tr><td>Deployed Lite (previous reference)</td><td>25</td><td>16</td></tr><tr><td>Fenify-3D</td><td>0</td><td>4</td></tr><tr><td>Fenify, 12-view averaging</td><td>0</td><td>2</td></tr><tr><td>Gemini 3 Flash Preview + Fenify occupancy</td><td>503 / no prediction</td><td>6</td></tr><tr><td>Gemini 3.1 Flash Lite + manual crop sheets</td><td>One batch 503; incomplete</td><td>4</td></tr><tr><td><strong>Local three-model hybrid</strong></td><td><strong>0</strong></td><td><strong>0</strong></td></tr></table>
'''+''.join(cards)+'''
<h2>Fresh inference and UI verification</h2><p>The local endpoint was rerun on both originals, brightness ×0.9, brightness ×1.1, and an 80% resize. All four image-2 inputs produced the exact reference. All four image-1 inputs produced the same prediction and zero occupancy errors. These are stability checks on the same photos, not eight independent boards.</p><p>The original image-2 JPEG was uploaded through Photos in the real UI. The editor's 64 squares matched the reference, and Analyze opened Stockfish successfully. Local CPU inference ranged from 10.6 to 31.3 seconds during these checks. Invalid image bytes returned 400; requests with a foreign Origin returned 403. Models total roughly 0.9 GB on disk and run on the local Python server, not in the browser.</p>
<h2>Moondream: tested beyond whole-board prompting</h2><p>Both cloud models (3.1-9B-A2B and 3-preview) returned unusable board mappings in all eight whole-image/occupancy-assisted requests. Simple FEN prompts with reasoning also failed. Native detection returned 14 boxes on image 1 and 26 on image 2, versus 27 and 32 occupied squares. Counts alone do not establish detection accuracy.</p><p>We then tested 59 individual crops with manually marked board corners. Only 21/27 and 22/32 returned an unambiguous piece type and color under the fixed parser; several accepted answers were visibly wrong. No complete board was scored from these crop responses. Google crop sheets were better, but still made four image-2 errors even with manual geometry. The hybrid requires no manually marked corners.</p>
<h2>Direct-provider attempts</h2><p>Image 1 errors count occupancy only. Image 2 errors count exact piece/color/square disagreements. HTTP failures and invalid formats are not scored as recognition errors. Google 3.8/3.7 Flash returned capacity errors; 2.5 Flash returned unavailable-for-new-users errors.</p><div class="scroll"><table><tr><th>Model</th><th>Image</th><th>Mode</th><th>Status</th><th>Errors</th><th>Seconds</th></tr>'''+''.join(table)+'''</table></div>
<h2>Evidence</h2><p><a href="summary.json">Combined records</a> · <a href="hybrid-fresh-validation.json">Fresh hybrid predictions and component votes</a> · <a href="../comparison.html">Original evaluation, preserved</a> · <a href="https://docs.moondream.ai/api/">Moondream API</a> · <a href="https://ai.google.dev/gemini-api/docs/pricing">Google free-tier documentation</a></p><p>No provider credentials are saved in the repository or artifacts. Cloud tests used the existing free Google project and Moondream's included credits. No credit purchase or auto top-up was enabled. The local hybrid needs no API key.</p></main>'''
(out/'comparison.html').write_text(page)
print(out/'comparison.html')
print('Direct requests:',len(direct),dict(Counter(r['status'] for r in direct)))
