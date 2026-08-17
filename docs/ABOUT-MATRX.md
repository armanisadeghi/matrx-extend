# AI Matrx

**The harness is the intelligence multiplier.**

The model is no longer the bottleneck. A mediocre harness with a frontier model produces demos. A world-class harness with a good model produces reliable, compounding, superhuman performance on real workflows. Systems that win treat the model as a powerful but fallible reasoning engine — and surround it with state, memory, verification, observability, and the right context at the right moment.

AI Matrx is that harness. Our goal is to be the harness the models themselves prefer.

---

## Build → Test → Consume

The system runs in three stages, each with surfaces purpose-built for its audience.

**Build.** *Agent Builder* is the forge. Engineers define an agent's identity — instructions, models, tools, variables, and Context Policies. Every save is versioned; internal instructions stay server-side.

**Test.** *Agent Runner* is the test track. Same runtime as production, with deep observability — traces, costs, version pinning, scenario replays.

**Consume.** Agents reach users through three surfaces:

- **Chat** — the conversational surface. Stateful and continuous, technical detail hidden.
- **Shortcuts** — invocation wrappers that map ambient UI state to agent variables. A click is the prompt.
- **Apps** — purpose-built experiences with custom artifacts, often composing multiple agents and shortcuts. The AI may be entirely invisible.

Two inputs feed every agent: **Variables** (mandatory, supplied by the caller) and **Context Policies** (optional, filled from ambient state). They are where the harness starts to feel like magic — and they're powered by the context system.

---

## Context: the heart of the harness

Context is what the agent knows about its world before it thinks. Get this right and the model needs less prompting, fewer tools, and fewer turns. Get it wrong and even a frontier model wastes capacity rediscovering what the surface already knew.

### Four parties, one chain

- **The Surface** decides what's *available*. A Surface is any environment an agent operates within — a Chrome extension, a chat UI, a phone over SMS, a sandbox the agent itself lives in, an inbound webhook. The Surface owns its catalog of context keys and is the sole authority on what state about itself exists. If the Surface doesn't expose it, no one downstream can ask for it.
- **The Agent Engineer** decides what the agent is *forced to see* — selecting which of the Surface's keys pre-load into every turn (the agent's *Context Policies*). Anything not pre-loaded stays reachable; it just isn't automatic.
- **The Agent** decides what it *wants* that the engineer didn't pre-load. Every advertised key is retrievable by name on demand.
- **The User** decides what they *want done* — and the layers above exist precisely so they never have to know any of this. No catalog to scan, no slots to configure. A symphony where the user hears only the music.

### How keys earn their place

- **Menu cost, not payload cost.** A context key costs ~one line in the agent's available-keys menu, regardless of payload size. The server retrieves it by name when asked. A 20KB bundle and a 20-byte field consume the same advertised space.
- **Tools cost more than keys for passive state.** Every tool's schema sits permanently in the model's window. Use tools for verbs and parameterized lookups; use context for state the surface already knows.
- **Bundle by mental concept.** One coherent thing earns one key. `images_count: 0` is the anti-pattern; fold fragments into a parent. Big rich bundles are encouraged.
- **Keys are public API.** Engineers template them as `{{key}}` and `{{key.subkey}}` into their own prompts. Name carefully, keep one source of truth per fact, and treat renames as breaking changes.
- **Context is dynamic.** Surfaces can attach keys based on detected state with no advance declaration. If a surface notices the user is on a product page, it can attach `product_data` for that turn alone. Lean into this.
