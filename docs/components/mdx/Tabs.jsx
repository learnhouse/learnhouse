import TabsClient from './TabsClient'

// Server wrapper so `<Tabs.Tab>` works in MDX: a static property on a client
// component doesn't survive the server/client boundary.
function Tab({ children }) {
  return <>{children}</>
}

export function Tabs(props) {
  return <TabsClient {...props} />
}

Tabs.Tab = Tab
