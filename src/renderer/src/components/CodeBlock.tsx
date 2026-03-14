import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-light'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

// Register only the languages we need (tree-shakeable with prism-light)
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx'
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript'
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx'
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python'
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash'
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css'
import scss from 'react-syntax-highlighter/dist/esm/languages/prism/scss'
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown'
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust'
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go'
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java'
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml'
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql'
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup'
import diff from 'react-syntax-highlighter/dist/esm/languages/prism/diff'
import toml from 'react-syntax-highlighter/dist/esm/languages/prism/toml'
import c from 'react-syntax-highlighter/dist/esm/languages/prism/c'
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp'
import csharp from 'react-syntax-highlighter/dist/esm/languages/prism/csharp'
import swift from 'react-syntax-highlighter/dist/esm/languages/prism/swift'
import kotlin from 'react-syntax-highlighter/dist/esm/languages/prism/kotlin'
import ruby from 'react-syntax-highlighter/dist/esm/languages/prism/ruby'

// Language must be registered before dependents (tsx needs typescript, jsx needs javascript)
SyntaxHighlighter.registerLanguage('c', c)
SyntaxHighlighter.registerLanguage('cpp', cpp)
SyntaxHighlighter.registerLanguage('javascript', javascript)
SyntaxHighlighter.registerLanguage('jsx', jsx)
SyntaxHighlighter.registerLanguage('typescript', typescript)
SyntaxHighlighter.registerLanguage('tsx', tsx)
SyntaxHighlighter.registerLanguage('python', python)
SyntaxHighlighter.registerLanguage('bash', bash)
SyntaxHighlighter.registerLanguage('json', json)
SyntaxHighlighter.registerLanguage('css', css)
SyntaxHighlighter.registerLanguage('scss', scss)
SyntaxHighlighter.registerLanguage('markdown', markdown)
SyntaxHighlighter.registerLanguage('rust', rust)
SyntaxHighlighter.registerLanguage('go', go)
SyntaxHighlighter.registerLanguage('java', java)
SyntaxHighlighter.registerLanguage('yaml', yaml)
SyntaxHighlighter.registerLanguage('sql', sql)
SyntaxHighlighter.registerLanguage('markup', markup)
SyntaxHighlighter.registerLanguage('diff', diff)
SyntaxHighlighter.registerLanguage('toml', toml)
SyntaxHighlighter.registerLanguage('csharp', csharp)
SyntaxHighlighter.registerLanguage('swift', swift)
SyntaxHighlighter.registerLanguage('kotlin', kotlin)
SyntaxHighlighter.registerLanguage('ruby', ruby)


const HIGHLIGHTER_STYLE = {
  ...vscDarkPlus,
  'pre[class*="language-"]': {
    ...vscDarkPlus['pre[class*="language-"]'],
    background: 'transparent',
    margin: 0,
    padding: 0,
  },
  'code[class*="language-"]': {
    ...vscDarkPlus['code[class*="language-"]'],
    background: 'transparent',
  },
}

interface CodeBlockProps {
  code: string
  language?: string
  showLineNumbers?: boolean
  startingLineNumber?: number
}

export function CodeBlock({ code, language = 'text', showLineNumbers = false, startingLineNumber = 1 }: CodeBlockProps) {
  return (
    <SyntaxHighlighter
      language={language}
      style={HIGHLIGHTER_STYLE}
      showLineNumbers={showLineNumbers}
      startingLineNumber={startingLineNumber}
      wrapLongLines
      customStyle={{
        margin: 0,
        padding: '10px 12px',
        background: 'transparent',
        fontSize: '0.85em',
        lineHeight: '1.5',
      }}
      lineNumberStyle={{
        color: '#555',
        minWidth: '2.5em',
        paddingRight: '1em',
        userSelect: 'none',
      }}
    >
      {code}
    </SyntaxHighlighter>
  )
}
