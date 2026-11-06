# AI Fruit Fly

A real fruit fly brain (all 138,639 neurons of the FlyWire map) simulated live in the browser.

- **Fly world** (`ai-fly/index.html`): a 3D fly whose whole brain steers it. It finds food, escapes a swatter and grooms.
- **Döner Dev Fly** (`ai-fly/doener.html`): the fly's learning centre picks code blocks by smell and learns from sugar and bitter until it has written a rotating döner kebab web app.
- **Fly Gym** (`ai-fly/fly-gym.html`): hard mode. 1,024 flies, each with its own copy of the learning centre, type a three.js döner app one token at a time and train together in 8 parallel labs.

**Demo video:** [media/fly-gym-demo.mp4](media/fly-gym-demo.mp4) (66 s). It shows a full Fly Gym run with 1,024 flies, from random typing to the first perfect döner in generation 350 (about 3 minutes of training, recorded in two parts), and then the app the flies wrote: [ai-fly/examples/doener-by-1024-flies.html](ai-fly/examples/doener-by-1024-flies.html).
Getting there took a few rounds of closing loopholes. The flies' first "döner" passed every test as a giant glowing ball swallowing the meat ([first-try-glowing-ball.html](ai-fly/examples/first-try-glowing-ball.html)). That's a classic case of a learner gaming its reward; the details are in [ai-fly/README.md](ai-fly/README.md).

Run it:

```bash
cd ai-fly
python serve.py
```

Then open <http://127.0.0.1:8765>. See [ai-fly/README.md](ai-fly/README.md) for details, credits and licences.
The FlyWire data is CC BY-NC 4.0: non-commercial use only, with credit.
