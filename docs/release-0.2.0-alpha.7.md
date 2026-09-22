# Native macOS preview v0.2.0-alpha.7

Invalid slot arguments now fail before dispatch or mutation. The CLI accepts
whole decimal slots 1 through 15 for select, clear and rename; malformed input
previously became JSON null and could target the first slot. Status now displays
the selected slot using the same one-based numbering.

The shared HTTP/IPC command boundary requires numeric integer indices within
range for selection, opening, clearing, renaming, swapping, attaching and virtual
deck keys. Omitted optional clear/attach arguments retain their existing behavior;
explicit null and coercible strings are rejected. Session slots and device keys
use their respective bounds.

Validation includes 29 actual CLI subprocess cases with a disposable HOME and
fake daemon, 26 command-boundary cases and 419 passing full-suite tests. The
extracted artifact additionally verifies invalid CLI arguments dispatch nothing,
valid slot 15 dispatches index 14 and compiled boundary guards reject null.

Apple Silicon, macOS 14+. Unnotarized, ad-hoc signed alpha preview. No installed
app, running session, real hardware or user data was changed during QA. Physical,
native lifecycle and actual browser-permission acceptance remain separate gates.
