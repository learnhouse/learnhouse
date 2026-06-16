import { createLowlight } from 'lowlight'

import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import sql from 'highlight.js/lib/languages/sql'
import yaml from 'highlight.js/lib/languages/yaml'
import markdown from 'highlight.js/lib/languages/markdown'
import java from 'highlight.js/lib/languages/java'
import cpp from 'highlight.js/lib/languages/cpp'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'

export const lowlight = createLowlight()

lowlight.register('javascript', javascript)
lowlight.register('js', javascript)
lowlight.register('jsx', javascript)
lowlight.register('typescript', typescript)
lowlight.register('ts', typescript)
lowlight.register('tsx', typescript)
lowlight.register('python', python)
lowlight.register('py', python)
lowlight.register('bash', bash)
lowlight.register('sh', bash)
lowlight.register('shell', bash)
lowlight.register('json', json)
lowlight.register('css', css)
lowlight.register('html', xml)
lowlight.register('xml', xml)
lowlight.register('sql', sql)
lowlight.register('yaml', yaml)
lowlight.register('yml', yaml)
lowlight.register('markdown', markdown)
lowlight.register('md', markdown)
lowlight.register('java', java)
lowlight.register('cpp', cpp)
lowlight.register('c++', cpp)
lowlight.register('c', cpp)
lowlight.register('go', go)
lowlight.register('golang', go)
lowlight.register('rust', rust)
lowlight.register('rs', rust)
