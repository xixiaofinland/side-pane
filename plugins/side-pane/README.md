# side-pane

A Claude Code plugin that keeps the options and open questions Claude asks you about in a
pane beside the conversation. In a long chat you no longer scroll back to remember what
"option 2" was.

![Claude fills the side pane with its options and questions, then updates it as you answer](https://raw.githubusercontent.com/xixiaofinland/side-pane/main/docs/side-pane.gif)

Claude fills the pane itself: the plugin gives it a tool and a short instruction to call
it whenever it lists options or asks you something. The topic you are on stays at the
top; unanswered items of an earlier topic move under "On hold". Each session has its own
pane, and the last pane of a directory comes back when you start a new session there.

## Requirements

Claude Code 2.1.289 or newer. The pane is built on Claude Code mods (plugins of function
hooks), which are in early access.

## Use

- The pane opens the first time Claude fills it.
- `/side-pane` shows or hides it; `/side-pane clear` empties it. Once you hide the pane,
  Claude keeps it current but no longer reopens it in that session.
- Works in the terminal and in the Code tab of Claude Code Desktop.
- In the terminal, a pane Claude Code was not asked for is placed only at least 144
  columns wide (110 once you have opened it yourself). In a narrower terminal you get a
  toast; run `/side-pane` and it opens at any width. Desktop places the pane itself.

## Settings

Change them in `/config`:

| Setting    | Default | What it does                                    |
| ---------- | ------- | ----------------------------------------------- |
| `autoOpen` | `true`  | Open the pane when Claude first fills it        |
| `maxChars` | `3000`  | Longest pane content in characters; more is cut |

## Data

The plugin runs no commands, opens no network connections and reads no files. It keeps
the pane's text in the session's plugin state, and the last pane of each working
directory in Claude Code's local plugin store, keyed by that directory's path, so a new
session there can show it again. `/side-pane clear` deletes that saved copy.

## License

MIT. Source and issues: https://github.com/xixiaofinland/side-pane
