'use client'

import { Children, isValidElement, useId, useState } from 'react'


/** <Tabs items={['A', 'B']}><Tabs.Tab>…</Tabs.Tab><Tabs.Tab>…</Tabs.Tab></Tabs> */
export default function TabsClient({ items = [], defaultIndex = 0, children }) {
  const [active, setActive] = useState(defaultIndex)
  const id = useId()
  const panels = Children.toArray(children).filter(isValidElement)
  return (
    <div className="lh-tabs">
      <div className="lh-tabs-list" role="tablist">
        {items.map((label, i) => (
          <button
            key={label}
            type="button"
            role="tab"
            id={`${id}-tab-${i}`}
            aria-selected={active === i}
            aria-controls={`${id}-panel-${i}`}
            className={`lh-tabs-tab ${active === i ? 'lh-tabs-tab-active' : ''}`}
            onClick={() => setActive(i)}
          >
            {label}
          </button>
        ))}
      </div>
      {panels.map((panel, i) => (
        <div
          key={i}
          role="tabpanel"
          id={`${id}-panel-${i}`}
          aria-labelledby={`${id}-tab-${i}`}
          hidden={active !== i}
          className="lh-tabs-panel"
        >
          {panel}
        </div>
      ))}
    </div>
  )
}

