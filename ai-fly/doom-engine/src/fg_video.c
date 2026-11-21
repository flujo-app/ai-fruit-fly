// FLYGYM: headless replacement for doomgeneric's i_video.c and for the platform
// functions (DG_*) a doomgeneric port has to provide. There is no window, no
// keyboard, no clock: the screen is a plain 320x200 array of palette indices that
// fg_render_full() hands to JavaScript, and the palette is applied by the caller.

#include <string.h>

#include "doomtype.h"
#include "doomgeneric.h"
#include "i_video.h"

static byte screen[SCREENWIDTH * SCREENHEIGHT];

byte *I_VideoBuffer = screen;
boolean screensaver_mode = false;
boolean screenvisible = true;
float mouse_acceleration = 2.0;
int mouse_threshold = 10;
int usegamma = 0;
int usemouse = 0;
int fb_scaling = 1;
boolean palette_changed;
struct color colors[256];

void I_InitGraphics (void) { I_VideoBuffer = screen; }
void I_ShutdownGraphics (void) {}
void I_StartFrame (void) {}
void I_StartTic (void) {}
void I_UpdateNoBlit (void) {}
void I_FinishUpdate (void) {}
void I_ReadScreen (byte *scr) { memcpy(scr, I_VideoBuffer, SCREENWIDTH * SCREENHEIGHT); }
void I_SetPalette (byte *palette) { (void) palette; }   // the caller applies PLAYPAL itself
int  I_GetPaletteIndex (int r, int g, int b) { (void) r; (void) g; (void) b; return 0; }
void I_BeginRead (void) {}
void I_EndRead (void) {}
void I_SetWindowTitle (char *title) { (void) title; }
void I_GraphicsCheckCommandLine (void) {}
void I_SetGrabMouseCallback (grabmouse_callback_t func) { (void) func; }
void I_EnableLoadingDisk (void) {}
void I_BindVideoVariables (void) {}
void I_DisplayFPSDots (boolean dots_on) { (void) dots_on; }
void I_CheckIsScreensaver (void) {}
void I_InitWindowTitle (void) {}
void I_InitWindowIcon (void) {}

// doomgeneric platform hooks: nothing happens, time stands still.
void DG_Init (void) {}
void DG_DrawFrame (void) {}
void DG_SleepMs (uint32_t ms) { (void) ms; }
uint32_t DG_GetTicksMs (void) { return 0; }
int  DG_GetKey (int *pressed, unsigned char *key) { (void) pressed; (void) key; return 0; }
void DG_SetWindowTitle (const char *title) { (void) title; }
