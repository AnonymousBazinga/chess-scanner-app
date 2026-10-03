"""Check a staged Vercel deployment using the exact locally replayed upload bytes."""
import json,subprocess,sys,time
from collect import ROOT,OUT
url=sys.argv[1];folder=OUT/'hosted'
inputs=json.loads((folder/'inputs.json').read_text());records=[]
for row in inputs:
    response=folder/(row['id']+'-response.json')
    args=['npx','--yes','vercel@62.1.0','curl','/api/recognize','--deployment',url,'--scope','anonymousbazingas-projects','--','--header','Content-Type: '+row['content_type'],'--data-binary','@'+row['path'],'--output',str(response),'--write-out','%{http_code}']
    start=time.monotonic();proc=subprocess.run(args,cwd=ROOT/'web',capture_output=True,text=True,timeout=330)
    if proc.returncode:raise RuntimeError(proc.stderr[-1000:])
    assert proc.stdout.strip().endswith('200'),proc.stdout[-100:]
    result=json.loads(response.read_text());expected=row['baseline']
    fields=['placement','fen','photo_placement','canonical_rotation_ccw','review_squares']
    differences=[key for key in fields if result[key]!=expected[key]]
    record={'id':row['id'],'deployment':url,'http_status':200,'wall_seconds':round(time.monotonic()-start,3),'differences':differences,'result':result}
    records.append(record);(folder/'verified.json').write_text(json.dumps(records,indent=2))
    print(row['id'],result['seconds'],result['revision'],differences,flush=True)
    assert not differences,record
print('All three hosted paths preserve their placements, orientation and review squares.',flush=True)
