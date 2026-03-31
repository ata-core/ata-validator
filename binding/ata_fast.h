#pragma once

#include <napi.h>

#ifdef ATA_V8_FAST_API

namespace ata_fast {

// Register CFunction fast paths on the exports object.
// Must be called from Init() after fast slots are available.
void Register(Napi::Env env, Napi::Object exports);

}  // namespace ata_fast

#endif  // ATA_V8_FAST_API
