import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution'
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution'
import 'monaco-editor/esm/vs/basic-languages/wgsl/wgsl.contribution'
import './browser.css'

self.MonacoEnvironment = { getWorker: () => new EditorWorker() }

type Example = {
  slug: string
  title: string
  description: string
  group: 'Basics' | 'Rendering' | 'Compute'
}

const examples: Example[] = [
  {
    slug: 'hello-triangle',
    title: 'Hello Triangle',
    description: 'The smallest regpu rendering example.',
    group: 'Basics'
  },
  {
    slug: 'hello-cube',
    title: 'Hello Cube',
    description: 'Render a rotating, depth-tested cube.',
    group: 'Basics'
  },
  {
    slug: 'two-cubes',
    title: 'Two Cubes',
    description: 'Compose commands and draw multiple objects.',
    group: 'Basics'
  },
  {
    slug: 'textured-cube',
    title: 'Textured Cube',
    description: 'Sample a 2D texture on a rotating cube.',
    group: 'Basics'
  },
  {
    slug: 'instanced-cube',
    title: 'Instanced Cubes',
    description: 'Draw many cubes with a single command.',
    group: 'Basics'
  },
  {
    slug: 'instanced-mesh',
    title: 'Instanced Mesh',
    description: 'Render an instanced geometry mesh.',
    group: 'Basics'
  },
  {
    slug: 'envmap',
    title: 'Environment Map',
    description: 'Reflect a cubemap from a 3D object.',
    group: 'Rendering'
  },
  {
    slug: 'cube-fbo',
    title: 'Cube Framebuffers',
    description: 'Render dynamic reflections into a cubemap.',
    group: 'Rendering'
  },
  {
    slug: 'metaball',
    title: 'Metaballs',
    description: 'Render an animated, bump-mapped metaball surface.',
    group: 'Rendering'
  },
  {
    slug: 'wireframe',
    title: 'Wireframe',
    description: 'Build and render wireframe geometry.',
    group: 'Rendering'
  },
  {
    slug: 'deferred-rendering',
    title: 'Deferred Rendering',
    description: 'Use multiple render targets for deferred shading.',
    group: 'Rendering'
  },
  {
    slug: 'gaussian-splat',
    title: 'Gaussian Splatting',
    description: 'Display a scene made from 3D Gaussian splats.',
    group: 'Rendering'
  },
  {
    slug: 'compute-boids',
    title: 'Compute Boids',
    description: 'Simulate flocking particles with a compute shader.',
    group: 'Compute'
  },
  {
    slug: 'game-of-life',
    title: 'Game of Life',
    description: 'Run Conway’s Game of Life on the GPU.',
    group: 'Compute'
  },
  {
    slug: 'marching-cubes',
    title: 'Marching Cubes',
    description: 'Generate and render an animated isosurface on the GPU.',
    group: 'Compute'
  }
]

const sourceModules = import.meta.glob('./examples/**/*.{ts,wgsl}', {
  eager: true,
  query: '?raw',
  import: 'default'
}) as Record<string, string>

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const list = byId<HTMLElement>('example-list')
const filter = byId<HTMLInputElement>('example-filter')
const title = byId<HTMLElement>('example-title')
const description = byId<HTMLElement>('example-description')
const preview = byId<HTMLIFrameElement>('preview')
const previewLoading = byId<HTMLElement>('preview-loading')
const openButton = byId<HTMLAnchorElement>('open-button')
const tabs = byId<HTMLElement>('source-tabs')
const copyButton = byId<HTMLButtonElement>('copy-button')
const sidebar = document.querySelector<HTMLElement>('.sidebar')!
const menuButton = byId<HTMLButtonElement>('menu-button')
const themeButton = byId<HTMLButtonElement>('theme-button')
const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')

const resolvedTheme = () =>
  document.documentElement.dataset.theme ?? (colorScheme.matches ? 'dark' : 'light')

function updateTheme() {
  const theme = resolvedTheme()
  monaco.editor.setTheme(theme === 'dark' ? 'vs-dark' : 'vs')
  themeButton.title = `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`
  themeButton.setAttribute('aria-label', themeButton.title)
}

const editor = monaco.editor.create(byId('editor'), {
  automaticLayout: true,
  fontFamily: 'SFMono-Regular, Consolas, "Liberation Mono", monospace',
  fontSize: 12,
  lineHeight: 20,
  minimap: { enabled: false },
  padding: { top: 12, bottom: 12 },
  readOnly: true,
  renderLineHighlight: 'none',
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  theme: resolvedTheme() === 'dark' ? 'vs-dark' : 'vs',
  wordWrap: 'off'
})

let current = examples[0]
let currentSource = ''
let models: monaco.editor.ITextModel[] = []

const displayName = (path: string) => path.split('/').pop() ?? path
const languageFor = (path: string) =>
  path.endsWith('.wgsl') ? 'wgsl' : path.endsWith('.html') ? 'html' : 'typescript'

function sourcesFor(example: Example) {
  const prefix = `./examples/${example.slug}/`
  return Object.entries(sourceModules)
    .filter(([path]) => path.startsWith(prefix))
    .sort(([a], [b]) => {
      const order = (path: string) =>
        path.endsWith('main.ts') ? 0 : path.endsWith('.wgsl') ? 1 : path.endsWith('.ts') ? 2 : 3
      return order(a) - order(b) || a.localeCompare(b)
    })
}

function selectSource(model: monaco.editor.ITextModel, button: HTMLButtonElement) {
  editor.setModel(model)
  currentSource = model.getValue()
  tabs.querySelectorAll('.source-tab').forEach((tab) => tab.classList.remove('active'))
  button.classList.add('active')
  button.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
}

function renderSources(example: Example) {
  models.forEach((model) => model.dispose())
  models = []
  tabs.replaceChildren()

  sourcesFor(example).forEach(([path, source], index) => {
    const model = monaco.editor.createModel(
      source,
      languageFor(path),
      monaco.Uri.parse(`file:///${path.slice(2)}`)
    )
    models.push(model)
    const button = document.createElement('button')
    button.className = 'source-tab'
    button.type = 'button'
    button.role = 'tab'
    button.textContent = displayName(path)
    button.setAttribute('aria-selected', String(index === 0))
    button.addEventListener('click', () => {
      tabs
        .querySelectorAll('[role="tab"]')
        .forEach((tab) => tab.setAttribute('aria-selected', 'false'))
      button.setAttribute('aria-selected', 'true')
      selectSource(model, button)
    })
    tabs.append(button)
    if (index === 0) selectSource(model, button)
  })
}

function renderList(query = '') {
  list.replaceChildren()
  const matches = examples.filter((example) =>
    `${example.title} ${example.group}`.toLowerCase().includes(query.toLowerCase())
  )
  if (!matches.length) {
    const empty = document.createElement('div')
    empty.className = 'empty-list'
    empty.textContent = 'No examples found'
    list.append(empty)
    return
  }

  for (const group of ['Basics', 'Rendering', 'Compute'] as const) {
    const groupExamples = matches.filter((example) => example.group === group)
    if (!groupExamples.length) continue
    const heading = document.createElement('div')
    heading.className = 'group-label'
    heading.textContent = group
    list.append(heading)
    groupExamples.forEach((example) => {
      const link = document.createElement('a')
      link.className = `example-link${example === current ? ' active' : ''}`
      link.href = `#${example.slug}`
      link.textContent = example.title
      list.append(link)
    })
  }
}

function selectExample(example: Example) {
  current = example
  document.title = `${example.title} · regpu examples`
  title.textContent = example.title
  description.textContent = example.description
  const url = `./examples/${example.slug}/index.html`
  preview.classList.add('loading')
  previewLoading.hidden = false
  preview.src = url
  window.setTimeout(hidePreviewLoading, 1200)
  openButton.href = url
  renderList(filter.value)
  renderSources(example)
  sidebar.classList.remove('open')
  menuButton.setAttribute('aria-expanded', 'false')
}

function selectFromHash() {
  const slug = window.location.hash.slice(1)
  selectExample(examples.find((example) => example.slug === slug) ?? examples[0])
}

function hidePreviewLoading() {
  preview.classList.remove('loading')
  previewLoading.hidden = true
}

preview.addEventListener('load', hidePreviewLoading)
byId('reload-button').addEventListener('click', () => preview.contentWindow?.location.reload())
filter.addEventListener('input', () => renderList(filter.value))
window.addEventListener('hashchange', selectFromHash)
window.addEventListener('keydown', (event) => {
  if (event.key === '/' && document.activeElement !== filter) {
    event.preventDefault()
    filter.focus()
  }
})
menuButton.addEventListener('click', () => {
  const isOpen = sidebar.classList.toggle('open')
  menuButton.setAttribute('aria-expanded', String(isOpen))
})
byId('sidebar-backdrop').addEventListener('click', () => {
  sidebar.classList.remove('open')
  menuButton.setAttribute('aria-expanded', 'false')
})
copyButton.addEventListener('click', async () => {
  await navigator.clipboard.writeText(currentSource)
  const label = copyButton.querySelector('span')!
  label.textContent = 'Copied'
  window.setTimeout(() => {
    label.textContent = 'Copy'
  }, 1200)
})

themeButton.addEventListener('click', () => {
  const theme = resolvedTheme() === 'dark' ? 'light' : 'dark'
  document.documentElement.dataset.theme = theme
  localStorage.setItem('regpu-example-theme', theme)
  updateTheme()
})
colorScheme.addEventListener('change', () => {
  if (!document.documentElement.dataset.theme) updateTheme()
})

updateTheme()
selectFromHash()
