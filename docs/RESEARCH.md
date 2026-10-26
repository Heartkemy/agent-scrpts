# Model/runtime pre-research — 27 September 2026

This is source-based integration research, not a benchmark run on your Mac. A local runtime can run structural inference checks and record cold/warm timings, but those tiny checks do not establish general accuracy or calibrated confidence.

## Pinned local-runtime profile

| Local ID | Weights | Native backend | Starter context |
|---|---|---|---|
| laya-english | aac6fef/laya-mlx | laya-mlx 0.2.0 / MLX FP16 | 512 |
| laya-multilingual | aac6fef/laya-multilingual-mlx | laya-mlx 0.2.0 / MLX FP16 | 1,024 |
| laya-typed | aac6fef/laya-typed-decisions-mlx | laya-mlx 0.2.0 / MLX FP16 | 1,024 |
| decider-0.8b | Mapika/decider-0.8b | decider-ai 1.5.0 / PyTorch MPS FP16 | 2,048 or 4,096 |

The independent Laya MLX port publishes English ModernBERT (~421M), multilingual mmBERT (~322M) and typed-decision (~421M) checkpoints. The fixed router uses multilingual to make non-English metadata usable without assuming the English model handles it. All three specialists are useful to compare, not presumed equally capable. The upstream project reports markedly different typed-decision performance between base and fine-tuned variants; deployment needs task-specific validation.

An optional local profile can add Mapika/decider-2b on Macs with at least 16 GiB RAM, or use only the three Laya checkpoints. Downloads are multiple GB; RAM residency is controlled separately from disk size. These choices are conservative starting points, not a guarantee of latency or compatibility on unknown hardware.

Decider also publishes larger 4B and 35B-A3B variants, including a CUDA-oriented NVFP4 variant and vision work. They are not default small-Mac installations. This project intentionally serves only the verified text typed-decision API. No image capability is implied by membership in a model family.

Decider's package metadata includes `flash-linear-attention`. The selected MPS path does not use that CUDA/Triton runtime. A compatible local runtime should use a separate environment, the pinned Mac dependency set, and the hash-verified decider-ai wheel with `--no-deps`. This is deliberate platform-specific dependency curation, not evidence that the unmodified full CUDA requirements work on macOS. Check the pinned source again when upgrading.

## Other relevant open projects, not silently installed

**Kev (jaredpalmer/kev)**: another one-pass typed-decision family, with a small 0.8B variant and larger 4B/9B/27B versions. Its project documents an Apple Silicon path choosing MLX. This makes it a real candidate for a later adapter, not a reason to assume Laya/Decider wire formats, token budgets or confidence semantics are identical. The larger Mac examples are not appropriate to assume on an unknown-memory MacBook.

**Jeff (logan-markewich/jeff)**: GliFormer-based decision model (~400M), with MPS support and a System One style serving API. Another plausible comparison target; its schemas and inference packaging need their own tested adapter before entering this service's installed registry.

No claim is made that this list exhausts the landscape. The starter integrates the two requested families rather than installing every newly published backend and treating them as interchangeable.

## Why the existing oMLX installation is unchanged

MLX is a tensor/inference framework; oMLX is a server with particular supported model backends. An MLX conversion does not automatically give a custom discriminative decision head an oMLX API. The oMLX documentation lists language, vision, OCR, embedding and reranking backends, not the verified Laya/Decider typed-decision call paths. This installation therefore runs the native adapters behind a separate local TypeScript service, without modifying oMLX's models, ports or configuration.

## Sources

- https://github.com/NandhaKishorM/laya
- https://github.com/mizorewww/laya-mlx
- https://github.com/mizorewww/laya-mlx/blob/main/laya_mlx/agent.py
- https://github.com/mizorewww/laya-mlx/blob/main/laya_mlx/common.py
- https://pypi.org/project/laya-mlx/0.2.0/
- https://huggingface.co/aac6fef/laya-mlx
- https://huggingface.co/aac6fef/laya-multilingual-mlx
- https://huggingface.co/aac6fef/laya-typed-decisions-mlx
- https://github.com/Mapika/decider
- https://github.com/Mapika/decider/blob/main/decider/infer.py
- https://github.com/Mapika/decider/blob/main/decider/systemone.py
- https://github.com/Mapika/decider/blob/main/decider/mps_ops.py
- https://pypi.org/project/decider-ai/1.5.0/
- https://huggingface.co/Mapika/decider-0.8b
- https://huggingface.co/Mapika/decider-2b
- https://github.com/jaredpalmer/kev
- https://github.com/logan-markewich/jeff
- https://github.com/jundot/omlx
- https://nodejs.org/api/typescript.html
- https://docs.astral.sh/uv/guides/install-python/
- https://docs.astral.sh/uv/pip/compile/
- https://docs.brew.sh/Installation
- https://developers.openai.com/codex/guides/agents-md/

Package versions are fixed in requirements inputs and checked-in lockfiles. They document the compatible runtime rather than providing a public installer. Any explicit local setup must resolve the pinned model revisions and keep its environments separate; it is therefore **not a fully hermetic pre-resolved macOS build**. Dependency and model retrieval still depend on external services and native approvals.
