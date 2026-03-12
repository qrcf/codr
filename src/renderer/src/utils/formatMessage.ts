/**
 * Preprocesses message content to convert raw XML-like tags
 * from Claude Code slash commands into formatted markdown.
 */
export function formatMessageContent(content: string): string {
  let result = content

  // Strip <system-reminder>...</system-reminder> blocks entirely (multiline)
  result = result.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')

  // Convert <command-name>/foo</command-name> to inline code
  result = result.replace(/<command-name>(.*?)<\/command-name>/g, '`$1`')

  // Strip <command-message>...</command-message> (redundant with command-name)
  result = result.replace(/<command-message>.*?<\/command-message>/g, '')

  // Handle <command-args>: strip if empty, show content if present
  result = result.replace(/<command-args>(.*?)<\/command-args>/g, (_match, args: string) => {
    return args.trim() ? ` ${args.trim()}` : ''
  })

  // Convert <local-command-stdout>...</local-command-stdout> to a subtle output
  result = result.replace(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/g, (_match, output: string) => {
    const trimmed = output.trim()
    return trimmed ? `\n> ${trimmed}\n` : ''
  })

  // Clean up excessive whitespace left behind
  result = result.replace(/\n{3,}/g, '\n\n').trim()

  return result
}
