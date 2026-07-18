import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import fs from 'fs'

// Build flavor (ix-agency | quizverse). Defined as a compile-time constant so
// the renderer bundle bakes the brand in and dead-code-eliminates the other
// brand's workspace. See scripts/apply-brand.mjs + src/lib/brand.ts.
import { loadBrand, resolveBrandId } from './scripts/apply-brand.mjs'

const brandId = resolveBrandId()

// `hgui` symlinks a worktree's node_modules to the main checkout. Vite realpaths
// those before enforcing server.fs.allow, so codicon/font assets resolve outside
// the worktree root and 404. Whitelist the real node_modules locations.
const real = (p: string): string | null => {
  try {
    return fs.realpathSync(p)
  } catch {
    return null
  }
}

const fsAllow = [
  ...new Set(
    [
      path.resolve(__dirname, '../..'),
      real(path.resolve(__dirname, 'node_modules')),
      real(path.resolve(__dirname, '../../node_modules'))
    ].filter((p): p is string => p !== null)
  )
]

export default defineConfig({
  base: './',
  define: {
    'import.meta.env.VITE_DESKTOP_BRAND': JSON.stringify(resolveBrandId())
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'brand-index-html',
      transformIndexHtml(html: string) {
        const touchIcon = loadBrand().touchIcon || loadBrand().markSvg
        const preferDark = brandId !== 'quizverse'
        const withBoot = html.replace(/__BRAND_PREFER_DARK__/g, preferDark ? 'true' : 'false')
        const withTitle = withBoot.replace(/<title>[^<]*<\/title>/, `<title>${loadBrand().productName}</title>`)
        const withFavicon = withTitle
          .replace(/href="(\.\/)?\/apple-touch-icon\.png"/g, `href="/${touchIcon}"`)
          .replace(/href="(\.\/)?\/quizverse\/mark-512\.png"/g, `href="/${touchIcon}"`)
          .replace(/href="\.\/apple-touch-icon\.png"/g, `href="./${touchIcon}"`)

        if (brandId === 'quizverse') {
          return withFavicon.replace(
            '</head>',
            '    <link rel="preconnect" href="https://fonts.googleapis.com" />\n' +
              '    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n' +
              '    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;700;900&display=swap" rel="stylesheet" />\n' +
              '  </head>'
          )
        }

        return withFavicon
      }
    },
    {
      name: 'brand-intro-copy',
      transform(code, id) {
        if (!id.includes('intro-copy.jsonl')) {
          return null
        }

        const productName = loadBrand().productName

        return {
          code: code.replace(/Hermes Agent/g, productName).replace(/\bHermes\b/g, productName),
          map: null
        }
      }
    }
  ],
  css: {
    // Pin an explicit (empty) PostCSS config. Tailwind is handled entirely by
    // `@tailwindcss/vite`, so the renderer needs no PostCSS plugins — and
    // without this, Vite's `postcss-load-config` walks UP the filesystem
    // looking for a stray `postcss.config.*` / `tailwind.config.*`. The desktop
    // build runs from inside the user's home tree (e.g.
    // `C:\Users\<name>\AppData\Local\hermes\hermes-agent\apps\desktop`), so an
    // unrelated Tailwind v3 config higher up the tree gets picked up and
    // reprocesses our v4 stylesheet, failing the build with
    // "`@layer base` is used but no matching `@tailwind base` directive is
    // present." Pinning the config makes the build hermetic.
    postcss: { plugins: [] }
  },
  build: {
    // Keep desktop packaging stable: Shiki ships many dynamic chunks by
    // default, and electron-builder can OOM scanning thousands of files.
    // Collapsing to a single chunk is intentional, so the renderer bundle is
    // large by design (~22 MB). Raise the warning ceiling above that so the
    // cosmetic "chunk larger than 500 kB" nag stays quiet, while still acting
    // as a regression alarm if the bundle balloons well past today's size.
    chunkSizeWarningLimit: 25000,
    rolldownOptions: {
      output: {
        codeSplitting: false
      }
    }
  },
  resolve: {
    alias: [
      {
        find: '@/app/quizverse-brand',
        replacement: path.resolve(
          __dirname,
          brandId === 'quizverse' ? './src/app/quizverse/index.tsx' : './src/app/quizverse.stub.tsx'
        )
      },
      ...(brandId === 'quizverse'
        ? []
        : [
            {
              find: '@/themes/quizverse-theme',
              replacement: path.resolve(__dirname, './src/themes/quizverse-theme.stub.ts')
            }
          ]),
      { find: '@', replacement: path.resolve(__dirname, './src') },
      { find: '@hermes/shared', replacement: path.resolve(__dirname, '../shared/src') },
      { find: 'react', replacement: path.resolve(__dirname, '../../node_modules/react') },
      { find: 'react-dom', replacement: path.resolve(__dirname, '../../node_modules/react-dom') },
      {
        find: 'react/jsx-dev-runtime',
        replacement: path.resolve(__dirname, '../../node_modules/react/jsx-dev-runtime.js')
      },
      {
        find: 'react/jsx-runtime',
        replacement: path.resolve(__dirname, '../../node_modules/react/jsx-runtime.js')
      }
    ],
    dedupe: ['react', 'react-dom']
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    fs: {
      allow: fsAllow
    }
  },
  preview: {
    host: '127.0.0.1',
    port: 4174
  }
})
