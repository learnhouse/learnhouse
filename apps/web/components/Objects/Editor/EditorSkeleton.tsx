export default function EditorSkeleton() {
  return (
    <div className="activity-editor-page">
      {/* Toolbar — uses real CSS classes for pixel-perfect match */}
      <div className="activity-editor-top">
        <div className="activity-editor-doc-section">
          <div className="activity-editor-info-wrapper">
            {/* Logo */}
            <div className="bg-black rounded-md w-[25px] h-[25px] flex items-center justify-center">
              <div className="w-[14px] h-[14px] bg-gray-700 rounded-sm" />
            </div>
            {/* Thumbnail */}
            <div className="activity-editor-info-thumbnail bg-gray-200 animate-pulse" style={{ height: 25, width: 56 }} />
            {/* Course / Activity name */}
            <div className="activity-editor-doc-name">
              <div className="flex items-center gap-1.5">
                <div className="w-24 h-3.5 bg-gray-200 rounded animate-pulse" />
                <span style={{ color: '#d1d5db', padding: 3 }}>/</span>
                <div className="w-16 h-3.5 bg-gray-200 rounded animate-pulse" />
              </div>
            </div>
          </div>
          {/* Toolbar buttons */}
          <div className="activity-editor-buttons-wrapper">
            <div className="flex flex-row items-center justify-start flex-wrap gap-[7px]">
              {/* Undo/Redo */}
              <div className="editor-tool-btn"><div className="w-[15px] h-[15px] bg-gray-200 rounded-sm animate-pulse" /></div>
              <div className="editor-tool-btn"><div className="w-[15px] h-[15px] bg-gray-200 rounded-sm animate-pulse" /></div>
              {/* Bold/Italic/Strike */}
              <div className="editor-tool-btn"><div className="w-[15px] h-[15px] bg-gray-200 rounded-sm animate-pulse" /></div>
              <div className="editor-tool-btn"><div className="w-[15px] h-[15px] bg-gray-200 rounded-sm animate-pulse" /></div>
              <div className="editor-tool-btn"><div className="w-[15px] h-[15px] bg-gray-200 rounded-sm animate-pulse" /></div>
              {/* List dropdown */}
              <div className="editor-tool-btn"><div className="w-[15px] h-[15px] bg-gray-200 rounded-sm animate-pulse" /></div>
              {/* Heading select */}
              <div className="editor-tool-btn" style={{ minWidth: 80 }}><div className="w-full h-[15px] bg-gray-200 rounded-sm animate-pulse" /></div>
              {/* Table/Code/Link */}
              <div className="editor-tool-btn"><div className="w-[15px] h-[15px] bg-gray-200 rounded-sm animate-pulse" /></div>
              <div className="editor-tool-btn"><div className="w-[15px] h-[15px] bg-gray-200 rounded-sm animate-pulse" /></div>
              <div className="editor-tool-btn"><div className="w-[15px] h-[15px] bg-gray-200 rounded-sm animate-pulse" /></div>
            </div>
          </div>
        </div>
        <div className="activity-editor-users-section space-x-2">
          {/* AI button */}
          <div className="rounded-md px-3 py-2 bg-gray-200 animate-pulse" style={{ width: 100, height: 36 }} />
          {/* Divider */}
          <div style={{ marginTop: 'auto', marginBottom: 'auto', color: 'grey', opacity: '0.5', padding: '0 2px' }}>|</div>
          {/* History button */}
          <div className="flex bg-neutral-100 h-9 px-3 py-2 rounded-lg" style={{ width: 36 }}>
            <div className="w-[15px] h-[15px] bg-gray-300 rounded-sm animate-pulse m-auto" />
          </div>
          {/* Save button */}
          <div className="bg-sky-600 px-3 py-2 rounded-lg animate-pulse" style={{ width: 52, height: 36 }} />
          {/* Preview button */}
          <div className="flex bg-neutral-600 h-9 px-3 py-2 rounded-lg" style={{ width: 36 }}>
            <div className="w-[15px] h-[15px] bg-neutral-400 rounded-sm animate-pulse m-auto" />
          </div>
          {/* Divider */}
          <div style={{ marginTop: 'auto', marginBottom: 'auto', color: 'grey', opacity: '0.5', padding: '0 2px' }}>|</div>
          {/* Avatar */}
          <div className="activity-editor-user-profile">
            <div className="w-[45px] h-[45px] bg-gray-200 rounded-xl border-4 border-white animate-pulse" />
          </div>
        </div>
      </div>

      {/* Content area — uses real CSS class for exact positioning and style */}
      <div className="flex gap-5" style={{ position: 'relative', margin: '0 40px' }}>
        <div className="activity-editor-content-wrapper" style={{ flex: 1, margin: 0, marginTop: 97 }}>
          <div className="p-10 space-y-5 animate-pulse">
            {/* Heading */}
            <div className="w-3/5 h-8 bg-gray-200/70 rounded" />
            {/* Paragraph lines */}
            <div className="space-y-3 pt-1">
              <div className="w-full h-[18px] bg-gray-100/80 rounded" />
              <div className="w-full h-[18px] bg-gray-100/80 rounded" />
              <div className="w-4/5 h-[18px] bg-gray-100/80 rounded" />
            </div>
            <div className="h-4" />
            {/* Subheading */}
            <div className="w-2/5 h-6 bg-gray-200/70 rounded" />
            {/* More paragraph lines */}
            <div className="space-y-3 pt-1">
              <div className="w-full h-[18px] bg-gray-100/80 rounded" />
              <div className="w-full h-[18px] bg-gray-100/80 rounded" />
              <div className="w-3/4 h-[18px] bg-gray-100/80 rounded" />
              <div className="w-full h-[18px] bg-gray-100/80 rounded" />
              <div className="w-5/6 h-[18px] bg-gray-100/80 rounded" />
            </div>
            <div className="h-4" />
            {/* Image/embed block placeholder */}
            <div className="w-full h-44 bg-gray-50 rounded-lg border border-gray-100/80" />
            <div className="space-y-3 pt-1">
              <div className="w-full h-[18px] bg-gray-100/80 rounded" />
              <div className="w-2/3 h-[18px] bg-gray-100/80 rounded" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
