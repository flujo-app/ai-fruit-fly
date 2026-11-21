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
  the customer gives a single rating out of 8, with partial credit. (The stand-in reads the flies'
  programs step by step instead of compiling them: that is about 3 times faster, and a browser
  driven by a test tool kept every compiled program in memory, about 12,000 per second, until the
  page crashed.) The fly's best program earns
  sugar and its worst earns bitter, but only for the tokens where the two programs differ. Each
  decision has a 3% chance of being a random token (curiosity). Each lab copies its best flies'
  memories over its weakest ones, and the labs swap their best fly every 2 rounds.
- **Results** (`node tools/train_gym.mjs 1024 1000 islands=8 migrateEvery=2 restartAfter=300`):
  random typing averages about 0.7 of 8 and never passes more than 3 tests. Against the current
  customer, **6 of 6 headless runs produced a perfect döner within 1,000 rounds**: four on the
  first try (rounds 204, 298, 367 and 414), and two after one restart with new flies, which
  happens when the best score hasn't improved for 300 rounds (rounds 635 and 661). The Cubicles
  office does the same restart by itself; in the Fly Gym page, press "New flies" when it says
  the flies are stuck. In the browser on an 8-core PC, training runs at about 2 to 3 rounds per
  second. The recorded Fly Gym run had its first perfect döner in round 219, after 2 minutes 16
  seconds. What made it work:
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
  8. No traps that need two changes at once. Whole runs got stuck on a döner exactly as wide as
     tall (making it taller also needed a longer spit) and on a grill just in front of the back of
     the meat (each step back was worth too little to notice). The customer now accepts a döner
     that is at least as tall as it is wide, and every step towards a wider top or towards a grill
     behind the meat earns clear credit. Things that did not help: more curiosity when progress
     stalls, one "wild idea" per round, and swapping flies between labs less often.

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
`../media/cubicles-demo.mp4` is one unedited take recorded by the page itself
(`cubicles.html?autopilot&record&size=1920x1080`, 83 seconds, a smooth 30 frames per second): the
first perfect döner came in round 131, and the video ends with the winner's döner app running.

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
- **The winner's döner app:** press **3** once a fly has won (press it again to go back). The
  winner's program runs with the real three.js, in the same shop as the Fly Gym's preview: the meat
  turns, the knife shaves it and the slices land on the bread, while the camera slowly moves round
  to the side. Next to it are the program, with the fly's own choices in amber, and the customer's
  8 tests.
- **Stuck flies:** if the best score doesn't improve for 300 rounds, 1,024 new flies take the
  desks and the big screen says why.
- **Options:** `?autostart` starts training at full speed, `?record` records from the start, and
  `?autopilot` lets the camera walk by itself (intro, a tour while they train, the walk to the
  winner, sugar, contract, the flight to management, the winner's döner app) and then stops the
  recording. Use
  `cubicles.html?autopilot&record&size=1920x1080` for an unattended demo video. `?size=1920x1080`
  always draws (and records) at that size, `?cam=x,z,yaw,pitch,height` places the camera,
  `?testparty` pretends round 20's best fly won (to try the party quickly), `?stuckafter=300`
  sets how many rounds without progress bring new flies, and `?off=near,atlas,screen,hud,render`
  switches parts of the drawing off (to find out what makes a computer slow).
- **Recording:** REC (or R) records the 3D view, including the on-screen text, straight from the
  canvas, as it happens (24 frames per second). Every 2 seconds the video so far is sent to
  `serve.py`, which adds it to `ai-fly/recordings/<name>.webm`, so there is nothing to stitch
  together. Without the local server, the video is downloaded when you stop.
- **Smooth autopilot videos:** with `?autopilot&record`, the page records frame by frame instead.
  Every drawn frame becomes exactly one video frame, 1/30 s apart, and everything that moves in the
  office (camera, confetti, typing, messages) also moves on by exactly 1/30 s per frame. So the
  video stays smooth even if the computer only manages a few frames per second; only the
  training keeps its real speed. The browser's own video encoder (WebCodecs) compresses the
  frames, webm-muxer packs them into the file, and if the encoder falls behind, the page waits for
  it. The file can't be scrubbed until it's repacked (`ffmpeg -i in.webm -c copy out.webm`) or
  converted to MP4.

## Doom Gym (doom-gym.html): the complete brain plays Doom

Open <http://127.0.0.1:8765/doom-gym.html> and press **Start**. Fruit flies play Doom. The rules we set
ourselves:

- **It is real Doom.** The game is the open-source Doom engine (doomgeneric, built for the browser
  without a screen or a clock, see `doom-engine/`) with the free Freedoom game data. The task is a
  round room: the fly has a shotgun and 200 health, and 8 monsters come for it within 30 seconds
  (3 zombies, a shotgun zombie, 3 imps and a demon, on Doom's normal difficulty "Hurt me plenty").
- **The fly only gets the screen.** No positions, no health, no score. The picture goes into its eyes;
  the impulses of its own output cells are the only thing that comes out.
- **The brain is complete and never changed.** Every player has all 138,639 neurons and all 15,091,983
  connections of the FlyWire map, simulated impulse by impulse with the paper's settings. Nothing is
  trimmed, re-weighted or trained. All flies have the same brain. (The one exception is optional and
  off by default: with `?learn` a fly's own learning connections change the way a real fly's do.)

### In: the eyes

About 70% of a fly's brain is for seeing (97,000 of the 138,639 neurons), and until now the pages
used almost none of it.

- **Where each cell looks** is read from the wiring (`tools/pack_doom_rig.py`). Behind each of the
  about 790 facets of an eye sits one column of cells. The Mi1 cells (one per column) lie on a curved
  sheet like the eye itself; which way is front and which way is up on that sheet comes from the
  motion cells: a T4a cell, known to prefer front-to-back motion, gets its Mi9 input from the side
  the motion comes from and its Mi4 input from the side it goes to. The four kinds of T4 cells come out
  at 0°, 180°, 101° and -102° on the left eye (expected: 0°, 180°, 90°, -90°). Every other eye cell
  is placed by the columns it is wired to.
- **The screen** stands in front of the fly and fills the middle of its view (120° wide by default).
  About 600 facets look at it, so to the fly Doom is a picture of about 600 points. Flies cannot see
  red: brightness is 5% red, 55% green and 40% blue.
- **Hand-made: the first two layers behind the facets.** The lamina and medulla work with smoothly
  varying voltages, not impulses, and the transmitter of the light-sensing cells (histamine) is not
  in the map's transmitter predictions, so the impulse model cannot do this part. Their well-known
  results are computed the textbook way (`js/doom/eye.js`) and handed to the cells known to carry
  them: brightening (Tm3), darkening (Tm1, Tm2, Tm4), dark areas (Tm9), small changing spots
  (T2, T2a, T3) and local motion in four directions, computed with the classic
  Hassenstein-Reichardt detector (T4a-d for bright edges, T5a-d for dark edges). That is 24,991 real
  cells, each with its own spot on the screen.
- **From there on it is the real wiring**, and it does what a real fly's does
  (`node tools/doom_experiments.mjs` shows the complete brain simple pictures through the same eyes).
  When the world turns to the right, the right eye's HS cells fire at 74 to 222 impulses per second
  and the left eye's stay silent, and the H2 cells do the opposite (left 212, right 0): exactly the
  direction preferences recorded in real flies. A dark disc growing on the left makes the giant fibre
  (the jump neuron) fire on both sides, the looming cells' targets DNp02 and DNp04 fire on the left
  only, and the steering cells turn the fly to the right, away from it. The model is rough in
  places: a shrinking disc startles it almost as much as a growing one.

### Out: the controller

A real fly-lab rig has the fly walk on a floating ball in front of a screen; the ball works like a
trackball. Here the "ball" is read from the fly's own output cells:

| Game input | Output cells | What they do in a real fly |
|---|---|---|
| turn | DNa01 and DNa02, left minus right | steering while walking |
| walk forward | DNg100 and DNg97 | drive forward walking |
| back up | MDN, the "moonwalker" cells | walking backwards |
| pull the trigger | DNp01, the giant fibre | the jump that starts an escape |

Which cell stands for which input is hand-made. So is the fact that the jump neuron is the trigger:
whatever startles this fly gets shot at.

### What gets better: the desk, not the fly

**By default the flies do not learn Doom.** A fly learns with dopamine in its learning centre (the
mushroom body), as in the döner pages. A lesson needs two things: a teacher (sugar or bitter, which
means dopamine) and something the learning centre perceives at that moment, to attach the lesson
to. In the döner pages that was the smell of each token. Doom has no smell, and with the eye
signals above **none of the 5,177 Kenyon cells responds to the screen**. So by default nothing
reaches the learning centre and nothing is learnt. Giving the flies made-up smells that tell them
what is going on in the game, or changing their wiring, would have been cheating. The next section
is about the one honest line from the eye into the learning centre, what happens when it is
switched on, and why it stays off by default.

What the gym tunes instead is each **desk's setup** (`js/doom/setup.js`), the same knobs a real rig has:
how big the screen looks, how strongly the four kinds of eye signal drive their cells, how the ball
is read (turning, a trim for a constant pull to one side, walking, backing up) and how many jump
impulses pull the trigger. Turning can be negative: the ball read the other way round, a classic
experiment in fly research. Every desk in a round faces the same monsters at the same places. After
each round, in each lab, the best desks' setups are copied with small random changes over the worst,
and each lab passes its best setup on to the next lab.

**What we measured** (`node tools/train_doom.mjs flies=64 rounds=3 threads=7 seconds=30`: complete
brains, 64 desks in 8 labs; round 1 is 56 random setups and 8 standard ones):

| Round | Average score | Middle desk | Best desk | Perfect games |
|---|---|---|---|---|
| 1 | 1.85 of 8 | 1.00 | 7.00 | 0 |
| 2 | 3.31 | 3.74 | 7.17 | 0 |
| 3 | 3.96 | 3.51 | **8.00** | 1 |

So the same unchanged brain goes from killing two of the eight monsters to killing all eight,
depending only on how its desk is set up. The first perfect game came in round 3, at a desk with a
125° screen, a weak motion signal, strong flicker and small-object signals, fast turning and
walking, and a trigger that needs 14 jump impulses within a tenth of a second: a fly that keeps
moving and only shoots when something really startles it. With the standard setup the fly killed 5
of 8 in the test game (`node tools/test_doom_fly.mjs`). About half of the flies die before the 30
seconds are over. One run is not much: the monsters' places change every round, each fly has its
own run of chance, and another run will find other desks.

### The learning centre, switched on (`?learn`): it works, and it does not help

**The line in.** Of the eye cells that reach the learning centre, one kind is well known: the 7
aMe12 cells. They are the biggest eye input of the "visual" Kenyon cells, and they are excited by
the pale kind of the colour photoreceptors R7/R8, which see ultraviolet and blue (Ganguly et al.
2024, *Nature Communications*). A monitor gives no ultraviolet, so with `?learn` each aMe12 cell is
driven by how much **blue light** the facets of "its" photoreceptor cells get. Those facets are read
from the wiring: 16 to 55 per cell, scattered over the eye, about half of them looking at the
screen. Hand-made: that the response is steady and grows with the light (nobody has recorded from
these cells), its strength (a desk knob, 300 on the standard desk) and an upper limit. The other
eye cells that reach the learning centre have never been recorded from, so they get no made-up
signal.

**What the complete brain does with it** (`node tools/doom_experiments.mjs`):

- A bright screen makes 40 Kenyon cells fire, a dark one 2. With only the left half bright 17 fire,
  with only the right half 10, and 7 of those are the same. So the learning centre can tell a bright
  view from a dark one and left from right, with a few dozen of its cells. That is all it gets.
- It has a say in the controller, through the real wiring. With the bright screen the left steering
  cells DNa01 and DNa02 fire 18 and 25 times a second and the right ones 7 and 10. With all Kenyon
  cells switched off it is the other way round (7 and 6 on the left, 12 and 16 on the right). The
  learning centre's output cells MBON27, MBON32 and MBON35 connect directly onto steering cells
  (DNa02, DNa03, DNg13) and onto the moonwalker cells.
- The model's learning centre has a weak spot. Driven a little too hard, almost all of its Kenyon
  cells (about 4,000 of the 5,177) fire at once and keep each other going. A real fly's brain
  prevents that; this model does not. So the blue signal has to stay weak.

**Sugar and bitter** (`js/doom/learning.js`). A monster killed earns a drop of sugar (three for the
last one). A hit taken, or a second of walking against a wall, earns a drop of bitter. The drops are
real input: the fly's taste cells fire, and with sugar its feeding neuron fires. That sugar means
dopamine from the reward cells and bitter dopamine from the punishment cells is made by hand, as in
the döner pages, because the taste signal does not reach the dopamine cells through the wiring of
this model. The rule itself is the real one: the Kenyon cells that were active in the last second
get weaker connections onto the output cells of that dopamine zone (38 output cells belong to the
sugar zone, 58 to the bitter zone, read from the wiring). These 3,641 connections are the only thing
in the brain that ever changes, each fly has its own, and it keeps them from game to game.

**What we measured** (`node tools/doom_learning.mjs`: 12 flies, 8 games each, standard desk, the
same monsters and the same run of chance in every row; complete brains):

| | Average score out of 8 | Whole centre fires at once | Flies that died |
|---|---|---|---|
| Blue light off (the game as it is by default) | 4.25 ± 0.16 | never | not counted |
| Blue 300, nothing learnt | 4.28 ± 0.15 | 2% of the time | 30% |
| Blue 300, sugar and bitter | 4.02 ± 0.14 | 5% | 39% |
| Blue 450, nothing learnt | 3.41 ± 0.18 | 16% | 46% |
| Blue 450, sugar and bitter | 3.67 ± 0.16 | 8% | 34% |

So: with a weak blue signal the learning centre takes part without doing harm, and learning does
not make the flies better (4.02 against 4.28; in the second half of the games 0.5 ± 0.3 worse).
With a stronger signal the fly plays clearly worse, because the whole centre keeps firing at once,
and learning wins a little of that back by weakening the connections that cause the trouble. In no
case did a fly with a learning centre beat the game as it is by default. In a game about a dozen
Kenyon cells take part, a fly gets about 4 drops of sugar and 13 of bitter, and being stuck was rare
(0.2 drops a game). The two rows with blue 450 were played before the drops for the last monster and
for being stuck were added.

Why it does not help, as far as we can tell: all the learning centre knows about the screen is how
much blue light there is on the left and on the right, and that says little about where a monster
is. And every lesson can only weaken a connection. So the learning centre stays **off by default**,
and `?learn` switches it on for anyone who wants to watch it (the desk's blue knob is then tuned
between rounds like the others, and the page shows how many learning cells are active and each drop).

### Speed, and the faster brain engine

One complete brain keeps one processor core busy, so as many flies play at the same moment as the
computer has cores (8 here), and the 1,024 desks take turns. The page shows the running games, every
desk's latest game, a replay of the best game (the same Doom engine, fed the fly's recorded input),
and for one fly what its eyes get, its brain and its output cells.

`js/brain-fast.js` computes exactly the same model as `js/brain-engine.js` with less wasted work:
a neuron far below threshold cannot fire until new input arrives, so it is left alone and brought up
to date with the exact formula when the next impulse reaches it. `node tools/test_brain_fast.mjs`
compares it with a deliberately simple reference that updates every neuron at every step: on the
learning centre's 5,554 neurons both fire the same 6,321 impulses, neuron for neuron. On the whole
brain it gives the same firing rates as the old engine (sugar taste: feeding neuron MN9 79 against
83 impulses per second) and was 5 to 7 times faster in those tests. In a game, one brain ran at
about twice real time on a free core with the standard setup, and at 0.4 to 0.65 times real time
when 7 brains ran at once on an 8-core PC that was busy with other work. There a round of 64 desks
took 7 to 12 minutes, so a round of all 1,024 desks takes a few hours. The page shows how long the
current round will still take.

Options: `?flies=64` (fewer desks, so a round is shorter), `?labs=4` (fewer brains at once),
`?seconds=20` (shorter games), `?autostart`, `?resume` (continue the run that is saved to the local
server every 16 games), `?learn` (the learning centre switched on, see above), and **`?fast`**: a reduced brain of 30,658 neurons (the cells between the
eyes and the output cells, and all connections between them). It is quicker and it is not the real
thing; the page says so in amber. The default is always the complete brain.

With `python serve.py` the 8 workers share one copy of the 61 MB wiring; on another server each
keeps its own copy (about 500 MB in total).

`node tools/play_doom.mjs`, `node tools/train_doom.mjs`, `node tools/doom_learning.mjs` and
`node tools/test_doom_fly.mjs` run games, whole rounds, the learning comparison and the checks
without a page.

**Hand-made:** the first two layers of the eye, where the eye looks (how many degrees the eye map
covers), which output cell is which game input, the desk setups, the arena, its monsters and the
scoring; and with `?learn` the blue-light signal of the aMe12 cells, what earns sugar or bitter, and
that sugar and bitter mean dopamine. **Real:** the game, every neuron and connection behind the
24,991 eye cells, every impulse that turns the picture into a movement, and the rule by which the
learning centre's connections change.

## Doom Cubicles (doom-cubicles.html): the Doom Gym as an office

The same games in the office of the Cubicles page: 1,024 desks in 8 teams, one team per lab.

- **Screens:** far away, every monitor shows the last picture of its desk's latest game, with a bar
  for the score. A blue marker floats over each desk that is playing right now; up close, its fly
  taps the keys and the screen shows the game live. Flies that wait for their turn clean themselves.
- **The supervisor deck:** the wall screen shows the games that are running, a replay of the best
  game so far, every desk's latest game, the progress and the best desk's setup. The console has
  PAUSE, PLAY, NEW DESKS (press twice) and REC.
- **The first fly that kills all 8 monsters** gets the party: a light beam, confetti and a path on
  the floor. Its screen replays the winning game. Press **1** for a sugar cube (it drinks; whether it
  learns anything depends on `?learn`) or **2** for a management contract: it flies to the management office and its
  desk setup is copied to the 8 weakest desks of every team.
- **3** shows the best game so far filling the view.
- **Options:** `?autostart`, `?record`, `?autopilot` (the camera walks by itself, for a demo video),
  `?fast`, `?learn`, `?seconds=`, `?resume`, `?cam=x,z,yaw,pitch,height`, `?size=1920x1080`, `?testparty=12`
  (pretend the best fly after 12 games won, to try the party).

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
  lab per worker (`gym-worker.js`), the wall of thumbnails (`wall.js`), the real app template
  (`app-template.js`) and the döner shop around every program (`shop.js`: counter, knife, falling
  slices)
- `js/gym/runner.js`: the training loop (one worker per lab, swapping best flies), shared by the
  Fly Gym and Cubicles
- `cubicles.html`, `css/cubicles.css`, `js/cubicles/`: the office: layout, walking and the shortest
  way along the aisles (`layout.js`, `player.js`), the building and the 1,024 cubicles
  (`office.js`), the flies near and far (`flies.js`), the supervisor deck (`supervisor.js`), the
  winner's party (`party.js`), the winner's döner app (`winner-show.js`), on-screen text
  (`hud.js`), recording (`recorder.js`), the office clock for frame-by-frame videos (`clock.js`)
  and `main.js`
- `data/gym.bin`, `data/gym.json`: precomputed smell fingerprints (`tools/make_fingerprints.mjs`)
- `tools/train_gym.mjs`: headless Fly Gym training, for experiments
- `doom-gym.html`, `doom-cubicles.html`, `css/doom.css`, `js/doom/`: the Doom pages: the Doom engine's
  wrapper (`engine.js`), the eyes (`eye.js`), one fly playing one game (`game.js`), the desk setups
  and what happens to them after a round (`setup.js`, `evolve.js`), the learning centre with sugar
  and bitter (`learning.js`, off unless `?learn`), one lab per worker
  (`doom-worker.js`), the rounds (`runner.js`), loading (`load.js`), drawing helpers (`views.js`)
  and the two pages (`gym-main.js`, `cubicles-main.js`)
- `js/brain-fast.js`: the whole-brain model again, computed with less wasted work (used by the Doom pages)
- `doom-engine/`: the Doom engine's source, licence and build script; `data/doom/doom.wasm` and
  `data/doom/flygym.wad` are built from it and from Freedoom (`tools/build_doom_wad.mjs`)
- `data/doom/rig.bin`, `rig.json`, `circuit.bin`: where every eye cell looks, the output cells, and the
  reduced brain for `?fast` (`tools/pack_doom_rig.py`)
- `tools/play_doom.mjs`, `tools/train_doom.mjs`, `tools/doom_learning.mjs`, `tools/doom_experiments.mjs`:
  flies play Doom without a page, the learning comparison, and the brain in front of simple
  pictures; `tools/test_doom_engine.mjs`,
  `tools/test_brain_fast.mjs`, `tools/test_doom_fly.mjs`: the checks

To rebuild `data/`, put these files in `../raw_data`:

- `Completeness_783.csv` and `Connectivity_783.parquet` from
  [philshiu/Drosophila_brain_model](https://github.com/philshiu/Drosophila_brain_model)
- `Supplemental_file1_neuron_annotations.tsv` from
  [flyconnectome/flywire_annotations](https://github.com/flyconnectome/flywire_annotations),
  renamed to `neuron_annotations.tsv`

Then run:

```bash
uv run --with pandas --with pyarrow --with numpy python tools/pack_brain.py
uv run --with pandas --with pyarrow --with numpy --with scipy python tools/pack_doom_rig.py   # the Doom pages' eye map
```

## Credits and licences

- Brain wiring: FlyWire Consortium (Dorkenwald et al. 2024, Schlegel et al. 2024),
  **CC BY-NC 4.0**, so non-commercial use only, with credit.
- Brain model and data packaging: Shiu et al. 2024, MIT licence.
- 3D engine: three.js, MIT licence.
- Video files in Cubicles: webm-muxer by Vanilagy, MIT licence.
- Doom engine: [doomgeneric](https://github.com/ozkl/doomgeneric) by ozkl, based on Chocolate Doom and
  id Software's Doom source, **GPL-2.0** (`doom-engine/LICENSE`; the source of the shipped
  `doom.wasm` is in `doom-engine/src/`).
- Game data: [Freedoom](https://freedoom.github.io/) 0.13.0, © the Freedoom contributors, BSD-style
  licence (`data/doom/FREEDOOM-COPYING.txt`, `FREEDOOM-CREDITS.txt`).
