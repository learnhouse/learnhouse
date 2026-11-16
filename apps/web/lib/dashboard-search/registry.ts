import type { SearchMeta } from './types'

import { searchMeta as home } from '@/app/orgs/[orgslug]/dash/page.search'
import { searchMeta as courses } from '@/app/orgs/[orgslug]/dash/courses/page.search'
import { searchMeta as coursesMigrate } from '@/app/orgs/[orgslug]/dash/courses/migrate/page.search'
import { searchMeta as assignments } from '@/app/orgs/[orgslug]/dash/assignments/page.search'
import { searchMeta as communities } from '@/app/orgs/[orgslug]/dash/communities/page.search'
import { searchMeta as paths } from '@/app/orgs/[orgslug]/dash/paths/page.search'
import { searchMeta as podcasts } from '@/app/orgs/[orgslug]/dash/podcasts/page.search'
import { searchMeta as liveSessions } from '@/app/orgs/[orgslug]/dash/live-sessions/page.search'
import { searchMeta as newsletter } from '@/app/orgs/[orgslug]/dash/newsletter/page.search'
import { searchMeta as boards } from '@/app/orgs/[orgslug]/dash/boards/page.search'
import { searchMeta as playgrounds } from '@/app/orgs/[orgslug]/dash/playgrounds/page.search'
import { searchMeta as analytics } from '@/app/orgs/[orgslug]/dash/analytics/page.search'
import { searchMetas as users } from '@/app/orgs/[orgslug]/dash/users/page.search'
import { searchMetas as org } from '@/app/orgs/[orgslug]/dash/org/page.search'
import { searchMetas as payments } from '@/app/orgs/[orgslug]/dash/payments/page.search'
import { searchMetas as account } from '@/app/orgs/[orgslug]/(withmenu)/account/page.search'
import { searchMetas as website } from '@/app/orgs/[orgslug]/dash/website/page.search'

export const dashboardPages: SearchMeta[] = [
  home,
  courses,
  coursesMigrate,
  assignments,
  communities,
  paths,
  podcasts,
  liveSessions,
  newsletter,
  boards,
  playgrounds,
  analytics,
  ...users,
  ...org,
  ...payments,
  ...account,
  ...website,
]
