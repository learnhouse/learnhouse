import './releases.css'

export default function ReleasesLayout({ children }) {
  return (
    <div className="lhr-shell">
      <main className="lhr-main">{children}</main>
    </div>
  )
}
