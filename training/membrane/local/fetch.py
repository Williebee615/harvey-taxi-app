"""Downloads the E5 ONNX model files (no other files) and prints the exact
commit so the calibration names the revision it measured."""
import shutil, sys
from huggingface_hub import HfApi, hf_hub_download

repo, out = sys.argv[1], sys.argv[2]
info = HfApi().model_info(repo)
print("repo", repo, "commit", info.sha, "license", (info.card_data or {}).get("license") if info.card_data else None)
files = [f.rfilename for f in info.siblings]
onnx = next(f for f in ["onnx/model.onnx", "model.onnx"] if f in files)
for name in [onnx, "tokenizer.json", "config.json"]:
    p = hf_hub_download(repo, name, revision=info.sha)
    shutil.copy(p, f"{out}/{name.split('/')[-1]}")
    print("got", name)
