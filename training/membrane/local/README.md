# Local membrane (development only)

To run the same embedding service locally (CPU, localhost), see
`membrane-service/`. It needs network access to `huggingface.co` to download
the model.

```bash
python3 -m venv /tmp/mvenv && /tmp/mvenv/bin/pip install -r membrane-service/requirements.txt
mkdir -p /tmp/e5 && /tmp/mvenv/bin/python -I membrane-service/fetch.py intfloat/multilingual-e5-small /tmp/e5
/tmp/mvenv/bin/python -I membrane-service/serve.py /tmp/e5 &
MEMBRANE_BASE_URL=http://127.0.0.1:8765/v1 MEMBRANE_EMBED_MODEL=multilingual-e5-small \
  node scripts/membrane-calibrate.js
```

In production, use the admin page `GET /api/admin/membrane/calibration`.
