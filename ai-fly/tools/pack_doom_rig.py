"""Pack what the Doom pages need to connect a screen and a game controller to the fly brain.

Inputs (in ../raw_data, see README): Completeness_783.csv, Connectivity_783.parquet,
neuron_annotations.tsv.   Outputs (in ../data/doom): rig.bin + rig.json, circuit.bin.

1. The eye map. Each eye has about 790 facets, and behind each facet sits one column of cells. The
   Mi1 cells (one per column) give the columns their place: their positions in the medulla lie on a
   curved sheet, like the eye itself, so the direction from the sheet's centre of curvature to a cell
   tells where on the sheet its column is. Which way is "front" and which way is "up" on that sheet is
   read from the wiring of the motion cells: a T4a cell, known to prefer front-to-back motion, gets its
   Mi9 input from the side the motion comes from and its Mi4 input from the side it goes to, and
   likewise T4b (back-to-front), T4c (up) and T4d (down). Every other eye cell is placed at the
   synapse-weighted average of the columnar cells it is wired to.
   Hand-made: how many degrees of the outside world the sheet covers (a fly eye sees about 166 degrees
   left-to-right and 170 degrees top-to-bottom, with the two eyes overlapping by about 15 degrees in
   front).

2. The driven cells: the 16 cell types at which the picture enters the brain (see js/doom/eye.js),
   each with its column.

3. The read-out cells (steering, walking, backing up, jumping) and the taste cells.

3b. The learning centre's one well-known line from the eye: the aMe12 cells. They are the biggest eye
   input of the "visual" Kenyon cells and are excited by the pale kind of the colour photoreceptors
   R7/R8, which see ultraviolet and blue (Ganguly et al. 2024). For each aMe12 cell the facets of
   the R8 cells that contact it are stored, so that the eye can hand it the blue light of exactly
   those spots. Also: the Kenyon cells that get input from the eyes, and the learning centre's output
   cells with their dopamine zone (as in tools/pack_mushroom_body.py).

4. circuit.bin: for the optional fast mode (?fast) only. The cells that lie on short paths from the
   eye cells to the read-out cells, with all the connections between them. The default uses the
   complete brain (data/connectome.bin).

Run:  uv run --with pandas --with pyarrow --with numpy --with scipy python tools/pack_doom_rig.py
"""
import json
import struct
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import scipy.sparse as sp

ROOT = Path(__file__).resolve().parent.parent
RAW = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / "raw_data"
OUT = ROOT / "data" / "doom"
OUT.mkdir(parents=True, exist_ok=True)

# what the eye sheet covers in the outside world (hand-made, see above)
SCALE_H, SCALE_V, OVERLAP_DEG = 1.3, 0.97, 15.0
FACET_DEG = 5.5                      # typical angle between neighbouring facets
# the cell types where the picture enters, and what each one reports (see js/doom/eye.js)
KINDS = ["T4a", "T4b", "T4c", "T4d", "T5a", "T5b", "T5c", "T5d", "Tm3", "Tm1", "Tm2", "Tm4", "Tm9", "T2", "T2a", "T3"]
READOUT_TYPES = ["DNa01", "DNa02", "DNg100", "DNg97", "DNp09", "MDN", "DNp01", "DNp02", "DNp04", "DNp11",
                 "DNp15", "DNb05", "DNb06", "DNg13", "DNa03", "CB0701"]
FAST_EXTRA = 6000                    # cells between eyes and read-outs kept in the fast mode's circuit

comp = pd.read_csv(RAW / "Completeness_783.csv", index_col=0)
n = len(comp)
id2idx = pd.Series(np.arange(n), index=comp.index)
ann = pd.read_csv(RAW / "neuron_annotations.tsv", sep="\t", low_memory=False)
ann = ann[ann.root_id.isin(comp.index)].drop_duplicates("root_id").copy()
ann["idx"] = id2idx[ann.root_id].to_numpy()
ann = ann.set_index("idx").reindex(np.arange(n))
ct = ann.cell_type.fillna(ann.hemibrain_type).fillna("?").astype(str).to_numpy()
side = ann.side.astype(str).to_numpy()
sc = ann.super_class.astype(str).to_numpy()
con = pd.read_parquet(RAW / "Connectivity_783.parquet", columns=["Presynaptic_Index", "Postsynaptic_Index", "Excitatory x Connectivity"])
pre = con.Presynaptic_Index.to_numpy(np.int64)
post = con.Postsynaptic_Index.to_numpy(np.int64)
w = con["Excitatory x Connectivity"].to_numpy(np.int64)
A = sp.csr_matrix((np.abs(w).astype(np.float32), (post, pre)), shape=(n, n))     # synapse counts, A[post, pre]
S2 = (A + A.T).tocsr()
P = np.stack([ann.pos_x.to_numpy(float) * 0.004, ann.pos_y.to_numpy(float) * 0.004, ann.pos_z.to_numpy(float) * 0.04], 1)

# ---------- 1. the eye map ----------
az = np.full(n, np.nan)
el = np.full(n, np.nan)


def t4_vector(coord, sd, sub):
    """mean step from a T4 cell's Mi9 inputs to its Mi4 inputs = the direction of motion it prefers"""
    vs = []
    for c in np.flatnonzero((ct == sub) & (side == sd)):
        row = A[c]
        pr, ws = row.indices, row.data
        m9, m4 = ct[pr] == "Mi9", ct[pr] == "Mi4"
        if ws[m9].sum() < 3 or ws[m4].sum() < 3:
            continue
        c9 = (coord[pr[m9]] * ws[m9][:, None]).sum(0) / ws[m9].sum()
        c4 = (coord[pr[m4]] * ws[m4][:, None]).sum(0) / ws[m4].sum()
        if not (np.isnan(c9).any() or np.isnan(c4).any()):
            vs.append(c4 - c9)
    v = np.array(vs)
    return v.mean(0), float(np.linalg.norm(v.mean(0)) / np.linalg.norm(v, axis=1).mean())


check = {}
for sd in ("left", "right"):
    mi1 = np.flatnonzero((ct == "Mi1") & (side == sd))
    p = P[mi1]
    M = np.c_[2 * p, np.ones(len(p))]
    cen = np.linalg.lstsq(M, (p ** 2).sum(1), rcond=None)[0][:3]          # centre of the best-fitting sphere
    d = p - cen
    d /= np.linalg.norm(d, axis=1)[:, None]
    axis = d.mean(0)
    axis /= np.linalg.norm(axis)
    e2 = np.array([0, -1.0, 0])
    e2 -= axis * (e2 @ axis)
    e2 /= np.linalg.norm(e2)
    e1 = np.cross(e2, axis)
    psi = np.arccos(np.clip(d @ axis, -1, 1))
    t = d - np.outer(d @ axis, axis)
    t /= np.linalg.norm(t, axis=1)[:, None] + 1e-12
    coord = np.full((n, 2), np.nan)
    coord[mi1] = np.c_[psi * (t @ e1), psi * (t @ e2)]
    lobe = np.flatnonzero((side == sd) & np.isin(sc, ["optic", "visual_projection", "sensory", "visual_centrifugal"]))
    col_types = [t_ for t_, c in pd.Series(ct[lobe]).value_counts().items() if c >= 600]
    is_col = np.isin(ct, col_types) & (side == sd)
    for _ in range(4):
        idxp = np.flatnonzero(~np.isnan(coord[:, 0]) & is_col)
        Sp = S2[lobe][:, idxp]
        tot = np.asarray(Sp.sum(1)).ravel()
        ok = (tot >= 5) & np.isnan(coord[lobe, 0])
        coord[lobe[ok], 0] = (Sp @ coord[idxp, 0])[ok] / tot[ok]
        coord[lobe[ok], 1] = (Sp @ coord[idxp, 1])[ok] / tot[ok]
    (va, ca), (vb, cb), (vc, cc), (vd, cd) = (t4_vector(coord, sd, s_) for s_ in ("T4a", "T4b", "T4c", "T4d"))
    hvec = va - vb
    hvec /= np.linalg.norm(hvec)                 # towards the back of the visual field
    uvec = vc - vd
    uvec -= hvec * (uvec @ hvec)
    uvec /= np.linalg.norm(uvec)                 # up
    ang = lambda v: float(np.degrees(np.arctan2(v @ uvec, v @ hvec)))
    check[sd] = {"T4a": [round(ang(va)), round(ca, 2)], "T4b": [round(ang(vb)), round(cb, 2)],
                 "T4c": [round(ang(vc)), round(cc, 2)], "T4d": [round(ang(vd)), round(cd, 2)]}
    h = (coord @ hvec) * SCALE_H
    v = (coord @ uvec) * SCALE_V
    front = np.percentile(h[mi1][np.abs(v[mi1]) < 0.25], 2)
    az0 = -front - np.radians(OVERLAP_DEG)      # how far to the side the middle of the eye looks
    sgn = -1 if sd == "left" else 1
    c = np.array([sgn * np.sin(az0), 0, np.cos(az0)])                       # x right, y up, z forward
    hh = np.array([sgn * np.cos(az0), 0, -np.sin(az0)])
    vv = np.array([0, 1.0, 0])
    rho = np.sqrt(h ** 2 + v ** 2) + 1e-12
    dirs = np.cos(rho)[:, None] * c + np.sin(rho)[:, None] * (np.outer(h, hh) + np.outer(v, vv)) / rho[:, None]
    ok = ~np.isnan(h)
    az[ok] = np.degrees(np.arctan2(dirs[ok, 0], dirs[ok, 2]))
    el[ok] = np.degrees(np.arcsin(np.clip(dirs[ok, 1], -1, 1)))
print("direction of preferred motion on the eye sheet (degrees; 0 = towards the back, 90 = up) and how consistent (0..1):")
print("  ", check)

# columns = the Mi1 cells, left eye first
col_idx = np.concatenate([np.flatnonzero((ct == "Mi1") & (side == sd)) for sd in ("left", "right")])
C = len(col_idx)
col_side = (side[col_idx] == "right").astype(np.uint8)
col_az, col_el = az[col_idx].astype(np.float32), el[col_idx].astype(np.float32)


def nearest_col(sd, a, e, tol):
    m = np.flatnonzero(col_side == sd)
    dx = (col_az[m] - a) * np.cos(np.radians(e))
    dy = col_el[m] - e
    d2 = dx * dx + dy * dy
    k = int(np.argmin(d2))
    return int(m[k]) if d2[k] < tol * tol else -1


# for each column, the column the motion comes from, for the 4 directions: front-to-back, back-to-front, up, down
nb = np.full((C, 4), -1, np.int16)
for c in range(C):
    s_, a, e = int(col_side[c]), float(col_az[c]), float(col_el[c])
    sg = -1 if s_ == 0 else 1
    k = FACET_DEG / max(0.2, np.cos(np.radians(e)))
    nb[c] = [nearest_col(s_, a - sg * k, e, 4), nearest_col(s_, a + sg * k, e, 4),
             nearest_col(s_, a, e - FACET_DEG, 4), nearest_col(s_, a, e + FACET_DEG, 4)]

# ---------- 2. the driven cells ----------
d_idx, d_col, d_kind = [], [], []
for k, name in enumerate(KINDS):
    for i in np.flatnonzero((ct == name) & ~np.isnan(az)):
        c = nearest_col(0 if side[i] == "left" else 1, az[i], el[i], 8)
        if c >= 0:
            d_idx.append(i); d_col.append(c); d_kind.append(k)
d_idx = np.array(d_idx, np.uint32); d_col = np.array(d_col, np.uint16); d_kind = np.array(d_kind, np.uint8)

# ---------- 3. read-outs and taste ----------
groups = {}
for name in READOUT_TYPES:
    for sd, s_ in (("left", "L"), ("right", "R")):
        g = np.flatnonzero((ct == name) & (side == sd) & np.isin(sc, ["descending", "motor"]))
        groups[f"{'MN9' if name == 'CB0701' else name}_{s_}"] = [int(i) for i in g]
SHIU_SUGAR = [720575940624963786, 720575940630233916, 720575940637568838, 720575940638202345,
              720575940617000768, 720575940630797113, 720575940632889389, 720575940621754367,
              720575940621502051, 720575940640649691, 720575940639332736, 720575940616885538,
              720575940639198653, 720575940620900446, 720575940617937543, 720575940632425919,
              720575940633143833, 720575940612670570, 720575940628853239, 720575940629176663,
              720575940611875570]
groups["sugar"] = sorted(int(id2idx[i]) for i in SHIU_SUGAR if i in id2idx.index)
sub = ann.cell_sub_class.astype(str).to_numpy()
cc = ann.cell_class.astype(str).to_numpy()
groups["bitter"] = [int(i) for i in np.flatnonzero((sub == "bitter") & (cc == "gustatory"))]
controller_groups = list(groups)       # everything so far is needed to play; the rest is only looked at
# cells that are only looked at (tools/doom_experiments.mjs): motion and looming cells of the eye,
# the learning centre's Kenyon cells, the eye cells that project to them, and the dopamine cells
for name in ("HSN", "HSE", "HSS", "H2", "LC4", "LPLC2", "LC11"):
    for sd, s_ in (("left", "L"), ("right", "R")):
        groups[f"{name}_{s_}"] = [int(i) for i in np.flatnonzero((ct == name) & (side == sd))]
groups["KC"] = [int(i) for i in np.flatnonzero(cc == "Kenyon_Cell")]
groups["PAM"] = [int(i) for i in np.flatnonzero((cc == "DAN") & np.char.startswith(ct.astype(str), "PAM"))]
groups["PPL1"] = [int(i) for i in np.flatnonzero((cc == "DAN") & np.char.startswith(ct.astype(str), "PPL1"))]
kc_set = np.zeros(n, bool); kc_set[groups["KC"]] = True
to_kc = np.zeros(n); np.add.at(to_kc, pre[kc_set[post]], np.abs(w[kc_set[post]]))
groups["eyeToKC"] = [int(i) for i in np.flatnonzero((to_kc >= 50) & np.isin(sc, ["visual_projection", "optic"]))]

# ---------- 3b. the learning centre ----------
is_kc = cc == "Kenyon_Cell"
is_mbon = cc == "MBON"
is_dan = cc == "DAN"
eye_cell = np.isin(sc, ["visual_projection", "optic"])
from_eye = np.zeros(n)
m_ = eye_cell[pre] & is_kc[post]
np.add.at(from_eye, post[m_], np.abs(w[m_]))
groups["visualKC"] = [int(i) for i in np.flatnonzero(is_kc & (from_eye >= 5))]
# each output cell's dopamine zone: more of its dopamine input from reward cells (PAM) -> sugar weakens its
# Kenyon-cell inputs ("avoid" cells); more from punishment cells (PPL1 and the like) -> bitter does ("approach" cells)
pam_in = np.zeros(n); ppl_in = np.zeros(n)
m_ = is_dan[pre] & is_mbon[post]
pam_pre = np.char.startswith(ct[pre[m_]].astype(str), "PAM")
np.add.at(pam_in, post[m_][pam_pre], np.abs(w[m_][pam_pre]))
np.add.at(ppl_in, post[m_][~pam_pre], np.abs(w[m_][~pam_pre]))
groups["MBON_sugar"] = [int(i) for i in np.flatnonzero(is_mbon & (pam_in > ppl_in))]
groups["MBON_bitter"] = [int(i) for i in np.flatnonzero(is_mbon & (ppl_in > pam_in))]
groups["MBON"] = [int(i) for i in np.flatnonzero(is_mbon)]
mbon_names = {int(i): f"{ct[i]}_{side[i][0].upper()}" for i in np.flatnonzero(is_mbon)}

# the blue-light cells: aMe12, and the facets of the R8 cells that contact each of them
blue_cells = np.flatnonzero(ct == "aMe12")
groups["aMe12"] = [int(i) for i in blue_cells]
r8 = ct == "R8"
m_ = r8[pre] & (ct[post] == "Mi1")
r8_home = pd.DataFrame({"r8": pre[m_], "mi1": post[m_], "w": np.abs(w[m_])}).sort_values("w", ascending=False).drop_duplicates("r8").set_index("r8").mi1
col_of_mi1 = np.full(n, -1); col_of_mi1[col_idx] = np.arange(C)
blue_start, blue_col, blue_w = [0], [], []
for b in blue_cells:
    m_ = (post == b) & r8[pre]
    acc = {}
    for cell, syn in zip(pre[m_], np.abs(w[m_])):
        if cell in r8_home.index:
            c = int(col_of_mi1[r8_home[cell]])            # the column of the Mi1 cell this R8 cell is wired to
        elif not np.isnan(az[cell]):
            c = nearest_col(0 if side[cell] == "left" else 1, az[cell], el[cell], 8)
        else:
            c = -1
        if c >= 0:
            acc[c] = acc.get(c, 0) + float(syn)
    blue_col += list(acc.keys()); blue_w += list(acc.values()); blue_start.append(len(blue_col))

# ---------- 4. the fast mode's circuit ----------
on_screen = (np.abs(az[d_idx]) < 80) & (np.abs(el[d_idx]) < 60)
x = np.zeros(n); x[d_idx[on_screen]] = 1
outs = np.array(sorted({i for k, g in groups.items() if k.split("_")[0] in ("DNa01", "DNa02", "DNg100", "DNg97", "MDN", "DNp01") for i in g}))
o = np.zeros(n); o[outs] = 1
indeg = np.asarray(A.sum(1)).ravel() + 1e-9
Wn = sp.diags(1 / indeg) @ A                       # share of a cell's input that comes from each other cell
WnT = Wn.T.tocsr()
F = np.zeros(n); f = x.copy()
B = np.zeros(n); b = o.copy()
for k in range(3):
    f = Wn @ f; F += f * 0.6 ** k
    b = WnT @ b; B += b * 0.6 ** k
score = F * B
keep = np.zeros(n, bool)
keep[np.argsort(-score)[:FAST_EXTRA]] = True
keep[d_idx] = True
for name in controller_groups:
    keep[groups[name]] = True
kept = np.flatnonzero(keep)
g2l = np.full(n, -1, np.int64); g2l[kept] = np.arange(len(kept))
m = keep[pre] & keep[post]
p2, q2, w2 = g2l[pre[m]], g2l[post[m]], w[m]
order = np.lexsort((q2, p2))
p2, q2, w2 = p2[order], q2[order], w2[order]
rowptr = np.zeros(len(kept) + 1, np.uint64)
np.add.at(rowptr, p2 + 1, 1)
rowptr = np.cumsum(rowptr).astype(np.uint32)
edges = (q2.astype(np.uint32) | ((w2 + 4096).astype(np.uint32) << 18)).astype(np.uint32)
with open(OUT / "circuit.bin", "wb") as fh:
    fh.write(struct.pack("<4sIII", b"FLY1", len(kept), len(edges), 18))
    fh.write(rowptr.tobytes())
    fh.write(edges.tobytes())

# ---------- write rig.bin / rig.json ----------
arrays = {
    "colSide": col_side, "colAz": col_az, "colEl": col_el, "colNb": nb.ravel(),
    "drivenIdx": d_idx, "drivenCol": d_col, "drivenKind": d_kind,
    "circuitGlobal": kept.astype(np.uint32),
    "blueIdx": blue_cells.astype(np.uint32), "blueStart": np.array(blue_start, np.uint32),
    "blueCol": np.array(blue_col, np.uint16), "blueW": np.array(blue_w, np.float32),
}
layout, blob = {}, bytearray()
for name, arr in arrays.items():
    while len(blob) % 4:
        blob.append(0)
    layout[name] = [str(arr.dtype), len(blob), int(arr.size)]
    blob += arr.tobytes()
(OUT / "rig.bin").write_bytes(bytes(blob))
classes = pd.Series(sc).value_counts()
meta = {
    "source": "FlyWire v783 (CC BY-NC 4.0) via Shiu et al. 2024 model data; annotations Schlegel et al. 2024",
    "nNeurons": int(n), "nConnections": int(len(w)), "columns": int(C), "facetDeg": FACET_DEG,
    "kinds": KINDS, "layout": layout, "groups": groups,
    "eyeMapCheck": check,
    "counts": {"driven": int(len(d_idx)), "eyeNeurons": int(classes.get("optic", 0) + classes.get("visual_projection", 0) + classes.get("visual_centrifugal", 0) + int(((sc == "sensory") & (ann.cell_class.astype(str).to_numpy() == "visual")).sum())),
               "descending": int(classes.get("descending", 0))},
    "circuit": {"neurons": int(len(kept)), "connections": int(len(edges))},
    "mbonNames": mbon_names,
}
(OUT / "rig.json").write_text(json.dumps(meta))
print(f"columns {C}; driven cells {len(d_idx)} ({ {k: int(v) for k, v in pd.Series(np.array(KINDS)[d_kind]).value_counts().items()} })")
print("read-outs:", {k: len(v) for k, v in groups.items()})
print(f"learning centre: {len(groups['visualKC'])} Kenyon cells with input from the eyes; output cells: {len(groups['MBON_sugar'])} weakened by sugar, {len(groups['MBON_bitter'])} by bitter; "
      f"{len(blue_cells)} blue-light cells with {[blue_start[k + 1] - blue_start[k] for k in range(len(blue_cells))]} facets")
print(f"fast-mode circuit: {len(kept):,} neurons, {len(edges):,} connections")
print({p_.name: p_.stat().st_size for p_ in OUT.iterdir() if p_.suffix in ('.bin', '.json')})
