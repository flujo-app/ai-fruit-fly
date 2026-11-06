"""Serve the AI fruit fly locally:  python serve.py   then open http://127.0.0.1:8765

Besides the files, the server keeps two things:
- a saved Fly Gym training state (POST /state/<name>, GET /state/<name>) in the .state folder, so a
  long training run can be continued after a page reload;
- videos recorded by the Cubicles page (POST /recording/<name>?part=N appends one piece,
  ?done=1 finishes it) in the recordings folder.
It only listens on 127.0.0.1.
"""
import http.server
import os
import re
import sys
import time
import urllib.parse

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
HERE = os.path.dirname(os.path.abspath(__file__))
STATE_DIR = os.path.join(HERE, ".state")
REC_DIR = os.path.join(HERE, "recordings")
os.chdir(HERE)


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
        ".html": "text/html", ".json": "application/json", ".bin": "application/octet-stream",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _state_file(self):
        url = urllib.parse.urlparse(self.path)
        m = re.fullmatch(r"/state/([\w-]{1,40})", url.path)
        return (os.path.join(STATE_DIR, m.group(1) + ".bin"), url.query) if m else (None, url.query)

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        if url.path == "/ping":   # lets a page mark a moment in the server log (used for video editing)
            print(f"PING {url.query} at {time.time():.3f}", flush=True)
            self.send_response(204)
            self.end_headers()
            return
        path, _ = self._state_file()
        if path:
            if not os.path.exists(path):
                self.send_error(404)
                return
            with open(path, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()

    def do_POST(self):
        url = urllib.parse.urlparse(self.path)
        m = re.fullmatch(r"/recording/([\w-]{1,80})", url.path)
        if m:
            data = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            os.makedirs(REC_DIR, exist_ok=True)
            out = os.path.join(REC_DIR, m.group(1) + ".webm")
            q = urllib.parse.parse_qs(url.query)
            if q.get("part") == ["0"] and os.path.exists(out):
                os.remove(out)   # a new recording with the same name starts over
            if data and "at" in q:
                # a piece that knows its byte position in the file
                with open(out, "r+b" if os.path.exists(out) else "wb") as f:
                    f.seek(int(q["at"][0]))
                    f.write(data)
            elif data:
                with open(out, "ab") as f:
                    f.write(data)
            if "done" in q:
                print(f"RECORDING done {out} {os.path.getsize(out) if os.path.exists(out) else 0} bytes at {time.time():.3f}", flush=True)
            self.send_response(204)
            self.end_headers()
            return
        path, query = self._state_file()
        if not path:
            self.send_error(404)
            return
        data = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        os.makedirs(STATE_DIR, exist_ok=True)
        with open(path + ".tmp", "wb") as f:
            f.write(data)
        os.replace(path + ".tmp", path)
        print(f"STATE saved {os.path.basename(path)} {query} {len(data)} bytes at {time.time():.3f}", flush=True)
        self.send_response(204)
        self.end_headers()


print(f"AI fruit fly running at http://127.0.0.1:{PORT}", flush=True)
http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
