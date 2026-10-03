"""Image-only recognition endpoint. Uploads are processed in memory, never saved."""
from http.server import BaseHTTPRequestHandler
from io import BytesIO
import json
import os
from pathlib import Path
import threading
from urllib.parse import urlsplit
from PIL import Image, ImageOps, UnidentifiedImageError

MAX_BYTES = 4_000_000
Image.MAX_IMAGE_PIXELS = 16_000_000
_lock = threading.Lock()
_model = None


def decode_image(data):
    try:
        image = Image.open(BytesIO(data))
        if image.width * image.height > Image.MAX_IMAGE_PIXELS or min(image.size) < 64:
            raise ValueError('Use an image between 64 pixels wide and 16 megapixels.')
        image.load()
        image = ImageOps.exif_transpose(image).convert('RGB')
        if max(image.size) > 2048:
            image.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
        return image
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError('Upload a valid PNG, JPEG or WebP photo.') from exc


class handler(BaseHTTPRequestHandler):
    def respond(self, code, payload):
        body = json.dumps(payload, allow_nan=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.respond(200, {'ready': True, 'method': 'structured-visual-v2', 'revision': os.getenv('VERCEL_GIT_COMMIT_SHA', 'local')})

    def do_POST(self):
        global _model
        origin = self.headers.get('Origin')
        if origin and urlsplit(origin).netloc != self.headers.get('Host'):
            return self.respond(403, {'error': 'Use the scanner on this site.'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            return self.respond(400, {'error': 'Invalid upload size.'})
        if not 0 < length <= MAX_BYTES:
            return self.respond(413, {'error': 'Please upload a photo smaller than 4 MB.'})
        if self.headers.get('Content-Type', '').split(';')[0] not in ('image/png', 'image/jpeg', 'image/webp'):
            return self.respond(415, {'error': 'Use a PNG, JPEG or WebP photo.'})
        # Fluid compute may dispatch concurrent calls into one process. Serialize
        # inference to bound memory; fail promptly rather than queue large photos.
        if not _lock.acquire(blocking=False):
            return self.respond(503, {'error': 'Scanner is busy. Please try again in a moment.'})
        try:
            image = decode_image(self.rfile.read(length))
            if _model is None:
                from scanner_backend.recognizer import StructuredRecognizer
                _model = StructuredRecognizer(Path(__file__).resolve().parents[1] / 'scanner_backend' / 'weights')
            result = _model.predict(image)
            result['revision'] = os.getenv('VERCEL_GIT_COMMIT_SHA', 'local')
            self.respond(200, result)
        except ValueError as exc:
            self.respond(400, {'error': str(exc)})
        except Exception as exc:
            # No request bodies or image data in logs.
            print('scanner failure:', type(exc).__name__, str(exc), flush=True)
            self.respond(500, {'error': 'The scanner could not finish. Please try again.'})
        finally:
            _lock.release()
