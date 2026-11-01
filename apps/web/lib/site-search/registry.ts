import type { SitePageMeta } from './types'

import { sitePage as home } from '@/app/orgs/[orgslug]/(withmenu)/page.search'
import { sitePage as courses } from '@/app/orgs/[orgslug]/(withmenu)/courses/page.search'
import { sitePage as library } from '@/app/orgs/[orgslug]/(withmenu)/library/page.search'
import { sitePage as podcasts } from '@/app/orgs/[orgslug]/(withmenu)/podcasts/page.search'
import { sitePage as communities } from '@/app/orgs/[orgslug]/(withmenu)/communities/page.search'
import { sitePage as playgrounds } from '@/app/orgs/[orgslug]/(withmenu)/playgrounds/page.search'
import { sitePage as store } from '@/app/orgs/[orgslug]/(withmenu)/store/page.search'
import { sitePage as trail } from '@/app/orgs/[orgslug]/(withmenu)/trail/page.search'
import { sitePage as boards } from '@/app/orgs/[orgslug]/(withmenu)/boards/page.search'
import { sitePage as copilot } from '@/app/orgs/[orgslug]/(withmenu)/copilot/page.search'
import { sitePage as search } from '@/app/orgs/[orgslug]/(withmenu)/search/page.search'
import { searchMetas as accountMetas } from '@/app/orgs/[orgslug]/(withmenu)/account/page.search'

// The account pages already describe themselves for the dashboard palette;
// reuse their titles, icons and routes with learner-facing copy.
const account: SitePageMeta[] = accountMetas.map((meta) => {
  const slug = meta.id.replace('.', '_')
  return {
    id: `site.${meta.id}`,
    // "General" alone means nothing outside the account page; the palette
    // and the help sheet call it by its full name.
    titleKey: meta.id === 'account.general' ? 'search.palette.entries.account_general.title' : meta.titleKey,
    descriptionKey: `search.palette.entries.${slug}.description`,
    keywordsKey: `search.palette.entries.${slug}.keywords`,
    icon: meta.icon,
    href: meta.href,
    requiresAuth: true,
    shortcut: meta.id === 'account.general' ? 'g u' : undefined,
  }
})

/** Every learner-facing page, in the order the palette lists them before a query. */
export const sitePages: SitePageMeta[] = [
  home,
  courses,
  library,
  podcasts,
  communities,
  playgrounds,
  store,
  trail,
  boards,
  copilot,
  search,
  ...account,
]
