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
  {
    id: 83,
    name: 'Swift',
    codemirrorLang: 'javascript',
    defaultCode: 'import Foundation\n\n// Write your code here\n',
  },
  {
    id: 81,
    name: 'Scala',
    codemirrorLang: 'java',
    defaultCode:
      'object Main extends App {\n    // Write your code here\n}\n',
  },
  {
    id: 85,
    name: 'Perl',
    codemirrorLang: 'perl',
    defaultCode: '#!/usr/bin/perl\nuse strict;\nuse warnings;\n\n# Write your code here\n',
  },
  {
    id: 80,
    name: 'R',
    codemirrorLang: 'r',
    defaultCode: '# Write your code here\n',
  },
  {
    id: 90,
    name: 'Dart',
    codemirrorLang: 'javascript',
    defaultCode: 'void main() {\n  // Write your code here\n}\n',
  },
  {
    id: 61,
    name: 'Haskell',
    codemirrorLang: 'haskell',
    defaultCode: 'main :: IO ()\nmain = do\n    -- Write your code here\n    putStrLn "Hello"\n',
  },
  {
    id: 64,
    name: 'Lua',
    codemirrorLang: 'lua',
    defaultCode: '-- Write your code here\n',
  },
  {
    id: 57,
    name: 'Elixir',
    codemirrorLang: 'python',
    defaultCode: '# Write your code here\n',
  },
  {
    id: 86,
    name: 'Clojure',
    codemirrorLang: 'clojure',
    defaultCode: '(defn -main []\n  ;; Write your code here\n  (println "Hello"))\n',
  },
  {
    id: 82,
    name: 'SQL',
    codemirrorLang: 'sql',
    defaultCode: '-- Write your query here\nSELECT 1;\n',
  },
  {
    id: 46,
    name: 'Bash',
    codemirrorLang: 'shell',
    defaultCode: '#!/bin/bash\n\n# Write your code here\n',
  },
  {
    id: 79,
    name: 'Objective-C',
    codemirrorLang: 'cpp',
    defaultCode:
      '#import <Foundation/Foundation.h>\n\nint main(int argc, const char * argv[]) {\n    @autoreleasepool {\n        // Write your code here\n    }\n    return 0;\n}\n',
  },
  {
    id: 77,
    name: 'Pascal',
    codemirrorLang: 'pascal',
    defaultCode:
      'program Main;\nbegin\n    { Write your code here }\n    writeln(\'Hello\');\nend.\n',
  },
  {
    id: 59,
    name: 'Fortran',
    codemirrorLang: 'fortran',
    defaultCode:
      'program main\n    implicit none\n    ! Write your code here\n    print *, "Hello"\nend program main\n',
  },
  {
    id: 69,
    name: 'Prolog',
    codemirrorLang: 'javascript',
    defaultCode: '% Write your code here\n:- initialization(main).\nmain :- write(hello), nl.\n',
  },
  {
    id: 55,
    name: 'Common Lisp',
    codemirrorLang: 'clojure',
    defaultCode: ';;; Write your code here\n(format t "Hello~%")\n',
  },
  {
    id: 91,
    name: 'PowerShell',
    codemirrorLang: 'powershell',
    defaultCode: '# Write your code here\nWrite-Host "Hello"\n',
  },
  {
    id: 45,
    name: 'Assembly (NASM)',
    codemirrorLang: 'javascript',
    defaultCode:
      'section .data\n    msg db "Hello", 10\n    len equ $ - msg\n\nsection .text\n    global _start\n\n_start:\n    mov rax, 1\n    mov rdi, 1\n    mov rsi, msg\n    mov rdx, len\n    syscall\n\n    mov rax, 60\n    xor rdi, rdi\n    syscall\n',
  },
]

export function getLanguageById(id: number): PlaygroundLanguage | undefined {
  return PLAYGROUND_LANGUAGES.find((l) => l.id === id)
}
