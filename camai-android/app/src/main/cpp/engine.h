// CamAI inference engine: a thin, platform-independent layer over llama.cpp.
// The JNI bridge (jni_bridge.cpp) exposes it to Kotlin; desktop tests link it directly.
#pragma once

#include <functional>
#include <string>
#include <vector>

namespace camai {

struct Msg {
    std::string role;     // "system" | "user" | "assistant"
    std::string content;
};

struct GenParams {
    float temp           = 0.7f;
    float top_p          = 0.9f;
    int   top_k          = 40;
    float min_p          = 0.05f;
    float repeat_penalty = 1.1f;
    int   max_tokens     = 512;
    bool  thinking       = false;  // let reasoning models "think" before answering
};

struct GenStats {
    int         prompt_tokens    = 0;
    int         reused_tokens    = 0;  // prompt tokens served from the KV cache
    int         gen_tokens       = 0;
    int         dropped_messages = 0;  // oldest messages left out to fit the context
    double      prompt_ms        = 0;
    double      gen_ms           = 0;
    std::string stop_reason;           // eos | length | stopped | context_full | error
    std::string error;

    std::string to_json() const;
};

// Called with each new piece of text (always complete UTF-8). Return false to stop.
using TokenCallback = std::function<bool(const std::string &)>;

void        backend_init(const std::string & native_lib_dir);
// kv_q8: store the conversation memory (KV cache) in 8-bit, halving its RAM use.
std::string load(const std::string & path, int n_ctx, int n_threads, bool kv_q8 = false, int n_batch = 256);  // "" on success, else a readable error
void        unload();
bool        is_loaded();
std::string model_info_json();
void        set_threads(int n_threads);
void        request_stop();  // safe to call from any thread
GenStats    generate(const std::vector<Msg> & messages, const GenParams & params, const TokenCallback & on_text);
std::string bench_threads_json(const std::vector<int> & thread_counts, int n_tokens);

// Smart Fit: simulate (without reading weights) how much RAM the model needs for each
// context size, with and without 8-bit KV memory. Returns JSON.
std::string plan_json(const std::string & path, const std::vector<int> & ctx_sizes);

// Instant Resume: persist the current conversation state (tokens, KV/recurrent state and
// checkpoints) so a chat can continue later without re-reading it.
bool save_session(const std::string & path);
bool load_session(const std::string & path);
int  cached_tokens();

}  // namespace camai
