"""Downloads the embedding model's ONNX weights and tokenizer (nothing else)
and records the exact commit and license in MODEL_INFO.json.

  python -I fetch.py <repo> <out_dir> [revision]
"""
import json
import shutil
import sys

from huggingface_hub import HfApi, hf_hub_download

# The same model as an ONNX export, used only if the first repository has
# no ONNX file.
FALLBACK = {"intfloat/multilingual-e5-small": "Xenova/multilingual-e5-small"}

repo, out = sys.argv[1], sys.argv[2]
revision = sys.argv[3] if len(sys.argv) > 3 else None


def onnx_file(info):
    files = {f.rfilename for f in info.siblings}
    return next((f for f in ["onnx/model.onnx", "model.onnx"] if f in files), None)


info = HfApi().model_info(repo, revision=revision, files_metadata=False)
onnx = onnx_file(info)
if not onnx and repo in FALLBACK:
    print(f"{repo} has no ONNX file; using {FALLBACK[repo]}")
    repo = FALLBACK[repo]
    info = HfApi().model_info(repo)
    onnx = onnx_file(info)
if not onnx:
    sys.exit(f"no ONNX model file in {repo}")
card = info.card_data.to_dict() if info.card_data else {}
for name in [onnx, "tokenizer.json", "config.json"]:
    path = hf_hub_download(repo, name, revision=info.sha)
    shutil.copy(path, f"{out}/{name.split('/')[-1]}")
meta = {"repo": repo, "commit": info.sha, "license": card.get("license"), "onnx_file": onnx}
with open(f"{out}/MODEL_INFO.json", "w", encoding="utf-8") as f:
    json.dump(meta, f)
print("model", json.dumps(meta))
