# Doom engine for the fly gym

The real Doom engine, built for the browser without a screen, a clock or a sound card, so that
simulated fruit flies can play it. Nothing happens on its own: the caller starts a game, sets
the input, runs game tics and asks for a picture when it wants one. The same seed and the same
calls always give the same game and the same pictures, bit for bit, in the browser (main thread
or Web Worker) and in Node.

| What | Where |
|---|---|
| Engine source (C, GPL-2.0) | `doom-engine/src/`, licence in `doom-engine/LICENSE` |
| Build script (Emscripten in Docker) | `doom-engine/build.sh` |
| Built engine | `data/doom/doom.wasm` (278,317 bytes) |
| Game data (made from Freedoom) | `data/doom/flygym.wad` (4,949,841 bytes), `data/doom/FREEDOOM-COPYING.txt`, `data/doom/FREEDOOM-CREDITS.txt` |
| Game data script | `tools/build_doom_wad.mjs` |
| JavaScript wrapper | `js/doom/engine.js` |
| Tests and speed numbers | `tools/test_doom_engine.mjs` |

## Rebuilding

From the `ai-fly` folder:

```sh
node tools/build_doom_wad.mjs          # data/doom/flygym.wad (downloads Freedoom 0.13.0 into doom-engine/.build/ once)
doom-engine/build.sh                   # data/doom/doom.wasm (needs Docker with Linux containers)
node tools/test_doom_engine.mjs        # all checks + speed numbers; add --png for screenshots in doom-engine/.build/shots/
```

`build.sh` runs `emcc` from the pinned image `emscripten/emsdk:4.0.10` and works from Git Bash on
Windows (it turns off MSYS path conversion and mounts the folder by its Windows path) as well as
from Linux and macOS. Both outputs are reproducible: running the two scripts again gives files
with the same SHA-256 (`doom.wasm` 7e0a2a0f…, `flygym.wad` a03f51c3… at the time of writing).

Compiler settings that matter: `-O3 -DFLYGYM -fwrapv -fno-strict-aliasing
-ftrivial-auto-var-init=zero` (Doom relies on integer wrap-around; every local variable starts at
zero, so leftovers on the stack can never leak into a game), linked with `-sSTANDALONE_WASM
--no-entry -sINITIAL_MEMORY=16MB -sALLOW_MEMORY_GROWTH=0 -sSTACK_SIZE=1MB`.

The result is a plain `.wasm` with only four imports, all supplied by `engine.js`:
`env.fg_error` (receives Doom's fatal error text) and the WASI calls `fd_write`, `fd_close`,
`fd_seek` that the C library's `printf` needs. No Emscripten JavaScript glue is used.

## Where the code comes from

Upstream: [doomgeneric](https://github.com/ozkl/doomgeneric) by ozkl, commit
`e257a09527062bfb986b6e5e0780839b6cbd5b71` (2026-10-11, "Merge pull request #39 from
yughias/compile-mingw"), itself based on Chocolate Doom and id Software's Doom source. GPL-2.0;
the licence file is `LICENSE` (copied unchanged from upstream).

`src/` holds every C file that is compiled, so the full source of the distributed
`doom.wasm` is in this repository. It contains all `.h` files of `doomgeneric/doomgeneric/` and
the `.c` files of upstream's `Makefile.emscripten`, except the ones listed as left out below.

Left out (platform code that a headless build does not use): `doomgeneric.c`,
`doomgeneric_*.c` (all window/OS ports), `i_video.c` (replaced by `fg_video.c`), `w_file_stdc.c`
(replaced by `w_file_mem.c`), `i_sdlmusic.c`, `i_sdlsound.c`, `i_allegromusic.c`,
`i_allegrosound.c`, `gusconf.c`, `icon.c`.

### Every change to upstream files

All changes are also marked `FLYGYM` in the code.

| File | Change |
|---|---|
| `m_random.c` | New global `fg_seed`; `M_ClearRandom()` (called by `G_InitNew`) starts `P_Random` at index `fg_seed & 255` and `M_Random` at `(fg_seed >> 8) & 255` instead of 0. |
| `z_zone.c` | `Z_Malloc` hands out zeroed memory (`memset`), plus `#include <string.h>`. Nothing a previous game left in the heap can reach a new game. |
| `i_system.c` | With `FLYGYM`, `I_Error` formats the message, passes it to JavaScript (`fg_js_error`) and stops with a trap: no stderr, no `exit()`, no dialog box. Includes `fg_api.h`. |
| `w_file.c` | With `FLYGYM`, `W_OpenFile` always uses the in-memory WAD class from `w_file_mem.c`; the stdio/mmap class table is compiled out. |
| `p_mobj.h` | New `int fgid` at the end of `mobj_t` (small id reported by `fg_things`). |
| `p_mobj.c` | `P_SpawnMobj` sets `fgid` (`fg_new_id`: next id for monsters, -1 otherwise). Includes `fg_api.h`. |
| `p_inter.c` | `P_DamageMobj` calls `fg_on_damage(target, source, damage)` just before health is taken (after armour), for the damage-dealt / damage-taken / hits / player-kills counters. Includes `fg_api.h`. |
| `p_pspr.c` | `P_FireWeapon` calls `fg_on_shot(player)` once it has passed the ammo check (shots-fired counter). Includes `fg_api.h`. |
| `r_main.c` | (1) The four `NetUpdate()` calls in `R_RenderPlayerView` are removed (drawing must never read input, time or network). (2) New globals `fg_viewwidth`/`fg_viewheight`: when set, `R_ExecuteSetViewSize` uses that exact size instead of the screenblocks steps. (3) `R_InitTextureMapping` builds `xtoviewangle[]` in one pass from the right edge instead of restarting the search for each column; the table is identical, it is just fast enough to change view size often. |
| `r_things.c` | New global `fg_draw_psprites`; `R_DrawMasked` draws the player's weapon only when it is 1. |
| `st_stuff.c` | The two static locals `lastattackdown` and `priority` of `ST_updateFaceWidget` became file-level statics, and `ST_initData` resets them and `st_facecount`, so the status bar face starts the same way in every game. |
| `s_sound.c` | With `FLYGYM`, `S_StartSound` records every sound the player could hear as an event (`fg_on_sound(id, volume, separation)`, values from Doom's own `S_AdjustSoundParams`) and returns before the channel code; `S_ChangeMusic` returns at once (no music). Includes `fg_api.h`. |

New files: `fg_api.c` (the exported API and the driver), `fg_api.h` (declarations shared with
the patched files), `fg_video.c` (headless replacement for `i_video.c` and the `DG_*`
platform functions: a 320x200 byte screen, no window, no keyboard, a clock that always says 0),
`w_file_mem.c` (the WAD lives in memory; lumps are read in place, never copied).

## How the engine is driven

`fg_init` sets up what Doom's `D_DoomMain` would (zone heap, WAD, textures, sprites, status bar,
heads-up font) but never enters a main loop, never shows a title screen, menu, demo or
intermission, never reads a config file and never touches files, time or the network. A game
tic (`fg_tick`) is exactly the game part of Doom's `G_Ticker`: copy the held input into the
player's ticcmd, then `P_Ticker`, `ST_Ticker`, `HU_Ticker`, `gametic++`. Exiting the level only
sets a flag.

### C API (exports of `doom.wasm`)

```c
uint8_t *fg_wad_alloc(int size);   // room for the WAD; JS copies it in, once, before fg_init
int      fg_init(void);            // 0 = ok, -1 no WAD, -2 WAD unreadable, -3 no PLAYPAL/MAP01
int      fg_new_game(int skill, int map, unsigned seed);  // 0 = ok, -1 not initialised, -2 no such map
void     fg_set_player(int x, int y, int angle_deg);
void     fg_give(int weapon, int ammo, int health);        // < 0 / <= 0 = leave unchanged
void     fg_set_cmd(int forward, int side, int turn, int buttons);
void     fg_tick(int n);
uint8_t *fg_render(int w, int h, int flags);               // flags bit 0 = draw the weapon
uint8_t *fg_render_full(void);
uint8_t *fg_palettes(void);                                // 14 * 768 bytes (PLAYPAL)
int32_t *fg_state(void);
int      fg_state_count(void);                             // 32
int      fg_spawn(int mobjtype, int x, int y, int angle_deg, int awake);
int      fg_things(int32_t *out, int max, int all);
int      fg_sounds(int32_t *out, int max);
int32_t *fg_ints(void);                                    // a 4096-int buffer for fg_things/fg_sounds
void     fg_set_fill(int colour);                          // debug: pre-fill frames (-1 = off)
int32_t *fg_mem_info(void);                                // zone size, zone free, C heap top, wasm memory
```

Differences from the original plan, and why: `fg_new_game` returns a status instead of `void`
(so a missing map is an error, not a crash); `fg_things` has a third argument `all` (list every
thing: player, items, missiles, bullet puffs, corpses; the tests use it to find bullet puffs);
`fg_wad_alloc`, `fg_state_count`, `fg_ints`, `fg_set_fill` and `fg_mem_info` are extra.

Details:

* **skill** 1..5 as in Doom's menu (1 = "I'm too young to die", 5 = Nightmare: fast monsters
  and respawning only there). **map** = MAPxx: 1 = Freedoom's MAP01, 2 = the arena, 3 = the
  arena with pillars.
* **fg_set_cmd**: forward and side are Doom ticcmd units, clamped to -50..50 (50 = running,
  25 = walking; Doom's top running speed is 16.7 map units per tic); turn is Doom's `angleturn`,
  a signed 16-bit value added to the angle every tic (positive = left, 65536 = a full circle, so
  1000 = 5.49 degrees per tic); buttons are Doom's ticcmd buttons: bit 0 fire, bit 1 use, bit 2
  change weapon with the weapon number in bits 3-5 (other bits are dropped). The input stays
  until changed; `fg_new_game` clears it. A dead player's "use" is ignored, so the player never
  respawns.
* **fg_give** makes the weapon ready at once (no raise animation) and owned; ammo goes to that
  weapon's ammo type (capped at 9999); health sets both player and body health. Note: after
  `fg_new_game` the pistol is raised the normal way, which takes about 16 tics, unless `fg_give`
  is used.
* **fg_set_player** places the player on the floor of the sector at (x, y), stops all motion and
  sets the eye height. It does not check walls or things there.
* **fg_spawn** works like a thing placed in a map (random start frame, counts for the kill/item
  totals). Solid things that do not fit (wall, other thing, the player) are refused (-1), as are
  the Icon of Sin parts (types 25-27, they need a special map). `awake` does what Doom's `A_Look`
  does when a monster sees the player: target the player, play the sight sound, start chasing.
  Ids count up from 0 per game; monsters from the map get ids too.
* **fg_things** records are 5 ints: type, x, y (16.16 fixed), health, id. Without `all` only
  live monsters (anything that counts as a kill, plus lost souls). It writes at most `max`
  records and returns how many it wrote.
* **fg_sounds** records are 3 ints: sfx id, volume 0..127, stereo separation 32..224 (128 =
  centre, lower = left). Computed by Doom's own rules (`S_AdjustSoundParams`: approximate
  distance, 1200-unit cut-off, full volume within 200 units). Sounds made by the player are
  centred at full volume. Up to 256 events are kept between calls; more are dropped. The list
  is cleared by each call and by `fg_new_game`.

### State array (`fg_state`, also `DOOM.S` in `engine.js`)

Refreshed after every `fg_tick`, `fg_new_game`, `fg_set_player`, `fg_give` and `fg_spawn`.

| Index | Name | Meaning |
|---|---|---|
| 0 | TIC | game tics since the new game (`leveltime`) |
| 1 | HEALTH | player health |
| 2 | ARMOR | armour points |
| 3 | AMMO | ammo of the current weapon, -1 for fist/chainsaw |
| 4 | WEAPON | current weapon (0 fist, 1 pistol, 2 shotgun, 3 chaingun, 4 rocket launcher, 5 plasma, 6 BFG, 7 chainsaw, 8 super shotgun) |
| 5 | KILLS | Doom's kill count (includes monsters killed by other monsters) |
| 6 | ITEMS | items picked up |
| 7, 8, 9 | X, Y, Z | player position, 16.16 fixed |
| 10 | ANGLE | player angle, binary angle (read as unsigned) |
| 11 | DEAD | 1 when the player is dead |
| 12 | PALETTE | palette Doom would show now: 0 normal, 1-8 red (damage), 9-12 gold (pickup), 13 green (radiation suit) |
| 13 | DAMAGE_DEALT | cumulative health taken from monsters by the player (overkill not counted; barrels and other monsters' attacks only count if the player is the source) |
| 14 | DAMAGE_TAKEN | cumulative health the player lost, after armour |
| 15 | SHOTS | cumulative attacks that really fired (one per trigger pull or automatic refire, after the ammo check) |
| 16 | MONSTERS | live monsters now |
| 17, 18 | MOMX, MOMY | player momentum, 16.16 per tic |
| 19 | EXITED | 1 once the player reached a level exit; the game stops there |
| 20 | VIEWZ | eye height, 16.16 |
| 21 | ARMORTYPE | 0 none, 1 green, 2 blue |
| 22 | SECRETS | secret areas found |
| 23 | DAMAGECOUNT | Doom's red-flash counter |
| 24 | BONUSCOUNT | Doom's gold-flash counter |
| 25 | PENDING | weapon being switched to (10 = none) |
| 26, 27, 28 | MAP, SKILL, SEED | the current game's settings |
| 29 | TOTAL_KILLS | monsters that count for the kill total |
| 30 | PLAYER_KILLS | cumulative monsters killed by the player |
| 31 | HITS | cumulative times the player damaged a monster |

### Seeds and determinism

Doom's own 256-entry random table is the only source of randomness. The seed sets where its two
read positions start: the game's stream (`P_Random`) at `seed & 255`, the second stream
(`M_Random`, which here only moves the status bar face) at `(seed >> 8) & 255`. So there are
exactly 256 different games per scenario; seeds with the same low 8 bits play the same game
(the test checks both). Different start positions, spawns and inputs make games differ further.

Nothing else can influence a game: there is no clock (time is always 0), no input device, the
zone heap is zeroed on every allocation, stack variables start at zero, `gametic` restarts at 0
with each game (the revenant's homing missile uses it), the status bar face forgets the previous
game, the spectre shimmer pattern restarts with every frame, and drawing never changes the game
(checked). An instance that has played many games plays the next one exactly like a fresh
instance (checked). WebAssembly integer and float maths are the same on every machine. A
2,000-tic scripted game (state, frame and sound hashes) was also run once by hand on a temporary
test page in Chrome 156, on the main thread and in a module Web Worker that got the module
compiled on the main thread: both gave exactly the same hashes as Node 22.

### Pictures

`fg_render(w, h, flags)` draws the player's eye view at any size from 8x8 to 320x200 into a
buffer of w*h palette indices, row by row. The horizontal field of view is Doom's 90 degrees at
every size. The vertical scale is the same as the horizontal scale per pixel, exactly as in Doom,
whose 320x200 pixels are shown stretched to 4:3 (each pixel 1.2 times taller than wide). So the
**vertical field of view is 2·atan(h/w)**: for 96x60 and for 320x200 it is **64.01 degrees**
(with Doom's 1.2 pixel stretch the picture looks exactly like the original game, scaled down).
The 3D part of `fg_render_full` is 320x168 (the status bar takes the bottom 32 rows), giving
55.40 degrees. Light fades with distance as in Doom at every size. The weapon, when drawn, is
scaled and placed as in Doom's full-screen mode.

`fg_render_full()` is what a player sees: the 320x168 view with the weapon, the full status bar
(redrawn completely every time, so it never depends on earlier frames) and Doom's pickup
messages at the top. Apply `fg_palettes() + 768 * state[PALETTE]` for the damage/pickup tint.

Both return pointers to engine-owned buffers that are reused by the next render call.

### Memory and speed

Each instance has a fixed 16 MB of wasm memory (no growth), of which 12.3 MB are used after
start: 1 MB stack, about 0.6 MB engine tables and screen buffers, 4.7 MB WAD, 6 MB zone heap.
Of the 6 MB zone, start-up tables take 240 KB, Freedoom's MAP01 about 300 KB and an arena under
10 KB, so there is plenty of room for monsters. 2,000 new games in a row leave the memory
exactly as it was (checked).

Measured by `tools/test_doom_engine.mjs` in Node 22 on this development PC (one core):
about 1.4-1.8 million game tics per second without drawing in the arena with 6 awake imps
attacking (570,000-590,000 per second on Freedoom MAP01 with 18 monsters), `render(96, 60)`
about 95,000-99,000 frames per second, `render(320, 200)` about 14,700 and `renderFull()` about
14,700-15,100 frames per second, `newGame` 0.02 ms for the arenas and 0.2 ms for MAP01; compile
1-3 ms, instantiate and load 5-8 ms.

## The game data (`tools/build_doom_wad.mjs`)

Made from Freedoom 0.13.0 Phase 2 (`freedoom2.wad`, 27.45 MB, licence in
`data/doom/FREEDOOM-COPYING.txt`, credits in `data/doom/FREEDOOM-CREDITS.txt`). The script
downloads the release zip into `doom-engine/.build/freedoom-dl/` if needed (SHA-256
`3f9b264f…8f59` is checked) and writes `data/doom/flygym.wad` (4.72 MB, 1,693 lumps):

* kept: palettes (PLAYPAL), colour maps, **all** sprites (3.7 MB, every monster, weapon, item
  and effect of Doom II), the status bar graphics and font, the automap digits and view border
  pieces (tiny), Freedoom's MAP01 unchanged;
* new: MAP02 "the arena" and MAP03 "the arena with pillars", generated from a short description
  at the top of the script (`ARENA`, `PILLARS`): a regular 16-sided room, 768 units from centre
  to corner, ceiling 192, light 208, brick walls (`BRICK12`), dark floor (`FLOOR4_8`), bright
  ceiling panels (`FLAT2`), player 1 in the middle facing a wall face to the east, no monsters.
  MAP03 adds six 64x64 pillars (`STARG3`) on a ring of radius 400 at 30, 90, ..., 330 degrees.
  All map lumps are built by the script, including a small BSP node builder (MAP02: one
  subsector, zero nodes, which vanilla Doom supports; MAP03: 20 subsectors, 19 nodes, 8 split
  segs) and the blockmap;
* textures: only the 56 textures the three maps can show (plus their switch and animation
  partners and SKY1) keep their real patches; the other 907 texture names stay defined but
  point to one small placeholder patch, so every lookup by name still works. 72 of 1,054
  patches remain. Flats: the 34 the maps use, plus whole animation ranges;
* removed: music, sound samples (PC speaker and digital), demos, MAP02-MAP32 of Freedoom, menu
  graphics, title/help/credit/intermission/finale pictures, DEHACKED, GENMIDI/DMXGUS, ENDOOM.

The tests render all three maps from hundreds of positions and angles at five sizes with
pre-filled frames and find no undrawn pixel, so nothing missing is ever shown.

## Things to know when using it

* Call order: `loadDoom` (copies the WAD, runs `fg_init`), then `newGame` before anything else.
  Before the first game, set/give/spawn/tick do nothing and renders are blank.
* After a level exit (`EXITED` = 1) ticks do nothing until the next `newGame`.
* If Doom hits a fatal error (`I_Error`), `engine.js` throws `Doom engine error: ...`; that
  instance must not be used again.
* Doom quirks that are kept: walls repeat every 128 units vertically; Doom's sine table has no
  exact zero, so running "due east" drifts a fraction of a unit north; the exit switch plays the
  normal switch sound.
* Not included: automap, savegames, demos, multiplayer, the Icon of Sin spawner via `fg_spawn`.
