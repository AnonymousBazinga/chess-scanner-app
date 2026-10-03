"""Use the actual installed Claude Code client for the free Inkling endpoint.

No identity spoofing, tool execution, repository context, paid fallback, or key
persistence. Images enter the supported stream-json input as image blocks.
"""
import argparse
import base64
import getpass
import hashlib
import json
import os
import subprocess
import tempfile
import time
import requests
from gemini_audit import OUT, PROMPT, source
from run_openrouter import extract

def main():
    p=argparse.ArgumentParser();p.add_argument('--images',nargs='+',type=int,default=[2]);p.add_argument('--round',default='r1');a=p.parse_args()
    key=getpass.getpass('OpenRouter key (hidden, memory only): ')
    model='thinkingmachines/inkling:free'
    env=dict(os.environ,ANTHROPIC_BASE_URL='https://openrouter.ai/api',ANTHROPIC_AUTH_TOKEN=key,ANTHROPIC_API_KEY='',ANTHROPIC_MODEL=model,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1')
    for role in ('FABLE','OPUS','SONNET','HAIKU'):env['ANTHROPIC_DEFAULT_'+role+'_MODEL']=model
    env['CLAUDE_CODE_SUBAGENT_MODEL']=model
    for i in a.images:
        target=OUT/f'inkling-claude-code-image{i}-{a.round}.json'
        if target.exists():continue
        path=source(i);raw=path.read_bytes()
        message={'type':'user','message':{'role':'user','content':[{'type':'text','text':PROMPT},{'type':'image','source':{'type':'base64','media_type':'image/png' if i>2 else 'image/jpeg','data':base64.b64encode(raw).decode()}}]},'parent_tool_use_id':None}
        args=['claude','-p','--safe-mode','--setting-sources','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--tools','','--disable-slash-commands','--no-session-persistence','--model',model,'--input-format','stream-json','--output-format','stream-json','--verbose']
        args += ['--system-prompt','You are a visual chessboard transcription assistant. Answer the image question directly with JSON. No tools are available.']
        row={'model':model,'image':i,'client':'installed Claude Code','prompt':PROMPT,'image_sha256':hashlib.sha256(raw).hexdigest(),'status':'pending'}
        start=time.monotonic()
        try:
            usage_before=requests.get('https://openrouter.ai/api/v1/key',headers={'Authorization':'Bearer '+key},timeout=20).json().get('data',{}).get('usage')
            with tempfile.TemporaryDirectory(prefix='chess-inkling-') as cwd:
                result=subprocess.run(args,input=json.dumps(message)+'\n',text=True,capture_output=True,env=env,cwd=cwd,timeout=240)
            # Keep visible text/results only, never reasoning, keys or image payloads.
            messages=[]
            for line in result.stdout.splitlines():
                try:event=json.loads(line)
                except ValueError:continue
                if event.get('type')=='assistant':
                    messages.extend(x['text'] for x in event.get('message',{}).get('content',[]) if x.get('type')=='text')
                if event.get('type')=='result':
                    row['result']={k:event.get(k) for k in ('subtype','is_error','result','total_cost_usd','usage','modelUsage','errors')}
            content='\n'.join(messages) or row.get('result',{}).get('result','')
            row.update(content=content,status='answered',exit_code=result.returncode)
            row['stderr']=result.stderr.replace(key,'[REDACTED]')[-1500:]
            usage_after=requests.get('https://openrouter.ai/api/v1/key',headers={'Authorization':'Bearer '+key},timeout=20).json().get('data',{}).get('usage')
            row['openrouter_usage_before']=usage_before;row['openrouter_usage_after']=usage_after
            try:row.update(placement=extract(content),status='ok')
            except ValueError:pass
        except Exception as exc:row.update(status='error',error=type(exc).__name__+': '+str(exc))
        row['seconds']=round(time.monotonic()-start,3)
        OUT.mkdir(exist_ok=True);target.write_text(json.dumps(row,indent=2)+'\n')
        print(json.dumps(row),flush=True)
        if row.get('exit_code',0)!=0:break

if __name__=='__main__':main()
