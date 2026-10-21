import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const mountPane = ($: Engine, surface: 'terminal' | 'desktop') =>
  $.ui.mount({
    plugin: 'side-pane',
    surface,
    component: 'Pane',
    requestId: 'side-pane',
    props: {},
  } as never)

// What the engine beneath the plugin answers: a project directory, a store in
// memory, and a terminal too narrow to place a pane opened unasked.
// /side-pane as the person types it at a terminal.
const typed = (args: string) => ({
  command: 'side-pane',
  args,
  origin: { kind: 'composer' } as const,
  presentation: { isFullscreen: true, columns: 160 },
})

const stubEngine = (on: On, stored: Record<string, unknown> = {}) => {
  const toasts: string[] = []
  const opens: string[] = []
  const closes: string[] = []
  on('session.cwd', () => ({ value: '/work/esp32' }))
  mock.store(on, stored)
  // The pane is placed only when the person asked (a typed command).
  const shown = new Set<string>()
  on('ui.panes', () => ({
    value: [...shown].map(id => ({
      id,
      title: id,
      isShown: true,
      isFocused: false,
      isPlaced: true,
    })),
  }))
  on('ui.open', (_$, e) => {
    opens.push(e.id)
    return { value: { isPlaced: false, reason: 'narrow' } }
  })
  on('ui.close', (_$, e) => {
    closes.push(e.id)
    shown.delete(e.id)
    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return { toasts, opens, closes, shown }
}

test('the pane shows a hint while nothing is open', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountPane($, surface)
    expect(await ui.find({ type: 'Text', text: /Nothing open/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the update tool fills the pane and clear empties it', async ($, on) => {
  const engine = stubEngine(on)
  const updated = await $.tool.call({
    tool: 'mcp__side-pane__update',
    markdown: '## ESP32\n1. LED strip\n2. Sensor',
  })
  expect(updated.result).toBe('Side pane updated.')
  expect(engine.opens).toEqual(['side-pane'])
  expect(engine.toasts).toHaveLength(1)
  await $.tool.call({ tool: 'mcp__side-pane__update', markdown: '## ESP32\n1. LED strip' })
  expect(engine.toasts).toHaveLength(1)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountPane($, surface)
    expect(await ui.find({ type: 'Markdown', text: /LED strip/ })).toBeDefined()
    await ui.unmount()
  }

  const cleared = await $.tool.call({ tool: 'mcp__side-pane__clear' })
  expect(cleared.result).toBe('Side pane cleared.')
  const ui = await mountPane($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /Nothing open/ })).toBeDefined()
  await ui.unmount()
})

test('content past maxChars is cut', { options: { maxChars: 200 } }, async ($, on) => {
  const engine = stubEngine(on)
  const updated = await $.tool.call({ tool: 'mcp__side-pane__update', markdown: 'x'.repeat(500) })
  expect(updated.result).toMatch(/cut to 200 characters/)
  void engine
})

test(
  'autoOpen off never opens the pane unasked',
  { options: { autoOpen: false } },
  async ($, on) => {
    const engine = stubEngine(on)
    await $.tool.call({ tool: 'mcp__side-pane__update', markdown: '1. A' })
    expect(engine.opens).toEqual([])
  },
)

test('the update tool is listed in the prompt, not behind ToolSearch', async ($, on) => {
  on('tool.describe', (_$, e) => ({ description: e.description, isDeferred: true }))
  const described = await $.tool.describe({
    tool: 'mcp__side-pane__update',
    description: 'Rules.',
    isDeferred: true,
    provider: { plugin: 'side-pane', tier: 'user' },
  })
  expect(described.isDeferred).toBe(false)
  expect(described.description).toBe('Rules.')
})

test('the first message carries a nudge to use the tool', async ($, on) => {
  on('prompt.context', () => ({ blocks: [{ name: 'currentDate', text: '2026-10-18' }] }))
  const { blocks } = await $.prompt.context({ blocks: [] })
  expect(blocks[0]?.name).toBe('currentDate')
  expect(blocks.find(block => block.name === 'side-pane')?.text).toMatch(/mcp__side-pane__update/)
})

test('a new session shows the last pane of its directory', async ($, on) => {
  stubEngine(on, { 'last:/work/esp32': { markdown: '1. Earlier item', savedAt: '2026-10-18' } })
  on('tool.register', () => ({ value: { tool: 'x' } }))
  on('command.register', () => ({ value: { command: 'side-pane' } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work/esp32', surface: 'terminal', isInteractive: true })

  const ui = await mountPane($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /earlier session/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: /Earlier item/ })).toBeDefined()
  await ui.unmount()
})

test('/side-pane toggles the pane, and a closed pane stays closed', async ($, on) => {
  const engine = stubEngine(on)
  engine.shown.add('side-pane')
  const closed = await $.command.run(typed(''))
  expect(closed.text).toMatch(/closed/)
  expect(engine.closes).toEqual(['side-pane'])
  await $.tool.call({ tool: 'mcp__side-pane__update', markdown: '1. A' })
  expect(engine.opens).toEqual([])

  const opened = await $.command.run(typed(''))
  expect(opened.text).toMatch(/opened/)
  expect(engine.opens).toEqual(['side-pane'])

  const unknown = await $.command.run(typed('off'))
  expect(unknown.text).toMatch(/Usage/)
})

test('each item copies or quotes itself on every surface', async ($, on) => {
  stubEngine(on)
  const copies: string[] = []
  const fills: string[] = []
  on('ui.copy', (_$, e) => {
    copies.push(e.text)
    return { value: { isCopied: true } }
  })
  on('prompt.fill', (_$, e) => {
    fills.push(e.text)
    return { isFilled: true }
  })
  const body = '## ESP32\n1. LED strip\n2. Sensor'
  await $.tool.call({ tool: 'mcp__side-pane__update', markdown: body })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountPane($, surface)
    expect(await ui.find({ type: 'Markdown', text: /ESP32/ })).toBeDefined()
    await ui.press({ key: 'copy:2' })
    await ui.press({ key: 'quote:1' })
    await ui.press({ key: 'copy-all' })
    await ui.unmount()
  }
  expect(copies).toEqual(['2. Sensor', body, '2. Sensor', body])
  expect(fills).toEqual(['> 1. LED strip\n', '> 1. LED strip\n'])
})
