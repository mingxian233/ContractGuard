import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { rollup } from 'rollup'
import ts from 'typescript'

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceDirectory = resolve(projectDirectory, 'src')
const outputDirectory = resolve(projectDirectory, 'dist')
const assetsDirectory = resolve(outputDirectory, 'assets')

await rm(outputDirectory, { recursive: true, force: true })
await mkdir(assetsDirectory, { recursive: true })

const bundle = await rollup({
  input: resolve(sourceDirectory, 'main.ts'),
  plugins: [resolver(), sourceTransforms()],
  onwarn(warning, warn) {
    if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') warn(warning)
  },
})

await bundle.write({
  file: resolve(assetsDirectory, 'app.js'),
  format: 'es',
  sourcemap: true,
  paths: { vue: './vue.esm-browser.prod.js' },
})
await bundle.close()

await cp(resolve(projectDirectory, 'node_modules/vue/dist/vue.esm-browser.prod.js'), resolve(assetsDirectory, 'vue.esm-browser.prod.js'))
await cp(resolve(sourceDirectory, 'style.css'), resolve(assetsDirectory, 'app.css'))

const html = (await readFile(resolve(projectDirectory, 'index.html'), 'utf8'))
  .replace(/<script[^>]+src="\/src\/main\.ts"[^>]*><\/script>/, '<script type="module" src="./assets/app.js"></script>')
  .replace('</head>', '  <link rel="stylesheet" href="./assets/app.css">\n</head>')
await writeFile(resolve(outputDirectory, 'index.html'), html, 'utf8')
process.stdout.write('Portable web build written to apps/web/dist.\n')

function resolver() {
  return {
    name: 'contractguard-resolver',
    async resolveId(source, importer) {
      if (source === 'vue') return { id: source, external: true }
      if (!importer || !source.startsWith('.')) return null
      const cleanImporter = importer.split('?')[0]
      const base = resolve(dirname(cleanImporter), source)
      const candidates = extname(base) ? [base] : [base, `${base}.ts`, `${base}.vue`, `${base}.js`]
      for (const candidate of candidates) {
        try {
          await readFile(candidate)
          return candidate
        } catch {
          // Try the next supported source extension.
        }
      }
      return null
    },
  }
}

function sourceTransforms() {
  return {
    name: 'contractguard-source-transforms',
    async load(id) {
      if (id.endsWith('.css')) return 'export default undefined'
      if (!id.endsWith('.vue')) return null

      const source = await readFile(id, 'utf8')
      const { descriptor, errors } = parse(source, { filename: id })
      if (errors.length) throw new Error(`Could not parse ${id}: ${formatErrors(errors)}`)
      if (!descriptor.script && !descriptor.scriptSetup) throw new Error(`${id} has no script block.`)
      if (!descriptor.template) throw new Error(`${id} has no template block.`)

      const scopeId = createHash('sha256').update(id).digest('hex').slice(0, 8)
      const script = compileScript(descriptor, { id: scopeId, genDefaultAs: '__sfc__' })
      const template = compileTemplate({
        id: scopeId,
        filename: id,
        source: descriptor.template.content,
        compilerOptions: { bindingMetadata: script.bindings },
      })
      if (template.errors.length) throw new Error(`Could not compile ${id}: ${formatErrors(template.errors)}`)

      const templateCode = template.code.replace(/export function render/, 'function render')
      const combined = `${script.content.replace(/\nexport default __sfc__\s*$/, '')}\n${templateCode}\n__sfc__.render = render\nexport default __sfc__\n`
      return transpile(combined, id)
    },
    transform(code, id) {
      if (id.endsWith('.ts')) return { code: transpile(code, id), map: null }
      return null
    },
  }
}

function transpile(code, filename) {
  const replaced = code.replace(/import\.meta\.env\.VITE_API_BASE/g, JSON.stringify(process.env.VITE_API_BASE ?? ''))
  return ts.transpileModule(replaced, {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      verbatimModuleSyntax: true,
    },
  }).outputText
}

function formatErrors(errors) {
  return errors.map((error) => error instanceof Error ? error.message : String(error)).join('; ')
}
