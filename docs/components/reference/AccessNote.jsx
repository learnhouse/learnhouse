import Link from 'next/link'
import { Key, UserCircle, LockOpen, Prohibit } from '@phosphor-icons/react/dist/ssr'
import { RIGHTS_LABEL } from '../../lib/reference/config'

const ACTION_LABEL = { read: 'Read', create: 'Create', update: 'Update', delete: 'Delete' }

/**
 * Who can call an operation, derived from the API's router wiring and RBAC
 * layer (see API_GROUPS in lib/reference/config.js).
 */
export default function AccessNote({ op }) {
  const authLink = (
    <Link href="/reference/guides/authentication" className="lhr-access-link">
      Authentication
    </Link>
  )

  if (!op.auth) {
    return (
      <div className="lhr-access">
        <LockOpen size={15} className="lhr-access-icon" />
        <div>
          <strong>No credentials needed.</strong> This endpoint issues credentials; see {authLink}.
        </div>
      </div>
    )
  }

  if (op.access === 'token' || op.access === 'token-required') {
    const right = op.tokenRight
    return (
      <div className="lhr-access">
        <Key size={15} className="lhr-access-icon" />
        <div>
          {op.access === 'token' ? (
            <>
              <strong>API token or user session.</strong>{' '}
            </>
          ) : (
            <>
              <strong>API token required.</strong> User sessions are not accepted here.{' '}
            </>
          )}
          {right ? (
            <>
              The token needs the <code>{ACTION_LABEL[right.action] || right.action}</code> right on{' '}
              <code>{RIGHTS_LABEL[right.bucket] || right.bucket}</code>
              <span className="lhr-access-key"> ({right.bucket}:{right.action})</span>.
            </>
          ) : (
            <>Each endpoint checks the token creator&apos;s permissions.</>
          )}
        </div>
      </div>
    )
  }

  if (op.access === 'session') {
    return (
      <div className="lhr-access lhr-access-session">
        <Prohibit size={15} className="lhr-access-icon" />
        <div>
          <strong>Session only.</strong> API tokens are refused with <code>403</code>. Sign in as a
          user and send the session JWT (or the browser cookie). See {authLink}.
        </div>
      </div>
    )
  }

  return (
    <div className="lhr-access">
      <UserCircle size={15} className="lhr-access-icon" />
      <div>
        <strong>User credentials.</strong> Called with a user session JWT or cookie, not an API
        token. See {authLink}.
      </div>
    </div>
  )
}
