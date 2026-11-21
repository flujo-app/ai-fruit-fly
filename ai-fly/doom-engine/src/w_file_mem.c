// FLYGYM: WAD "file" that lives in memory. JavaScript copies the WAD into the
// buffer from fg_wad_alloc(); the engine then reads lumps straight from it
// (mapped, so no lump is ever copied into the zone heap). Replaces w_file_stdc.c.

#include <string.h>

#include "w_file.h"
#include "fg_api.h"

extern wad_file_class_t mem_wad_file;

static wad_file_t mem_file;

static wad_file_t *W_Mem_OpenFile(char *path)
{
    (void) path;
    if (fg_wad_data == NULL || fg_wad_size < 12)
        return NULL;
    mem_file.file_class = &mem_wad_file;
    mem_file.mapped = fg_wad_data;
    mem_file.length = fg_wad_size;
    return &mem_file;
}

static void W_Mem_CloseFile(wad_file_t *wad)
{
    (void) wad;
}

static size_t W_Mem_Read(wad_file_t *wad, unsigned int offset,
                         void *buffer, size_t buffer_len)
{
    if (offset >= wad->length)
        return 0;
    if (buffer_len > wad->length - offset)
        buffer_len = wad->length - offset;
    memcpy(buffer, wad->mapped + offset, buffer_len);
    return buffer_len;
}

wad_file_class_t mem_wad_file =
{
    W_Mem_OpenFile,
    W_Mem_CloseFile,
    W_Mem_Read,
};
