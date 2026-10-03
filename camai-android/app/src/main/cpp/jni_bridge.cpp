// JNI glue between app.camai.LlamaEngine (Kotlin) and the engine.
// All text crosses the boundary as UTF-8 byte arrays: JNI's NewStringUTF/GetStringUTFChars
// use "modified UTF-8", which mangles emoji and other 4-byte characters.
#include <android/log.h>
#include <jni.h>

#include <string>
#include <vector>

#include "engine.h"
#include "llama.h"

namespace {

std::string from_bytes(JNIEnv * env, jbyteArray arr) {
    if (!arr) {
        return {};
    }
    const jsize  n = env->GetArrayLength(arr);
    std::string  s(n, '\0');
    env->GetByteArrayRegion(arr, 0, n, reinterpret_cast<jbyte *>(s.data()));
    return s;
}

jbyteArray to_bytes(JNIEnv * env, const std::string & s) {
    jbyteArray arr = env->NewByteArray((jsize) s.size());
    env->SetByteArrayRegion(arr, 0, (jsize) s.size(), reinterpret_cast<const jbyte *>(s.data()));
    return arr;
}

void android_log(ggml_log_level level, const char * text, void *) {
    int prio = ANDROID_LOG_DEBUG;
    switch (level) {
        case GGML_LOG_LEVEL_ERROR: prio = ANDROID_LOG_ERROR; break;
        case GGML_LOG_LEVEL_WARN:  prio = ANDROID_LOG_WARN; break;
        case GGML_LOG_LEVEL_INFO:  prio = ANDROID_LOG_INFO; break;
        default: break;
    }
    __android_log_write(prio, "CamAI-llama", text);
}

}  // namespace

extern "C" {

JNIEXPORT void JNICALL Java_app_camai_LlamaEngine_nativeInit(JNIEnv * env, jobject, jbyteArray lib_dir) {
    llama_log_set(android_log, nullptr);
    camai::backend_init(from_bytes(env, lib_dir));
}

JNIEXPORT jbyteArray JNICALL Java_app_camai_LlamaEngine_nativeLoad(JNIEnv * env, jobject, jbyteArray path, jint n_ctx,
                                                                   jint n_threads) {
    return to_bytes(env, camai::load(from_bytes(env, path), n_ctx, n_threads));
}

JNIEXPORT void JNICALL Java_app_camai_LlamaEngine_nativeUnload(JNIEnv *, jobject) {
    camai::unload();
}

JNIEXPORT jbyteArray JNICALL Java_app_camai_LlamaEngine_nativeInfo(JNIEnv * env, jobject) {
    return to_bytes(env, camai::model_info_json());
}

JNIEXPORT void JNICALL Java_app_camai_LlamaEngine_nativeSetThreads(JNIEnv *, jobject, jint n) {
    camai::set_threads(n);
}

JNIEXPORT void JNICALL Java_app_camai_LlamaEngine_nativeStop(JNIEnv *, jobject) {
    camai::request_stop();
}

JNIEXPORT jbyteArray JNICALL Java_app_camai_LlamaEngine_nativeBench(JNIEnv * env, jobject, jintArray threads,
                                                                    jint n_tokens) {
    const jsize      n = env->GetArrayLength(threads);
    std::vector<int> counts(n);
    env->GetIntArrayRegion(threads, 0, n, counts.data());
    return to_bytes(env, camai::bench_threads_json(counts, n_tokens));
}

// listener: an object with `boolean onText(byte[] utf8)`; returning false stops generation.
JNIEXPORT jbyteArray JNICALL Java_app_camai_LlamaEngine_nativeGenerate(
        JNIEnv * env, jobject, jobjectArray roles, jobjectArray contents, jfloat temp, jfloat top_p, jint top_k,
        jfloat min_p, jfloat repeat_penalty, jint max_tokens, jboolean thinking, jobject listener) {
    std::vector<camai::Msg> msgs;
    const jsize             n = env->GetArrayLength(roles);
    for (jsize i = 0; i < n; i++) {
        auto r = (jbyteArray) env->GetObjectArrayElement(roles, i);
        auto c = (jbyteArray) env->GetObjectArrayElement(contents, i);
        msgs.push_back({ from_bytes(env, r), from_bytes(env, c) });
        env->DeleteLocalRef(r);
        env->DeleteLocalRef(c);
    }

    camai::GenParams p;
    p.temp           = temp;
    p.top_p          = top_p;
    p.top_k          = top_k;
    p.min_p          = min_p;
    p.repeat_penalty = repeat_penalty;
    p.max_tokens     = max_tokens;
    p.thinking       = thinking;

    jclass    cls     = env->GetObjectClass(listener);
    jmethodID on_text = env->GetMethodID(cls, "onText", "([B)Z");
    auto      stats   = camai::generate(msgs, p, [&](const std::string & piece) {
        jbyteArray arr  = to_bytes(env, piece);
        jboolean   keep = env->CallBooleanMethod(listener, on_text, arr);
        env->DeleteLocalRef(arr);
        if (env->ExceptionCheck()) {
            env->ExceptionClear();
            return false;
        }
        return (bool) keep;
    });
    env->DeleteLocalRef(cls);
    return to_bytes(env, stats.to_json());
}

}  // extern "C"
