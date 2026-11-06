"""Pack the FlyWire v783 whole-brain wiring into small binary files the browser can load.

Inputs (in ../raw_data, see README for where they come from):
  Completeness_783.csv, Connectivity_783.parquet   (Shiu et al. 2024 model data, FlyWire v783)
  neuron_annotations.tsv                           (Schlegel et al. 2024 FlyWire annotations)

Outputs (in ../data):
  connectome.bin  header + row pointers + packed edges (target index | signed synapse count)
  neurons.bin     float32 xyz position (micrometres, centred) + uint8 class code per neuron
  circuits.json   named groups of neuron indices used as senses and motor read-outs

Run:  uv run --with pandas --with pyarrow --with numpy python tools/pack_brain.py
"""
import json
import struct
import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
RAW = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / "raw_data"
OUT = ROOT / "data"
OUT.mkdir(exist_ok=True)

TARGET_BITS = 18          # 2^18 = 262,144 > 138,639 neurons
WEIGHT_OFFSET = 4096      # signed synapse count stored as (w + 4096) in the upper 13 bits

comp = pd.read_csv(RAW / "Completeness_783.csv", index_col=0)
ids = comp.index.to_numpy(np.int64)
n = len(ids)
id2idx = pd.Series(np.arange(n), index=ids)

con = pd.read_parquet(RAW / "Connectivity_783.parquet",
                      columns=["Presynaptic_Index", "Postsynaptic_Index", "Excitatory x Connectivity"])
pre = con["Presynaptic_Index"].to_numpy(np.int64)
post = con["Postsynaptic_Index"].to_numpy(np.int64)
w = con["Excitatory x Connectivity"].to_numpy(np.int64)
assert post.max() < (1 << TARGET_BITS)
assert np.abs(w).max() < WEIGHT_OFFSET

order = np.lexsort((post, pre))
pre, post, w = pre[order], post[order], w[order]
rowptr = np.zeros(n + 1, np.uint32)
np.add.at(rowptr, pre + 1, 1)
rowptr = np.cumsum(rowptr, dtype=np.uint64).astype(np.uint32)
edges = (post.astype(np.uint32) | ((w + WEIGHT_OFFSET).astype(np.uint32) << TARGET_BITS)).astype(np.uint32)

with open(OUT / "connectome.bin", "wb") as f:
    f.write(struct.pack("<4sIII", b"FLY1", n, len(edges), TARGET_BITS))
    f.write(rowptr.tobytes())
    f.write(edges.tobytes())

# ---------- neuron positions and classes ----------
ann = pd.read_csv(RAW / "neuron_annotations.tsv", sep="\t", low_memory=False)
ann = ann[ann.root_id.isin(id2idx.index)].drop_duplicates("root_id")
ann["idx"] = id2idx[ann.root_id].to_numpy()
ann = ann.set_index("idx").reindex(np.arange(n))

xyz = np.stack([
    ann.soma_x.fillna(ann.pos_x).to_numpy(float) * 0.004,   # FlyWire voxels are 4 x 4 x 40 nm
    ann.soma_y.fillna(ann.pos_y).to_numpy(float) * 0.004,
    ann.soma_z.fillna(ann.pos_z).to_numpy(float) * 0.040,
], axis=1)
known = ~np.isnan(xyz).any(axis=1)
centre = np.nanmean(xyz[known], axis=0)
xyz = np.where(known[:, None], xyz - centre, 0.0).astype(np.float32)

CLASSES = ["unknown", "optic", "central", "sensory", "visual_projection", "ascending",
           "descending", "sensory_ascending", "visual_centrifugal", "motor", "endocrine"]
cls = ann.super_class.map({c: i for i, c in enumerate(CLASSES)}).fillna(0).to_numpy(np.uint8)

with open(OUT / "neurons.bin", "wb") as f:
    f.write(struct.pack("<4sI", b"NEU1", n))
    f.write(xyz.tobytes())
    f.write(cls.tobytes())

# ---------- circuits: named groups of neuron indices ----------
def pick(mask, side=None):
    m = mask.fillna(False)
    if side:
        m &= ann.side.eq(side)
    return sorted(int(i) for i in ann.index[m.to_numpy()])

ct = ann.cell_type.astype(str)
sub = ann.cell_sub_class.astype(str)
groups = {}
for side, s in (("left", "L"), ("right", "R")):
    groups[f"sugar_{s}"] = pick(sub.isin(["sugar", "sugar/low_salt"]) & ann.cell_class.eq("gustatory"), side)
    groups[f"bitter_{s}"] = pick(sub.eq("bitter") & ann.cell_class.eq("gustatory"), side)
    groups[f"water_{s}"] = pick(sub.eq("water") & ann.cell_class.eq("gustatory"), side)
    # fruity / food odours: vinegar (DM1), banana esters (DM2, DM3), DM4, butanedione (VA2), VM2
    groups[f"odor_{s}"] = pick(ct.isin(["ORN_DM1", "ORN_DM2", "ORN_DM3", "ORN_DM4", "ORN_VA2", "ORN_VM2"]), side)
    groups[f"loom_{s}"] = pick(ct.isin(["LC4", "LPLC2"]), side)
    groups[f"antenna_touch_{s}"] = pick(ct.str.match(r"^JO-(C|E)"), side)
    groups[f"DNp01_{s}"] = pick(ct.eq("DNp01"), side)          # giant fibre: escape take-off
    groups[f"DNa02_{s}"] = pick(ct.eq("DNa02"), side)          # steering
    groups[f"DNa01_{s}"] = pick(ct.eq("DNa01"), side)          # steering
    groups[f"MDN_{s}"] = pick(ct.eq("MDN"), side)              # moonwalker: walk backwards
    groups[f"MN9_{s}"] = pick(ct.eq("CB0701"), side)           # proboscis motor neuron (Shiu et al. 2024)
    groups[f"descending_{s}"] = pick(ann.super_class.eq("descending"), side)
    # small-object vision (LC10a), chosen because it drives same-side steering neurons in this model
    groups[f"objects_{s}"] = pick(ct.eq("LC10a"), side)
    # read-outs, chosen from tools/experiments.mjs runs (see README)
    groups[f"steer_{s}"] = pick(ct.isin(["DNa02", "DNae002", "DNg111", "DNge043", "DNb01", "DNde002"]), side)
    groups[f"groom_{s}"] = pick(ct.isin(["DNp18", "DNb06", "DNge091", "DNbe001", "DNg07", "DNg29"]), side)

# the 20 sugar-sensing taste neurons used by Shiu et al. 2024 (their example notebook), FlyWire v783 IDs
SHIU_SUGAR = [720575940624963786, 720575940630233916, 720575940637568838, 720575940638202345,
              720575940617000768, 720575940630797113, 720575940632889389, 720575940621754367,
              720575940621502051, 720575940640649691, 720575940639332736, 720575940616885538,
              720575940639198653, 720575940620900446, 720575940617937543, 720575940632425919,
              720575940633143833, 720575940612670570, 720575940628853239, 720575940629176663,
              720575940611875570]
groups["sugar"] = sorted(int(id2idx[i]) for i in SHIU_SUGAR if i in id2idx.index)
groups["bitter"] = groups["bitter_L"] + groups["bitter_R"]
groups["MN9"] = groups["MN9_L"] + groups["MN9_R"]
groups["DNp01"] = groups["DNp01_L"] + groups["DNp01_R"]
groups["MDN"] = groups["MDN_L"] + groups["MDN_R"]
groups["groom"] = groups["groom_L"] + groups["groom_R"]

meta = {
    "n_neurons": n,
    "n_edges": int(len(edges)),
    "classes": CLASSES,
    "groups": groups,
    "cell_types": {k: v for k, v in zip(range(n), ct.where(ct != "nan", "").tolist()) if v and ann.super_class.iloc[k] == "descending"},
    "source": "FlyWire v783 (CC BY-NC 4.0) via Shiu et al. 2024 model data; annotations Schlegel et al. 2024",
}
(OUT / "circuits.json").write_text(json.dumps(meta))
print(f"neurons {n:,}  edges {len(edges):,}  positioned {known.sum():,}")
for k, v in groups.items():
    print(f"  {k:20s} {len(v)}")
print({p.name: p.stat().st_size for p in OUT.iterdir()})
