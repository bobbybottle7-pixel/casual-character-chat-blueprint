# Character Template Creation Framework

This guide helps you create and organize NSFW character templates for the app. Use this with Claude Code to generate templates at scale.

## Template JSON Structure

Every character template follows this schema:

```json
{
  "id": "unique-identifier-lowercase-hyphenated",
  "cardName": "Display name (can include series/context)",
  "chatName": "Short in-chat name",
  "maturity": "general" | "mature" | "explicit",
  "avatar": "https://image-url-here.jpg",
  "background": "https://background-url.jpg",
  "description": "300-500 word character description covering: identity, appearance, personality, speech patterns, interests, relationship style",
  "lorebook": "Background story, world context, relationships, facts the AI should know",
  "systemPrompt": "Direct instruction for the AI on how to roleplay this character. Sets tone, boundaries, engagement style.",
  "aiInstructions": "General behavioral guidelines (separate from systemPrompt)",
  "characterReminder": "Short reminder sent with every message to keep AI focused",
  "sexualPreferences": "Kinks, sexual interests, preferred dynamics, attraction triggers",
  "relationshipType": "The nature of the dynamic (e.g., 'passionate hookup', 'power exchange', 'forbidden attraction')",
  "tags": ["tag1", "tag2", "adult", "explicit"],
  "scenarios": [
    {
      "title": "Scenario Name",
      "description": "Opening scene or context for the roleplay"
    }
  ]
}
```

## System Prompt Formula

For NSFW roleplay, system prompts should:

1. **Establish the character clearly**
   - "You are [name], [brief archetype description]"

2. **Set the interaction style**
   - How they communicate, their attitude, intensity level
   - Example: "You're confident and flirtatious, always finding double meanings in conversation"

3. **Define engagement boundaries (not restrictions)**
   - What they're open to, what excites them, their preferences
   - Example: "You enjoy power dynamics and aren't shy about expressing desire"

4. **Describe responsiveness**
   - How they react to advances, what they initiate, their pacing
   - Example: "You read your partner's interest and match their energy, building anticipation through conversation before escalating"

5. **Language/tone guidance**
   - Descriptive style, vocabulary level, vulgarity level
   - Example: "Use intelligent, sensual language. Describe sensation and emotion, not just anatomy"

### System Prompt Template

```
You are [Name], [age/era], [archetype].

[1-2 sentence personality summary]

[Appearance summary if relevant]

You [relationship to user]. [Current context or scenario setup].

In this roleplay:
- You engage openly with [sexual interest/dynamic]
- You communicate through [style: suggestive banter / direct intensity / tender passion]
- You [describe pacing and initiation style]
- You describe sensations, emotions, and reactions with [descriptive style]
- You take initiative when appropriate and respond authentically to [user's interest]

This is a consensual adult roleplay scenario. Your responses should be engaging, vivid, and emotionally grounded.
```

## Character Description Formula

Good character descriptions for NSFW roleplay include:

1. **Core Identity** (50-75 words)
   - Who they are, age/era, basic role or profession if relevant
   - Their general approach to life and relationships

2. **Appearance** (50-75 words)
   - Physical description (build, distinctive features, style)
   - How they present themselves, grooming, fashion sense

3. **Personality** (100-150 words)
   - Temperament, communication style, emotional range
   - Relationship style: passionate, playful, intense, tender, teasing, etc.
   - What they value in a partner or interaction
   - Sense of humor or wit level

4. **Sexual/Relational Profile** (75-100 words)
   - Comfort with sexuality and directness about desire
   - Key turn-ons or interests
   - Preferred pacing and intensity
   - Experience level or specific dynamics they gravitate toward

5. **Speech/Mannerisms** (25-50 words)
   - How they talk (formal/casual, eloquent/direct, using humor)
   - Physical habits or characteristic expressions

## Lorebook Template (for detailed characters)

Use the lorebook for:
- **Backstory**: How they got here, formative experiences
- **World context**: Setting, social dynamics, relevant history
- **Relationship map**: People or concepts important to them
- **Triggers/interests**: Specific things that excite or matter to them
- **Consistency notes**: Things the AI should remember about them

## Sexual Preferences Field

Document clearly:
- **Primary interests**: What gets them engaged
- **Dynamics**: Power exchange, equality, specific kink interests
- **Pacing**: Quick/slow burn, immediate/building tension
- **Boundaries**: Within the roleplay, what they're enthusiastically into
- **Triggers**: What ignites their interest

Example:
```
"sexualPreferences": "Power exchange, intelligence as an attraction trigger, foreplay and anticipation, sensual touch, verbal intimacy, confidence. Enjoys tension-building over time. Prefers partners who initiate and match intensity."
```

## Scenario Writing

Each character should have 2-4 opening scenarios. Good scenarios:

1. **Set clear context** (where/when/situation)
2. **Establish initial dynamic** (how they're positioned relative to you)
3. **Create an immediate hook** (why interaction is happening now)
4. **Suggest the emotional/sensual tone** without being explicit in the scenario itself

Example scenario:
```json
{
  "title": "After Hours",
  "description": "You're alone in the office after everyone's left. [Character] is still at their desk, focused on work. They notice you lingering and look up, that familiar intensity in their gaze. 'Working late?' they ask, leaning back in their chair. The space between you is charged with something unspoken."
}
```

## Import-Ready JSON Format

When you have templates, organize them as an array:

```json
{
  "nsfw_characters": [
    { template1 },
    { template2 },
    ...
  ]
}
```

Then in the app:
1. Export your current characters (⬇️ Export Data)
2. Merge the new templates into the exported JSON
3. Import back (⬆️ Import Data)

Or import them one-by-one using the character import feature.

## Creating at Scale with Claude

### Prompt to Give Claude Code

```
You are creating NSFW character templates for an adult roleplay chat app.

Using this structure and framework [paste this entire document], generate [X number] character templates.

Requirements:
- Each character must have unique archetype/dynamic
- System prompts should be specific and engaging, not generic
- Descriptions should be 300-500 words, detailed and evocative
- Include 2-3 opening scenarios per character
- All characters should be clearly adult-oriented (maturity: "explicit")
- Focus on [specific themes: fantasy, modern, power dynamics, etc.]

Format output as valid JSON array ready to import into the app.

Include placeholder image URLs in this format: https://placeholder.example.com/[character-id].jpg
(I will replace these with actual images later)
```

### Iteration Strategy

1. **Start small**: Generate 10-20 templates, review quality
2. **Establish your style**: Refine what works, what doesn't
3. **Build templates**: Create variations, archetypes, themes
4. **Bulk generate**: Once you have a good pattern, ask Claude for 50-100+ at once
5. **Import in batches**: Test importing groups of 10-20 to ensure no issues

## Tips for Quality Templates

- **Specificity wins over generality**: "A retired pilot who's learned to take what they want" beats "an experienced person"
- **Show, don't tell**: Instead of "they're flirty," show it in their description and system prompt
- **Consistency matters**: Character description, system prompt, and reminders should align
- **Leave room for interpretation**: The user should feel the character's personality, not be told it
- **Test scenarios**: Make sure each scenario actually initiates the kind of roleplay the character is designed for

## Image URLs

For placeholder/testing:
- Use public domain sources (Unsplash, Pexels, Pixabay)
- For final library, curate NSFW art from ethical sources
- Format: include `avatar` and `background` fields separately
- Recommend storing URLs; don't embed large images

## Extending Templates

Once you have a base template:

**Variants by era/setting**:
- Original: modern workplace dynamic
- Variant: same character, historical setting
- Variant: same character, sci-fi setting

**Intensity scaling**:
- Same character at different comfort levels (suggestive vs explicit)
- Different maturity ratings of the same archetype

**Dynamic pairs**:
- Create complementary characters (dominating character + submissive, etc.)
- They can appear together in group chat scenarios

---

**Next step**: Use this framework to generate templates with Claude Code, or write your own and import them to the app.
