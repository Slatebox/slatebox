// node --import ./test/pty/watch-imports.mjs ...: says on stderr each time the wizard's modules or
// its input library are resolved (the lazy-import test runs commands that must never load them).
import module from 'node:module'

module.registerHooks({
  resolve(specifier, context, next) {
    if (specifier.includes('@clack/core') || /ui\/(rich-prompt|term|keys)\.mjs$/.test(specifier)) process.stderr.write(`[resolved] ${specifier}\n`)
    return next(specifier, context)
  },
})
