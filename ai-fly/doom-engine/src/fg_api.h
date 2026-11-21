// FLYGYM: shared declarations between the fly gym driver (fg_api.c) and the few
// places in the engine that were patched to call it. Not part of doomgeneric.

#ifndef FG_API_H
#define FG_API_H

#include "doomtype.h"

struct mobj_s;
struct player_s;

// JavaScript import (module "env", name "fg_error"): receives the I_Error text
// just before the engine stops itself with a trap.
__attribute__((import_module("env"), import_name("fg_error")))
void fg_js_error(const char *msg);

extern unsigned int fg_seed;        // m_random.c: start of both random streams
extern int fg_draw_psprites;        // r_things.c: draw the weapon or not
extern int fg_viewwidth;            // r_main.c: explicit view size (0 = classic)
extern int fg_viewheight;

extern byte *fg_wad_data;           // fg_api.c: the WAD that JavaScript copied in
extern unsigned int fg_wad_size;

int  fg_new_id(int mobjtype);                   // p_mobj.c: id for a new thing
void fg_on_damage(struct mobj_s *target, struct mobj_s *source, int damage);  // p_inter.c
void fg_on_shot(struct player_s *player);       // p_pspr.c
void fg_on_sound(int sfx, int vol, int sep);    // s_sound.c

#endif
