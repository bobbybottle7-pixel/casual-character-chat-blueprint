package app.camai

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

private fun fixture(name: String) = ToolsTest::class.java.classLoader!!.getResource(name)!!.readText()

class ToolsTest {
    // Real output of the engine's planner for Qwen 3.5 0.8B (see enginetest/tools_test.cpp).
    private val qwenPlan = SmartFit.parse(fixture("plan_qwen08.json"))

    @Test fun parsesRealPlan() {
        assertEquals(16, qwenPlan.size)
        val c = qwenPlan.first { it.nCtx == 4096 && it.nBatch == 64 && !it.kvQ8 }
        assertEquals(601, c.totalMb)
    }

    @Test fun plentyOfRamPicksFullQualityBigBatch() {
        val plan = SmartFit.choose(qwenPlan, 4096, "auto", budgetMb = 2000)!!
        assertEquals(FitConfig(4096, 256, false, 785), plan.chosen)
        assertEquals(FitLevel.GOOD, plan.level)
    }

    @Test fun tightRamFallsBackToSmallBatchThenCompression() {
        assertEquals(FitConfig(4096, 64, false, 601), SmartFit.choose(qwenPlan, 4096, "auto", 650)!!.chosen)
        assertEquals(FitConfig(4096, 64, true, 579), SmartFit.choose(qwenPlan, 4096, "auto", 590)!!.chosen)
        // Not even 4096 fits: drop to a smaller context.
        assertEquals(2048, SmartFit.choose(qwenPlan, 4096, "auto", 570)!!.chosen.nCtx)
    }

    @Test fun nothingFitsReportsTooBigWithSmallestConfig() {
        val plan = SmartFit.choose(qwenPlan, 4096, "auto", 300)!!
        assertEquals(FitLevel.TOO_BIG, plan.level)
        assertEquals(566, plan.chosen.totalMb)
    }

    @Test fun respectsCompressionSetting() {
        assertFalse(SmartFit.choose(qwenPlan, 8192, "off", 590)!!.chosen.kvQ8)
        assertTrue(SmartFit.choose(qwenPlan, 8192, "on", 5000)!!.chosen.kvQ8)
    }

    @Test fun budgetNeverBelowAThirdOfRam() {
        assertEquals(1330L, SmartFit.budgetMb(availMb = 200, totalMb = 3800, loadedModelMb = 0))
        assertEquals(1850L, SmartFit.budgetMb(availMb = 1500, totalMb = 3800, loadedModelMb = 700))
    }

    @Test fun contextCandidates() {
        assertEquals(listOf(4096, 2048, 1024), SmartFit.contextCandidates(4096).toList())
        assertEquals(listOf(8192, 4096, 2048, 1024), SmartFit.contextCandidates(8192).toList())
    }

    @Test fun hfSearchParsesRealResponse() {
        val repos = HuggingFace.parseSearch(fixture("hf_search.json"))
        assertTrue(repos.size > 10)
        assertTrue(repos.all { it.id.contains('/') })
        assertTrue(repos.zipWithNext().all { (a, b) -> a.downloads >= b.downloads })
    }

    @Test fun hfFilesSkipVisionAndNonGguf() {
        val (gated, files) = HuggingFace.parseFiles("unsloth/Qwen3.5-2B-GGUF", fixture("hf_files.json"))
        assertFalse(gated)
        assertTrue(files.none { "mmproj" in it.name || !it.name.endsWith(".gguf") })
        val q4 = files.first { it.name == "Qwen3.5-2B-Q4_0.gguf" }
        assertEquals("Q4_0", q4.quant)
        assertEquals(1214L, q4.sizeBytes / 1_000_000)
        assertEquals("https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_0.gguf", q4.url)
        assertEquals("Q4_K_M", HuggingFace.quantOf("x-Q4_K_M.gguf"))
        assertEquals("IQ4_XS", HuggingFace.quantOf("x-IQ4_XS.gguf"))
        assertTrue(files.zipWithNext().all { (a, b) -> a.sizeBytes <= b.sizeBytes })
    }

    @Test fun hfDetectsGatedRepos() {
        assertTrue(HuggingFace.parseFiles("meta-llama/Llama-3.2-1B-Instruct", fixture("hf_gated.json")).first)
    }

    @Test fun estimateBeforeDownload() {
        assertEquals(FitLevel.GOOD, SmartFit.estimateLevel(700, 1800))
        assertEquals(FitLevel.TIGHT, SmartFit.estimateLevel(1400, 1700))
        assertEquals(FitLevel.TOO_BIG, SmartFit.estimateLevel(2600, 1700))
        assertNotNull(SmartFit.choose(qwenPlan, 2048, "auto", 100))
    }
}
