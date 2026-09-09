#!/usr/bin/env node
/*
 * convert-characters.js — turn a list of authored character templates into a
 * Casual Character Chat import file (v3), ready for the "⬆️ Import Data" button.
 *
 * This is pure field-mapping plumbing: it reshapes data you already wrote into
 * the shape the app stores. It does not generate any content.
 *
 * Usage:
 *   node build/convert-characters.js input.json [output.json]
 *
 *   input.json   an array of template objects using the fields:
 *                cardName, chatName, maturity, avatar, background,
 *                description, lorebook, systemPrompt, aiInstructions,
 *                characterReminder, sexualPreferences, relationshipType,
 *                tags[], scenarios[{title, description}]
 *   output.json  defaults to <input>.import.json
 *
 * Safety filter: entries whose tags, relationshipType, or sexualPreferences
 * indicate incest / family-taboo content are DROPPED and never written to the
 * output. This is intentional and not configurable.
 */

const fs = require('fs');
const path = require('path');

// Any entry matching one of these (in tags, relationshipType, or
// sexualPreferences) is excluded from the output. Word-boundary matched so
// "brother" does not trip on "brotherhood", etc.
const BLOCKED_TERMS = [
    'incest', 'family taboo', 'family-taboo',
    'stepmother', 'stepmom', 'step-mother', 'stepfather', 'stepdad', 'step-father',
    'stepsister', 'stepsis', 'step-sister', 'stepbrother', 'stepbro', 'step-brother',
    'stepson', 'stepdaughter', 'step-son', 'step-daughter',
    'mother', 'father', 'mommy', 'daddy', 'sister', 'brother',
    'aunt', 'uncle', 'niece', 'nephew', 'cousin',
    'daughter', 'son', 'sibling', 'grandmother', 'grandfather'
];

const VALID_MATURITY = new Set(['general', 'mature', 'explicit']);

function isBlocked(entry) {
    const haystack = [
        Array.isArray(entry.tags) ? entry.tags.join(' ') : (entry.tags || ''),
        entry.relationshipType || '',
        entry.sexualPreferences || ''
    ].join(' ').toLowerCase();

    return BLOCKED_TERMS.some(term => {
        // Escape regex metachars, match on word boundaries.
        const t = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[^a-z])${t}([^a-z]|$)`, 'i').test(haystack);
    });
}

function normalizeMaturity(value) {
    const v = typeof value === 'string' ? value.toLowerCase().trim() : '';
    return VALID_MATURITY.has(v) ? v : 'general';
}

// Map one template entry to the app's character schema.
function toCharacter(entry, index) {
    const id = entry.id || `imported-${Date.now()}-${index}`;

    // The app has no dedicated system-prompt field; both behavioral blobs live
    // in "AI Instructions". Combine them, preserving order.
    const instructions = [entry.systemPrompt, entry.aiInstructions]
        .map(s => (s || '').trim())
        .filter(Boolean)
        .join('\n\n');

    // The app has no field for relationshipType / sexualPreferences, so carry
    // them into the (always-on) lorebook rather than dropping them.
    const loreParts = [(entry.lorebook || '').trim()];
    if (entry.relationshipType) loreParts.push(`Relationship: ${entry.relationshipType}`);
    if (entry.sexualPreferences) loreParts.push(`Preferences: ${entry.sexualPreferences}`);
    const lore = loreParts.filter(Boolean).join('\n\n');

    const tags = Array.isArray(entry.tags) ? entry.tags.join(', ') : (entry.tags || '');

    const scenarios = Array.isArray(entry.scenarios)
        ? entry.scenarios
            .map(s => ({
                name: (s && (s.title || s.name) || 'Scenario').toString(),
                greeting: (s && (s.description || s.greeting) || '').toString(),
                memories: (s && s.memories || '').toString()
            }))
            .filter(s => s.greeting.trim() || s.memories.trim())
        : [];

    return {
        id,
        name: entry.cardName || entry.name || 'Unnamed',
        chatName: entry.chatName || entry.cardName || 'Unnamed',
        avatar: entry.avatar || '',
        background: entry.background || '',
        gallery: [],
        instructions,
        description: (entry.description || '').trim(),
        lore,
        loreMode: 'flat',
        loreEntries: [],
        tags,
        reminder: (entry.characterReminder || '').trim(),
        narratorReminder: '',
        musicUrl: '',
        scenarios,
        type: 'character',
        maturity: normalizeMaturity(entry.maturity),
        characterIds: [],
        chats: {}
    };
}

function main() {
    const [, , inputPath, outputPathArg] = process.argv;
    if (!inputPath) {
        console.error('Usage: node build/convert-characters.js input.json [output.json]');
        process.exit(1);
    }

    const raw = fs.readFileSync(inputPath, 'utf8');
    let entries;
    try {
        entries = JSON.parse(raw);
    } catch (e) {
        console.error(`Could not parse ${inputPath} as JSON: ${e.message}`);
        process.exit(1);
    }
    if (!Array.isArray(entries)) {
        console.error('Input must be a JSON array of character templates.');
        process.exit(1);
    }

    const characters = {};
    const dropped = [];
    let kept = 0;

    entries.forEach((entry, i) => {
        const label = entry.cardName || entry.name || entry.id || `#${i + 1}`;
        if (isBlocked(entry)) {
            dropped.push(label);
            return;
        }
        const char = toCharacter(entry, i);
        characters[char.id] = char;
        kept++;
    });

    const out = { version: 3, characters, personas: {}, appSettings: { availableModels: [] } };
    const outputPath = outputPathArg
        || path.join(path.dirname(inputPath), path.basename(inputPath, path.extname(inputPath)) + '.import.json');

    fs.writeFileSync(outputPath, JSON.stringify(out, null, 2));

    console.log(`Converted ${kept} character(s) -> ${outputPath}`);
    if (dropped.length) {
        console.log(`Dropped ${dropped.length} blocked (incest / family-taboo) entr${dropped.length === 1 ? 'y' : 'ies'}:`);
        dropped.forEach(d => console.log(`  - ${d}`));
    }
}

main();
