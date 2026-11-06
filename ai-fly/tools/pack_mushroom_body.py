"""Cut the fly's learning centre (mushroom body) out of the FlyWire v783 wiring.

Keeps: uniglomerular olfactory projection neurons (the "smell" input), all Kenyon cells, the APL
and DPM neurons, and all mushroom-body output neurons (MBONs). Every connection between them is kept.

Each MBON gets a learning zone from the connectome itself: if more of its dopamine input comes from
PAM neurons (reward), sugar weakens its Kenyon-cell inputs; if more comes from PPL1 neurons
(punishment), bitter does. That is the standard picture of fly learning (Aso et al. 2014).

Outputs: data/mb.bin (same format as connectome.bin, local indices) and data/mb.json.
Run:  uv run --with pandas --with pyarrow --with numpy python tools/pack_mushroom_body.py
"""
import json
import struct
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / "raw_data"
OUT = ROOT / "data"

comp = pd.read_csv(RAW / "Completeness_783.csv", index_col=0)
id2idx = pd.Series(np.arange(len(comp)), index=comp.index)
ann = pd.read_csv(RAW / "neuron_annotations.tsv", sep="\t", low_memory=False)
ann = ann[ann.root_id.isin(id2idx.index)].drop_duplicates("root_id").copy()
ann["idx"] = id2idx[ann.root_id].to_numpy()
ct = ann.cell_type.astype(str)

uni_pn = ann[(ann.cell_class == "ALPN") & ann.cell_sub_class.astype(str).str.contains("uniglomerular")]
kc = ann[ann.cell_class == "Kenyon_Cell"]
apl_dpm = ann[ct.isin(["APL", "DPM"])]
mbon = ann[ann.cell_class == "MBON"]
dan = ann[ann.cell_class == "DAN"]

keep = np.unique(np.concatenate([uni_pn.idx, kc.idx, apl_dpm.idx, mbon.idx]).astype(np.int64))
g2l = pd.Series(np.arange(len(keep)), index=keep)

con = pd.read_parquet(RAW / "Connectivity_783.parquet",
                      columns=["Presynaptic_Index", "Postsynaptic_Index", "Connectivity", "Excitatory x Connectivity"])

# learning zone of each MBON from its dopamine input
dan_type = dan.set_index("idx").cell_type.astype(str)
dm = con[con.Presynaptic_Index.isin(dan_type.index) & con.Postsynaptic_Index.isin(mbon.idx)].copy()
dm["family"] = np.where(dan_type[dm.Presynaptic_Index].str.startswith("PAM").to_numpy(), "PAM", "PPL")
zone = dm.pivot_table(index="Postsynaptic_Index", columns="family", values="Connectivity", aggfunc="sum").fillna(0)
for c in ("PAM", "PPL"):
    if c not in zone:
        zone[c] = 0

sub = con[con.Presynaptic_Index.isin(keep) & con.Postsynaptic_Index.isin(keep)]
pre = g2l[sub.Presynaptic_Index].to_numpy()
post = g2l[sub.Postsynaptic_Index].to_numpy()
w = sub["Excitatory x Connectivity"].to_numpy(np.int64)
order = np.lexsort((post, pre))
pre, post, w = pre[order], post[order], w[order]
n = len(keep)
rowptr = np.zeros(n + 1, np.uint64)
np.add.at(rowptr, pre + 1, 1)
rowptr = np.cumsum(rowptr).astype(np.uint32)
edges = (post.astype(np.uint32) | ((w + 4096).astype(np.uint32) << 18)).astype(np.uint32)
with open(OUT / "mb.bin", "wb") as f:
    f.write(struct.pack("<4sIII", b"FLY1", n, len(edges), 18))
    f.write(rowptr.tobytes())
    f.write(edges.tobytes())

L = lambda idx: [int(g2l[i]) for i in sorted(idx)]
glomeruli = {}
for t, grp in uni_pn.groupby(ct[uni_pn.index]):
    glomeruli[t.split("_")[0]] = glomeruli.get(t.split("_")[0], []) + L(grp.idx)

mbons = []
for _, r in mbon.sort_values("cell_type").iterrows():
    pam = float(zone.PAM.get(r.idx, 0)) if r.idx in zone.index else 0.0
    ppl = float(zone.PPL.get(r.idx, 0)) if r.idx in zone.index else 0.0
    kind = "avoid" if pam > ppl else "approach" if ppl > pam else "none"
    mbons.append({"local": int(g2l[r.idx]), "type": str(r.cell_type), "side": str(r.side), "pam": pam, "ppl": ppl, "kind": kind})

meta = {
    "n": int(n), "edges": int(len(edges)),
    "global": [int(i) for i in keep],
    "glomeruli": glomeruli,
    "kc": L(kc.idx),
    "apl": L(apl_dpm[ct[apl_dpm.index] == "APL"].idx),
    "mbon": mbons,
}
(OUT / "mb.json").write_text(json.dumps(meta))
print(f"neurons {n:,}  connections {len(edges):,}  glomeruli {len(glomeruli)}  KCs {len(kc)}  MBONs {len(mbon)}")
summary = pd.DataFrame(mbons).groupby(["type", "kind"]).agg(n=("local", "size"), pam=("pam", "sum"), ppl=("ppl", "sum"))
print(summary.to_string())
