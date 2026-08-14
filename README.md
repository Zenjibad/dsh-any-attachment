# dsh-any-attachment

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) plugin bundle that lets the Web UI attach files of **any type** as **pathless @-mentions**: type `@` to pick a workspace file, or drop a file (or use the **+** button) to tag it into your message — the agent then reads the file itself with its own tools. Mentions carry the name only, never a path. Raster images keep flowing through the built-in image pipeline. No changes to the harness repo, and nothing is written into your workspaces.

## How mentions work

- **`@`-list**: in the composer, type `@` and a menu shows the session workspace's files, recursively and flat (`src/main.ts`, `docs/guide.md`, …). Type more to filter; pick one and a pathless `@name` chip is inserted into the draft.
- **Drop / + button**: drop a local file onto the composer (or click **+**) and it is stored privately; the draft gains an `@<stored-name>` chip — no path, no drive letter.
- Send as usual (Enter or the send button) — every mention chip resolves to its **exact file location** in the sent message (`@name (C:\...\absolute\path)`), so the agent reads the file directly instead of guessing where it lives.
- Raster images (png/jpeg/webp/gif) still route to the built-in image pipeline (vision models see them).
- Files live under `$DSH_HOME/attachments-any/` — private, never dumped into a workspace.

## Install

```sh
dsh plugin --profile web add https://github.com/Zenjibad/dsh-any-attachment
```

Restart `dsh web`, then hard-refresh the page.

## Limits

| Guard | Value |
| --- | --- |
| Max bytes per file | 25 MB |
| `@`-list depth | 4 levels below the workspace root |
| `@`-list entries | 500 (sorted, `/`-separated relative paths) |
| `@`-list exclusions | hidden (`.`-prefixed) entries and `node_modules` |
| Name | basename only; traversal, separators, drive letters rejected |
| Storage | private store under `$DSH_HOME/attachments-any`, never a workspace |

## How it works

- **Host** (`lib/`): registers an RPC channel `/attachments-any` (authority `trusted-host`, same LAN fence as `/api`). `list { sessionId }` walks the session workspace recursively and returns relative paths; `upload` validates base64/size/name, writes into the private store, and returns the stored name (deduped with `-2` suffixes). A system-prompt section tells the agent that a referenced `@name` lives at `./<name>` relative to its working directory, or in the private store otherwise.
- **Client** (`client/`): composer `+` button (`conversation.input.left`), a capture-phase drop handler, and an `@file` input-trigger source (workspace autocomplete, pathless picks). Rasters route through `createDraftImages`/`addImages`; everything else uploads via the channel and the mention `@<name>` is appended to the composer draft via `inputActions.setDraft`.

The agent reads the file at the resolved path with its own tools — no extraction, no download UI, no special send flow.

## Test

```sh
node --test
```

## License

[MIT](LICENSE)
