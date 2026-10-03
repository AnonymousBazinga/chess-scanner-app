"""Loopback-only prototype, serving the existing site with experimental recognition."""
import argparse
from functools import partial
from http.server import HTTPServer, SimpleHTTPRequestHandler
import io
import json
from pathlib import Path
from urllib.parse import urlsplit
from PIL import Image, UnidentifiedImageError
from hybrid import from_args, model_arguments

ROOT=Path(__file__).resolve().parents[2]
Image.MAX_IMAGE_PIXELS=16_000_000

class Handler(SimpleHTTPRequestHandler):
    def reply(self,status,data):
        raw=json.dumps(data).encode()
        self.send_response(status);self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(raw)));self.send_header('Cache-Control','no-store')
        self.end_headers();self.wfile.write(raw)

    def valid_origin(self):
        allowed={f'localhost:{self.server.server_port}',f'127.0.0.1:{self.server.server_port}'}
        origin=self.headers.get('Origin')
        return self.headers.get('Host') in allowed and (not origin or origin in {'http://'+h for h in allowed})

    def do_GET(self):
        if not self.valid_origin():return self.reply(403,{'error':'Local access only'})
        path=urlsplit(self.path).path
        if path=='/api/health':return self.reply(200,{'ready':True,'experimental':True})
        if path.startswith('/qa/'):return self.reply(404,{'error':'Not found'})
        super().do_GET()

    def do_POST(self):
        if not self.valid_origin():return self.reply(403,{'error':'Local access only'})
        if urlsplit(self.path).path!='/api/recognize':return self.reply(404,{'error':'Not found'})
        try:size=int(self.headers.get('Content-Length','0'))
        except ValueError:return self.reply(400,{'error':'Invalid image size'})
        if not 0<size<=15_000_000:return self.reply(413,{'error':'Image must be under 15 MB'})
        self.connection.settimeout(30)
        try:
            with Image.open(io.BytesIO(self.rfile.read(size))) as image:
                if image.width*image.height>16_000_000:return self.reply(413,{'error':'Image exceeds 16 megapixels'})
                result=self.server.recognizer.predict(image)
        except (UnidentifiedImageError,OSError,ValueError,Image.DecompressionBombError):
            return self.reply(400,{'error':'Could not read this image'})
        self.reply(200,result)

if __name__=='__main__':
    p=argparse.ArgumentParser();model_arguments(p);p.add_argument('--port',type=int,default=8766);args=p.parse_args()
    print('Loading the three recognition models…',flush=True)
    model=from_args(args)
    server=HTTPServer(('127.0.0.1',args.port),partial(Handler,directory=str(ROOT/'web')))
    server.recognizer=model
    print(f'Ready: http://127.0.0.1:{args.port}/?scanner=hybrid',flush=True)
    server.serve_forever()
