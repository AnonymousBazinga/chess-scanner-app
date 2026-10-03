import io
import threading
import unittest
from http.server import HTTPServer
from unittest.mock import patch
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from PIL import Image
from api import recognize

class EndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=HTTPServer(('127.0.0.1',0),recognize.handler)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
        cls.url=f'http://127.0.0.1:{cls.server.server_port}/api/recognize'
    @classmethod
    def tearDownClass(cls): cls.server.shutdown();cls.server.server_close();cls.thread.join()
    def request(self,data,content='image/png',origin=None):
        headers={'Content-Type':content}
        if origin:headers['Origin']=origin
        try:r=urlopen(Request(self.url,data=data,headers=headers))
        except HTTPError as e:r=e
        return r.status,r.read()
    def test_rejects_invalid_photo(self):self.assertEqual(self.request(b'not a photo')[0],400)
    def test_rejects_cross_origin(self):self.assertEqual(self.request(b'x',origin='https://evil.example')[0],403)
    def test_rejects_wrong_media(self):self.assertEqual(self.request(b'x','text/plain')[0],415)
    def test_rejects_oversize(self):
        from http.client import HTTPConnection
        conn=HTTPConnection('127.0.0.1',self.server.server_port)
        conn.request('POST','/api/recognize',body=b'x',headers={'Content-Type':'image/png','Content-Length':'4000001'})
        self.assertEqual(conn.getresponse().status,413);conn.close()
    def test_busy_does_not_queue(self):
        with recognize._lock:self.assertEqual(self.request(b'x')[0],503)
    def test_limits_decoded_resolution(self):
        b=io.BytesIO();Image.new('RGB',(3000,2000)).save(b,'PNG')
        im=recognize.decode_image(b.getvalue());self.assertEqual(max(im.size),2048)
    def test_success_uses_model(self):
        b=io.BytesIO();Image.new('RGB',(64,64)).save(b,'PNG')
        with patch.object(recognize,'_model') as model:
            model.predict.return_value={'fen':'8/8/8/8/8/8/8/8 w - - 0 1'}
            status,body=self.request(b.getvalue());self.assertEqual(status,200);model.predict.assert_called_once()
            self.assertIn(b'"fen"',body)

if __name__=='__main__':unittest.main()
