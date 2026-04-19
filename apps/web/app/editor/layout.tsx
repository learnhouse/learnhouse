// Course-builder editor is English/LTR only, regardless of user's chosen site
// language. Per PLAN.md: "Admin-facing: English-only." Overrides the parent
// <html dir="rtl"> when a learner picks Hebrew.
export default function EditorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div dir="ltr" lang="en" className="admin-en-ltr contents">
      {children}
    </div>
  )
}
