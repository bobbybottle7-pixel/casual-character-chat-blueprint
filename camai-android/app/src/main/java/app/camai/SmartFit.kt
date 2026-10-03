package app.camai

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** One way to run a model, with the RAM the engine simulated for it. */
data class FitConfig(val nCtx: Int, val nBatch: Int, val kvQ8: Boolean, val totalMb: Int)

enum class FitLevel { GOOD, TIGHT, TOO_BIG }

data class FitPlan(val chosen: FitConfig, val level: FitLevel, val budgetMb: Long) {
    fun describe(): String {
        val mem = "${chosen.nCtx} memory" + if (chosen.kvQ8) ", compressed" else ""
        return when (level) {
            FitLevel.GOOD -> "Fits well · ~${chosen.totalMb} MB · $mem"
            FitLevel.TIGHT -> "Tight fit · ~${chosen.totalMb} MB of ~$budgetMb MB free · $mem"
            FitLevel.TOO_BIG -> "Probably too big · needs ~${chosen.totalMb} MB, ~$budgetMb MB free"
        }
    }
}

/**
 * Smart Fit: picks the best settings a model can run with on this phone.
 * The engine simulates the exact memory each configuration needs (without reading the
 * weights); this chooses the richest one that fits the RAM Android can give us.
 */
object SmartFit {
    private val json = Json { ignoreUnknownKeys = true }

    /** Context sizes worth simulating, from the user's chosen maximum downwards. */
    fun contextCandidates(maxCtx: Int): IntArray =
        (listOf(maxCtx) + listOf(8192, 4096, 2048, 1024).filter { it < maxCtx }).toIntArray()

    fun parse(planJson: String): List<FitConfig> {
        val root = json.parseToJsonElement(planJson).jsonObject
        if (root["ok"]?.jsonPrimitive?.boolean != true) return emptyList()
        return root["configs"]!!.jsonArray.map {
            val o = it.jsonObject
            FitConfig(
                nCtx = o["n_ctx"]!!.jsonPrimitive.int,
                nBatch = o["n_batch"]!!.jsonPrimitive.int,
                kvQ8 = o["kv_q8"]!!.jsonPrimitive.boolean,
                totalMb = o["total_mb"]!!.jsonPrimitive.int,
            )
        }
    }

    /**
     * RAM we can count on: what's free now, plus what the currently loaded model will give back
     * when it's unloaded, minus a safety margin for the app and Android. Android can usually free
     * more by closing background apps, so never assume less than about a third of total RAM.
     */
    fun budgetMb(availMb: Long, totalMb: Long, loadedModelMb: Long): Long =
        maxOf(availMb + loadedModelMb - 350, totalMb * 35 / 100)

    /**
     * Order of preference, for each context size from largest down:
     * full-precision memory with big batches, then small batches (less scratch RAM, ~same speed),
     * then 8-bit compressed memory. kvMode: "auto" | "off" (never compress) | "on" (always).
     */
    fun choose(configs: List<FitConfig>, maxCtx: Int, kvMode: String, budgetMb: Long): FitPlan? {
        val allowed = configs.filter { it.nCtx <= maxCtx }.filter {
            when (kvMode) {
                "off" -> !it.kvQ8
                "on" -> it.kvQ8
                else -> true
            }
        }
        if (allowed.isEmpty()) return null
        fun rank(c: FitConfig) = (if (c.kvQ8) 2 else 0) + (if (c.nBatch >= 256) 0 else 1)
        val ordered = allowed.sortedWith(compareBy<FitConfig>({ -it.nCtx }, { rank(it) }))
        val fit = ordered.firstOrNull { it.totalMb <= budgetMb }
        return if (fit != null) {
            FitPlan(fit, if (fit.totalMb <= budgetMb * 8 / 10) FitLevel.GOOD else FitLevel.TIGHT, budgetMb)
        } else {
            FitPlan(allowed.minBy { it.totalMb }, FitLevel.TOO_BIG, budgetMb)
        }
    }

    /** Rough rating before a model is downloaded, from its file size alone. */
    fun estimateLevel(fileMb: Long, budgetMb: Long): FitLevel {
        val need = fileMb * 105 / 100 + 150
        return when {
            need <= budgetMb * 8 / 10 -> FitLevel.GOOD
            need <= budgetMb -> FitLevel.TIGHT
            else -> FitLevel.TOO_BIG
        }
    }
}
