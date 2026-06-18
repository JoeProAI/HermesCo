# HermesCo - the real GPU substrate. This is the external vendor the agent
# autonomously rents from. When a GPU-backed job is delivered, HermesCo POSTs to
# the web endpoint below; Modal cold-starts a real cloud GPU container, runs a
# real PyTorch hyperparameter sweep ("parameter golf") on that GPU, and returns
# the winning config plus the REAL GPU type and metered GPU-seconds. The agent
# books that real, per-second Modal cost as a Nemotron-screened Treasury spend.
#
# Nothing here is simulated: the sweep trains real neural nets on a real CUDA
# device, and the cost is measured container GPU-seconds x Modal's published
# per-second GPU rate. Cross-check it on the Modal usage dashboard.

import os
import time

import modal
from fastapi import Header
from fastapi.responses import JSONResponse

# Captured the moment this module is first imported inside the container, i.e.
# right after Modal boots the GPU container. Used to measure billed GPU-seconds
# (Modal bills per second of container uptime, including the cold start).
_CONTAINER_START = time.time()

APP_NAME = "hermesco-gpu"

# Modal's published per-second GPU prices (USD/sec). Source of truth for cost.
# https://modal.com/pricing
GPU_RATE_USD_PER_SEC = {
    "T4": 0.000164,
    "L4": 0.000222,
    "A10G": 0.000306,
    "A10": 0.000306,
    "L40S": 0.000542,
    "A100": 0.000583,
    "A100-40GB": 0.000583,
    "A100-80GB": 0.000694,
    "H100": 0.001097,
    "H200": 0.001267,
    "B200": 0.001736,
}

# The GPU this service rents. L4 is a real, modern datacenter GPU and cheap
# enough that a per-job rental lands well inside the agent's auto-approve band.
DEFAULT_GPU = "L4"

app = modal.App(APP_NAME)

# GPU image: a real PyTorch + CUDA stack. Heavy imports run only in the
# container (not at deploy time) via image.imports().
gpu_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("torch==2.4.1", "numpy==1.26.4")
    .pip_install("fastapi[standard]==0.115.0")
)
with gpu_image.imports():
    import numpy as np
    import torch
    import torch.nn as nn

# Lightweight image for the public web endpoint (no torch needed - it just
# authenticates and fans out to the GPU function).
web_image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "fastapi[standard]==0.115.0"
)


def _rate_for(gpu_type: str) -> float:
    return GPU_RATE_USD_PER_SEC.get(gpu_type.upper(), GPU_RATE_USD_PER_SEC[DEFAULT_GPU])


@app.function(image=gpu_image, gpu=DEFAULT_GPU, timeout=600, scaledown_window=2)
def sweep(payload: dict) -> dict:
    """Run a real hyperparameter sweep on a real GPU and return the winner."""
    compute_start = time.time()

    objective = str((payload or {}).get("brief") or "").strip()
    seed = int((payload or {}).get("seed") or 7)
    gpu_type = str((payload or {}).get("gpu_type") or DEFAULT_GPU)

    torch.manual_seed(seed)
    np.random.seed(seed)

    if not torch.cuda.is_available():
        # Fail loudly rather than silently running on CPU and mislabelling it.
        return {
            "ok": False,
            "error": "no_cuda_device",
            "detail": "CUDA not available in the rented container.",
        }

    device = torch.device("cuda")
    device_name = torch.cuda.get_device_name(0)

    # Real, non-trivial dataset: two interleaving spirals (not linearly
    # separable), generated on the GPU. The sweep has to actually learn it.
    def make_spirals(n_per_class: int):
        n = n_per_class
        t = torch.linspace(0.0, 1.0, n, device=device)
        Xs, ys = [], []
        for c in range(2):
            r = 1.0 + 3.5 * t
            theta = 1.75 * t * 2 * 3.141592653589793 + c * 3.141592653589793
            noise = 0.18 * torch.randn(n, device=device)
            x1 = r * torch.cos(theta) + noise
            x2 = r * torch.sin(theta) + noise
            Xs.append(torch.stack([x1, x2], dim=1))
            ys.append(torch.full((n,), c, device=device, dtype=torch.long))
        X = torch.cat(Xs, dim=0)
        y = torch.cat(ys, dim=0)
        perm = torch.randperm(X.shape[0], device=device)
        return X[perm], y[perm]

    X_train, y_train = make_spirals(2000)
    X_val, y_val = make_spirals(600)
    # Standardise on train stats.
    mu, sd = X_train.mean(0, keepdim=True), X_train.std(0, keepdim=True) + 1e-6
    X_train = (X_train - mu) / sd
    X_val = (X_val - mu) / sd

    def build_mlp(hidden: int, depth: int) -> nn.Module:
        layers = [nn.Linear(2, hidden), nn.ReLU()]
        for _ in range(depth - 1):
            layers += [nn.Linear(hidden, hidden), nn.ReLU()]
        layers += [nn.Linear(hidden, 2)]
        return nn.Sequential(*layers).to(device)

    # The hyperparameter grid this rental sweeps ("parameter golf").
    hidden_sizes = [64, 128, 256]
    learning_rates = [0.003, 0.01, 0.03]
    depths = [2, 3]
    epochs = 220

    loss_fn = nn.CrossEntropyLoss()
    leaderboard = []
    for hidden in hidden_sizes:
        for lr in learning_rates:
            for depth in depths:
                torch.manual_seed(seed)
                model = build_mlp(hidden, depth)
                opt = torch.optim.Adam(model.parameters(), lr=lr)
                for _ in range(epochs):
                    opt.zero_grad()
                    out = model(X_train)
                    loss = loss_fn(out, y_train)
                    loss.backward()
                    opt.step()
                with torch.no_grad():
                    val_logits = model(X_val)
                    val_loss = float(loss_fn(val_logits, y_val).item())
                    val_acc = float((val_logits.argmax(1) == y_val).float().mean().item())
                leaderboard.append(
                    {
                        "hidden": hidden,
                        "lr": lr,
                        "depth": depth,
                        "params": int(sum(p.numel() for p in model.parameters())),
                        "val_acc": round(val_acc, 4),
                        "val_loss": round(val_loss, 4),
                    }
                )

    torch.cuda.synchronize()
    leaderboard.sort(key=lambda r: (-r["val_acc"], r["val_loss"]))
    best = leaderboard[0]

    compute_seconds = time.time() - compute_start
    billed_seconds = time.time() - _CONTAINER_START
    rate = _rate_for(gpu_type)
    cost_usd = round(billed_seconds * rate, 6)

    return {
        "ok": True,
        "objective": objective,
        "task": "hyperparameter_sweep_2class_spirals",
        "gpu_type": gpu_type,
        "cuda_device": device_name,
        "torch_version": str(torch.__version__),
        "configs_evaluated": len(leaderboard),
        "epochs_per_config": epochs,
        "best": best,
        "leaderboard": leaderboard,
        "compute_seconds": round(compute_seconds, 3),
        "billed_seconds": round(billed_seconds, 3),
        "rate_usd_per_sec": rate,
        "rate_usd_per_hr": round(rate * 3600, 4),
        "cost_usd": cost_usd,
    }


@app.function(
    image=web_image,
    secrets=[modal.Secret.from_name("hermesco-gpu-auth")],
)
@modal.fastapi_endpoint(method="POST")
def run(payload: dict, authorization: str = Header(default="")):
    """Public, token-gated entrypoint HermesCo calls to rent a GPU per job."""
    expected = os.environ.get("HERMESCO_GPU_SHARED_SECRET", "")
    token = authorization[7:].strip() if authorization[:7].lower() == "bearer " else ""
    if not expected or token != expected:
        return JSONResponse({"ok": False, "error": "unauthorized"}, status_code=401)

    result = sweep.remote(payload or {})
    return JSONResponse(result)
