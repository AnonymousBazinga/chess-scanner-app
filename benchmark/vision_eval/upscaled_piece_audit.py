"""Same 24 deterministic crops, enlarged to 512 px for a matched detail ablation."""
import getpass,json,time,concurrent.futures
from PIL import Image
from gemini_audit import OUT,request
from single_piece_audit import PROMPT

def main():
 key=getpass.getpass('Gemini key (hidden): ');tasks=[]
 for p in sorted(OUT.glob('image*-single-object-*.png')):
  im=Image.open(p).convert('RGB');scale=512/max(im.size);im=im.resize((round(im.width*scale),round(im.height*scale)),Image.Resampling.LANCZOS);dest=p.with_name(p.stem+'-large.jpg');im.save(dest);tasks.append(dest)
 def run(p):
  target=OUT/('gemini-'+p.stem+'.json');r=request(key,'gemini-3.1-flash-lite',[p],PROMPT,'generate',target);print(p.name,r.get('status'),r.get('content'),flush=True)
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  futures=[]
  for p in tasks:futures.append(pool.submit(run,p));time.sleep(5)
  for f in futures:f.result()
if __name__=='__main__':main()
