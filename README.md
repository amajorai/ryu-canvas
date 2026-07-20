# ryu-canvas

Canvas for Ryu — a ComfyUI / ElevenLabs-Flows-style node board: wire up image / video / chat / tts / stt / upload / note nodes through Ryu's media and agent bridges; each board persists as a Space document.

> **Read-only mirror.** Developed in https://github.com/amajorai/ryu —
> please open issues and pull requests there, not on this repository.

## Source & build

This is the **source of record** for the app UI. It imports Ryu's private
`@ryu/ui` design system, so it does **not** build standalone outside the
monorepo — it **builds inside the amajorai/ryu monorepo workspace**.
The **shipped bundle below is the built artifact**: a prebuilt single-file
companion bundle is included at [`dist/canvas.ui.html`](./dist/canvas.ui.html) —
the runnable UI Ryu loads for this app.

## License

Apache-2.0 — see [LICENSE](./LICENSE).

---

# com.ryu.canvas — Canvas

A ComfyUI / ElevenLabs-Flows-style node board: wire up image / video / chat / tts /
stt / upload / note nodes and run them through Ryu's media and agent bridges. Each
board persists as a Space document.

## Parts

- **`ui/` — companion (`@ryu/canvas-app`).** A sandboxed full-page Companion
  (Path B, `ui_format: "html"`), a React Flow (`@xyflow/react`) canvas built to one
  self-contained `dist/index.html` via `vite-plugin-singlefile`. No backend crate
  of its own — it persists via `spaces:docs` and runs nodes through the
  `window.ryu` media/agent bridge, never raw `fetch`.

## Manifest (`ui/plugin.json`)

- **id** `com.ryu.canvas` · one `companion` runnable (`Canvas`, icon `ai-image`).
- **Requires:** app `com.ryu.spaces` + grant `spaces:docs` (a hard dependency —
  boards are stored as Space documents).
- **Grants:** `spaces:docs` (persistence), `core:list_agents` (pick a chat node's
  agent), `media:generate` + `media:transcribe` (image/video/tts + stt nodes),
  `hook:run-agent` + `hook:side-model` (chat / side-model nodes).
- **CSP:** the sandbox is opened to `api.iconify.design` / `api.svgl.app` /
  `svgl.app` for icon/logo fetches (`connect_domains` + `resource_domains`).
- No sidecar: all node execution rides Core's existing media + agent hooks.

## Surface

Registers as the **Canvas** companion in the desktop app store / launcher.

## Swap seam

Node kinds are the extensible unit; each maps to a bridge capability
(`media:*`, `hook:*`), none hardcoded to a provider. Boards live in Spaces, so a
different Spaces backend behind `spaces:docs` backs persistence unchanged.
