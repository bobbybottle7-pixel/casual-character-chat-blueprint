package app.camai

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PromptingTest {
    @Test fun splitsThoughts() {
        assertEquals("plan" to "Answer", Prompting.splitThoughts("<think>plan</think>\n\nAnswer"))
        assertEquals("half a thou" to "", Prompting.splitThoughts("<think>half a thou"))
        assertEquals("opened by template" to "Answer", Prompting.splitThoughts("opened by template</think>Answer"))
        val (t, a) = Prompting.splitThoughts("Just an answer")
        assertNull(t); assertEquals("Just an answer", a)
        assertTrue(Prompting.isStillThinking("<think>hmm"))
    }

    @Test fun historyFoldsGreetingAndDropsErrorsAndThoughts() {
        val story = BUILT_IN_CHARACTERS.first { it.id == "story-weaver" }
        val chat = Chat(characterId = story.id, messages = listOf(
            ChatMessage(role = "assistant", content = story.greeting),
            ChatMessage(role = "user", content = "A mystery"),
            ChatMessage(role = "assistant", content = "Generation error: boom", error = true),
            ChatMessage(role = "assistant", content = "<think>ok</think>It was a dark night."),
            ChatMessage(role = "user", content = "Go on"),
        ))
        val h = Prompting.buildHistory(chat, story, Settings(userName = "Cam"))
        assertEquals(listOf("system", "user", "assistant", "user"), h.map { it.first })
        assertTrue(h[0].second.contains("Story Weaver"))
        assertTrue(h[0].second.contains("You opened the conversation with"))
        assertTrue(h[0].second.contains("Cam"))
        assertEquals("It was a dark night.", h[2].second)
    }

    @Test fun defaultAssistantUsesSettingsPrompt() {
        val h = Prompting.buildHistory(Chat(messages = listOf(ChatMessage(role = "user", content = "hi"))), BUILT_IN_CHARACTERS[0], Settings(systemPrompt = "Be terse."))
        assertEquals("Be terse.", h[0].second)
    }

    @Test fun titles() {
        assertEquals("Hello there", Prompting.titleFrom("Hello there\nsecond line"))
        assertEquals(39, Prompting.titleFrom("x".repeat(100)).length)
        assertEquals("New chat", Prompting.titleFrom("   "))
    }

    @Test fun speechStripsMarkdown() {
        assertEquals("Hi bold see (code) end", Prompting.plainForSpeech("<think>x</think>Hi **bold** see ```kotlin\nval a = 1\n``` end"))
    }

    @Test fun statsLine() {
        assertEquals("10.0 tokens/s · M", Prompting.statsLine(50, 5000, 100, 90, 100, "M"))
        assertEquals("10.0 tokens/s · read 60 in 2.0s · M", Prompting.statsLine(50, 5000, 100, 40, 2000, "M"))
    }
}

class MarkdownTest {
    @Test fun blocks() {
        val b = Markdown.parse("# Title\nSome *text*\nmore\n\n- one\n2. two\n```kotlin\nval x = 1\n```\nafter")
        assertEquals(MdBlock.Heading(1, "Title"), b[0])
        assertEquals(MdBlock.Paragraph("Some *text*\nmore"), b[1])
        assertEquals(MdBlock.ListItem("•", "one"), b[2])
        assertEquals(MdBlock.ListItem("2.", "two"), b[3])
        assertEquals(MdBlock.Code("kotlin", "val x = 1"), b[4])
        assertEquals(MdBlock.Paragraph("after"), b[5])
    }

    @Test fun unclosedFenceWhileStreaming() {
        val b = Markdown.parse("Here:\n```py\nprint(1)")
        assertEquals(MdBlock.Code("py", "print(1)"), b[1])
    }

    @Test fun inlineSpans() {
        val s = Markdown.inline("a **b** *c* `d` snake_case_name 2 * 3")
        assertEquals(listOf(
            MdSpan("a "), MdSpan("b", bold = true), MdSpan(" "), MdSpan("c", italic = true), MdSpan(" "),
            MdSpan("d", code = true), MdSpan(" snake_case_name 2 * 3"),
        ), s)
    }
}
