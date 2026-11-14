import Link from 'next/link'
import { APP_IMAGE } from '../../../lib/releases/config'
import { formatDate } from './format'

function VersionCard({ label, version, sub, cmd, href, hrefLabel, muted = false }) {
  return (
    <div className="lhr-card lhr-vcard">
      <span className="lhr-label">{label}</span>
      <span className={muted ? 'lhr-vcard-version is-muted' : 'lhr-vcard-version'}>{version}</span>
      <span className="lhr-vcard-sub">{sub}</span>
      {cmd && <code className="lhr-cmd lhr-vcard-cmd">{cmd}</code>}
      {href && (
        <Link href={href} className="lhr-vcard-link">
          {hrefLabel}
        </Link>
      )}
    </div>
  )
}

function packageCard(pkg, app) {
  if (!pkg.published) {
    return {
      version: 'Not published yet',
      muted: true,
      sub: 'First published with the next app release.',
      cmd: null,
    }
  }
  const matches = app && pkg.version === app.version
  return {
    version: pkg.version,
    sub: matches
      ? `Matches LearnHouse ${app.version}`
      : pkg.date
        ? `Published ${formatDate(pkg.date)}`
        : 'Latest on npm',
    cmd: `npm i ${pkg.name}@${pkg.version}`,
  }
}

export default function CurrentVersions({ latest, npm }) {
  const { app, cli } = latest
  const sdk = npm.find((p) => p.name === '@learnhouse/sdk') || { name: '@learnhouse/sdk', published: false }
  const react = npm.find((p) => p.name === '@learnhouse/react') || { name: '@learnhouse/react', published: false }
  const vue = npm.find((p) => p.name === '@learnhouse/vue') || { name: '@learnhouse/vue', published: false }

  return (
    <div className="lhr-vgrid">
      <VersionCard
        label="LearnHouse"
        version={app ? app.version : 'Unavailable'}
        muted={!app}
        sub={app ? `Released ${formatDate(app.date)}` : 'Could not load releases.'}
        cmd={app ? `${APP_IMAGE}:${app.version}` : null}
        href={app ? `/releases/${encodeURIComponent(app.tag)}` : null}
        hrefLabel="Release notes"
      />
      <VersionCard
        label="CLI"
        version={cli ? cli.version : 'Unavailable'}
        muted={!cli}
        sub={cli ? `Released ${formatDate(cli.date)}` : 'Could not load releases.'}
        cmd={cli ? `npx learnhouse@${cli.version}` : null}
        href={cli ? `/releases/${encodeURIComponent(cli.tag)}` : null}
        hrefLabel="Release notes"
      />
      <VersionCard label="@learnhouse/sdk" {...packageCard(sdk, app)} href="/developers/sdk" hrefLabel="SDK docs" />
      <VersionCard label="@learnhouse/react" {...packageCard(react, app)} href="/developers/react" hrefLabel="React docs" />
      <VersionCard label="@learnhouse/vue" {...packageCard(vue, app)} href="/developers/vue" hrefLabel="Vue docs" />
    </div>
  )
}
