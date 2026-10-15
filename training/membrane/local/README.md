# Local membrane: embedding calibration

Runs the embedding model on this machine (CPU, localhost only) so
`scripts/membrane-calibrate.js` can measure real retrieval quality and
suggest `MEMBRANE_MIN_SIMILARITY`. Nothing here touches production.

Needs network access to `huggingface.co`, `cdn-lfs.huggingface.co` and
`cas-bridge.xethub.hf.co` (owner added these to the environment on
2026-10-15; takes effect in a new session). No Hugging Face account or
token is needed: the model is public.

```bash
python3 -m venv /tmp/mvenv && /tmp/mvenv/bin/pip install -r training/membrane/local/requirements.txt
mkdir -p /tmp/e5 && /tmp/mvenv/bin/python -I training/membrane/local/fetch.py Xenova/multilingual-e5-small /tmp/e5
/tmp/mvenv/bin/python -I training/membrane/local/serve.py /tmp/e5 8765 &
MEMBRANE_BASE_URL=http://127.0.0.1:8765/v1 MEMBRANE_EMBED_MODEL=multilingual-e5-small \
  MEMBRANE_QUERY_PREFIX="query: " MEMBRANE_PASSAGE_PREFIX="passage: " \
  node scripts/membrane-calibrate.js
```

`fetch.py` prints the exact model commit and license; record both with the
results. If `Xenova/multilingual-e5-small` has no ONNX file, use
`intfloat/multilingual-e5-small` (check its `onnx/` folder).
