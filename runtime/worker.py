"""Minimal inference bridge. Workflows, HTTP, routing and repository management live in TS.

Line-delimited JSON over a private child-process pipe, not an MCP server.
Imports upstream packages only when needed. Fixed checkpoint paths, no remote code.
"""
import contextlib
import gc
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import time
from types import SimpleNamespace

MODELS = {}
TOKENIZERS = {}

class InputError(Exception):
    def __init__(self, code, message, details=None):
        super().__init__(message)
        self.code, self.details = code, details


def laya_budget(tok, cfg, state, questions):
    """Reject every upstream truncation path: instruction, each option, prefix, state."""
    from laya_mlx.agent import Agent
    from laya_mlx.common import render_options, serialize_state
    counts = []
    for qid, definition in questions.items():
        q = Agent._to_internal(definition)
        options = render_options(q)
        clean = lambda s: s.replace(tok.mask_token, " ")
        encode = lambda s: tok(s, add_special_tokens=False)["input_ids"]
        head = len(encode(f'{q["t"]} question: {clean(str(q["ins"]))}'))
        lengths = [1 + len(encode(" " + clean(opt))) for opt in options]
        budget = cfg.get("head_max_len", 192)
        remaining = budget - sum(lengths)
        if any(n > 49 for n in lengths) or remaining < 16 or head > max(8, remaining):
            raise InputError("SCHEMA_TOO_LARGE", "This Laya checkpoint would shorten the instructions or options.", {"question": qid, "headBudget": budget})
        total = 1 + head + 1 + sum(lengths) + 1 + len(encode(clean(serialize_state(state)))) + 1
        limit = cfg.get("max_len", 512)
        if total > limit:
            raise InputError("INPUT_TOO_LONG", "This Laya checkpoint cannot read the complete request.", {"question": qid, "tokens": total, "limit": limit})
        counts.append(total)
    return {"maxTokens": max(counts), "rowTokens": counts, "truncated": False}


def metadata(model):
    key = model["id"]
    if key in TOKENIZERS:
        return TOKENIZERS[key]
    p = Path(model["path"])
    if not p.is_dir():
        raise InputError("MODEL_MISSING", "The pinned model snapshot is missing. Configure the local runtime with the required model files.")
    if model["family"] == "laya":
        from laya_mlx.tokenizer import Tokenizer
        cfg = json.loads((p / "rl_agent_config.json").read_text())
        info = {"tok": Tokenizer(p / "tokenizer"), "cfg": cfg}
    else:
        from transformers import AutoTokenizer
        from decider.prompt import resolve_layout, chat_template
        cfg = json.loads((p / "decider_config.json").read_text())
        tok = AutoTokenizer.from_pretrained(str(p), local_files_only=True, trust_remote_code=False)
        info = {"tok": tok, "cfg": cfg, "chat": chat_template(tok) if resolve_layout(cfg) == "chat" else None}
    TOKENIZERS[key] = info
    return info


def inspect_request(model, request):
    info = metadata(model)
    if model["family"] == "laya":
        effective = dict(info["cfg"], max_len=min(info["cfg"].get("max_len", 512), model["maxTokens"]))
        return laya_budget(info["tok"], effective, request["state"], request["questions"])
    from decider.infer import Decider
    from decider.systemone import render_state
    # Use the PINNED upstream formatter without allocating the model. No prompt fork.
    adapter = SimpleNamespace(m=SimpleNamespace(tok=info["tok"]), chat=info["chat"], schema_first=False,
                              neutralize_none=bool(info["cfg"].get("neutralize_none", True)),
                              isolated_levels=bool(info["cfg"].get("isolated_levels", False)))
    state_text = render_state(request["state"])
    state_len = len(info["tok"].encode("Context:\n" + state_text, add_special_tokens=False))
    # Large enough not to clip the state in either plain or chat layout.
    no_clip_budget = state_len + len(info["tok"].encode(state_text, add_special_tokens=False)) + 32
    _, _, rows = Decider._system_one_items(adapter, request["state"], request["questions"],
                                          independent=True, max_state_tokens=no_clip_budget,
                                          layout="state_first", isolated=adapter.isolated_levels)
    lengths = [len(row["ids"]) for row in rows]
    max_tokens = max(lengths)
    if max_tokens > model["maxTokens"]:
        raise InputError("INPUT_TOO_LONG", "The complete formatted request exceeds this installation's token budget.",
                         {"tokens": max_tokens, "limit": model["maxTokens"]})
    return {"maxTokens": max_tokens, "rowTokens": lengths, "stateBudget": no_clip_budget, "truncated": False}


def unload(keep):
    for key in list(MODELS):
        if key not in keep:
            del MODELS[key]
    gc.collect()
    if "mlx.core" in sys.modules:
        import mlx.core as mx
        mx.clear_cache()
    if "torch" in sys.modules:
        import torch
        if torch.backends.mps.is_available():
            torch.mps.empty_cache()


def load_model(model, budget):
    key = model["id"]
    if key not in MODELS:
        if model["family"] == "laya":
            import laya_mlx
            import mlx.core as mx
            if hasattr(mx, "set_memory_limit"):
                mx.set_memory_limit(budget)
            MODELS[key] = laya_mlx.load(model["path"], device="gpu", dtype="float16", batch_size=1,
                                       compile=False, cache_prompts=False)
        else:
            import torch
            from decider.infer import Decider
            if not torch.backends.mps.is_available():
                raise InputError("NO_MPS", "Decider requires an available Apple MPS device; there is no silent CPU fallback.")
            torch.mps.set_per_process_memory_fraction(0.40)
            MODELS[key] = Decider(model["path"], device="mps", dtype=torch.float16, use_graphs=False)
    return MODELS[key]


def dispatch(message):
    op = message.get("op")
    if op == "unload":
        unload(message.get("keep", [])); return {"loaded": list(MODELS)}
    if op == "ping":
        return {"loaded": list(MODELS)}
    model, request = message["model"], message["request"]
    check = inspect_request(model, request)
    if op == "inspect":
        return check
    if op != "predict":
        raise InputError("BAD_OPERATION", "Unknown worker operation.")
    started = time.perf_counter()
    cold = model["id"] not in MODELS
    agent = load_model(model, message.get("memoryBudgetBytes", 2 * 1024 ** 3))
    loaded = time.perf_counter()
    if model["family"] == "laya":
        result = agent.predict(request["state"], request["questions"])
    else:
        result = agent.system_one(request["state"], request["questions"], independent=True,
                                  max_state_tokens=check["stateBudget"],
                                  max_fwd_tokens=model["maxTokens"], layout="state_first")
    result["runtime"] = {"cold": cold, "loadMs": round((loaded - started) * 1000, 3),
                         "inferenceMs": round((time.perf_counter() - loaded) * 1000, 3),
                         "tokens": check["maxTokens"], "truncated": False,
                         "backend": "mlx-fp16" if model["family"] == "laya" else "torch-mps-fp16"}
    return result


def download(spec):
    from huggingface_hub import snapshot_download
    path = snapshot_download(spec["repo"], revision=spec["revision"],
                             allow_patterns=["*.safetensors", "*.json", "*.model", "*.txt", "LICENSE*", "README.md"])
    # Files downloaded by HF are content-addressed; additionally record our own weight checksums.
    hashes, total = {}, 0
    for file in sorted(Path(path).rglob("*")):
        if file.is_file() and file.suffix in (".safetensors", ".json", ".model"):
            sha = hashlib.sha256()
            with file.open("rb") as stream:
                for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
                    sha.update(block)
            hashes[str(file.relative_to(path))] = sha.hexdigest()
            total += file.stat().st_size
    print(json.dumps({"path": path, "sha256": hashes, "bytes": total}))


def main():
    if "--download" in sys.argv:
        spec = json.load(sys.stdin)
        with contextlib.redirect_stdout(sys.stderr):
            # Keep the protocol result on stdout, not progress or third-party diagnostics.
            from huggingface_hub import snapshot_download  # noqa: F401
        download(spec)
        return
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["TOKENIZERS_PARALLELISM"] = "false"
    for line in sys.stdin:
        message = {}
        try:
            message = json.loads(line)
            with contextlib.redirect_stdout(sys.stderr):
                result = dispatch(message)
            reply = {"id": message.get("id"), "result": result}
        except InputError as exc:
            reply = {"id": message.get("id"), "error": {"code": exc.code, "message": str(exc), "details": exc.details}}
        except Exception as exc:
            # Do not persist exception text that might echo confidential request content.
            print(f"worker failure: {type(exc).__name__}", file=sys.stderr, flush=True)
            reply = {"id": message.get("id"), "error": {"code": "BACKEND_FAILURE", "message": f"Local inference failed ({type(exc).__name__}); run ascr doctor and check the pinned runtime."}}
        print(json.dumps(reply, allow_nan=False, ensure_ascii=False), flush=True)

if __name__ == "__main__":
    main()
