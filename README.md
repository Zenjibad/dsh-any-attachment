# dsh-any-attachment

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) plugin bundle that lets the Web UI attach files of **any type** to a chat message: text-like files are extracted and inlined into the prompt, everything else is attached as a tagged mention with download. Raster images keep flowing through the built-in image pipeline. No changes to the harness repo, and nothing is written into your workspaces.

## What it does

Drop a file (or use the **+** button) — it becomes a **chat attachment**:

| Attached file | In the message |
| --- | --- |
| `note.md`, `code.py`, `data.json`, ... (valid UTF-8) | `Attached: <name>` + first 50 KB of extracted text inlined |
| `report.pdf`, `archive.zip`, `song.mp3`, ... (binary) | `Attached: <name>` — a tagged mention; downloadable from the chat |
| `photo.png` / `.jpg` / `.webp` / `.gif` | routed to the built-in image pipeline unchanged (vision-capable models see it) |

Files are stored privately under `$DSH_HOME/attachments-any/` (content is never dropped into a workspace). The composer shows a pending-attachment rail (name/size, download, collapsible extracted-text preview, removal); sending goes through the rail's **Send with files** button, which composes the mention + extracted text into the message.

## Install

```sh
dsh plugin --profile web add https://github.com/Zenjibad/dsh-any-attachment
```

Restart `dsh web`, then hard-refresh the page.

## Limits

| Guard | Value |
| --- | --- |
| Max bytes per file | 25 MB |
| Max files per message | 8 |
| Inlined text per file / per message | 50 KB / 100 KB |
| Name | basename only; traversal, separators, drive letters rejected |
| Storage | private store under `$DSH_HOME/attachments-any`, never a workspace |
| Download scope | store ids only (bare basenames) |

## How it works

- **Host** (`lib/`): registers an RPC channel `/attachments-any` (authority `trusted-host`, same LAN fence as `/api`). `upload` validates base64/size/name, writes into the private store, sniffs UTF-8 and extracts; `read` returns bytes for download after a bare-id containment check.
- **Client** (`client/`): composer `+` button (`conversation.input.left`), attachment rail + send (`conversation.input.dock`), and a capture-phase drop handler. Rasters route through `createDraftImages`/`addImages`; everything else uploads via the channel. Sending calls the scope-addressed `conversation.sendSession` with the composed mention + extracted text.

Known limitation: binary files are mentioned by name only — the agent does not get their content (no read tool yet). Text-likes are fully inlined.

## Test

```sh
node --test
```

## License

[MIT](LICENSE)
