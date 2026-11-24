// Questions for people: short, each with a default that Enter accepts.
// Only used when there is a person at a terminal; agents get exit code 3 and
// the list of questions instead.
import { createInterface } from 'node:readline'
import { EXIT, InstallError } from './errors.mjs'

export function createPrompt({ input, output }) {
  // One reader for the whole run, with lines queued, so answers typed (or
  // piped) ahead of their question are not lost.
  const rl = createInterface({ input, terminal: false })
  const queue = []
  const waiting = []
  let closed = false
  rl.on('line', line => (waiting.length ? waiting.shift()(line) : queue.push(line)))
  rl.on('close', () => { closed = true; while (waiting.length) waiting.shift()(null) })
  const nextLine = () => (queue.length ? Promise.resolve(queue.shift()) : closed ? Promise.resolve(null) : new Promise(resolve => waiting.push(resolve)))

  async function line(prompt) {
    output.write(prompt)
    const answer = await nextLine()
    if (answer === null) throw new InstallError(EXIT.CANCELLED, 'Cancelled.')
    return answer.trim()
  }

  return {
    async text(question, { default: fallback = '', validate, optional = false } = {}) {
      for (;;) {
        const answer = (await line(`? ${question}${fallback ? ` (${fallback})` : optional ? ' (Enter skips)' : ''}: `)) || fallback
        if (!answer && optional) return ''
        const problem = !answer ? 'An answer is needed.' : validate?.(answer)
        if (!problem) return answer
        output.write(`  ${problem}\n`)
      }
    },
    async choose(question, choices, { default: fallback = null } = {}) {
      output.write(`? ${question}\n`)
      choices.forEach((choice, index) => output.write(`  ${index + 1}) ${choice.label}${choice.value === fallback ? '  [default]' : ''}\n`))
      for (;;) {
        const answer = await line(`  Choose 1-${choices.length}${fallback ? ' (Enter for the default)' : ''}: `)
        if (!answer && fallback) return fallback
        const index = Number(answer) - 1
        if (Number.isInteger(index) && choices[index]) return choices[index].value
        const named = choices.find(choice => choice.value === answer)
        if (named) return named.value
        output.write('  Type the number of a choice.\n')
      }
    },
    async confirm(question, { default: fallback = false } = {}) {
      const answer = (await line(`? ${question} [${fallback ? 'Y/n' : 'y/N'}]: `)).toLowerCase()
      if (!answer) return fallback
      return answer === 'y' || answer === 'yes'
    },
    /** Hidden input: nothing is echoed while the key is typed. */
    async secret(question) {
      output.write(`? ${question}: `)
      const tty = input.isTTY && typeof input.setRawMode === 'function'
      if (!tty) {
        const answer = await nextLine()
        output.write('\n')
        return answer?.trim() || undefined
      }
      rl.pause()
      input.setRawMode(true)
      input.resume()
      let value = ''
      try {
        await new Promise((resolve, reject) => {
          const onData = chunk => {
            for (const char of chunk.toString('utf8')) {
              if (char === '\r' || char === '\n') { input.off('data', onData); resolve(); return }
              if (char === '\u0003') { input.off('data', onData); reject(new InstallError(EXIT.CANCELLED, 'Cancelled.')); return }
              if (char === '\u007f') value = value.slice(0, -1)
              else value += char
            }
          }
          input.on('data', onData)
        })
      } finally {
        input.setRawMode(false)
        output.write('\n')
        rl.resume()
      }
      return value || undefined
    },
    close: () => rl.close(),
  }
}
