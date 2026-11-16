'use client'
/** Newsletter signup and contact form blocks. Loaded on demand. */
import React from 'react'
import { CheckCircle } from '@phosphor-icons/react'
import { getAPIUrl } from '@services/config/config'
import { submitLandingForm } from '@services/landing/landing'
import type { LandingNode } from '../model/types'
import { rootProps, useRender } from './context'
import { arr, str } from './elements'

function Done({ text }: { text: string }) {
  return (
    <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', fontWeight: 600, padding: '12px 0' }}>
      <CheckCircle size={22} weight="fill" style={{ color: 'var(--lhp-primary)' }} aria-hidden />
      <span>{text}</span>
    </div>
  )
}

export function NewsletterBlock({ node }: { node: LandingNode }) {
  const { mode, org, labels } = useRender()
  const p = node.props || {}
  const slug = str(p.newsletterSlug)
  const { orgslug, pageSlug } = useRender()
  const [email, setEmail] = React.useState('')
  const [state, setState] = React.useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [error, setError] = React.useState('')
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (mode !== 'public') return
    setState('sending')
    try {
      if (!slug || !org?.slug) {
        // Not linked to a newsletter yet: the signup is kept with the page's form messages.
        await submitLandingForm(orgslug, pageSlug, node.id, { email })
        setState('done')
        return
      }
      // The newsletter's own public signup (EE); see ee/routers/newsletter.
      const res = await fetch(`${getAPIUrl()}newsletter/public/${encodeURIComponent(org.slug)}/${encodeURIComponent(slug)}/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, language: typeof document !== 'undefined' ? document.documentElement.lang : undefined }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail || labels.form_error)
      setState('done')
    } catch (err: any) {
      setError(typeof err?.message === 'string' ? err.message : labels.form_error)
      setState('error')
    }
  }
  const props = rootProps(node, mode)
  if (state === 'done') return <div {...props}><Done text={str(p.successText) || labels.subscribe_success} /></div>
  const stacked = p.layout === 'stacked'
  return (
    <form {...props} onSubmit={submit} style={{ ...(props.style || {}), display: 'flex', flexDirection: stacked ? 'column' : 'row', flexWrap: 'wrap', gap: 10 }} noValidate={mode !== 'public'}>
      <input
        className="lhp-input"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={str(p.placeholder) || 'you@example.com'}
        aria-label={str(p.placeholder) || 'Email'}
        style={{ flex: '1 1 220px' }}
        readOnly={mode !== 'public'}
      />
      <button className="lhp-btn" data-variant="primary" data-size="md" type="submit" disabled={state === 'sending'} style={{ height: 48, flex: stacked ? undefined : '0 0 auto' }}>
        {state === 'sending' ? labels.sending : str(p.buttonLabel) || 'Subscribe'}
      </button>
      {mode === 'canvas' && !slug && <p style={{ width: '100%', fontSize: '.8125rem', opacity: 0.7, margin: 0 }}>{labels.placeholder_newsletter_form}</p>}
      {state === 'error' && <p role="alert" style={{ width: '100%', fontSize: '.8125rem', color: '#dc2626', margin: 0 }}>{error}</p>}
    </form>
  )
}

export function ContactFormBlock({ node }: { node: LandingNode }) {
  const { mode, orgslug, pageSlug, labels } = useRender()
  const p = node.props || {}
  const fields = arr(p.fields)
  const [values, setValues] = React.useState<Record<string, any>>({})
  const [state, setState] = React.useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [error, setError] = React.useState('')
  const set = (k: string, v: any) => setValues((cur) => ({ ...cur, [k]: v }))
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (mode !== 'public') return
    setState('sending')
    try {
      await submitLandingForm(orgslug, pageSlug, node.id, values)
      setState('done')
    } catch (err: any) {
      setError(typeof err?.message === 'string' && err.message ? err.message : labels.form_error)
      setState('error')
    }
  }
  const props = rootProps(node, mode)
  if (state === 'done') return <div {...props}><Done text={str(p.successText) || labels.form_success} /></div>
  return (
    <form {...props} onSubmit={submit} style={{ ...(props.style || {}), display: 'flex', flexDirection: 'column', gap: 16 }} noValidate={mode !== 'public'}>
      {fields.map((f) => {
        const id = `lhp-${node.id}-${f.key}`
        const label = `${str(f.label) || f.key}${f.required ? ' *' : ''}`
        if (f.type === 'checkbox') {
          return (
            <label key={f.key} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: '.9375rem' }}>
              <input type="checkbox" checked={!!values[f.key]} onChange={(e) => set(f.key, e.target.checked)} required={!!f.required} disabled={mode !== 'public'} />
              <span>{label}</span>
            </label>
          )
        }
        return (
          <label key={f.key} className="lhp-field" htmlFor={id}>
            <span>{label}</span>
            {f.type === 'textarea' ? (
              <textarea id={id} className="lhp-input" placeholder={str(f.placeholder)} value={values[f.key] || ''} onChange={(e) => set(f.key, e.target.value)} required={!!f.required} readOnly={mode !== 'public'} />
            ) : f.type === 'select' ? (
              <select id={id} className="lhp-input" value={values[f.key] || ''} onChange={(e) => set(f.key, e.target.value)} required={!!f.required} disabled={mode !== 'public'}>
                <option value="" />
                {arr<string>(f.options).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input id={id} className="lhp-input" type={f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : 'text'} placeholder={str(f.placeholder)} value={values[f.key] || ''} onChange={(e) => set(f.key, e.target.value)} required={!!f.required} readOnly={mode !== 'public'} />
            )}
          </label>
        )
      })}
      {/* Honeypot: people never see or fill it. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" value={values.website || ''} onChange={(e) => set('website', e.target.value)} style={{ position: 'absolute', insetInlineStart: '-9999px', width: 1, height: 1, opacity: 0 }} aria-hidden="true" />
      <div>
        <button className="lhp-btn" data-variant="primary" data-size="lg" type="submit" disabled={state === 'sending'}>
          {state === 'sending' ? labels.sending : str(p.submitLabel) || 'Send'}
        </button>
      </div>
      {state === 'error' && <p role="alert" style={{ fontSize: '.875rem', color: '#dc2626', margin: 0 }}>{error}</p>}
    </form>
  )
}
