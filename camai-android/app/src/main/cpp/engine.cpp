#include "engine.h"

#include <algorithm>
#include <atomic>
#include <cctype>
#include <cstdio>
#include <sstream>

#include "chat.h"
#include "common.h"
#include "ggml-backend.h"
#include "llama.h"
#include "sampling.h"

namespace camai {

namespace {

constexpr int N_BATCH = 256;  // smaller batches keep peak memory down on 4 GB phones

llama_model *              g_model   = nullptr;
llama_context *            g_ctx     = nullptr;
common_chat_templates_ptr  g_tmpls;
std::vector<llama_token>   g_cache;  // exactly the tokens currently held in the KV cache (sequence 0)
std::atomic<bool>          g_stop{ false };
int                        g_n_ctx     = 0;
int                        g_n_threads = 4;
bool                       g_needs_checkpoints = false;  // memory that cannot be rewound (recurrent / hybrid / SWA)

// Saved non-rewindable state at the end of a user turn, so the next turn (or a
// regenerate) can resume from there instead of re-reading the whole chat.
struct Checkpoint {
    std::vector<llama_token> tokens;  // the prompt prefix this state corresponds to
    std::vector<uint8_t>     data;
};
constexpr size_t           MAX_CHECKPOINTS = 2;
std::vector<Checkpoint>    g_checkpoints;

std::string json_escape(const std::string & s) {
    std::string out;
    out.reserve(s.size() + 8);
    for (unsigned char c : s) {
        switch (c) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (c < 0x20) {
                    char buf[8];
                    snprintf(buf, sizeof(buf), "\\u%04x", c);
                    out += buf;
                } else {
                    out += (char) c;
                }
        }
    }
    return out;
}

// Length of the longest prefix of s that ends on a complete UTF-8 character.
size_t utf8_complete_prefix(const std::string & s) {
    size_t n = s.size();
    // Walk back over at most 3 continuation bytes to the start of the last character.
    size_t i = n;
    int    cont = 0;
    while (i > 0 && cont < 4) {
        unsigned char c = (unsigned char) s[i - 1];
        if ((c & 0xC0) == 0x80) {
            cont++;
            i--;
            continue;
        }
        int need = (c & 0x80) == 0 ? 1 : (c & 0xE0) == 0xC0 ? 2 : (c & 0xF0) == 0xE0 ? 3 : (c & 0xF8) == 0xF0 ? 4 : 1;
        return (cont + 1 >= need) ? n : i - 1;
    }
    return n;
}

std::string chatml_fallback(const std::vector<Msg> & msgs) {
    std::string out;
    for (const auto & m : msgs) {
        out += "<|im_start|>" + m.role + "\n" + m.content + "<|im_end|>\n";
    }
    return out + "<|im_start|>assistant\n";
}

struct Rendered {
    std::string              prompt;
    std::vector<std::string> stops;
    std::string              open_think_tag;  // set when the template already opened a reasoning block
};

// Render the conversation with the model's own chat template.
Rendered render_prompt(const std::vector<Msg> & msgs, bool thinking, bool add_generation_prompt = true) {
    common_chat_templates_inputs in;
    for (const auto & m : msgs) {
        common_chat_msg cm;
        cm.role    = m.role;
        cm.content = m.content;
        in.messages.push_back(cm);
    }
    in.add_generation_prompt = add_generation_prompt;
    in.enable_thinking       = thinking;
    Rendered out;
    for (bool jinja : { true, false }) {
        try {
            in.use_jinja = jinja;
            auto r       = common_chat_templates_apply(g_tmpls.get(), in);
            out.prompt   = r.prompt;
            out.stops    = r.additional_stops;
            if (thinking && !r.thinking_start_tag.empty()) {
                std::string tail = out.prompt;
                while (!tail.empty() && isspace((unsigned char) tail.back())) {
                    tail.pop_back();
                }
                const std::string tag = r.thinking_start_tag;
                if (tail.size() >= tag.size() && tail.compare(tail.size() - tag.size(), tag.size(), tag) == 0) {
                    out.open_think_tag = tag;
                }
            }
            return out;
        } catch (...) {
        }
    }
    out.prompt = chatml_fallback(msgs);
    out.stops  = { "<|im_end|>" };
    if (!add_generation_prompt) {
        out.prompt.erase(out.prompt.size() - std::string("<|im_start|>assistant\n").size());
    }
    return out;
}

bool starts_with_tokens(const std::vector<llama_token> & a, const std::vector<llama_token> & prefix) {
    return prefix.size() <= a.size() && std::equal(prefix.begin(), prefix.end(), a.begin());
}

void save_checkpoint(const std::vector<llama_token> & tokens) {
    const auto flags = LLAMA_STATE_SEQ_FLAGS_PARTIAL_ONLY;
    Checkpoint cp;
    cp.tokens = tokens;
    cp.data.resize(llama_state_seq_get_size_ext(g_ctx, 0, flags));
    if (cp.data.empty() || llama_state_seq_get_data_ext(g_ctx, cp.data.data(), cp.data.size(), 0, flags) != cp.data.size()) {
        return;
    }
    g_checkpoints.erase(std::remove_if(g_checkpoints.begin(), g_checkpoints.end(),
                                       [&](const Checkpoint & c) { return c.tokens.size() >= tokens.size(); }),
                        g_checkpoints.end());
    if (g_checkpoints.size() >= MAX_CHECKPOINTS) {
        g_checkpoints.erase(g_checkpoints.begin());
    }
    g_checkpoints.push_back(std::move(cp));
}

// Make the KV cache hold exactly prompt[0, n) for the largest n we can manage; returns n.
size_t rewind_cache(const std::vector<llama_token> & prompt, size_t n_keep) {
    auto * mem = llama_get_memory(g_ctx);
    if (n_keep >= g_cache.size()) {
        return n_keep;
    }
    if (llama_memory_seq_rm(mem, 0, (llama_pos) n_keep, -1)) {
        g_cache.resize(n_keep);
        return n_keep;
    }
    // Cannot cut mid-way: restore the newest checkpoint that still matches this prompt.
    for (auto it = g_checkpoints.rbegin(); it != g_checkpoints.rend(); ++it) {
        if (it->tokens.size() > n_keep || !starts_with_tokens(prompt, it->tokens)) {
            continue;
        }
        const auto flags = LLAMA_STATE_SEQ_FLAGS_PARTIAL_ONLY;
        if (llama_state_seq_set_data_ext(g_ctx, it->data.data(), it->data.size(), 0, flags) == it->data.size() &&
            llama_memory_seq_rm(mem, 0, (llama_pos) it->tokens.size(), -1)) {
            const size_t n = it->tokens.size();
            g_cache.resize(n);
            g_checkpoints.erase(std::remove_if(g_checkpoints.begin(), g_checkpoints.end(),
                                               [&](const Checkpoint & c) { return c.tokens.size() > n; }),
                                g_checkpoints.end());
            return n;
        }
        break;
    }
    llama_memory_clear(mem, true);
    g_cache.clear();
    g_checkpoints.clear();
    return 0;
}

void free_context() {
    if (g_ctx) {
        llama_free(g_ctx);
        g_ctx = nullptr;
    }
    g_cache.clear();
    g_checkpoints.clear();
}

}  // namespace

std::string GenStats::to_json() const {
    std::ostringstream o;
    o << "{\"prompt_tokens\":" << prompt_tokens << ",\"reused_tokens\":" << reused_tokens
      << ",\"gen_tokens\":" << gen_tokens << ",\"dropped_messages\":" << dropped_messages
      << ",\"prompt_ms\":" << (long long) prompt_ms << ",\"gen_ms\":" << (long long) gen_ms << ",\"stop_reason\":\""
      << json_escape(stop_reason) << "\",\"error\":\"" << json_escape(error) << "\"}";
    return o.str();
}

void backend_init(const std::string & native_lib_dir) {
    if (native_lib_dir.empty()) {
        ggml_backend_load_all();
    } else {
        ggml_backend_load_all_from_path(native_lib_dir.c_str());
    }
    llama_backend_init();
}

std::string load(const std::string & path, int n_ctx, int n_threads) {
    unload();

    auto mp         = llama_model_default_params();
    mp.n_gpu_layers = 0;
    mp.load_mode    = LLAMA_LOAD_MODE_MMAP;  // weights are paged in from storage instead of copied into RAM
    g_model         = llama_model_load_from_file(path.c_str(), mp);
    if (!g_model) {
        return "Could not read this model file. It may be incomplete, corrupt, or an unsupported type.";
    }

    const int n_train = llama_model_n_ctx_train(g_model);
    if (n_train > 0 && n_ctx > n_train) {
        n_ctx = n_train;
    }

    auto cp            = llama_context_default_params();
    cp.n_ctx           = n_ctx;
    cp.n_batch         = N_BATCH;
    cp.n_ubatch        = N_BATCH;
    cp.n_threads       = n_threads;
    cp.n_threads_batch = n_threads;
    g_ctx              = llama_init_from_model(g_model, cp);
    if (!g_ctx) {
        llama_model_free(g_model);
        g_model = nullptr;
        return "Not enough memory to start this model. Try a smaller model or a smaller context size in Settings.";
    }
    g_n_ctx             = (int) llama_n_ctx(g_ctx);
    g_n_threads         = n_threads;
    g_needs_checkpoints = llama_model_is_recurrent(g_model) || llama_model_is_hybrid(g_model) || llama_model_n_swa(g_model) > 0;

    try {
        g_tmpls = common_chat_templates_init(g_model, "");
    } catch (...) {
        g_tmpls.reset();
    }
    if (!g_tmpls) {
        unload();
        return "This model's chat format could not be read.";
    }
    return "";
}

void unload() {
    free_context();
    g_tmpls.reset();
    if (g_model) {
        llama_model_free(g_model);
        g_model = nullptr;
    }
}

bool is_loaded() {
    return g_ctx != nullptr;
}

std::string model_info_json() {
    if (!g_model) {
        return "{}";
    }
    char desc[256] = { 0 };
    llama_model_desc(g_model, desc, sizeof(desc));
    std::ostringstream o;
    o << "{\"desc\":\"" << json_escape(desc) << "\",\"size_bytes\":" << llama_model_size(g_model)
      << ",\"n_params\":" << llama_model_n_params(g_model) << ",\"n_ctx\":" << g_n_ctx
      << ",\"n_ctx_train\":" << llama_model_n_ctx_train(g_model) << ",\"threads\":" << g_n_threads
      << ",\"recurrent\":" << ((llama_model_is_recurrent(g_model) || llama_model_is_hybrid(g_model)) ? "true" : "false")
      << ",\"system\":\"" << json_escape(llama_print_system_info()) << "\"}";
    return o.str();
}

void set_threads(int n_threads) {
    g_n_threads = n_threads;
    if (g_ctx) {
        llama_set_n_threads(g_ctx, n_threads, n_threads);
    }
}

void request_stop() {
    g_stop = true;
}

GenStats generate(const std::vector<Msg> & messages, const GenParams & p, const TokenCallback & on_text) {
    GenStats st;
    g_stop = false;
    if (!g_ctx) {
        st.stop_reason = "error";
        st.error       = "No model is loaded.";
        return st;
    }
    const llama_vocab * vocab = llama_model_get_vocab(g_model);

    // Fit the conversation into the context window, leaving room for the reply.
    // When it overflows, drop the oldest turns down to ~2/3 of the budget so the
    // following turns can reuse the cache instead of re-trimming every time.
    const int max_new = std::max(16, std::min(p.max_tokens, g_n_ctx / 2));
    const int budget  = g_n_ctx - max_new;
    std::vector<Msg>         msgs = messages;
    Rendered                 rendered;
    std::vector<llama_token> prompt;
    bool                     trimming = false;
    while (true) {
        rendered = render_prompt(msgs, p.thinking);
        prompt   = common_tokenize(vocab, rendered.prompt, true, true);
        const int limit = trimming ? budget * 2 / 3 : budget;
        if ((int) prompt.size() <= limit) {
            break;
        }
        const size_t first = (!msgs.empty() && msgs[0].role == "system") ? 1 : 0;
        if (msgs.size() - first <= 1) {
            if ((int) prompt.size() <= budget) {
                break;
            }
            st.stop_reason = "error";
            st.error       = "This message is too long for the model's memory. Shorten it, or raise the context size in Settings.";
            return st;
        }
        trimming = true;
        msgs.erase(msgs.begin() + first);
        st.dropped_messages++;
        // A conversation must not start with an assistant turn.
        while (msgs.size() - first > 1 && msgs[first].role == "assistant") {
            msgs.erase(msgs.begin() + first);
            st.dropped_messages++;
        }
    }
    st.prompt_tokens = (int) prompt.size();

    const std::vector<std::string> & stops = rendered.stops;

    // Where the conversation ends and the reply header begins: a good place for a
    // checkpoint, because the next turn's prompt will start with exactly these tokens.
    size_t n_stable = 0;
    if (g_needs_checkpoints) {
        auto stable = common_tokenize(vocab, render_prompt(msgs, p.thinking, false).prompt, true, true);
        if (!stable.empty() && stable.size() < prompt.size() && starts_with_tokens(prompt, stable)) {
            n_stable = stable.size();
        }
    }

    // Reuse the longest shared prefix with what is already in the KV cache.
    size_t n_keep = 0;
    while (n_keep < g_cache.size() && n_keep < prompt.size() && g_cache[n_keep] == prompt[n_keep]) {
        n_keep++;
    }
    if (n_keep == prompt.size() && n_keep > 0) {
        n_keep--;  // the last prompt token must be re-evaluated to get fresh logits
    }
    auto * mem       = llama_get_memory(g_ctx);
    n_keep           = rewind_cache(prompt, n_keep);
    st.reused_tokens = (int) n_keep;

    llama_batch batch   = llama_batch_init(N_BATCH, 0, 1);
    const auto  t_start = ggml_time_us();
    for (size_t i = n_keep; i < prompt.size();) {
        if (g_stop) {
            llama_batch_free(batch);
            st.stop_reason = "stopped";
            st.prompt_ms   = (ggml_time_us() - t_start) / 1000.0;
            return st;
        }
        common_batch_clear(batch);
        size_t end = std::min(prompt.size(), i + N_BATCH);
        if (n_stable > i && n_stable < end) {
            end = n_stable;  // stop exactly at the checkpoint position
        }
        for (size_t k = i; k < end; k++) {
            common_batch_add(batch, prompt[k], (llama_pos) k, { 0 }, k == prompt.size() - 1);
        }
        if (llama_decode(g_ctx, batch) != 0) {
            llama_batch_free(batch);
            llama_memory_clear(mem, true);
            g_cache.clear();
            g_checkpoints.clear();
            st.stop_reason = "error";
            st.error       = "The model failed while reading the conversation (possibly out of memory).";
            return st;
        }
        g_cache.insert(g_cache.end(), prompt.begin() + i, prompt.begin() + end);
        if (end == n_stable) {
            save_checkpoint(g_cache);
        }
        i = end;
    }
    const auto t_prompt_done = ggml_time_us();
    st.prompt_ms             = (t_prompt_done - t_start) / 1000.0;

    common_params_sampling sp;
    sp.temp           = p.temp;
    sp.top_p          = p.top_p;
    sp.top_k          = p.top_k;
    sp.min_p          = p.min_p;
    sp.penalty_repeat = p.repeat_penalty;
    sp.penalty_last_n = 64;
    common_sampler * smpl = common_sampler_init(g_model, sp);

    std::string pending;  // bytes of an incomplete UTF-8 character
    std::string out;      // everything emitted so far, for stop-string checks
    if (!rendered.open_think_tag.empty()) {
        on_text(rendered.open_think_tag);  // the template opened the reasoning block; show it to the app
    }
    llama_pos   pos = (llama_pos) prompt.size();
    st.stop_reason  = "length";
    while (st.gen_tokens < max_new) {
        if (g_stop) {
            st.stop_reason = "stopped";
            break;
        }
        if (pos >= g_n_ctx) {
            st.stop_reason = "context_full";
            break;
        }
        const llama_token tok = common_sampler_sample(smpl, g_ctx, -1);
        common_sampler_accept(smpl, tok, true);
        if (llama_vocab_is_eog(vocab, tok)) {
            st.stop_reason = "eos";
            break;
        }
        st.gen_tokens++;

        // special=true keeps tags like <think> visible so the app can show reasoning separately.
        pending += common_token_to_piece(g_ctx, tok, true);
        const size_t ready = utf8_complete_prefix(pending);
        if (ready > 0) {
            std::string piece = pending.substr(0, ready);
            pending.erase(0, ready);
            const size_t before = out.size();
            out += piece;
            bool hit_stop = false;
            for (const auto & s : stops) {
                if (s.empty()) {
                    continue;
                }
                const size_t from = before >= s.size() ? before - s.size() + 1 : 0;
                const size_t at   = out.find(s, from);
                if (at != std::string::npos) {
                    piece    = at > before ? out.substr(before, at - before) : "";
                    hit_stop = true;
                    break;
                }
            }
            if (!piece.empty() && !on_text(piece)) {
                st.stop_reason = "stopped";
                break;
            }
            if (hit_stop) {
                st.stop_reason = "eos";
                break;
            }
        }

        // Feed the token back so the next one can be predicted.
        common_batch_clear(batch);
        common_batch_add(batch, tok, pos, { 0 }, true);
        if (llama_decode(g_ctx, batch) != 0) {
            st.stop_reason = "error";
            st.error       = "The model failed while writing (possibly out of memory).";
            break;
        }
        g_cache.push_back(tok);
        pos++;
    }
    st.gen_ms = (ggml_time_us() - t_prompt_done) / 1000.0;

    common_sampler_free(smpl);
    llama_batch_free(batch);
    return st;
}

std::string bench_threads_json(const std::vector<int> & thread_counts, int n_tokens) {
    if (!g_ctx) {
        return "{}";
    }
    const llama_vocab * vocab  = llama_model_get_vocab(g_model);
    auto                prompt = common_tokenize(vocab, "The quick brown fox jumps over the lazy dog.", true, false);
    auto *              mem    = llama_get_memory(g_ctx);
    llama_batch         batch  = llama_batch_init(N_BATCH, 0, 1);

    std::ostringstream o;
    o << "{";
    bool first = true;
    for (int n : thread_counts) {
        llama_set_n_threads(g_ctx, n, n);
        llama_memory_clear(mem, true);
        common_batch_clear(batch);
        for (size_t k = 0; k < prompt.size(); k++) {
            common_batch_add(batch, prompt[k], (llama_pos) k, { 0 }, k == prompt.size() - 1);
        }
        llama_decode(g_ctx, batch);
        // One warm-up token, then time single-token decodes (the cost of writing a reply).
        llama_pos pos = (llama_pos) prompt.size();
        int64_t   t0  = 0;
        for (int i = 0; i <= n_tokens; i++) {
            if (i == 1) {
                t0 = ggml_time_us();
            }
            common_batch_clear(batch);
            common_batch_add(batch, prompt[i % prompt.size()], pos++, { 0 }, true);
            llama_decode(g_ctx, batch);
        }
        const double tps = n_tokens / ((ggml_time_us() - t0) / 1e6);
        o << (first ? "" : ",") << "\"" << n << "\":" << tps;
        first = false;
    }
    o << "}";
    llama_batch_free(batch);
    llama_memory_clear(mem, true);
    g_cache.clear();
    g_checkpoints.clear();
    llama_set_n_threads(g_ctx, g_n_threads, g_n_threads);
    return o.str();
}

}  // namespace camai
