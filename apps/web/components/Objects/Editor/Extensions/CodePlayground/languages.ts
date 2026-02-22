export interface PlaygroundLanguage {
  id: number // Judge0 language ID
  name: string
  codemirrorLang: string // key used to resolve the CodeMirror language extension
  defaultCode: string
}

export const PLAYGROUND_LANGUAGES: PlaygroundLanguage[] = [
  {
    id: 71,
    name: 'Python 3',
    codemirrorLang: 'python',
    defaultCode: '# Write your code here\n',
  },
  {
    id: 63,
    name: 'JavaScript (Node)',
    codemirrorLang: 'javascript',
    defaultCode: '// Write your code here\n',
  },
  {
    id: 74,
    name: 'TypeScript',
    codemirrorLang: 'javascript',
    defaultCode: '// Write your code here\n',
  },
  {
    id: 62,
    name: 'Java',
    codemirrorLang: 'java',
    defaultCode:
      'import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        // Write your code here\n    }\n}\n',
  },
  {
    id: 54,
    name: 'C++',
    codemirrorLang: 'cpp',
    defaultCode:
      '#include <iostream>\nusing namespace std;\n\nint main() {\n    // Write your code here\n    return 0;\n}\n',
  },
  {
    id: 50,
    name: 'C',
    codemirrorLang: 'cpp',
    defaultCode:
      '#include <stdio.h>\n\nint main() {\n    // Write your code here\n    return 0;\n}\n',
  },
  {
    id: 73,
    name: 'Rust',
    codemirrorLang: 'rust',
    defaultCode: 'fn main() {\n    // Write your code here\n}\n',
  },
  {
    id: 60,
    name: 'Go',
    codemirrorLang: 'go',
    defaultCode:
      'package main\n\nimport "fmt"\n\nfunc main() {\n    // Write your code here\n    fmt.Println("Hello")\n}\n',
  },
  {
    id: 68,
    name: 'PHP',
    codemirrorLang: 'php',
    defaultCode: '<?php\n// Write your code here\n',
  },
  {
    id: 72,
    name: 'Ruby',
    codemirrorLang: 'python', // closest syntax highlighting
    defaultCode: '# Write your code here\n',
  },
  {
    id: 78,
    name: 'Kotlin',
    codemirrorLang: 'java',
    defaultCode: 'fun main() {\n    // Write your code here\n}\n',
  },
  {
    id: 51,
    name: 'C#',
    codemirrorLang: 'java',
    defaultCode:
      'using System;\n\nclass Program {\n    static void Main() {\n        // Write your code here\n    }\n}\n',
  },
]

export function getLanguageById(id: number): PlaygroundLanguage | undefined {
  return PLAYGROUND_LANGUAGES.find((l) => l.id === id)
}
