# Known issues

Findings that are real but deliberately not fixed yet, so they are not
rediscovered as if they were new.

## World state is not reconciled when the cast changes

`update_world_state` records who is present as play proceeds. Swapping a
conversation's characters replaces the cast, but leaves the stored world state
alone — so `Present: <old character>` can survive into the rebuilt prompt and
the removed character may resurface in the narration.

Found while verifying the Stage 1 prompt-refresh fix (the fix itself is
correct; the cast in the rebuilt prompt is right).

Options when we get to it: reconcile `world_state.present` against the cast on
change, or have the swap write a scene transition through `advance_scene`.

## Memories only reach Roleplay

`memories` are stored for any conversation and the API accepts them everywhere,
but only `modes/roleplay/prompt.ts` renders them. In General Chat a memory is
saved and silently never used.

## Thinking is never shown

Four modes set `ui.showThinking: true` and the UI renders a Thinking panel, but
`thinking.display` is never configured and defaults to omitted, so the panel can
never fill. Long thinking also looks like a hang, because nothing streams.
