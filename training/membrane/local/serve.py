"""Local membrane for calibration: OpenAI-compatible POST /v1/embeddings,
serving an E5 ONNX model with onnxruntime on CPU. localhost only.

  python -I serve.py <model_dir> [port]
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

MODEL_DIR = sys.argv[1]
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8765

tok = Tokenizer.from_file(f"{MODEL_DIR}/tokenizer.json")
tok.enable_truncation(max_length=512)
tok.enable_padding(pad_id=tok.token_to_id("<pad>") or 0, pad_token="<pad>")
sess = ort.InferenceSession(f"{MODEL_DIR}/model.onnx", providers=["CPUExecutionProvider"])
INPUTS = {i.name for i in sess.get_inputs()}


def embed(texts):
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


class H(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path.rstrip("/") != "/v1/embeddings":
            self.send_response(404); self.end_headers(); return
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
        inputs = body["input"] if isinstance(body["input"], list) else [body["input"]]
        vecs = embed(inputs)
        out = json.dumps({"object": "list", "model": body.get("model"), "data": [{"object": "embedding", "index": i, "embedding": v.tolist()} for i, v in enumerate(vecs)]}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(out))); self.end_headers(); self.wfile.write(out)

    def log_message(self, *a):
        pass


ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
