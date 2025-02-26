import { NodeViewWrapper } from '@tiptap/react'
import React from 'react'
import styled from 'styled-components'
import 'katex/dist/katex.min.css'
import { BlockMath } from 'react-katex'
import { Save, Sigma, ExternalLink, ChevronDown, BookOpen, Lightbulb } from 'lucide-react'
import Link from 'next/link'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { motion } from 'framer-motion'

// Predefined LaTeX templates
const mathTemplates = [
  { 
    name: 'Fraction', 
    latex: '\\frac{a}{b}',
    description: 'Simple fraction'
  },
  { 
    name: 'Square Root', 
    latex: '\\sqrt{x}',
    description: 'Square root'
  },
  { 
    name: 'Summation', 
    latex: '\\sum_{i=1}^{n} x_i',
    description: 'Sum with limits'
  },
  { 
    name: 'Integral', 
    latex: '\\int_{a}^{b} f(x) \\, dx',
    description: 'Definite integral'
  },
  { 
    name: 'Limit', 
    latex: '\\lim_{x \\to \\infty} f(x)',
    description: 'Limit expression'
  },
  { 
    name: 'Matrix 2×2', 
    latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}',
    description: '2×2 matrix with parentheses'
  },
  { 
    name: 'Binomial', 
    latex: '\\binom{n}{k}',
    description: 'Binomial coefficient'
  },
  { 
    name: 'Quadratic Formula', 
    latex: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}',
    description: 'Solution to quadratic equation'
  },
  { 
    name: 'Vector', 
    latex: '\\vec{v} = \\begin{pmatrix} x \\\\ y \\\\ z \\end{pmatrix}',
    description: '3D vector'
  },
  { 
    name: 'System of Equations', 
    latex: '\\begin{cases} a_1x + b_1y = c_1 \\\\ a_2x + b_2y = c_2 \\end{cases}',
    description: 'System of linear equations'
  }
];

// Common LaTeX symbols
const mathSymbols = [
  { symbol: '\\alpha', display: 'α' },
  { symbol: '\\beta', display: 'β' },
  { symbol: '\\gamma', display: 'γ' },
  { symbol: '\\delta', display: 'δ' },
  { symbol: '\\theta', display: 'θ' },
  { symbol: '\\pi', display: 'π' },
  { symbol: '\\sigma', display: 'σ' },
  { symbol: '\\infty', display: '∞' },
  { symbol: '\\pm', display: '±' },
  { symbol: '\\div', display: '÷' },
  { symbol: '\\cdot', display: '·' },
  { symbol: '\\leq', display: '≤' },
  { symbol: '\\geq', display: '≥' },
  { symbol: '\\neq', display: '≠' },
  { symbol: '\\approx', display: '≈' },
];

// Styled components
const MathEqWrapper = styled.div`
  transition: all 0.2s ease;
  background-color: #f9f9f9;
  border: 1px solid #eaeaea;
`

const EditBar = styled.div`
  display: flex;
  justify-content: space-between;
  border-radius: 8px;
  padding: 0 5px 0 12px;
  background-color: white;
  color: #5252528d;
  align-items: center;
  height: 45px;
  border: solid 1px #e2e2e2;
  transition: all 0.2s ease;
  
  &:focus-within {
    border-color: #d1d1d1;
    box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.03);
  }

  input {
    border: none;
    background: none;
    font-size: 14px;
    color: #494949;
    width: 100%;
    font-family: 'DM Sans', sans-serif;
    
    &:focus {
      outline: none;
    }

    &::placeholder {
      color: #49494980;
    }
  }
`

const SaveButton = styled(motion.button)`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 6px;
  border: none;
  background: rgba(217, 217, 217, 0.5);
  color: #494949;
  cursor: pointer;
`

const InfoLink = styled.div`
  padding-left: 2px;
`

const TemplateButton = styled.button`
  display: flex;
  align-items: center;
  padding: 6px 10px;
  background: rgba(217, 217, 217, 0.4);
  border-radius: 6px;
  border: none;
  font-size: 13px;
  color: #494949;
  cursor: pointer;
`

const TemplateDropdown = styled.div`
  background: white;
  border-radius: 8px;
  border: 1px solid #e2e2e2;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  overflow: hidden;
`

const TemplateItem = styled.div`
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.15s;
  
  &:hover {
    background: rgba(217, 217, 217, 0.24);
  }
`

const SymbolsDropdown = styled.div`
  background: white;
  border-radius: 8px;
  border: 1px solid #e2e2e2;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  overflow: hidden;
`

const SymbolButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  margin: 2px;
  background: rgba(217, 217, 217, 0.3);
  border-radius: 4px;
  border: none;
  font-size: 16px;
  color: #494949;
  cursor: pointer;
`

const HelpDropdown = styled.div`
  background: white;
  border-radius: 8px;
  border: 1px solid #e2e2e2;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  overflow: hidden;
`

function MathEquationBlockComponent(props: any) {
  const [equation, setEquation] = React.useState(props.node.attrs.math_equation)
  const [isEditing, setIsEditing] = React.useState(true)
  const [showTemplates, setShowTemplates] = React.useState(false)
  const [showSymbols, setShowSymbols] = React.useState(false)
  const [showHelp, setShowHelp] = React.useState(false)
  const editorState = useEditorProvider() as any
  const isEditable = editorState.isEditable
  const inputRef = React.useRef<HTMLInputElement>(null)
  const templatesRef = React.useRef<HTMLDivElement>(null)
  const symbolsRef = React.useRef<HTMLDivElement>(null)
  const helpRef = React.useRef<HTMLDivElement>(null)

  // Close dropdowns when clicking outside
  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (templatesRef.current && !templatesRef.current.contains(event.target as Node)) {
        setShowTemplates(false)
      }
      if (symbolsRef.current && !symbolsRef.current.contains(event.target as Node)) {
        setShowSymbols(false)
      }
      if (helpRef.current && !helpRef.current.contains(event.target as Node)) {
        setShowHelp(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  const handleEquationChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setEquation(event.target.value)
    props.updateAttributes({
      math_equation: event.target.value,
    })
  }

  const saveEquation = () => {
    props.updateAttributes({
      math_equation: equation,
    })
    //setIsEditing(false);
  }

  const insertTemplate = (template: string) => {
    setEquation(template)
    props.updateAttributes({
      math_equation: template,
    })
    setShowTemplates(false)
    
    // Focus the input and place cursor at the end
    if (inputRef.current) {
      inputRef.current.focus()
      inputRef.current.setSelectionRange(template.length, template.length)
    }
  }

  const insertSymbol = (symbol: string) => {
    const cursorPosition = inputRef.current?.selectionStart || equation.length
    const newEquation = equation.substring(0, cursorPosition) + symbol + equation.substring(cursorPosition)
    
    setEquation(newEquation)
    props.updateAttributes({
      math_equation: newEquation,
    })
    
    // Focus the input and place cursor after the inserted symbol
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus()
        inputRef.current.setSelectionRange(cursorPosition + symbol.length, cursorPosition + symbol.length)
      }
    }, 0)
  }

  return (
    <NodeViewWrapper className="block-math-equation">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <MathEqWrapper className="flex flex-col space-y-3 rounded-lg py-6 px-5">
          <div className="flex items-center space-x-2 text-sm text-zinc-500 mb-1">
            <Sigma size={16} />
            <span className="font-medium">Math Equation</span>
          </div>
          
          <div className="bg-white p-4 rounded-md nice-shadow">
            <BlockMath>{equation}</BlockMath>
          </div>
          
          {isEditing && isEditable && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              transition={{ duration: 0.2 }}
              className="space-y-3"
            >
              <div className="flex space-x-2">
                <div ref={templatesRef} className="relative">
                  <TemplateButton 
                    onClick={() => setShowTemplates(!showTemplates)}
                    className="flex items-center space-x-1"
                  >
                    <BookOpen size={14} />
                    <span>Templates</span>
                    <ChevronDown size={14} className={`transition-transform ${showTemplates ? 'rotate-180' : ''}`} />
                  </TemplateButton>
                  
                  {showTemplates && (
                    <TemplateDropdown className="absolute left-0 mt-1 z-10 w-64 max-h-80 overflow-y-auto">
                      <div className="p-2 text-xs text-zinc-500 border-b">
                        Select a template to insert
                      </div>
                      {mathTemplates.map((template, index) => (
                        <TemplateItem 
                          key={index} 
                          onClick={() => insertTemplate(template.latex)}
                        >
                          <div className="flex flex-col">
                            <span className="font-medium">{template.name}</span>
                            <span className="text-xs text-zinc-500">{template.description}</span>
                          </div>
                        </TemplateItem>
                      ))}
                    </TemplateDropdown>
                  )}
                </div>
                
                <div ref={symbolsRef} className="relative">
                  <TemplateButton 
                    onClick={() => setShowSymbols(!showSymbols)}
                    className="flex items-center space-x-1"
                  >
                    <Sigma size={14} />
                    <span>Symbols</span>
                    <ChevronDown size={14} className={`transition-transform ${showSymbols ? 'rotate-180' : ''}`} />
                  </TemplateButton>
                  
                  {showSymbols && (
                    <SymbolsDropdown className="absolute left-0 mt-1 z-10 w-64">
                      <div className="p-2 text-xs text-zinc-500 border-b">
                        Click a symbol to insert
                      </div>
                      <div className="flex flex-wrap p-2">
                        {mathSymbols.map((symbol, index) => (
                          <SymbolButton 
                            key={index} 
                            onClick={() => insertSymbol(symbol.symbol)}
                            title={symbol.symbol}
                          >
                            {symbol.display}
                          </SymbolButton>
                        ))}
                      </div>
                    </SymbolsDropdown>
                  )}
                </div>
                
                <div ref={helpRef} className="relative">
                  <TemplateButton 
                    onClick={() => setShowHelp(!showHelp)}
                    className="flex items-center space-x-1"
                  >
                    <Lightbulb size={14} />
                    <span>Help</span>
                    <ChevronDown size={14} className={`transition-transform ${showHelp ? 'rotate-180' : ''}`} />
                  </TemplateButton>
                  
                  {showHelp && (
                    <HelpDropdown className="absolute left-0 mt-1 z-10 w-72">
                      <div className="p-2 text-xs font-medium text-zinc-700 border-b">
                        LaTeX Math Quick Reference
                      </div>
                      <div className="p-3 text-xs space-y-2">
                        <div>
                          <span className="font-medium">Fractions:</span> \frac{'{'}'numerator'{'}'}{'{'}denominator{'}'}
                        </div>
                        <div>
                          <span className="font-medium">Exponents:</span> x^{'{'}'power'{'}'}
                        </div>
                        <div>
                          <span className="font-medium">Subscripts:</span> x_{'{'}'subscript'{'}'}
                        </div>
                        <div>
                          <span className="font-medium">Square root:</span> \sqrt{'{'}'x'{'}'}
                        </div>
                        <div>
                          <span className="font-medium">Summation:</span> \sum_{'{'}'lower'{'}'}^{'{'}'upper'{'}'}
                        </div>
                        <div>
                          <span className="font-medium">Integral:</span> \int_{'{'}'lower'{'}'}^{'{'}'upper'{'}'}
                        </div>
                        <div className="pt-1 border-t">
                          <Link
                            className="text-blue-600 hover:text-blue-800 font-medium flex items-center"
                            href="https://katex.org/docs/supported.html"
                            target="_blank"
                          >
                            View complete reference
                            <ExternalLink size={10} className="ml-1" />
                          </Link>
                        </div>
                      </div>
                    </HelpDropdown>
                  )}
                </div>
              </div>
              
              <EditBar>
                <input
                  ref={inputRef}
                  value={equation}
                  onChange={handleEquationChange}
                  placeholder="Insert a Math Equation (LaTeX)"
                  type="text"
                  className="focus:ring-1 focus:ring-blue-300"
                />
                <SaveButton 
                  onClick={() => saveEquation()}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <Save size={15} />
                </SaveButton>
              </EditBar>
              
              <InfoLink className="flex items-center text-zinc-500 text-sm">
                <span>Please refer to this</span>
                <Link
                  className="inline-flex items-center mx-1 text-blue-600 hover:text-blue-800 font-medium"
                  href="https://katex.org/docs/supported.html"
                  target="_blank"
                >
                  guide
                  <ExternalLink size={12} className="ml-1" />
                </Link>
                <span>for supported TeX functions</span>
              </InfoLink>
            </motion.div>
          )}
        </MathEqWrapper>
      </motion.div>
    </NodeViewWrapper>
  )
}

export default MathEquationBlockComponent
