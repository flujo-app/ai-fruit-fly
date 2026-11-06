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
rounds after the first perfect döner. In demo mode the page also saves all fly memories to the
local server (`serve.py`, folder `.state`) every 20 rounds, and `fly-gym.html?demo&resume`
continues from the last save. That way a long run can be recorded in pieces. A recorded run is in
`../media/fly-gym-demo.mp4`, and its winning program is in `examples/doener-by-1024-flies.html`
(add `?side` to that address for a side view). The winner of the first video, which looked like a
lampshade on a loaf, is in `examples/lampshade-by-1024-flies.html`.

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
  which blank + this token". For decisions about an object, the whole smell depends on the object,
  so "height 2" smells different for the döner and for the bread. Which Kenyon cells fire for each
  smell was computed in advance with the real spiking model (`tools/make_fingerprints.mjs`, 1,448
  smells, about 3% of the cells each).
- **Learning:** each round, every fly writes 4 programs. A stand-in for three.js runs each one and
  the customer gives a single rating out of 8, with partial credit. The fly's best program earns
  sugar and its worst earns bitter, but only for the tokens where the two programs differ. Each
  decision has a 3% chance of being a random token (curiosity). Each lab copies its best flies'
  memories over its weakest ones, and the labs swap their best fly every 2 rounds.
- **Results** (`node tools/train_gym.mjs 1024 600 islands=8 migrateEvery=2`): random typing
  averages about 0.7 of 8 and never passes more than 3 tests. Against the current customer, 2 of
  4 headless runs produced a döner that passes all 8 tests, in rounds 123 and 225. The other two
  were still stuck after 500 rounds, at 7.5 and 7.8 of 8 (a döner that is still too wide, or a
  grill that won't move behind the meat). So if a run stays stuck, press "New flies". In the
  browser on an 8-core PC, training runs at about 2 rounds per second. The recorded run had its
  first perfect döner in round 219, after 2 minutes 16 seconds. What made it work:
  1. Each fly compares its own attempts: much clearer than one attempt per round.
  2. Only the tokens that differ between the best and worst attempt are rewarded or punished, so good habits aren't worn down.
  3. Smells are about objects instead of line numbers, so inserting a line doesn't scramble the memory.
  4. A little curiosity, so the flies keep trying new tokens after they become confident.
  5. The customer gives smooth partial credit, for example for "almost a spit" or "the grill moved part of the way".
  6. Enough position choices: the grill can only fit behind wider döners if things can move far enough back.
  7. Smells that belong to one object. At first, "height 2" smelled almost the same for every
     object, so learning "the döner must be tall" also made the bread tall, and a flat round
     dürüm was nearly impossible to learn. (A bread loaf never had this problem, because box
     sizes are separate blanks from cylinder sizes.)

**The loopholes, and the pickier customer.** The first customer only checked a list of facts: a
brown cone exists, something glows near it, something bread-coloured is lower, and so on. The flies
passed all 8 tests with a giant glowing ball that swallowed half of a green-glowing, needle-pointed
cone, standing on a huge "bread tent" (`examples/first-try-glowing-ball.html`). Nothing in the tests
forbade it. That's a classic case of a learner exploiting the gaps in its reward. The customer was
tightened step by step, and the flies found a new gap each time:
1. They made everything wheat-coloured, so the bread and the grill could double as "meat".
2. They used a tiny glowing stick far off to the side as the "grill", put the döner near the
   top edge and lit it with dim brown lamps.
3. They put the lamp at its default position, inside the meat, so the döner was pitch black.
4. The winner of the first video passed all 8 tests but looked like a **lampshade**: wider than
   tall, with a pale glowing ball as the "grill" (it looked like a light bulb), a bread loaf, and
   a knife that shaved the ball as well as the meat.
5. Against the new rules, they tried using one thing twice: a glowing, wheat-coloured disc as
   both the bread and the grill, a glowing rod in the middle as both the spit and the grill, and
   a thick wheat-coloured spit that also counted a little as bread. Now every object has exactly
   one job (the customer picks the spit and the grill together), nothing that glows or stands
   upright counts as bread, and nothing as thin as a spit counts as a grill.

The customer now checks that:
- the döner stands in the middle, is brightly lit **on the side facing the customer** (a simple
  light calculation), and nothing big hides it;
- the meat is brown, doesn't glow, is the biggest thing in the shop, is round, is **at least as
  tall as it is wide** (no lampshades), is not as thin as a pole, and doesn't end in a needle point;
- the spit is thin, plain metal (it doesn't glow), vertical and sticks out at the top;
- the grill glows **orange** right behind the meat, at a sensible size and not touching it. It
  can be a panel or a heating rod, but **not a ball** (a glowing ball looks like a light bulb) and
  not pale (that looks like a lamp);
- the bread is a flat, round **dürüm** or a triangle of **Fladenbrot**, lies on the counter, and
  sits **where the shaved meat falls**. The customer follows a dozen slices from the knife down to
  the counter, and at least 9 in 10 must land on the bread;
- the knife shaves the meat, **and only the meat**.

To make this possible, the flies got new things to type: the sizes `0.3` (for slim döners) and
`4` (for a spit that is longer than a tall döner), and an optional fourth number for cylinders, the number of corners
(`3` makes a triangle, so `CylinderGeometry(1.5, 1.5, 0.2, 3)` is a piece of Fladenbrot). In the
real app, slices are cut from the side facing the customer, fly off a little, and stay on the
first thing they land on, using the same numbers as the customer.

Run `node tools/test_judge.mjs` to check that a proper döner passes (on a dürüm and on a
Fladenbrot) and the loophole döners and the lampshade fail.

**Hand-made:** the token rules, the numbers and colours on offer, the `knife()` helper and the 8
tests. **Real:** the learning-centre wiring and how dopamine changes it. Every token in the winning
programs was chosen by a fly.

## Cubicles (cubicles.html): the Fly Gym as an office

The same training as the Fly Gym, as an interactive three.js world. 1,024 flies (8 labs = 8 teams
of 128) sit at 1,024 desks in an open-plan office. Each one types at its own computer.

- **Walk around:** WASD (or the arrow keys), Shift to run, the mouse to look (click into the
  view first). You can't walk through cubicles; a ramp leads up to the supervisor deck.
- **Screens:** far away, every monitor shows a small picture of the döner shop its fly is typing
  right now (all 1,024 screens share one texture). Up close, a detailed fly takes over: its front
  legs tap the keyboard, and its screen shows the program token by token, with the fly's own
  choices in amber.
- **The supervisor deck:** a big wall screen with the live training (numbers, every fly's shop,
  the progress chart and the best fly's program) and a console of push buttons: PAUSE, 1×
  (a round every 3.5 s, so you can watch them type), 4×, MAX, NEW FLIES (press twice) and REC.
- **The first perfect döner:** the speed drops to 1×, the winner dances on its chair under a light
  beam and confetti, and a path of arrows on the floor leads you to it. Then press **1** for a
  **sugar cube** (real dopamine: every choice in its winning program gets sugar in its learning
  centre) or **2** for a **management contract**: it flies to the glass management office, and its
  memory is copied over the 8 weakest flies of every team (64 flies). A new intern, with a fresh
  memory, takes its desk.
- **Stuck flies:** if the best score doesn't improve for 300 rounds, 1,024 new flies take the
  desks and the big screen says why.
- **Options:** `?autostart` starts training at full speed, `?record` records from the start, and
  `?autopilot` lets the camera walk by itself (intro, a tour while they train, the walk to the
  winner, sugar, contract, the flight to management) and then stops the recording. Use
  `cubicles.html?autopilot&record` for an unattended demo video. `?cam=x,z,yaw,pitch,height` places
  the camera, and `?testparty` pretends round 20's best fly won (to try the party quickly).
- **Recording:** REC (or R) records the 3D view, including the on-screen text, straight from the
  canvas. Every 2 seconds the video so far is sent to `serve.py`, which adds it to
  `ai-fly/recordings/<name>.webm`, so there is nothing to stitch together. Without the local
  server, the video is downloaded when you stop. The file can't be scrubbed until it's repacked
  (`ffmpeg -i in.webm -c copy out.webm`) or converted to MP4.

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
- `js/gym/runner.js`: the training loop (one worker per lab, swapping best flies), shared by the
  Fly Gym and Cubicles
- `cubicles.html`, `css/cubicles.css`, `js/cubicles/`: the office: layout, walking and the shortest
  way along the aisles (`layout.js`, `player.js`), the building and the 1,024 cubicles
  (`office.js`), the flies near and far (`flies.js`), the supervisor deck (`supervisor.js`), the
  winner's party (`party.js`), on-screen text (`hud.js`), recording (`recorder.js`) and `main.js`
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
