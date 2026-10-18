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
const stubEngine = (on: On, stored: Record<string, unknown> = {}) => {
  const toasts: string[] = []
  const opens: string[] = []
  on('session.cwd', () => ({ value: '/work/esp32' }))
  mock.store(on, stored)
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', (_$, e) => {
    opens.push(e.id)
    return { value: { isPlaced: false, reason: 'narrow' } }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return { toasts, opens }
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

test('the system prompt carries the instructions', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'Hi.', scope: 'shared' }] }))
  const { sections } = await $.prompt.compose({
    model: 'claude-opus-5-5',
    promptModel: 'claude-opus-5-5',
    surfaces: ['terminal'],
    tools: [],
    outputStyle: null,
    traits: [],
  })
  expect(sections[0]?.id).toBe('intro')
  const ours = sections.find(section => section.id === 'side-pane:instructions')
  expect(ours?.text).toMatch(/mcp__side-pane__update/)
  expect(ours?.scope).toBe('session')
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
