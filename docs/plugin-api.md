# Plugin API (experimental)

Other Obsidian plugins can send prompts to Claudian sessions, stop them, and read their replies. A voice companion, for example, sends the user's transcript, waits for the turn to end, and speaks the reply.

The API is experimental: its shape may change in minor releases while `version` is `1`. Check `version` before using it.

## Getting the API

The public Obsidian SDK types omit the runtime plugin manager. Use a local type
intersection for the member needed here. Put the type imports at file scope and
run the remaining statements inside your plugin's methods.

```ts
import type { App } from 'obsidian';

const app = this.app as App & {
  plugins: { getPlugin(id: string): { api?: ClaudianAPI } | null };
};
const claudian = app.plugins.getPlugin('realclaudian');
const api = claudian?.api;
if (api?.version !== 1) return; // Claudian is missing, disabled, still loading, or incompatible
```

Resolve the API when you need it rather than caching it across plugin reloads: disabling or updating Claudian replaces the plugin instance.

## Interface

```ts
interface ClaudianAPI {
  readonly version: 1;
  /** The session shown in the focused chat view, or null. */
  getActiveSessionId(): string | null;
  /** Delivers text as the user's own prompt; `interrupt` without text only stops the session. */
  send(sessionId: string, options: { text?: string; mode?: 'queue' | 'steer' | 'interrupt' }): Promise<SendStatus>;
  /** The last finished turn's final reply as Markdown; empty when no turn has finished. */
  read(sessionId: string): Promise<string>;
}

type SendStatus = 'started' | 'queued' | 'steered' | 'uncertain' | 'interrupted' | 'idle';
```

### `send`

The text arrives in the session as an ordinary user prompt, exactly as if the user had typed it. The session runs on its own provider, model and reasoning settings, and it does not need to be open in a tab.

| `mode` | Behavior | Status |
|---|---|---|
| `queue` (default) | Starts a turn, or waits until the session finishes its current work and the user's queued input. | `started`, `queued` |
| `steer` | Joins the running turn. Without a turn to join, it is queued instead. | `steered`, `uncertain`, or the `queue` statuses |
| `interrupt` | Stops the session's work like the Stop button, then delivers the text first. | `interrupted`, or the `queue` statuses when nothing was running |

- `text` is required, except that `{ mode: 'interrupt' }` without text only stops the session (`interrupted`, or `idle` when nothing was running).
- `uncertain` means a steer may or may not have reached the provider. Do not resend it.
- `send` resolves as soon as the text is accepted; it does not wait for the reply. Use the turn-ended event below.
- It rejects when the session does not exist or is archived, or when `text` is missing or empty.
- If the agent asks for permission or a question during the turn, the turn waits until the user answers on screen.

### `read`

Returns the final answer of the last finished turn as Markdown: the text the agent wrote after its last piece of work, without progress commentary, tool calls or thinking. A turn still running is not included, even after a prompt was steered into it. When a turn produced no text, it returns `(interrupted)`, `(error)` or `(no reply)`. Stripping Markdown, for example for speech, is up to the caller.

## Bücher messages in the main chat

Check `typeof api.sendBookMessage === 'function'` before calling `sendBookMessage({ text, context })`. It opens the main chat, submits the text in the active tab (including a blank one), and attaches the context to the provider prompt. The transcript shows the text and a collapsed **Bücher context** disclosure. The promise resolves when the chat accepts the message or queues it behind a running turn.

When Bücher is installed, the main composer also offers its book objects in the @ picker. Selected links attach the referenced object's excerpt on send.

## Background tasks in Claudian for Bücher

Check `typeof api.runTask === 'function'` before use. A request starts one isolated provider session with Claudian's last selected available model. It returns `{ text, data? }` to the caller. There is no chat tab, draft, or turn-ended subscription.

- Pass `prompt` and `instructions`. Pass an optional JSON Schema as `schema` to receive parsed `data`. Codex and Claude Code use their native structured output. Other providers receive the schema as instructions and can fail with an invalid JSON error.
- Pass an `AbortSignal` to cancel. `onProgress` receives `starting`, `working`, and `responding` as available. `onAnalysis` receives deltas when the provider publishes a user-facing analysis summary.
- For Bücher tasks, pass `book: { path, chapter, block?, query? }`. Claudian calls Bücher's book-scoped context tool for relevant passages, prerequisites, and reading status. The source index and the tutor and reviewer skills live in Bücher. Existing solutions are excluded from the search index.

## Turn-ended event

Claudian fires a workspace event when a session finishes its turn and any work the
turn left running. This custom event is absent from the SDK's workspace overloads;
describe it locally and register the returned event reference for unload cleanup:

```ts
import type { EventRef, Workspace } from 'obsidian';

const workspace = this.app.workspace as Workspace & {
  on(name: 'claudian:turn-ended', callback: (event: { sessionId: string }) => void): EventRef;
};
this.registerEvent(workspace.on('claudian:turn-ended', async ({ sessionId }: { sessionId: string }) => {
  if (sessionId !== mySessionId) return;
  const reply = await api.read(sessionId);
  // speak or display the reply
}));
```

The event fires for every session and every turn, whether it was started from the chat view, by another agent, or through this API. Filter by `sessionId`.

## Example: one spoken exchange

```ts
const sessionId = api.getActiveSessionId();
if (!sessionId) return;
await api.send(sessionId, { text: transcript });
// ...the 'claudian:turn-ended' listener reads and speaks the reply.

// The user talks over the reply:
await api.send(sessionId, { text: newTranscript, mode: 'interrupt' });
```
