"""Fine-tune the membrane (Harvey Taxi's own model) with LoRA or QLoRA.

Owner decisions (2026-10-15): own model, no AI vendor; training data is
published pages + synthetic Q&A only (scripts/membrane-build-dataset.js);
no GPU is rented until the owner approves a quote. Runs on a GPU host we
rent; never on the production web server.

  pip install -r training/membrane/requirements.txt
  python training/membrane/train_lora.py --mode qlora \
      --base-model <open-weight instruct model> --data training/membrane/data \
      --out training/membrane/out
  python training/membrane/train_lora.py --predict --adapter training/membrane/out \
      --base-model <same model> --data training/membrane/data   # writes predictions.jsonl
  node scripts/membrane-score-predictions.js training/membrane/out/predictions.jsonl

LoRA:  the base model in bf16, small trainable low-rank adapters.
QLoRA: the base model loaded in 4-bit NF4 (bitsandbytes), LoRA adapters on
       top; about a quarter of the memory, so a 3B-8B model fits one 24 GB GPU.
Loss is computed on the assistant's answer only, never on the sources or
the question.
"""

import argparse
import json
import os
import random

import torch
from peft import LoraConfig, PeftModel, get_peft_model, prepare_model_for_kbit_training
from transformers import (AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, Trainer,
                          TrainingArguments)

TARGET_MODULES = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]


def read_jsonl(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def load_model(base, mode):
    kwargs = {"torch_dtype": torch.bfloat16, "device_map": "auto"}
    if mode == "qlora":
        kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=torch.bfloat16)
    model = AutoModelForCausalLM.from_pretrained(base, **kwargs)
    if mode == "qlora":
        model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
    return model


def encode(tokenizer, example, max_len):
    """Tokens for the whole conversation; labels only on the final answer."""
    msgs = example["messages"]
    prompt_ids = tokenizer.apply_chat_template(msgs[:-1], add_generation_prompt=True, tokenize=True)
    full_ids = tokenizer.apply_chat_template(msgs, tokenize=True)
    if full_ids[: len(prompt_ids)] != prompt_ids:
        raise ValueError("chat template does not extend the prompt; pick a model with a standard template")
    if len(full_ids) > max_len:
        return None
    labels = [-100] * len(prompt_ids) + full_ids[len(prompt_ids):]
    return {"input_ids": full_ids, "labels": labels}


def collate(pad_id):
    def fn(batch):
        n = max(len(b["input_ids"]) for b in batch)
        ids = torch.full((len(batch), n), pad_id)
        labels = torch.full((len(batch), n), -100)
        mask = torch.zeros((len(batch), n), dtype=torch.long)
        for i, b in enumerate(batch):
            ids[i, : len(b["input_ids"])] = torch.tensor(b["input_ids"])
            labels[i, : len(b["labels"])] = torch.tensor(b["labels"])
            mask[i, : len(b["input_ids"])] = 1
        return {"input_ids": ids, "labels": labels, "attention_mask": mask}
    return fn


def train(args):
    random.seed(args.seed)
    torch.manual_seed(args.seed)
    tok = AutoTokenizer.from_pretrained(args.base_model)
    if tok.pad_token_id is None:
        tok.pad_token = tok.eos_token
    rows = [encode(tok, e, args.max_len) for e in read_jsonl(os.path.join(args.data, "train.jsonl"))]
    train_rows = [r for r in rows if r]
    eval_rows = [r for r in (encode(tok, e, args.max_len) for e in read_jsonl(os.path.join(args.data, "eval.jsonl"))) if r]
    print(f"train {len(train_rows)} (skipped {len(rows) - len(train_rows)} too long), eval {len(eval_rows)}")

    model = load_model(args.base_model, args.mode)
    model = get_peft_model(model, LoraConfig(
        r=args.rank, lora_alpha=args.rank * 2, lora_dropout=0.05, bias="none",
        target_modules=TARGET_MODULES, task_type="CAUSAL_LM"))
    model.print_trainable_parameters()

    trainer = Trainer(
        model=model,
        args=TrainingArguments(
            output_dir=args.out, num_train_epochs=args.epochs, learning_rate=args.lr,
            per_device_train_batch_size=args.batch, per_device_eval_batch_size=args.batch,
            gradient_accumulation_steps=args.accum, lr_scheduler_type="cosine", warmup_ratio=0.05,
            logging_steps=10, eval_strategy="epoch", save_strategy="epoch", save_total_limit=2,
            bf16=True, gradient_checkpointing=args.mode == "qlora", report_to=[], seed=args.seed),
        train_dataset=train_rows, eval_dataset=eval_rows, data_collator=collate(tok.pad_token_id))
    trainer.train()
    model.save_pretrained(args.out)  # adapter only (tens of MB), not the base model
    tok.save_pretrained(args.out)
    with open(os.path.join(args.out, "training_run.json"), "w", encoding="utf-8") as f:
        json.dump({k: v for k, v in vars(args).items()}, f, indent=2)


@torch.no_grad()
def predict(args):
    tok = AutoTokenizer.from_pretrained(args.adapter)
    model = load_model(args.base_model, args.mode)
    model = PeftModel.from_pretrained(model, args.adapter)
    model.eval()
    out_path = os.path.join(args.adapter, "predictions.jsonl")
    with open(out_path, "w", encoding="utf-8") as out:
        for e in read_jsonl(os.path.join(args.data, "eval.jsonl")):
            ids = tok.apply_chat_template(e["messages"][:-1], add_generation_prompt=True, return_tensors="pt").to(model.device)
            gen = model.generate(ids, max_new_tokens=200, do_sample=False)
            answer = tok.decode(gen[0, ids.shape[1]:], skip_special_tokens=True).strip()
            out.write(json.dumps({"messages": e["messages"][:-1], "expected": e["messages"][-1]["content"], "answer": answer}) + "\n")
    print(f"wrote {out_path}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--mode", choices=["lora", "qlora"], default="qlora")
    p.add_argument("--base-model", required=True)
    p.add_argument("--data", default="training/membrane/data")
    p.add_argument("--out", default="training/membrane/out")
    p.add_argument("--adapter", default=None)
    p.add_argument("--predict", action="store_true")
    p.add_argument("--rank", type=int, default=16)
    p.add_argument("--epochs", type=float, default=3)
    p.add_argument("--lr", type=float, default=2e-4)
    p.add_argument("--batch", type=int, default=2)
    p.add_argument("--accum", type=int, default=8)
    p.add_argument("--max-len", type=int, default=2048)
    p.add_argument("--seed", type=int, default=7)
    args = p.parse_args()
    if args.predict:
        if not args.adapter:
            p.error("--predict needs --adapter")
        predict(args)
    else:
        train(args)


if __name__ == "__main__":
    main()
