'use client'

import React, { useEffect } from 'react'
import { useOrg } from '@/components/Contexts/OrgContext'
import DOMPurify from 'dompurify'

const OrgScripts: React.FC = () => {
  const org = useOrg() as any

  // Function to cleanup existing scripts
  const cleanupExistingScript = (scriptId: string) => {
    const existingScript = document.getElementById(scriptId)
    if (existingScript) {
      const parent = existingScript.parentNode
      if (parent) {
        let node = existingScript.previousSibling
        while (node && node.nodeType === Node.COMMENT_NODE) {
          const prevNode = node.previousSibling
          parent.removeChild(node)
          node = prevNode
        }
        node = existingScript.nextSibling
        while (node && node.nodeType === Node.COMMENT_NODE) {
          const nextNode = node.nextSibling
          parent.removeChild(node)
          node = nextNode
        }
        parent.removeChild(existingScript)
      }
    }
  }

  // Function to check if script is already loaded
  const isScriptLoaded = (scriptName: string): boolean => {
    const scripts = document.querySelectorAll(`script[data-script-name="${scriptName}"]`)
    return scripts.length > 0
  }

  // Function to sanitize script content using DOMPurify
  const sanitizeScriptContent = (content: string): string => {
    if (typeof window === 'undefined') {
      return content;
    }

    DOMPurify.addHook('afterSanitizeAttributes', function(node) {
      if (node.nodeName === 'SCRIPT') {
        node.setAttribute('type', 'text/javascript');
      }
    });

    const purifyConfig = {
      ALLOWED_TAGS: ['script'],
      ALLOWED_ATTR: [
        'src', 'async', 'defer', 'crossorigin', 
        'integrity', 'type', 'nonce', 'id',
        'data-*', 'referrerpolicy'
      ],
      ADD_TAGS: ['script'],
      WHOLE_DOCUMENT: false,
      RETURN_DOM: false,
      RETURN_DOM_FRAGMENT: false,
      FORCE_BODY: true
    }

    if (content.trim().toLowerCase().startsWith('<script')) {
      return DOMPurify.sanitize(content, purifyConfig)
    } else {
      return DOMPurify.sanitize(content, {
        ALLOWED_TAGS: [],
        ALLOWED_ATTR: [],
        WHOLE_DOCUMENT: false
      })
    }
  }

  // Function to safely load and execute a script
  const loadScript = (scriptContent: string, scriptName: string) => {
    try {
      if (isScriptLoaded(scriptName) || !scriptContent.trim()) {
        return
      }

      const safeScriptId = `learnhouse-org-script-${scriptName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Math.random().toString(36).substr(2, 9)}`

      cleanupExistingScript(safeScriptId)

      if (scriptContent.trim().toLowerCase().startsWith('<script')) {
        const sanitizedHtml = sanitizeScriptContent(scriptContent.trim())
        const div = document.createElement('div')
        div.innerHTML = sanitizedHtml
        const scriptTag = div.querySelector('script')

        if (!scriptTag) {
          return
        }

        const scriptElement = document.createElement('script')
        Array.from(scriptTag.attributes).forEach(attr => {
          scriptElement.setAttribute(attr.name, attr.value)
        })

        if (scriptTag.src) {
          try {
            new URL(scriptTag.src)
            scriptElement.async = true
            scriptElement.onload = () => {
              scriptElement.dataset.loaded = 'true'
            }
            scriptElement.onerror = (error) => {
              console.error(`Failed to load external script "${scriptName}":`, error)
              cleanupExistingScript(safeScriptId)
            }
          } catch (error) {
            console.error(`Invalid script URL in "${scriptName}":`, error)
            return
          }
        } else {
          const sanitizedContent = sanitizeScriptContent(scriptTag.textContent || '')
          scriptElement.textContent = `
            /* LearnHouse Organization Script - ${scriptName} */
            try {
              (function() {
                'use strict';
                ${sanitizedContent}
              })();
            } catch (error) {
              console.error("Script error in ${scriptName}:", error);
            }
          `
        }

        scriptElement.id = safeScriptId
        scriptElement.dataset.scriptName = scriptName
        scriptElement.dataset.loadTime = new Date().toISOString()
        scriptElement.dataset.type = scriptTag.src ? 'external' : 'inline'
        scriptElement.dataset.orgId = org?.id
        scriptElement.dataset.orgSlug = org?.slug

        const comment = document.createComment(` LearnHouse Organization Script - ${scriptName} (${safeScriptId}) `)
        document.body.appendChild(comment)
        document.body.appendChild(scriptElement)
      } else {
        const scriptElement = document.createElement('script')
        scriptElement.type = 'text/javascript'
        
        const sanitizedContent = sanitizeScriptContent(scriptContent)
        scriptElement.textContent = `
          /* LearnHouse Organization Script - ${scriptName} */
          try {
            (function() {
              'use strict';
              ${sanitizedContent}
            })();
          } catch (error) {
            console.error("Script error in ${scriptName}:", error)
          }
        `
        
        scriptElement.id = safeScriptId
        scriptElement.dataset.scriptName = scriptName
        scriptElement.dataset.loadTime = new Date().toISOString()
        scriptElement.dataset.type = 'raw'
        scriptElement.dataset.orgId = org?.id
        scriptElement.dataset.orgSlug = org?.slug

        const comment = document.createComment(` LearnHouse Organization Script - ${scriptName} (${safeScriptId}) `)
        document.body.appendChild(comment)
        document.body.appendChild(scriptElement)
      }
    } catch (error) {
      console.error(`Failed to load script ${scriptName}:`, error)
    }
  }

  useEffect(() => {
    if (!org || !org?.scripts?.scripts || !Array.isArray(org.scripts.scripts)) {
      return
    }

    const loadedScripts = new Map()
    
    org.scripts.scripts.forEach((script: { content: string, name: string }, index: number) => {
      const scriptName = script.name || `Script ${index + 1}`
      
      if (!loadedScripts.has(scriptName) && script.content) {
        loadedScripts.set(scriptName, true)
        loadScript(script.content, scriptName)
      }
    })

    return () => {
      const scripts = document.querySelectorAll('script[id^="learnhouse-org-script-"]')
      scripts.forEach(script => {
        cleanupExistingScript(script.id)
      })
    }
  }, [org])

  return null
}

export default OrgScripts 