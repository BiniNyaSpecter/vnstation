/**
 * Splits a launch-arguments string into individual arguments following Windows'
 * `CommandLineToArgvW` rules, without ever invoking a shell:
 *
 * - Whitespace outside double quotes separates arguments.
 * - Double quotes group text (including spaces) into a single argument and are stripped.
 * - `2n` backslashes followed by `"` produce `n` backslashes and open/close quotes.
 * - `2n + 1` backslashes followed by `"` produce `n` backslashes and a literal `"`.
 * - Backslashes not followed by `"` are kept as-is, so Windows paths like
 *   `D:\Visual Novels\Save\` are never mangled.
 */
export function splitArguments(raw: string): string[] {
  const input = raw.trim()
  if (!input) return []

  const args: string[] = []
  let current = ''
  let inQuotes = false
  let hasToken = false

  for (let i = 0; i < input.length; ) {
    const ch = input[i]

    if (ch === '\\') {
      let slashes = 0
      while (i < input.length && input[i] === '\\') {
        slashes++
        i++
      }
      if (i < input.length && input[i] === '"') {
        current += '\\'.repeat(Math.floor(slashes / 2))
        if (slashes % 2 === 0) {
          inQuotes = !inQuotes
        } else {
          current += '"'
        }
        hasToken = true
        i++
      } else {
        current += '\\'.repeat(slashes)
        hasToken = true
      }
      continue
    }

    if (ch === '"') {
      inQuotes = !inQuotes
      hasToken = true
      i++
      continue
    }

    if (!inQuotes && /\s/.test(ch)) {
      if (hasToken) {
        args.push(current)
        current = ''
        hasToken = false
      }
      while (i < input.length && /\s/.test(input[i])) i++
      continue
    }

    current += ch
    hasToken = true
    i++
  }

  if (hasToken) args.push(current)
  return args
}
