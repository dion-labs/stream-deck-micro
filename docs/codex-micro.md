# Codex Micro — Functionality Study

Source: [OpenAI Supply Co. × Work Louder](https://openai.com/it-IT/supply/co-lab/work-louder/), [Work Louder product page](https://worklouder.cc/codex-micro), press coverage (TechCrunch, TNW, 2026-07).

## What it is

The **Codex Micro** (kbd-1.0) is a limited-run macro keyboard co-developed by OpenAI's Supply Co. and Work Louder, purpose-built for agentic coding with Codex. It is not a generic macro pad: its controls are semantically bound to Codex concepts (chats, agent state, approvals, reasoning effort) and its companion software integrates directly with Codex.

## Functionality breakdown

| Hardware control | Function |
|---|---|
| 6 frosted "Agent Keys" | Each key follows a Codex chat/session; pressing it focuses/switches to that chat. The keyboard has 13 mechanical switches in total. |
| Per-key RGB lighting | Real-time agent state per chat — e.g. idle, thinking/processing, running, waiting for input, task complete — so you can read the fleet of parallel agents at a glance without switching windows. |
| Planar joystick | Flick to launch common Codex workflows/skills: review a PR, debug an error, refactor. |
| Command keys | The most-used actions: accept, reject, push-to-talk (voice), new chat. |
| Rotary encoder | Adjust reasoning effort (low ↔ high) in real time. |
| Push-to-talk | Voice control of Codex (dictation). |
| Reset button | Firmware/boot controls. |
| Software | "ChatGPT Codex" + "Work Louder Input" companion app — proprietary bridge between the keyboard and Codex. Not reusable for third parties. |

## Mapping to our Stream Deck build

| Codex Micro feature | Stream Deck MK.2 equivalent | Status in v1 |
|---|---|---|
| Agent Keys (6) | 6 slot keys, each = one Codex session | ✅ v1 |
| RGB state per key | Key background color + label: idle (grey), thinking (purple, pulsing), running (blue), done (green flash), error (red) | ✅ v1 |
| Switch to chat | Slot key press selects the slot (active target for prompts/workflows) | ✅ v1 |
| New chat key | Sessions are created elsewhere and pulled in with ATCH; `sdm new` remains available | Deliberately omitted from the deck |
| Interrupt | "STOP" key interrupts the selected slot's active turn | ✅ v1 |
| Joystick workflows | Workflows page: one key per workflow (review PR, debug error, refactor, user-defined in config) → prompt sent to selected slot | ✅ v1 |
| Free-text prompt | No keyboard on the deck → companion CLI `sdm send "..."` | ✅ v1 |
| Accept/reject keys | — | ❌ out (user runs Codex full-auto; no approvals exist) |
| Rotary encoder (reasoning effort) | No knob on MK.2; a cycling key is trivially addable later | ❌ out of v1 |
| Push-to-talk voice | Codex dictation is TUI/desktop-only, not exposed via app-server; would require daemon-side capture+transcription → send text. Documented as future extension. | ❌ out of v1 |
| Reset / firmware | N/A | ❌ |

## How we talk to Codex (instead of their proprietary bridge)

- **Control plane**: `codex app-server` JSON-RPC protocol (same channel the Codex desktop app ecosystem uses). We use the official `@openai/codex-sdk` npm package, which spawns the CLI and speaks this protocol; raw protocol as fallback (full method/notification list in JOURNAL.md).
- **Sessions**: created headless via `thread/start`, persisted in `~/.codex/sessions`, resumable via `thread/resume` — so daemon restarts don't lose agent slots.
- **State feed**: `thread/status/changed`, `turn/started`/`turn/completed`, `item/started`/`item/completed` notifications → mapped to our `AgentState` enum.
- **Hooks**: Codex hooks/notify are outbound-only events; useful as supplementary signals for other harnesses, not as a control channel.
