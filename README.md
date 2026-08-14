# dsh-any-attachment

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) plugin bundle that lets the Web UI attach files of **any type**: text-like files are extracted and inlined into the prompt, everything else becomes a workspace path the agent can read with its existing tools. Raster images keep flowing through the built-in image pipeline. No changes to the harness repo.

## What it does

| Attached file | Result |
| --- | --- |
| `note.md`, `code.py`, `data.json`, ... (valid UTF-8) | stored in the session's workspace; first 50 KB inlined into the prompt as text, with the path line |
| `report.pdf`, `archive.zip`, `song.mp3`, ... (binary) | stored in the session's workspace; prompt gets only the path line — the agent reads it itself |
| `photo.png` / `.jpg` / `.webp` / `.gif` | routed to the built-in image pipeline unchanged (visible to vision-capable models) |

Attach via the **+ button** in the composer or by **dragging a file** onto the window. Pending files show as rows with name/size, download, a collapsible extracted-text preview, and removal; sending goes through the rail's **Send with files** button, which composes the path + extracted text into the message.

Files land in the session's workspace directory (`<cwd>/<name>`, deduped with a `-2` suffix on collisions), so the agent can read, edit, or reference them with its normal fs tools and the sandbox policy applies as usual.

## Install

```sh
dsh plugin --profile web add https://github.com/Zenjibad/dsh-any-attachment
```

Restart `dsh web` (or rely on the profile patch hot-reload), then hard-refresh the page.

## Limits

| Guard | Value |
| --- | --- |
| Max bytes per file | 25 MB |
| Max files per message | 8 |
| Inlined text per file / per message | 50 KB / 100 KB |
| Name | basename only; traversal, separators, drive letters rejected |
| Upload target | the session's own cwd, resolved server-side |
| Download scope | files must resolve inside that same cwd |

## How it works

- **Host** (`lib/`): registers an RPC channel `/attachments-any` (authority `trusted-host`, same LAN fence as `/api`). `upload` validates base64/size/name, writes into the session cwd, sniffs UTF-8 and extracts; `read` returns bytes for download after a realpath containment check.
- **Client** (`client/`): composer `+` button (`conversation.input.left`), file rail + send (`conversation.input.dock`), and a capture-phase drop handler. Rasters route through `createDraftImages`/`addImages`; everything else uploads via the channel. Sending calls the scope-addressed `conversation.sendSession` with the composed text part.

Known limitation: while files are pending, the composer is blocked with "Send with the files above" — plain Enter sends text without the pending files; use the rail's Send button (or the block clears once the rail is empty).

## Test

```sh
node --test
```

## License

[MIT](LICENSE)
