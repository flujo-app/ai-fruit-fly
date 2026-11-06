# AI Fruit Fly

A 3D tabletop world (three.js) with a virtual fruit fly. A full simulation of a real fly brain
runs live in the browser and steers it. That brain is all **138,639 neurons** and
**15,091,983 connections** of an adult female fruit fly, from the FlyWire map.

## Run it

```bash
python serve.py
```

Then open <http://127.0.0.1:8765>. You need an internet connection the first time, because
three.js loads from a CDN. The brain file is 61 MB and loads in a few seconds.

## What you can do

| Key | Action | What happens in the brain |
|---|---|---|
| **S** | Swat | Looming-detector cells (LC4, LPLC2) fire, then the giant fibre escape neuron (DNp01), and the fly jumps away |
| **A** or click the fly | Puff air on the antennae | Antenna touch cells (Johnston's organ C/E) fire, then grooming output cells, and the fly cleans its antennae |
| **F** or click the cloth | Drop sugar | Object-detector cells (LC10a) on one side fire, the steering cells on that side follow, and the fly turns toward the sugar. Tasting it fires the sugar cells, then the feeding motor neuron MN9, and the fly feeds |
| **B** or Shift-click | Drop something bitter | Bitter taste cells block MN9, so the fly tastes it but doesn't feed |
| **L** | Brain lab | Switch off real neurons (escape, feeding, left eye) and watch the behaviour break |
| **C** / **I** / **H** | Follow camera / what's real / hide panels | |

The panel on the right shows every neuron as a dot. A dot flashes when that neuron fires.

## Döner Dev Fly (doener.html)

Inspired by the joke that a mouse has as many synapses as an AI model but still can't program a
rotating döner. Open <http://127.0.0.1:8765/doener.html> and press **Start coding**.

- The app is built from 8 parts: lighting, meat colour, shape, spit, heat, bread, slicing and
  rotation. Each part has 3 or 4 ready-made code blocks, and only one block per part works.
- Each block gets its own made-up smell, a mix of 9 of the fly's 56 smell channels. The fly
  sniffs every option with its **real learning centre** (mushroom body), cut from the FlyWire map:
  5,554 neurons and 419,128 connections. It then picks the block it likes best, with a bit of
  randomness.
- A "customer" tests the running app: is it a cone, is it brown, does it turn slowly around a
  vertical spit, and so on. Each passed test gives the fly sugar and each failed test gives it
  bitter. That weakens certain learning-cell connections, the way real flies learn which smells
  mean food. Whether sugar or bitter acts on an output neuron is read from the wiring itself:
  output neurons that get dopamine mostly from reward cells (PAM) are weakened by sugar, and those
  that get it mostly from punishment cells (PPL1) are weakened by bitter.
- In simulations (`node tools/test_doener_learning.mjs`), the fly passes all 8 tests after
  4 to 8 rounds.

The fly doesn't understand code. We wrote the blocks and the tests; the fly only learns which
blocks earn sugar. Simplification: the learning centre's output neurons get too much braking in
this simple model to fire, so the fly's liking is read from how hard its learning cells push the
"approach" outputs against the "avoid" outputs.

## Fly Gym (fly-gym.html): hard mode, mass training

Add `?demo` to the address (`fly-gym.html?demo`) and training starts by itself, then stops 40
rounds after the first perfect döner. That's handy for recordings. A recorded run is in
`../media/fly-gym-demo.mp4`, and the winning program is in `examples/doener-by-1024-flies.html`.

Here the flies get no ready-made code blocks. They type a three.js program **one token at a time**:
keywords, names, numbers, colours and symbols. Open <http://127.0.0.1:8765/fly-gym.html> and press
**Start training**.

- **Autocomplete:** at each spot it only offers tokens that are legal there, like a code editor.
  Where only one token is legal it is typed automatically. Everywhere else the fly decides, which
  is about 50 to 70 decisions per program. Every program it writes therefore runs.
- **Many flies:** 1,024 flies train at once, in 8 labs of 128 (one background worker per lab). Each
  fly has its **own copy** of the learning-centre memory: 5,177 Kenyon cells and their push onto the
  "approach" and "avoid" output neurons. That's about 41 KB per fly.
- **Smells:** what a fly smells at a decision is "which object am I describing (or which line) +
  which blank + this token". Which Kenyon cells fire for each smell was computed in advance with the
  real spiking model (`tools/make_fingerprints.mjs`, 1,274 smells, about 3% of the cells each).
- **Learning:** each round, every fly writes 4 programs. A stand-in for three.js runs each one and
  the customer gives a single rating out of 8, with partial credit. The fly's best program earns
  sugar and its worst earns bitter. Each lab copies its best flies' memories over its weakest
  ones, and the labs swap their best fly every 2 rounds.
- **Results** (`node tools/train_gym.mjs 512 300`): random typing averages 0.4 of 8 and never
  passes more than 3 tests. With 512 flies, 5 of 8 runs produced flies that pass all 8 tests,
  first in round 94 to 238. The other runs got stuck between 7.5 and 7.96. With 1,024 flies,
  5 of 6 runs succeeded (first perfect döner in round 127 to 181), and with labs swapping flies
  every 2 rounds, 2 of 2. In the browser on an 8-core PC, it runs at about 3.5 rounds per second.
  One test run had its first perfect döner in round 280, after 71 seconds. If a run stays stuck,
  press "New flies". Three things made it work:
  1. Each fly compares its own attempts, which gives a much clearer signal than one attempt per round.
  2. Smells are about objects instead of line numbers, so inserting a line doesn't scramble the memory.
  3. The customer gives partial credit, for example for "almost a spit" or "the grill moved part of the way".

**Hand-made:** the token rules, the numbers and colours on offer, the `knife()` helper and the 8
tests. **Real:** the learning-centre wiring and how dopamine changes it. Every token in the winning
programs was chosen by a fly.

## What's real and what's hand-made

**Real:** the wiring, the brain model (Shiu et al., *Nature* 2024, with the paper's settings),
the named cells used for each sense and output, and every decision that flows through the wiring.

**Hand-made:** the 3D body and its animation (walking, flying), how strongly each sense fires,
how output cells become movement, a hunger rule, random wandering, and staying on the cloth.
The right side's steering signal is boosted ×1.5 to balance both sides. Smell is left out,
because in this model it sets off far too much of the brain at once.

## How the output cells were chosen

`node tools/experiments.mjs` runs the brain on its own and prints which output cells respond to
each stimulus. With the sugar cells used in the original paper, it reproduces the published
result: about 400 neurons become active and the feeding neuron MN9 fires.

| Stimulus (1 s) | Response in this model |
|---|---|
| Left-eye LC10a, 40 Hz | left steering cells 49 Hz, right 0 Hz |
| Right-eye LC10a, 40 Hz | left 0 Hz, right 28 Hz |
| Looming on the left | escape neuron DNp01 206 Hz, right steering cells 28 Hz (turn away) |
| Sugar taste | feeding neuron MN9 82 Hz |
| Sugar + bitter taste | MN9 drops to 3 Hz |
| Air on the antennae | grooming cells 16 Hz |

## Files

- `index.html`, `css/`: the page
- `js/brain-engine.js`: the whole-brain spiking model; it only updates neurons that are busy
- `js/brain-worker.js`: runs the brain in the background in step with the clock
- `js/fly.js`: the fly's 3D body, with legs that step in a three-legged gait
- `js/world.js`: the table, cloth, banana slice, drops and swatter
- `js/main.js`: senses, behaviour, camera and controls
- `data/`: the packed brain (made by `tools/pack_brain.py`) and learning centre (made by `tools/pack_mushroom_body.py`)
- `doener.html`, `js/doener/`, `js/mushroom-body.js`, `js/mb-worker.js`: the Döner Dev Fly page
- `fly-gym.html`, `js/gym/`: the Fly Gym (hard mode): the token rules (`grammar.js`), the fast
  three.js stand-in and customer tests (`judge.js`), the fly population (`population.js`), one
  lab per worker (`gym-worker.js`), the wall of thumbnails (`wall.js`) and the real app template
  (`app-template.js`)
- `data/gym.bin`, `data/gym.json`: precomputed smell fingerprints (`tools/make_fingerprints.mjs`)
- `tools/train_gym.mjs`: headless Fly Gym training, for experiments

To rebuild `data/`, put these files in `../raw_data`:

- `Completeness_783.csv` and `Connectivity_783.parquet` from
  [philshiu/Drosophila_brain_model](https://github.com/philshiu/Drosophila_brain_model)
- `Supplemental_file1_neuron_annotations.tsv` from
  [flyconnectome/flywire_annotations](https://github.com/flyconnectome/flywire_annotations),
  renamed to `neuron_annotations.tsv`

Then run:

```bash
uv run --with pandas --with pyarrow --with numpy python tools/pack_brain.py
```

## Credits and licences

- Brain wiring: FlyWire Consortium (Dorkenwald et al. 2024, Schlegel et al. 2024),
  **CC BY-NC 4.0**, so non-commercial use only, with credit.
- Brain model and data packaging: Shiu et al. 2024, MIT licence.
- 3D engine: three.js, MIT licence.
