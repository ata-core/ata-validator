#include "ata_fast.h"

#ifdef ATA_V8_FAST_API

#include <v8.h>
#include <v8-fast-api-calls.h>
#include <node_api.h>
#include "ata.h"

#include <cstring>

// Defined in ata_napi.cpp — shared fast slot registry (extern linkage)
extern const size_t MAX_FAST_SLOTS;
extern ata::schema_ref g_fast_schemas[];
extern uint32_t g_fast_slot_count;

// ---------------------------------------------------------------------------
// Helper: extract raw uint8_t* and length from a V8 TypedArray Local<Value>
// ---------------------------------------------------------------------------
static inline bool extract_typed_array(v8::Isolate* isolate,
                                       v8::Local<v8::Value> val,
                                       const uint8_t*& out_data,
                                       size_t& out_len) {
  if (!val->IsTypedArray()) return false;
  v8::HandleScope scope(isolate);
  auto ta = val.As<v8::TypedArray>();
  auto backing = ta->Buffer()->GetBackingStore();
  out_data = static_cast<const uint8_t*>(backing->Data()) + ta->ByteOffset();
  out_len = ta->ByteLength();
  return true;
}

// ===========================================================================
// FastIsValid — V8 CFunction: (slot, buf) -> bool
// ===========================================================================

static bool FastIsValid(v8::Local<v8::Value> receiver,
                        uint32_t slot,
                        v8::Local<v8::Value> buf_val,
                        v8::FastApiCallbackOptions& options) {
  if (slot >= g_fast_slot_count || !g_fast_schemas[slot]) return false;

  const uint8_t* data;
  size_t len;
  if (!extract_typed_array(options.isolate, buf_val, data, len)) return false;

  return ata::is_valid_buf(g_fast_schemas[slot], data, len);
}

static void SlowIsValid(const v8::FunctionCallbackInfo<v8::Value>& info) {
  v8::Isolate* isolate = info.GetIsolate();
  if (info.Length() < 2) { info.GetReturnValue().Set(false); return; }

  uint32_t slot = info[0]->Uint32Value(isolate->GetCurrentContext()).FromJust();
  if (slot >= g_fast_slot_count || !g_fast_schemas[slot]) {
    info.GetReturnValue().Set(false);
    return;
  }

  if (info[1]->IsTypedArray()) {
    auto ta = info[1].As<v8::TypedArray>();
    auto backing = ta->Buffer()->GetBackingStore();
    const uint8_t* data = static_cast<const uint8_t*>(backing->Data()) + ta->ByteOffset();
    info.GetReturnValue().Set(ata::is_valid_buf(g_fast_schemas[slot], data, ta->ByteLength()));
    return;
  }

  if (info[1]->IsString()) {
    v8::String::Utf8Value utf8(isolate, info[1]);
    if (*utf8) {
      info.GetReturnValue().Set(
          ata::is_valid_buf(g_fast_schemas[slot],
                            reinterpret_cast<const uint8_t*>(*utf8), utf8.length()));
      return;
    }
  }

  info.GetReturnValue().Set(false);
}

// ===========================================================================
// FastNDJSONCount — V8 CFunction: (slot, buf) -> uint32_t
// ===========================================================================

static uint32_t FastNDJSONCount(v8::Local<v8::Value> receiver,
                                uint32_t slot,
                                v8::Local<v8::Value> buf_val,
                                v8::FastApiCallbackOptions& options) {
  if (slot >= g_fast_slot_count || !g_fast_schemas[slot]) return 0;

  const uint8_t* raw;
  size_t total;
  if (!extract_typed_array(options.isolate, buf_val, raw, total)) return 0;

  const char* start = reinterpret_cast<const char*>(raw);
  const char* end = start + total;
  uint32_t valid = 0;

  while (start < end) {
    const char* nl = static_cast<const char*>(std::memchr(start, '\n', end - start));
    size_t line_len = nl ? static_cast<size_t>(nl - start) : static_cast<size_t>(end - start);
    if (line_len > 0) {
      if (ata::is_valid_buf(g_fast_schemas[slot],
                            reinterpret_cast<const uint8_t*>(start), line_len)) {
        valid++;
      }
    }
    start += line_len + 1;
  }
  return valid;
}

static void SlowNDJSONCount(const v8::FunctionCallbackInfo<v8::Value>& info) {
  v8::Isolate* isolate = info.GetIsolate();
  if (info.Length() < 2) { info.GetReturnValue().Set(0u); return; }

  uint32_t slot = info[0]->Uint32Value(isolate->GetCurrentContext()).FromJust();
  if (slot >= g_fast_slot_count || !g_fast_schemas[slot] || !info[1]->IsTypedArray()) {
    info.GetReturnValue().Set(0u);
    return;
  }

  auto ta = info[1].As<v8::TypedArray>();
  auto backing = ta->Buffer()->GetBackingStore();
  const char* data = static_cast<const char*>(backing->Data()) + ta->ByteOffset();
  size_t total = ta->ByteLength();

  uint32_t valid = 0;
  const char* start = data;
  const char* end = data + total;

  while (start < end) {
    const char* nl = static_cast<const char*>(std::memchr(start, '\n', end - start));
    size_t line_len = nl ? static_cast<size_t>(nl - start) : static_cast<size_t>(end - start);
    if (line_len > 0) {
      if (ata::is_valid_buf(g_fast_schemas[slot],
                            reinterpret_cast<const uint8_t*>(start), line_len)) {
        valid++;
      }
    }
    start += line_len + 1;
  }

  info.GetReturnValue().Set(valid);
}

// ===========================================================================
// FastBatchValidate — V8 CFunction: (slot, concat, offsets, count) -> uint32_t
// ===========================================================================

static uint32_t FastBatchValidate(v8::Local<v8::Value> receiver,
                                  uint32_t slot,
                                  v8::Local<v8::Value> concat_val,
                                  v8::Local<v8::Value> offsets_val,
                                  uint32_t count,
                                  v8::FastApiCallbackOptions& options) {
  if (slot >= g_fast_slot_count || !g_fast_schemas[slot]) return 0;

  v8::HandleScope scope(options.isolate);

  if (!concat_val->IsTypedArray() || !offsets_val->IsTypedArray()) return 0;

  auto buf_ta = concat_val.As<v8::TypedArray>();
  auto off_ta = offsets_val.As<v8::TypedArray>();

  auto buf_store = buf_ta->Buffer()->GetBackingStore();
  auto off_store = off_ta->Buffer()->GetBackingStore();

  const uint8_t* buf_data = static_cast<const uint8_t*>(buf_store->Data()) + buf_ta->ByteOffset();
  const int32_t* off_data = reinterpret_cast<const int32_t*>(
      static_cast<const uint8_t*>(off_store->Data()) + off_ta->ByteOffset());

  size_t buf_len = buf_ta->ByteLength();
  uint32_t valid = 0;

  for (uint32_t i = 0; i < count; i++) {
    int32_t start = off_data[i];
    int32_t end_pos = (i + 1 < count) ? off_data[i + 1] : static_cast<int32_t>(buf_len);
    if (start < 0 || end_pos <= start || static_cast<size_t>(end_pos) > buf_len) continue;
    if (ata::is_valid_buf(g_fast_schemas[slot],
                          buf_data + start,
                          static_cast<size_t>(end_pos - start))) {
      valid++;
    }
  }
  return valid;
}

static void SlowBatchValidate(const v8::FunctionCallbackInfo<v8::Value>& info) {
  v8::Isolate* isolate = info.GetIsolate();
  if (info.Length() < 4) { info.GetReturnValue().Set(0u); return; }

  uint32_t slot = info[0]->Uint32Value(isolate->GetCurrentContext()).FromJust();
  uint32_t count = info[3]->Uint32Value(isolate->GetCurrentContext()).FromJust();

  if (slot >= g_fast_slot_count || !g_fast_schemas[slot] ||
      !info[1]->IsTypedArray() || !info[2]->IsTypedArray()) {
    info.GetReturnValue().Set(0u);
    return;
  }

  auto buf_ta = info[1].As<v8::TypedArray>();
  auto off_ta = info[2].As<v8::TypedArray>();

  auto buf_store = buf_ta->Buffer()->GetBackingStore();
  auto off_store = off_ta->Buffer()->GetBackingStore();

  const uint8_t* buf = static_cast<const uint8_t*>(buf_store->Data()) + buf_ta->ByteOffset();
  const int32_t* offs = reinterpret_cast<const int32_t*>(
      static_cast<const uint8_t*>(off_store->Data()) + off_ta->ByteOffset());
  size_t buf_len = buf_ta->ByteLength();

  uint32_t valid = 0;
  for (uint32_t i = 0; i < count; i++) {
    int32_t start = offs[i];
    int32_t end_pos = (i + 1 < count) ? offs[i + 1] : static_cast<int32_t>(buf_len);
    if (start < 0 || end_pos <= start || static_cast<size_t>(end_pos) > buf_len) continue;
    if (ata::is_valid_buf(g_fast_schemas[slot], buf + start,
                          static_cast<size_t>(end_pos - start))) {
      valid++;
    }
  }

  info.GetReturnValue().Set(valid);
}

// ===========================================================================
// Registration — attach CFunction fast paths to exports via V8 API
// ===========================================================================

namespace ata_fast {

void Register(Napi::Env env, Napi::Object exports) {
  v8::Isolate* isolate = v8::Isolate::GetCurrent();
  v8::Local<v8::Context> context = isolate->GetCurrentContext();

  // Bridge NAPI exports to V8 Local<Object>
  napi_value napi_exports = exports;
  v8::Local<v8::Object> v8_exports =
      v8::Local<v8::Object>::Cast(
          *reinterpret_cast<v8::Local<v8::Value>*>(&napi_exports));

  // isValid(slot, buf) -> bool
  {
    static v8::CFunction fast_fn = v8::CFunction::Make(FastIsValid);
    auto tmpl = v8::FunctionTemplate::New(
        isolate, SlowIsValid, v8::Local<v8::Value>(),
        v8::Local<v8::Signature>(), 0,
        v8::ConstructorBehavior::kThrow,
        v8::SideEffectType::kHasNoSideEffect,
        &fast_fn);
    v8_exports->Set(context,
        v8::String::NewFromUtf8Literal(isolate, "v8IsValid"),
        tmpl->GetFunction(context).ToLocalChecked()).Check();
  }

  // ndjsonCount(slot, buf) -> uint32
  {
    static v8::CFunction fast_fn = v8::CFunction::Make(FastNDJSONCount);
    auto tmpl = v8::FunctionTemplate::New(
        isolate, SlowNDJSONCount, v8::Local<v8::Value>(),
        v8::Local<v8::Signature>(), 0,
        v8::ConstructorBehavior::kThrow,
        v8::SideEffectType::kHasNoSideEffect,
        &fast_fn);
    v8_exports->Set(context,
        v8::String::NewFromUtf8Literal(isolate, "v8NDJSONCount"),
        tmpl->GetFunction(context).ToLocalChecked()).Check();
  }

  // batchValidate(slot, concat, offsets, count) -> uint32
  {
    static v8::CFunction fast_fn = v8::CFunction::Make(FastBatchValidate);
    auto tmpl = v8::FunctionTemplate::New(
        isolate, SlowBatchValidate, v8::Local<v8::Value>(),
        v8::Local<v8::Signature>(), 0,
        v8::ConstructorBehavior::kThrow,
        v8::SideEffectType::kHasNoSideEffect,
        &fast_fn);
    v8_exports->Set(context,
        v8::String::NewFromUtf8Literal(isolate, "v8BatchValidate"),
        tmpl->GetFunction(context).ToLocalChecked()).Check();
  }
}

}  // namespace ata_fast

#endif  // ATA_V8_FAST_API
