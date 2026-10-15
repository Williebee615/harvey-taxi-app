"""Membrane: Harvey Taxi's own embedding service.

OpenAI-compatible POST /v1/embeddings serving an E5 ONNX model with
onnxruntime on CPU, plus GET /health. Text is processed in memory and never
stored or logged. Owner decisions (2026-10-15): own model, no AI vendor;
hosted as a Render private service, reachable only inside Harvey Taxi's
Render network.

  python -I serve.py <model_dir>            # port from $PORT (Render) or 8765
Environment:
  PORT                 listen port (Render sets it; default 8765)
  HOST                 bind address (default 0.0.0.0 on Render, else 127.0.0.1)
  MEMBRANE_API_KEY     if set, every embeddings request must send
                       "Authorization: Bearer <key>" (the web service holds
                       the same value)
"""
import hmac
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

MODEL_DIR = sys.argv[1]
PORT = int(os.environ.get("PORT") or (sys.argv[2] if len(sys.argv) > 2 else 8765))
HOST = os.environ.get("HOST") or ("0.0.0.0" if os.environ.get("RENDER") else "127.0.0.1")
API_KEY = os.environ.get("MEMBRANE_API_KEY", "")
MAX_INPUTS = 64
MAX_CHARS = 4000
MAX_BODY = 1_000_000
# Texts run through the model this many at a time: a batch of 64 passages of
# 512 tokens needs well over 1 GB for attention alone, more than a 2 GB
# instance can spare next to the model, and an out-of-memory kill drops the
# connection with no reply.
CHUNK = 8

tok = Tokenizer.from_file(f"{MODEL_DIR}/tokenizer.json")
tok.enable_truncation(max_length=512)
pad_id = tok.token_to_id("<pad>")
tok.enable_padding(pad_id=pad_id if pad_id is not None else 0, pad_token="<pad>")
sess = ort.InferenceSession(f"{MODEL_DIR}/model.onnx", providers=["CPUExecutionProvider"])
INPUTS = {i.name for i in sess.get_inputs()}
try:
    with open(f"{MODEL_DIR}/MODEL_INFO.json", encoding="utf-8") as f:
        MODEL_INFO = json.load(f)
except OSError:
    MODEL_INFO = {}


def embed(texts):
    if len(texts) > CHUNK:
        return np.concatenate([embed(texts[i:i + CHUNK]) for i in range(0, len(texts), CHUNK)])
    enc = tok.encode_batch(texts)
    ids = np.array([e.ids for e in enc], dtype=np.int64)
    mask = np.array([e.attention_mask for e in enc], dtype=np.int64)
    feed = {"input_ids": ids, "attention_mask": mask}
    if "token_type_ids" in INPUTS:
        feed["token_type_ids"] = np.zeros_like(ids)
    hidden = sess.run(None, feed)[0]  # (batch, seq, dim)
    m = mask[..., None].astype(np.float32)
    pooled = (hidden * m).sum(1) / np.clip(m.sum(1), 1e-9, None)  # mean pooling, as E5 specifies
    return pooled / np.linalg.norm(pooled, axis=1, keepdims=True)


DIMS = int(embed(["warm up"]).shape[1])


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, payload):
        out = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def do_GET(self):
        if self.path.rstrip("/") in ("/health", "/v1/health"):
            return self._send(200, {"ok": True, "dims": DIMS, "model": MODEL_INFO.get("repo"), "revision": MODEL_INFO.get("commit")})
        return self._send(404, {"error": "not_found"})

    def do_POST(self):
        if self.path.rstrip("/") != "/v1/embeddings":
            return self._send(404, {"error": "not_found"})
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length <= 0 or length > MAX_BODY:
            self.close_connection = True
            return self._send(413 if length > MAX_BODY else 400, {"error": "bad_body"})
        # Read the body before any refusal: replying while the client is still
        # sending makes it see a reset connection instead of the status code.
        raw = self.rfile.read(length)
        if API_KEY:
            given = self.headers.get("Authorization", "")
            if not hmac.compare_digest(given.encode(), f"Bearer {API_KEY}".encode()):
                return self._send(401, {"error": "unauthorized"})
        try:
            body = json.loads(raw)
            inputs = body["input"] if isinstance(body["input"], list) else [body["input"]]
            if not inputs or len(inputs) > MAX_INPUTS or not all(isinstance(t, str) for t in inputs):
                raise ValueError("input")
            inputs = [t[:MAX_CHARS] for t in inputs]
        except (ValueError, KeyError, TypeError, json.JSONDecodeError):
            return self._send(400, {"error": "bad_request"})
        started = time.monotonic()
        try:
            vecs = embed(inputs)
        except Exception as err:  # never the text, only the error type
            sys.stderr.write(f"membrane embed_failed {type(err).__name__}\n")
            return self._send(500, {"error": "embed_failed"})
        return self._send(200, {
            "object": "list",
            "model": body.get("model"),
            "data": [{"object": "embedding", "index": i, "embedding": v.tolist()} for i, v in enumerate(vecs)],
            "usage": {"ms": round((time.monotonic() - started) * 1000)},
        })

    def log_message(self, fmt, *args):
        # Never log request content; status line only.
        if args and str(args[1])[:1] in "45":
            sys.stderr.write(f"membrane {args[1]} {self.command} {self.path}\n")


if __name__ == "__main__":
    print(f"membrane listening on {HOST}:{PORT} dims={DIMS} model={MODEL_INFO.get('repo')} revision={MODEL_INFO.get('commit')}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
