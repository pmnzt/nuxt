import { isAbsolute, relative } from 'pathe'
import { genDynamicImport } from 'knitwork'
import type { Component, Nuxt, NuxtApp, NuxtPage, NuxtPluginTemplate, NuxtTemplate } from 'nuxt/schema'

interface ComponentsTemplateContext {
  app: NuxtApp
  nuxt: Nuxt
  options: {
    getComponents: (mode?: 'client' | 'server' | 'all') => Component[]
    mode?: 'client' | 'server'
  }
}

type ImportMagicCommentsOptions = {
  chunkName: string
  prefetch?: boolean | number
  preload?: boolean | number
}

const createImportMagicComments = (options: ImportMagicCommentsOptions) => {
  const { chunkName, prefetch, preload } = options
  return [
    `webpackChunkName: "${chunkName}"`,
    prefetch === true || typeof prefetch === 'number' ? `webpackPrefetch: ${prefetch}` : false,
    preload === true || typeof preload === 'number' ? `webpackPreload: ${preload}` : false
  ].filter(Boolean).join(', ')
}

const emptyComponentsPlugin = `
import { defineNuxtPlugin } from '#app/nuxt'
export default defineNuxtPlugin({
  name: 'nuxt:global-components',
})
`

export const componentsPluginTemplate: NuxtPluginTemplate = {
  filename: 'components.plugin.mjs',
  getContents ({ app }) {
    const lazyGlobalComponents = new Set<string>()
    const syncGlobalComponents = new Set<string>()
    for (const component of app.components) {
      if (component.global === 'sync') {
        syncGlobalComponents.add(component.pascalName)
      } else if (component.global) {
        lazyGlobalComponents.add(component.pascalName)
      }
    }
    if (!lazyGlobalComponents.size && !syncGlobalComponents.size) { return emptyComponentsPlugin }

    const lazyComponents = [...lazyGlobalComponents]
    const syncComponents = [...syncGlobalComponents]

    return `import { defineNuxtPlugin } from '#app/nuxt'
import { ${[...lazyComponents.map(c => 'Lazy' + c), ...syncComponents].join(', ')} } from '#components'
const lazyGlobalComponents = [
  ${lazyComponents.map(c => `["${c}", Lazy${c}]`).join(',\n')},
  ${syncComponents.map(c => `["${c}", ${c}]`).join(',\n')}
]

export default defineNuxtPlugin({
  name: 'nuxt:global-components',
  setup (nuxtApp) {
    for (const [name, component] of lazyGlobalComponents) {
      nuxtApp.vueApp.component(name, component)
      nuxtApp.vueApp.component('Lazy' + name, component)
    }
  }
})
`
  }
}

export const componentNamesTemplate: NuxtTemplate<ComponentsTemplateContext> = {
  filename: 'component-names.mjs',
  getContents ({ app }) {
    return `export const componentNames = ${JSON.stringify(app.components.filter(c => !c.island).map(c => c.pascalName))}`
  }
}

export const componentsIslandsTemplate: NuxtTemplate<ComponentsTemplateContext> = {
  // components.islands.mjs'
  getContents ({ app }) {
    const components = app.components
    const pages = app.pages
    const islands = components.filter(component =>
      component.island ||
      // .server components without a corresponding .client component will need to be rendered as an island
      (component.mode === 'server' && !components.some(c => c.pascalName === component.pascalName && c.mode === 'client'))
    )

    const pageExports = pages?.map((p) => {
      if(!p.file || !p.name || !p.server) return ''
      const comment = createImportMagicComments({
        chunkName: p.file
      })

      return `"${p}": defineAsyncComponent(${genDynamicImport(p.file)})`
    }) || []

    return [
      'import { defineAsyncComponent } from \'vue\'',
      'export const islandComponents = {',
      islands.map(
        (c) => {
          const exp = c.export === 'default' ? 'c.default || c' : `c['${c.export}']`
          const comment = createImportMagicComments(c)
          return `  "${c.pascalName}": defineAsyncComponent(${genDynamicImport(c.filePath, { comment })}.then(c => ${exp}))`
        }
      ).join(',\n'),
      pageExports.join(',\n'),
      '}'
    ].join('\n')
  }
}

export const componentsTypeTemplate: NuxtTemplate<ComponentsTemplateContext> = {
  filename: 'components.d.ts',
  getContents: ({ app, nuxt }) => {
    const buildDir = nuxt.options.buildDir
    const componentTypes = app.components.filter(c => !c.island).map(c => [
      c.pascalName,
      `typeof ${genDynamicImport(isAbsolute(c.filePath)
        ? relative(buildDir, c.filePath).replace(/(?<=\w)\.(?!vue)\w+$/g, '')
        : c.filePath.replace(/(?<=\w)\.(?!vue)\w+$/g, ''), { wrapper: false })}['${c.export}']`
    ])

    return `// Generated by components discovery
declare module 'vue' {
  export interface GlobalComponents {
${componentTypes.map(([pascalName, type]) => `    '${pascalName}': ${type}`).join('\n')}
${componentTypes.map(([pascalName, type]) => `    'Lazy${pascalName}': ${type}`).join('\n')}
  }
}

${componentTypes.map(([pascalName, type]) => `export const ${pascalName}: ${type}`).join('\n')}
${componentTypes.map(([pascalName, type]) => `export const Lazy${pascalName}: ${type}`).join('\n')}

export const componentNames: string[]
`
  }
}
