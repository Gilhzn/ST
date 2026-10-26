# ADR 0005: Layered chat moderation pipeline

- Status: Accepted (2026-10)

## Context
Game chat needs multilingual (13 locales, including he/ar/hi/ru) filtering of abuse and threats before delivery, with transparency (Apple 1.2) and low latency. Perspective API shuts down at the end of 2026; OpenAI omni-moderation is free but has higher false positives; Azure Content Safety is weak for several of our languages.

## Decision
- **Layer 1 (client):** a small per-locale blocklist for instant feedback. Not trusted.
- **Layer 2 (server, `send-message`):** OpenAI omni-moderation and an LLM classifier (Claude `claude-haiku-5-5`, short context-aware prompt) run in parallel with a 1.5 s timeout; results are normalised to `ModerationCategory` and combined into `allow | nudge | block | pending`.
- **Failure mode:** if providers fail or time out, deliver as `pending` and re-check asynchronously; a later block retracts the message via Broadcast.
- **Consequences for users:** block/nudge always explain why (`reasonKey`); 3 blocks in 7 days → yellow card + 24 h chat mute (via the trust engine).
- **Retention:** chat is purged at `ends_at + 3h`; blocked and reported content is retained 90 days for appeals and abuse handling.
- Providers sit behind a `Moderator` dependency of the Edge Function so they can be swapped or faked in tests.

## Consequences
- + Works across all locales, degrades gracefully, explainable to users.
- + Vendor-swappable; no dependency on a sunset API.
- − Per-message LLM cost and up to 1.5 s added latency on send (mitigated by optimistic UI and the client blocklist).
- − Message content goes to vendors: must be disclosed in the privacy policy, with DPAs in place and no training use.
