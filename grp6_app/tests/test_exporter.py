import gzip
import json
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from grp6_app.exporter import HttpsOutboxExporter


class Handler(BaseHTTPRequestHandler):
    batches = []

    def do_POST(self):
        body = self.rfile.read(int(self.headers['Content-Length']))
        if self.headers.get('Content-Encoding') == 'gzip':
            body = gzip.decompress(body)
        self.__class__.batches.append(json.loads(body))
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"accepted":true}')

    def log_message(self, *_):
        pass


class ExporterTests(unittest.TestCase):
    def test_local_delivery_uses_batch_and_stable_event_id(self):
        Handler.batches = []
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        with tempfile.TemporaryDirectory() as folder:
            exporter = HttpsOutboxExporter(
                'http://127.0.0.1:{}/api/v1/events/batch'.format(server.server_port),
                outbox=Path(folder)/'outbox.sqlite3', timeout_seconds=1)
            event = {'event_id': 'event-1', 'event_type': 'device_completed'}
            self.assertTrue(exporter.submit(event))
            deadline = time.time() + 3
            while not Handler.batches and time.time() < deadline:
                time.sleep(.02)
            exporter.close()
        server.shutdown();server.server_close()
        self.assertTrue(Handler.batches)
        self.assertEqual(Handler.batches[0]['schema_version'], '1')
        self.assertEqual(Handler.batches[0]['events'][0]['event_id'], 'event-1')

    def test_public_plain_http_is_rejected(self):
        with self.assertRaises(ValueError):
            HttpsOutboxExporter('http://example.com/events')


if __name__ == '__main__':
    unittest.main()
