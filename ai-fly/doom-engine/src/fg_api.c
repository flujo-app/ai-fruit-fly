// FLYGYM: the fly gym's control surface for the Doom engine (not part of doomgeneric).
//
// The engine never runs on its own: no main loop, no menus, no title screen, no
// demo loop, no clock, no input devices, no sound output, no files, no network.
// JavaScript copies the WAD in, then drives everything with explicit calls:
// new game -> set input -> run N tics -> draw when wanted. With the same seed and
// the same calls, the game and every frame are bit-for-bit the same.

#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "doomdef.h"
#include "doomstat.h"
#include "d_main.h"
#include "p_setup.h"
#include "p_tick.h"
#include "d_player.h"
#include "d_items.h"
#include "info.h"
#include "sounds.h"
#include "g_game.h"
#include "m_argv.h"
#include "m_misc.h"
#include "m_random.h"
#include "p_local.h"
#include "p_mobj.h"
#include "p_pspr.h"
#include "r_local.h"
#include "s_sound.h"
#include "st_stuff.h"
#include "hu_stuff.h"
#include "v_video.h"
#include "w_wad.h"
#include "z_zone.h"
#include "i_video.h"
#include "tables.h"
#include "fg_api.h"

#define EXPORT __attribute__((used, visibility("default")))

// --- things the engine files define that we steer -------------------------------
extern boolean precache;
extern int setdetail;
extern byte *ylookup[];
extern int columnofs[];
extern int viewwindowx, viewwindowy;
extern int fuzzpos;                // r_draw.c: where the spectre shimmer pattern is
void R_ExecuteSetViewSize(void);

// --- state array: refreshed after every fg_tick / fg_new_game / fg_set_player ---
enum {
    FS_TIC, FS_HEALTH, FS_ARMOR, FS_AMMO, FS_WEAPON, FS_KILLS, FS_ITEMS,
    FS_X, FS_Y, FS_Z, FS_ANGLE, FS_DEAD, FS_PALETTE,
    FS_DMG_DEALT, FS_DMG_TAKEN, FS_SHOTS, FS_MONSTERS, FS_MOMX, FS_MOMY, FS_EXITED,
    FS_VIEWZ, FS_ARMORTYPE, FS_SECRETS, FS_DAMAGECOUNT, FS_BONUSCOUNT, FS_PENDING,
    FS_MAP, FS_SKILL, FS_SEED, FS_TOTALKILLS, FS_PLAYER_KILLS, FS_HITS,
    FS_COUNT
};
static int32_t state[FS_COUNT];

static int inited;
static int game_on;
static int exited;
static int skill_now, map_now;
static int dmg_dealt, dmg_taken, shots, player_kills, hits;
static int next_id;
static int cmd_forward, cmd_side, cmd_turn, cmd_buttons;
static byte *playpal;

byte *fg_wad_data = NULL;
unsigned int fg_wad_size = 0;

// --- sound events ---------------------------------------------------------------
#define MAX_SOUNDS 256
static int32_t sound_q[MAX_SOUNDS * 3];
static int sound_n;

// a general int buffer JavaScript can hand back to fg_things / fg_sounds
static int32_t ints[4096];

// --- drawing --------------------------------------------------------------------
static byte scratch[SCREENWIDTH * SCREENHEIGHT];   // 3D view, 320-byte rows
static byte packed[SCREENWIDTH * SCREENHEIGHT];    // the same, w-byte rows
static int view_w, view_h;
static byte *view_base;
static int fill = -1;                              // debug: pre-fill colour or -1

static int is_monster_type(int type)
{
    return (mobjinfo[type].flags & MF_COUNTKILL) || type == MT_SKULL;
}

static angle_t deg_to_bam(int deg)
{
    deg %= 360;
    if (deg < 0)
        deg += 360;
    return (angle_t) (((uint64_t) deg << 32) / 360);
}

// Same rule as the status bar's ST_doPaletteStuff (which only runs when drawing).
static int palette_index(player_t *p)
{
    int cnt = p->damagecount, pal;
    if (p->powers[pw_strength])
    {
        int bzc = 12 - (p->powers[pw_strength] >> 6);
        if (bzc > cnt)
            cnt = bzc;
    }
    if (cnt)
    {
        pal = (cnt + 7) >> 3;
        if (pal >= 8) pal = 7;
        return pal + 1;                 // red: 1..8
    }
    if (p->bonuscount)
    {
        pal = (p->bonuscount + 7) >> 3;
        if (pal >= 4) pal = 3;
        return pal + 9;                 // gold: 9..12
    }
    if (p->powers[pw_ironfeet] > 4 * 32 || (p->powers[pw_ironfeet] & 8))
        return 13;                      // radiation suit green
    return 0;
}

static int live_monsters(void)
{
    thinker_t *th;
    int n = 0;
    for (th = thinkercap.next; th != &thinkercap; th = th->next)
    {
        mobj_t *mo;
        if (th->function.acp1 != (actionf_p1) P_MobjThinker)
            continue;
        mo = (mobj_t *) th;
        if (is_monster_type(mo->type) && mo->health > 0)
            n++;
    }
    return n;
}

static void update_state(void)
{
    player_t *p = &players[0];
    mobj_t *mo = p->mo;
    int ammotype;

    memset(state, 0, sizeof(state));
    if (!game_on || mo == NULL)
        return;
    ammotype = weaponinfo[p->readyweapon].ammo;
    state[FS_TIC] = leveltime;
    state[FS_HEALTH] = p->health;
    state[FS_ARMOR] = p->armorpoints;
    state[FS_AMMO] = ammotype == am_noammo ? -1 : p->ammo[ammotype];
    state[FS_WEAPON] = p->readyweapon;
    state[FS_KILLS] = p->killcount;
    state[FS_ITEMS] = p->itemcount;
    state[FS_X] = mo->x;
    state[FS_Y] = mo->y;
    state[FS_Z] = mo->z;
    state[FS_ANGLE] = (int32_t) mo->angle;
    state[FS_DEAD] = p->playerstate == PST_DEAD;
    state[FS_PALETTE] = palette_index(p);
    state[FS_DMG_DEALT] = dmg_dealt;
    state[FS_DMG_TAKEN] = dmg_taken;
    state[FS_SHOTS] = shots;
    state[FS_MONSTERS] = live_monsters();
    state[FS_MOMX] = mo->momx;
    state[FS_MOMY] = mo->momy;
    state[FS_EXITED] = exited;
    state[FS_VIEWZ] = p->viewz;
    state[FS_ARMORTYPE] = p->armortype;
    state[FS_SECRETS] = p->secretcount;
    state[FS_DAMAGECOUNT] = p->damagecount;
    state[FS_BONUSCOUNT] = p->bonuscount;
    state[FS_PENDING] = p->pendingweapon;
    state[FS_MAP] = map_now;
    state[FS_SKILL] = skill_now;
    state[FS_SEED] = (int32_t) fg_seed;
    state[FS_TOTALKILLS] = totalkills;
    state[FS_PLAYER_KILLS] = player_kills;
    state[FS_HITS] = hits;
}

// --- hooks called from the patched engine files -----------------------------------

int fg_new_id(int type)
{
    return is_monster_type(type) ? next_id++ : -1;
}

void fg_on_damage(mobj_t *target, mobj_t *source, int damage)
{
    mobj_t *pmo = players[0].mo;
    int real;
    if (damage <= 0 || target->health <= 0 || pmo == NULL)
        return;
    real = damage < target->health ? damage : target->health;   // overkill does not count
    if (target == pmo)
        dmg_taken += real;
    else if (source == pmo && is_monster_type(target->type))
    {
        dmg_dealt += real;
        hits++;
        if (damage >= target->health)
            player_kills++;
    }
}

void fg_on_shot(player_t *player)
{
    if (player == &players[0])
        shots++;
}

void fg_on_sound(int sfx, int vol, int sep)
{
    if (sound_n >= MAX_SOUNDS)
        return;
    sound_q[sound_n * 3] = sfx;
    sound_q[sound_n * 3 + 1] = vol;
    sound_q[sound_n * 3 + 2] = sep;
    sound_n++;
}

// --- exported API ------------------------------------------------------------------

// Room for the WAD; JavaScript copies it in, then calls fg_init(). Only once.
EXPORT byte *fg_wad_alloc(int size)
{
    if (fg_wad_data != NULL || size < 12)
        return NULL;
    fg_wad_data = malloc(size);
    fg_wad_size = fg_wad_data ? (unsigned int) size : 0;
    return fg_wad_data;
}

static char *fake_argv[] = { "flygym", NULL };

EXPORT int fg_init(void)
{
    int i;
    if (inited)
        return 0;
    if (fg_wad_data == NULL)
        return -1;

    myargc = 1;
    myargv = fake_argv;
    Z_Init();
    V_Init();
    if (W_AddFile("flygym.wad") == NULL)
        return -2;
    W_GenerateHashTable();
    if (W_CheckNumForName("PLAYPAL") < 0 || W_CheckNumForName("MAP01") < 0)
        return -3;

    gamemode = commercial;
    gamemission = doom2;
    gameversion = exe_doom_1_9;
    nomonsters = respawnparm = fastparm = devparm = false;
    deathmatch = 0;
    netgame = false;
    precache = false;              // lumps are read straight from the WAD anyway

    I_InitGraphics();
    R_Init();
    setdetail = 0;
    P_Init();
    S_Init(127, 0);                // full volume scale for the sound events, no music
    HU_Init();
    ST_Init();

    for (i = 0; i < MAXPLAYERS; i++)
        playeringame[i] = i == 0;
    consoleplayer = displayplayer = 0;
    playpal = W_CacheLumpName("PLAYPAL", PU_STATIC);
    inited = 1;
    return 0;
}

// New game on MAPxx (skill 1..5 as in Doom's menu). Returns 0, or <0 if the map
// is missing. The held input is cleared.
EXPORT int fg_new_game(int skill, int map, unsigned int seed)
{
    char name[9];
    player_t *p = &players[0];
    if (!inited)
        return -1;
    if (map < 1 || map > 99)
        return -2;
    M_snprintf(name, sizeof(name), "MAP%02d", map);
    if (W_CheckNumForName(name) < 0)
        return -2;
    if (skill < 1) skill = 1;
    if (skill > 5) skill = 5;

    fg_seed = seed;                // used by M_ClearRandom() inside G_InitNew
    cmd_forward = cmd_side = cmd_turn = cmd_buttons = 0;
    dmg_dealt = dmg_taken = shots = player_kills = hits = 0;
    next_id = 0;
    exited = 0;
    gametic = 0;                   // the revenant's tracer uses gametic
    gameaction = ga_nothing;
    skill_now = skill;
    map_now = map;

    G_InitNew((skill_t) (skill - 1), 1, map);
    gameaction = ga_nothing;
    game_on = 1;

    p->viewz = p->mo->z + p->viewheight;   // otherwise eye height is set by the first tic
    sound_n = 0;                   // nothing heard yet
    update_state();
    return 0;
}

EXPORT void fg_set_player(int x, int y, int angle_deg)
{
    player_t *p = &players[0];
    mobj_t *mo = p->mo;
    if (!game_on || mo == NULL)
        return;
    P_UnsetThingPosition(mo);
    mo->x = x << FRACBITS;
    mo->y = y << FRACBITS;
    P_SetThingPosition(mo);
    mo->floorz = mo->subsector->sector->floorheight;
    mo->ceilingz = mo->subsector->sector->ceilingheight;
    mo->z = mo->floorz;
    mo->momx = mo->momy = mo->momz = 0;
    mo->angle = deg_to_bam(angle_deg);
    p->viewheight = VIEWHEIGHT;
    p->deltaviewheight = 0;
    p->viewz = mo->z + p->viewheight;
    update_state();
}

// weapon < 0, ammo < 0 or health <= 0 leave that part unchanged.
EXPORT void fg_give(int weapon, int ammo, int health)
{
    player_t *p = &players[0];
    if (!game_on || p->mo == NULL)
        return;
    if (weapon >= 0 && weapon < NUMWEAPONS)
    {
        pspdef_t *psp = &p->psprites[ps_weapon];
        p->weaponowned[weapon] = true;
        p->readyweapon = weapon;
        p->pendingweapon = wp_nochange;
        // straight into the ready state, without the raise animation
        psp->state = &states[weaponinfo[weapon].readystate];
        psp->tics = psp->state->tics;
        psp->sx = FRACUNIT;
        psp->sy = 32 * FRACUNIT;    // WEAPONTOP
        p->psprites[ps_flash].state = NULL;
    }
    if (ammo >= 0)
    {
        int w = weapon >= 0 && weapon < NUMWEAPONS ? weapon : (int) p->readyweapon;
        int t = weaponinfo[w].ammo;
        if (t != am_noammo)
            p->ammo[t] = ammo > 9999 ? 9999 : ammo;
    }
    if (health > 0)
        p->health = p->mo->health = health;
    update_state();
}

EXPORT void fg_set_cmd(int forward, int side, int turn, int buttons)
{
    cmd_forward = forward < -50 ? -50 : forward > 50 ? 50 : forward;
    cmd_side = side < -50 ? -50 : side > 50 ? 50 : side;
    cmd_turn = turn < -32768 ? -32768 : turn > 32767 ? 32767 : turn;
    cmd_buttons = buttons & (BT_ATTACK | BT_USE | BT_CHANGE | BT_WEAPONMASK);
}

EXPORT void fg_tick(int n)
{
    player_t *p = &players[0];
    if (!game_on || p->mo == NULL)
        return;
    while (n-- > 0 && !exited)
    {
        ticcmd_t *c = &p->cmd;
        memset(c, 0, sizeof(*c));
        c->forwardmove = (signed char) cmd_forward;
        c->sidemove = (signed char) cmd_side;
        c->angleturn = (short) cmd_turn;
        c->buttons = (byte) cmd_buttons;
        if (p->playerstate == PST_DEAD)
            c->buttons &= ~BT_USE;         // a dead player never respawns
        P_Ticker();
        ST_Ticker();
        HU_Ticker();
        gametic++;
        if (gameaction != ga_nothing)
        {
            if (gameaction == ga_completed)
                exited = 1;                // the game stops here; no intermission
            gameaction = ga_nothing;
        }
    }
    update_state();
}

static void set_view(int w, int h, byte *base)
{
    int i;
    if (w != view_w || h != view_h)
    {
        fg_viewwidth = w;
        fg_viewheight = h;
        setdetail = 0;
        R_ExecuteSetViewSize();
        view_w = w;
        view_h = h;
        view_base = NULL;          // R_InitBuffer overwrote the row table
    }
    if (base != view_base)
    {
        viewwindowx = viewwindowy = 0;
        for (i = 0; i < w; i++)
            columnofs[i] = i;
        for (i = 0; i < h; i++)
            ylookup[i] = base + i * SCREENWIDTH;
        view_base = base;
    }
}

// The player's 3D view at w x h (8..320 x 8..200), as w*h palette indices.
// flags bit 0: also draw the weapon.
EXPORT byte *fg_render(int w, int h, int flags)
{
    int y;
    if (w < 8) w = 8;
    if (w > SCREENWIDTH) w = SCREENWIDTH;
    if (h < 8) h = 8;
    if (h > SCREENHEIGHT) h = SCREENHEIGHT;
    if (!game_on || players[0].mo == NULL)
        return packed;
    set_view(w, h, scratch);
    if (fill >= 0)
        for (y = 0; y < h; y++)
            memset(scratch + y * SCREENWIDTH, fill, w);
    fg_draw_psprites = flags & 1;
    fuzzpos = 0;                   // every frame starts the shimmer pattern afresh
    R_RenderPlayerView(&players[0]);
    fg_draw_psprites = 1;
    if (w == SCREENWIDTH)
        return scratch;
    for (y = 0; y < h; y++)
        memcpy(packed + y * w, scratch + y * SCREENWIDTH, w);
    return packed;
}

// What a human player sees: 320x168 view + weapon + status bar (+ pickup messages).
EXPORT byte *fg_render_full(void)
{
    if (!game_on || players[0].mo == NULL)
        return I_VideoBuffer;
    set_view(SCREENWIDTH, SCREENHEIGHT - ST_HEIGHT, I_VideoBuffer);
    if (fill >= 0)
        memset(I_VideoBuffer, fill, SCREENWIDTH * SCREENHEIGHT);
    fg_draw_psprites = 1;
    fuzzpos = 0;
    R_RenderPlayerView(&players[0]);
    ST_Drawer(false, true);        // redraw the whole bar every time (no history)
    HU_Drawer();
    return I_VideoBuffer;
}

EXPORT byte *fg_palettes(void)
{
    return playpal;
}

EXPORT int32_t *fg_state(void)
{
    return state;
}

EXPORT int fg_state_count(void)
{
    return FS_COUNT;
}

// Spawn a thing on the floor. Returns its id (>= 0), or -1 if the type is not
// allowed or a solid thing does not fit there.
EXPORT int fg_spawn(int type, int x, int y, int angle_deg, int awake)
{
    mobj_t *mo;
    if (!game_on || players[0].mo == NULL)
        return -1;
    if (type <= MT_PLAYER || type >= NUMMOBJTYPES
        || type == MT_BOSSBRAIN || type == MT_BOSSSPIT || type == MT_BOSSTARGET)
        return -1;                 // the Icon of Sin parts need their own map setup
    mo = P_SpawnMobj(x << FRACBITS, y << FRACBITS, ONFLOORZ, type);
    if ((mo->flags & MF_SOLID) && !P_CheckPosition(mo, mo->x, mo->y))
    {
        P_RemoveMobj(mo);
        return -1;
    }
    mo->angle = deg_to_bam(angle_deg);
    // as P_SpawnMapThing does for things placed in a map
    if (mo->tics > 0)
        mo->tics = 1 + (P_Random() % mo->tics);
    if (mo->flags & MF_COUNTKILL)
        totalkills++;
    if (mo->flags & MF_COUNTITEM)
        totalitems++;
    if (mo->fgid < 0)
        mo->fgid = next_id++;
    if (awake && is_monster_type(type) && mo->info->seestate != S_NULL)
    {
        // as A_Look does when it sees the player
        mo->target = players[0].mo;
        mo->threshold = 0;
        if (mo->info->seesound)
        {
            int sound;
            switch (mo->info->seesound)
            {
              case sfx_posit1: case sfx_posit2: case sfx_posit3:
                sound = sfx_posit1 + P_Random() % 3;
                break;
              case sfx_bgsit1: case sfx_bgsit2:
                sound = sfx_bgsit1 + P_Random() % 2;
                break;
              default:
                sound = mo->info->seesound;
                break;
            }
            if (mo->type == MT_SPIDER || mo->type == MT_CYBORG)
                S_StartSound(NULL, sound);
            else
                S_StartSound(mo, sound);
        }
        P_SetMobjState(mo, mo->info->seestate);
    }
    update_state();
    return mo->fgid;
}

// Live monsters as records of 5 ints: type, x, y (16.16), health, id.
// Writes at most max records and returns how many it wrote. all != 0 lists every
// thing instead (player, items, missiles, puffs, corpses...; for tests).
EXPORT int fg_things(int32_t *out, int max, int all)
{
    thinker_t *th;
    int n = 0;
    if (!game_on)
        return 0;
    for (th = thinkercap.next; th != &thinkercap && n < max; th = th->next)
    {
        mobj_t *mo;
        if (th->function.acp1 != (actionf_p1) P_MobjThinker)
            continue;
        mo = (mobj_t *) th;
        if (!all && (!is_monster_type(mo->type) || mo->health <= 0))
            continue;
        out[n * 5] = mo->type;
        out[n * 5 + 1] = mo->x;
        out[n * 5 + 2] = mo->y;
        out[n * 5 + 3] = mo->health;
        out[n * 5 + 4] = mo->fgid;
        n++;
    }
    return n;
}

// Sound events since the last call, as records of 3 ints: sfx id, volume 0..127,
// stereo separation 0..255 (128 = centre, lower = left). Clears the list.
EXPORT int fg_sounds(int32_t *out, int max)
{
    int n = sound_n < max ? sound_n : max;
    memcpy(out, sound_q, n * 3 * sizeof(int32_t));
    sound_n = 0;
    return n;
}

EXPORT int32_t *fg_ints(void)
{
    return ints;
}

// Debug: pre-fill the frame with this colour before drawing (-1 = off), to find
// pixels the renderer never touches.
EXPORT void fg_set_fill(int colour)
{
    fill = colour < 0 ? -1 : colour & 255;
}

// Memory report: zone heap size, zone bytes free (incl. purgable cache), top of the
// C heap, total wasm memory.
EXPORT int32_t *fg_mem_info(void)
{
    static int32_t info[4];
    info[0] = (int32_t) Z_ZoneSize();
    info[1] = Z_FreeMemory();
    info[2] = (int32_t) (intptr_t) sbrk(0);
    info[3] = (int32_t) (__builtin_wasm_memory_size(0) * 65536);
    return info;
}
