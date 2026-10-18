import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

const PLUGIN = 'side-pane'
const PANE = 'side-pane'
const TITLE = 'Side pane'
const UPDATE_TOOL = 'mcp__side-pane__update'
const CLEAR_TOOL = 'mcp__side-pane__clear'

const markdown = atom({ plugin: 'side-pane', key: 'markdown' } as const, '')
const isRestored = atom({ plugin: 'side-pane', key: 'isRestored' } as const, false)
const hasWarned = atom({ plugin: 'side-pane', key: 'hasWarned' } as const, false)

// $.store is shared by every session, so the last content is kept per working
// directory and parallel sessions never overwrite each other's live pane.
type Saved = { markdown: string; savedAt: string }
const storeKey = (cwd: string) => `last:${cwd}`

const instructions = (maxChars: number) =>
  [
    '# Side pane',
    '',
    `The user sees a side pane next to this conversation, filled with the \`${UPDATE_TOOL}\` tool. It saves them scrolling back to recall what "option 2" was.`,
    '',
    `- Whenever you list options for the user to pick from, or ask them questions they still have to answer, also call \`${UPDATE_TOOL}\` with those items, in the same turn.`,
    '- Pass the full pane each time: it replaces what was there. Keep items that are still open, drop ones the user settled.',
    '- Group by context: a heading per project or topic, then its items, numbered the way you numbered them in the conversation.',
    `- Keep it short: a few words per item, no explanations, under ${maxChars} characters. Write in the language you are replying in.`,
    `- When nothing is left open, call \`${CLEAR_TOOL}\`.`,
    '- Do not mention the pane or the tool calls in your reply.',
  ].join('\n')

async function open($: EngineInterface) {
  if ((await $.ui.panes()).some(pane => pane.id === PANE)) return
  const opened = await $.ui.open({ id: PANE, title: TITLE })
  if (opened.isPlaced || (await read($, hasWarned))) return
  await update($, hasWarned, () => true)
  $.ui.toast('side-pane: the terminal is too narrow to open the pane unasked; run /side-pane', {
    timeoutMs: 8000,
  })
}

async function show($: EngineInterface, text: string) {
  await update($, markdown, () => text)
  await update($, isRestored, () => false)
  const cwd = await $.session.cwd()
  if (text === '') await $.store.delete(storeKey(cwd))
  else await $.store.set(storeKey(cwd), { markdown: text, savedAt: new Date().toISOString() })
}

export const register: Register = (on, options) => {
  const autoOpen = options.autoOpen !== false
  const maxChars = Math.max(200, Number(options.maxChars) || 3000)

  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'update',
      description:
        'Replace the content of the side pane the user sees next to the conversation. Use it for the options and open questions the user still has to answer.',
      inputSchema: {
        type: 'object',
        properties: {
          markdown: {
            type: 'string',
            description: 'The whole pane as Markdown: headings per context, numbered items.',
          },
        },
        required: ['markdown'],
      },
    })
    await $.tool.register({
      name: 'clear',
      description: 'Empty the side pane once nothing in it is open any more.',
    })
    await $.command.register({
      name: 'side-pane',
      description: 'Show the side pane (`clear` empties it)',
      argumentHint: '[clear]',
      immediate: true,
    })

    // A fresh session starts empty; show the last pane of this directory so a
    // resumed conversation has it back. A hot reload keeps its own state.
    if ((await read($, markdown)) === '') {
      const saved = (await $.store.get(storeKey(e.cwd))) as Saved | undefined
      if (saved?.markdown) {
        await update($, markdown, () => saved.markdown)
        await update($, isRestored, () => true)
      }
    }

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    return {
      sections: [
        ...composed.sections,
        { id: `${PLUGIN}:instructions`, text: instructions(maxChars), scope: 'session' },
      ],
    }
  })

  on('tool.call', { tool: UPDATE_TOOL }, async ($, e) => {
    if (typeof e.markdown !== 'string') return { deny: 'markdown must be a string.' }
    const text = e.markdown.trim()
    const isCut = text.length > maxChars
    await show($, isCut ? text.slice(0, maxChars) : text)
    if (autoOpen && text !== '') await open($)

    return {
      result: isCut
        ? `Side pane updated, cut to ${maxChars} characters. Shorten it next time.`
        : 'Side pane updated.',
    }
  })

  on('tool.call', { tool: CLEAR_TOOL }, async $ => {
    await show($, '')

    return { result: 'Side pane cleared.' }
  })

  on('command.run', { command: 'side-pane' }, async ($, e) => {
    if (e.args.trim() === 'clear') {
      await show($, '')
      return { text: 'Side pane cleared.' }
    }
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Side pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Markdown } = $.ui.resolve(e)
    const body = await read($, markdown)
    const restored = await read($, isRestored)

    return (
      <Box flexDirection="column">
        {body.trim() === '' ? (
          <Text dimColor>Nothing open. Claude fills this pane when it asks you to choose.</Text>
        ) : (
          <Box flexDirection="column">
            {restored && <Text dimColor>From an earlier session here</Text>}
            <Markdown text={body} />
          </Box>
        )}
      </Box>
    )
  })
}
