# `record_gif` — design notes & known limitations

> Status: shipped 2026-05-05. Read this before changing the recorder, the
> overlay compositor, or the GIF encoder — every gotcha here cost real time
> to find.

## Why CDP screencast (not `chrome.tabs.captureVisibleTab`)

`chrome.tabs.captureVisibleTab` is throttled to ~2 calls/sec by Chrome's
quota system (`MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND`). Animation needs
8–15 fps minimum. CDP's `Page.startScreencast` streams JPEG frames at
request rate with no quota; we already have CDP plumbing (admin gate +
`debugger` optional permission + `chrome.debugger.onEvent` listener
registry), so the marginal cost is small.

Tradeoff: CDP requires admin + `debugger` permission, which lights up
Chrome's "is being debugged" banner during recording. Acceptable for the
record-then-export flow.

## Memory: keep frames as JPEG, decode at export

Storing 720p RGBA frames at 12 fps for 30 s = ~80 MB. The SW would die.
We keep frames as the JPEG bytes CDP delivers (~30 KB each at q=80) and
decode lazily at export time. Same recording stays under 15 MB.

If you ever bump CDP screencast to lower JPEG quality or switch to PNG,
re-do this math.

## Frame rate is throttled in the listener, not in CDP

We pass `everyNthFrame: 1` to `Page.startScreencast` and rate-limit at our
listener (`minFrameIntervalMs = ~83 ms`, target 12 fps). Reason: CDP
delivers frames "as available" — on a static page that's effectively zero,
on a busy page it can be 60 fps. Server-side throttling lets us catch
short bursts of motion without flooding memory.

## Click / drag overlay limitations

The dispatcher calls `recordToolEvent()` for every tool invocation while
recording is active. We only render an overlay when the call args carry
an explicit **viewport coordinate**:

- `click_element` / `right_click_element` with `coordinate` ✅
- `click_element` with **only** `ref` — no overlay (we'd need to re-enter
  the page to resolve the ref to a coord, which is too expensive per
  frame).
- `computer.left_click` / `right_click` / `double_click` / `triple_click`
  with `coordinate` ✅
- `computer.left_click_drag` with `start_coordinate` + `coordinate` ✅
  (rendered as an arrow on frames in a ~800 ms window).
- `type` / `key` / `scroll` / `navigate` — get an action label only, no
  pulse.

If you want pulse rendering for ref-based clicks, the cleanest fix is to
have the click handler write the resolved viewport coordinate into the
`tool_event.started` payload before broadcasting (one extra round-trip
into the page per click). Until then: ref-only clicks render as labels,
not pulses.

## Multi-tab caveat

`recordToolEvent()` writes events to **every** active recording, not just
the recording on the tab the tool targeted. Reason: most action tools
operate implicitly on the active tab, and we don't have a clean way to
extract "which tab" from arbitrary tool args. In practice this is
harmless because a single conversation usually has one recording in
flight at a time. If multi-tab parallel recordings ship, route events
by `tab_id` from the dispatcher.

## SW lifecycle

In-memory state lives in `STATES: Map<number, RecordingState>` in
[src/lib/recording/state.ts](../src/lib/recording/state.ts). If the SW
restarts mid-recording, frames are lost. CDP attachment dies with the
SW too, so this is consistent — the agent will see "no recording"
on the next call and can restart cleanly.

## GIF encoder validation

The encoder is implemented from scratch (NeuQuant + LZW + GIF89a
assembler) in [src/lib/recording/gif-encoder.ts](../src/lib/recording/gif-encoder.ts).
The LZW bit-packing and codeSize-bump rules were written carefully against
the GIF89a spec (the encoder bumps width when `nextCode > (1 << codeSize)`
strictly after assignment, which matches the standard `>=` rule once
you account for the post-increment). **It has not been validated against
a real GIF decoder in CI.** Before shipping to production users:

1. Manually verify a recording renders correctly in Chrome's GIF preview,
   macOS Preview, and the browser `<img>` tag.
2. Add a vitest smoke test: encode a 3-frame red→green→blue strip and
   verify the byte stream against a known-good fixture.

If you see decoder errors in the wild, the most likely culprits are:

- **Width-bump off-by-one**: standard says bump at `nextCode == 2^width`
  (i.e. when the just-assigned code fills the width); some decoders are
  strict about this. Our `>` test on the post-incremented `nextCode`
  matches the standard semantic, but if you see "code out of range"
  errors, swap to `>=` and verify.
- **Sub-block overflow**: GIF requires ≤ 255 bytes per data sub-block;
  we cap at 255 explicitly in `writeImageData`. If you change that, things
  break silently.
- **Color map size**: must always be 256 × 3 = 768 bytes for our 8-bit
  LZW; we hard-fail if the map is the wrong size.

## Overlay compositor: why a hand-rolled font

The compositor draws on the RGBA buffer directly because the SW's
`OffscreenCanvas` 2D context is awkward to share across many frames
without churn — and we already have raw bytes in hand from JPEG decode.
A 5×7 bitmap font at scale=2 gives readable labels at any reasonable
recording size. If you need bigger / better text, swap in a real Canvas
draw pass (one canvas per frame, `drawImage` the original, then
`fillText`, then `getImageData`) at a perf cost.

## What to do when this doc and the code disagree

The code wins. Update this doc — don't quietly change behavior.
