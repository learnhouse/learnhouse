declare module 'react-plyr' {
  import { Component } from 'react'

  interface PlyrProps {
    source: {
      type: string
      sources: Array<{
        src: string
        type: string
      }>
    }
    options?: any
    onReady?: () => void
  }

  export default class Plyr extends Component<PlyrProps> {}
} 