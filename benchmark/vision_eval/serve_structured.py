"""Run the structured prototype on loopback using the existing scanner UI."""
import argparse
from pathlib import Path
from functools import partial
from http.server import HTTPServer
from serve_hybrid import Handler,ROOT
from structured_recognizer import StructuredRecognizer
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=8768);p.add_argument('--source',type=Path,default=Path('/tmp/chess-vision-chessqueries'));p.add_argument('--weights',type=Path,default=Path('/tmp/chess-vision-weights'));a=p.parse_args()
 model=StructuredRecognizer(ROOT/'fenify-3D/model.pt',a.source,a.weights/'chessqueries-vitl-644-safetensors-fp16-r1.safetensors',a.weights/'cq-vit-s-644-v4-seed2-safetensors-fp16-r2.safetensors',a.weights)
 server=HTTPServer(('127.0.0.1',a.port),partial(Handler,directory=str(ROOT/'web')));server.recognizer=model
 print(f'Ready: http://127.0.0.1:{a.port}/?scanner=structured',flush=True);server.serve_forever()
