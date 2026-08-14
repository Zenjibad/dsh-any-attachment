# dsh-any-attachment

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) plugin bundle that lets the Web UI attach files of **any type** as **@mentions**: drop a file (or use the **+** button) and its name + path are tagged into your message — the agent then reads the file itself with its own tools. Raster images keep flowing through the built-in image pipeline. No changes to the harness repo, and nothing is written into your workspaces.

## What it does

Drop a file or click **+** — the file is stored privately and its mention is inserted into your message text, right where you're typing:

```
can you @test.xml (C:\Users\...\.dsh\attachments-any\test.xml) file and give me a resume?
```

- You keep typing normally around the tag — the mention is plain text in the draft.
- Send as usual (Enter or the send button) — the agent sees the mention and reads the file at the given path with its fs tools.
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
| Max files per drop/pick | 8 |
| Name | basename only; traversal, separators, drive letters rejected |
| Storage | private store under `$DSH_HOME/attachments-any`, never a workspace |

## How it works

- **Host** (`lib/`): registers an RPC channel `/attachments-any` (authority `trusted-host`, same LAN fence as `/api`). `upload` validates base64/size/name, writes into the private store, and returns the stored path (deduped with `-2` suffixes).
- **Client** (`client/`): composer `+` button (`conversation.input.left`) and a capture-phase drop handler. Rasters route through `createDraftImages`/`addImages`; everything else uploads via the channel and the mention `@<name> (<path>)` is appended to the composer draft via `inputActions.setDraft`.

The agent reads the file at the mentioned path with its own tools — no extraction, no download UI, no special send flow.

## Test

```sh
node --test
```

## License

[MIT](LICENSE)
