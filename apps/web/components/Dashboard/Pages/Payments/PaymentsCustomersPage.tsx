'use client'
import React, { useState } from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import useSWR from 'swr'
import {
  getOrgCustomers,
  getStripeOverview,
  getStripeCharges,
  getStripeSubscriptions,
} from '@services/payments/payments'
import { Badge } from '@components/ui/badge'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import {
  CreditCard,
  ExternalLink,
  RefreshCcw,
  SquareCheck,
  TrendingUp,
  DollarSign,
  Users,
  Activity,
  ChevronRight,
  ChevronLeft,
  AlertCircle,
  CheckCircle2,
  Clock,
} from 'lucide-react'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import UserAvatar from '@components/Objects/UserAvatar'
import { usePaymentsEnabled } from '@hooks/usePaymentsEnabled'
import UnconfiguredPaymentsDisclaimer from '@components/Pages/Payments/UnconfiguredPaymentsDisclaimer'
import { Button } from '@components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@components/ui/table'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmt(amount: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function CardChip({ brand, last4 }: { brand?: string; last4?: string }) {
  const labels: Record<string, string> = {
    visa: 'Visa', mastercard: 'MC', amex: 'Amex',
    discover: 'Disc', jcb: 'JCB', unionpay: 'UP',
  }
  if (!brand) return <span className="text-gray-400">—</span>
  return (
    <div className="flex items-center space-x-1.5">
      <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
        {labels[brand.toLowerCase()] ?? brand}
      </span>
      {last4 && <span className="text-sm text-gray-600 font-mono">••••&nbsp;{last4}</span>}
    </div>
  )
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  active:    { label: 'Active',    cls: 'bg-green-100 text-green-700' },
  completed: { label: 'Completed', cls: 'bg-blue-100 text-blue-700' },
  succeeded: { label: 'Paid',      cls: 'bg-green-100 text-green-700' },
  pending:   { label: 'Pending',   cls: 'bg-amber-100 text-amber-700' },
  failed:    { label: 'Failed',    cls: 'bg-red-100 text-red-600' },
  cancelled: { label: 'Cancelled', cls: 'bg-gray-100 text-gray-500' },
  canceled:  { label: 'Cancelled', cls: 'bg-gray-100 text-gray-500' },
  refunded:  { label: 'Refunded',  cls: 'bg-purple-100 text-purple-700' },
  trialing:  { label: 'Trialing',  cls: 'bg-sky-100 text-sky-700' },
  past_due:  { label: 'Past due',  cls: 'bg-red-100 text-red-600' },
}

function StatusPill({ status }: { status: string }) {
  const s = STATUS_BADGE[status] ?? { label: status, cls: 'bg-gray-100 text-gray-500' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${s.cls}`}>
      {s.label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Metric card
// ---------------------------------------------------------------------------
function MetricCard({
  label, value, sub, icon: Icon, color,
}: { label: string; value: string; sub?: string; icon: any; color: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 flex items-center space-x-4">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
        <Icon size={18} />
      </div>
      <div>
        <div className="text-2xl font-bold text-gray-900 tracking-tight">{value}</div>
        <div className="text-xs text-gray-500">{label}</div>
        {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab bar (internal)
// ---------------------------------------------------------------------------
type Tab = 'overview' | 'customers' | 'transactions' | 'subscriptions'

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: 'overview',      label: 'Overview',      icon: Activity },
  { id: 'customers',     label: 'Customers',     icon: Users },
  { id: 'transactions',  label: 'Transactions',  icon: CreditCard },
  { id: 'subscriptions', label: 'Subscriptions', icon: RefreshCcw },
]

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------
function OverviewTab({ orgId, accessToken }: { orgId: number; accessToken: string }) {
  const { data, error, isLoading } = useSWR(
    [`/stripe/overview/${orgId}`, accessToken],
    () => getStripeOverview(orgId, accessToken),
    { revalidateOnFocus: false }
  )

  if (isLoading) return <PageLoading />
  if (error) return <StripeUnavailable />

  const d = data as any

  return (
    <div className="space-y-6">
      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <MetricCard label="MRR"               value={fmt(d.mrr)}            icon={TrendingUp}  color="bg-blue-100 text-blue-600" />
        <MetricCard label="ARR"               value={fmt(d.arr)}            icon={TrendingUp}  color="bg-indigo-100 text-indigo-600" />
        <MetricCard label="Total revenue"     value={fmt(d.total_revenue)}  icon={DollarSign}  color="bg-green-100 text-green-600" />
        <MetricCard label="Active subscribers" value={String(d.active_subscribers)} icon={RefreshCcw} color="bg-violet-100 text-violet-600" />
        <MetricCard label="Total customers"   value={String(d.total_customers)} icon={Users}   color="bg-purple-100 text-purple-600" />
        <MetricCard label="Churned (30d)"     value={String(d.churn_30d)}   icon={Activity}    color="bg-red-100 text-red-500" />
      </div>

      {/* Recent charges */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="font-semibold text-gray-800 text-sm">Recent transactions</span>
        </div>
        {d.recent_charges.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">No transactions yet</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {d.recent_charges.map((ch: any) => (
              <div key={ch.id} className="px-5 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors">
                <div className="flex items-center space-x-3">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center ${ch.paid ? 'bg-green-100' : 'bg-red-100'}`}>
                    {ch.paid ? <CheckCircle2 size={13} className="text-green-600" /> : <AlertCircle size={13} className="text-red-500" />}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-800">
                      {ch.customer?.name ?? ch.customer?.email ?? ch.customer?.id ?? 'Unknown'}
                    </div>
                    <div className="text-xs text-gray-400">{fmtDate(ch.created)}</div>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  {ch.card && <CardChip brand={ch.card.brand} last4={ch.card.last4} />}
                  <span className="font-semibold text-gray-900">{fmt(ch.amount, ch.currency)}</span>
                  <StatusPill status={ch.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Customers tab
// ---------------------------------------------------------------------------
function CustomersTab({ orgId, accessToken }: { orgId: number; accessToken: string }) {
  const { data: customers, error, isLoading } = useSWR(
    [`/payments/${orgId}/customers`, accessToken],
    () => getOrgCustomers(orgId, accessToken),
    { revalidateOnFocus: false }
  )

  if (isLoading) return <PageLoading />
  if (error) return <div className="p-6 text-sm text-red-500">Error loading customers</div>
  if (!customers || customers.length === 0) {
    return <Empty message="No customers yet" />
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Customer</TableHead>
            <TableHead>Offer</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Payment method</TableHead>
            <TableHead>Last charge</TableHead>
            <TableHead>Next billing</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Since</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {customers.map((item: any) => {
            const offer = item.offer
            const stripe = item.stripe
            const pm = stripe?.payment_method
            return (
              <TableRow key={item.enrollment_id}>
                <TableCell>
                  <div className="flex items-center space-x-3">
                    <UserAvatar
                      border="border-2"
                      rounded="rounded-md"
                      avatar_url={getUserAvatarMediaDirectory(item.user?.user_uuid, item.user?.avatar_image)}
                    />
                    <div className="flex flex-col min-w-0">
                      <span className="font-medium truncate">
                        {item.user?.first_name ? `${item.user.first_name} ${item.user.last_name ?? ''}`.trim() : item.user?.username}
                      </span>
                      <span className="text-xs text-gray-400 truncate">{item.user?.email}</span>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="font-medium">{offer?.name ?? '—'}</TableCell>
                <TableCell>
                  {offer?.offer_type === 'subscription' ? (
                    <Badge variant="outline" className="flex items-center gap-1 w-fit"><RefreshCcw size={11} /><span>Subscription</span></Badge>
                  ) : (
                    <Badge variant="outline" className="flex items-center gap-1 w-fit"><SquareCheck size={11} /><span>One-time</span></Badge>
                  )}
                </TableCell>
                <TableCell>{offer ? fmt(offer.amount, offer.currency) : '—'}</TableCell>
                <TableCell>{pm ? <CardChip brand={pm.brand} last4={pm.last4} /> : <span className="text-gray-400">—</span>}</TableCell>
                <TableCell>
                  {stripe?.last_charge_date ? (
                    <div className="flex flex-col">
                      <span className="text-sm">{fmtDate(stripe.last_charge_date)}</span>
                      {stripe.last_charge_amount != null && (
                        <span className="text-xs text-gray-400">{fmt(stripe.last_charge_amount, offer?.currency)}</span>
                      )}
                    </div>
                  ) : <span className="text-gray-400">—</span>}
                </TableCell>
                <TableCell>
                  {stripe?.next_billing_date ? (
                    <div className="flex flex-col">
                      <span className="text-sm">{fmtDate(stripe.next_billing_date)}</span>
                      {stripe.cancel_at_period_end && <span className="text-xs text-red-500">Cancels then</span>}
                    </div>
                  ) : <span className="text-gray-400">—</span>}
                </TableCell>
                <TableCell><StatusPill status={item.status} /></TableCell>
                <TableCell className="text-sm text-gray-500">{fmtDate(item.creation_date)}</TableCell>
                <TableCell>
                  {stripe?.stripe_customer_url && (
                    <a href={stripe.stripe_customer_url} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gray-600 transition">
                      <ExternalLink size={13} />
                    </a>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Transactions tab (paginated, direct from Stripe)
// ---------------------------------------------------------------------------
function TransactionsTab({ orgId, accessToken }: { orgId: number; accessToken: string }) {
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [cursorStack, setCursorStack] = useState<string[]>([])

  const { data, error, isLoading } = useSWR(
    [`/stripe/charges/${orgId}`, accessToken, cursor],
    () => getStripeCharges(orgId, accessToken, 25, cursor),
    { revalidateOnFocus: false }
  )

  const goNext = () => {
    if (data?.next_cursor) {
      setCursorStack(s => [...s, cursor ?? ''])
      setCursor(data.next_cursor)
    }
  }
  const goPrev = () => {
    const stack = [...cursorStack]
    const prev = stack.pop()
    setCursorStack(stack)
    setCursor(prev || undefined)
  }

  if (isLoading) return <PageLoading />
  if (error) return <StripeUnavailable />
  if (!data?.data?.length) return <Empty message="No transactions yet" />

  return (
    <div className="space-y-3">
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Payment method</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Refunded</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Description</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.data.map((ch: any) => (
              <TableRow key={ch.id}>
                <TableCell className="text-sm text-gray-500 whitespace-nowrap">{fmtDate(ch.created)}</TableCell>
                <TableCell>
                  <div className="flex flex-col min-w-0">
                    <span className="font-medium truncate">{ch.customer?.name ?? ch.customer?.email ?? '—'}</span>
                    {ch.customer?.name && ch.customer?.email && (
                      <span className="text-xs text-gray-400 truncate">{ch.customer.email}</span>
                    )}
                  </div>
                </TableCell>
                <TableCell><CardChip brand={ch.card?.brand} last4={ch.card?.last4} /></TableCell>
                <TableCell className="font-semibold">{fmt(ch.amount, ch.currency)}</TableCell>
                <TableCell className="text-sm">
                  {ch.amount_refunded > 0 ? (
                    <span className="text-purple-600">{fmt(ch.amount_refunded, ch.currency)}</span>
                  ) : '—'}
                </TableCell>
                <TableCell><StatusPill status={ch.paid ? 'succeeded' : ch.status} /></TableCell>
                <TableCell className="text-sm text-gray-500 max-w-[200px] truncate">{ch.description ?? '—'}</TableCell>
                <TableCell>
                  {ch.receipt_url && (
                    <a href={ch.receipt_url} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gray-600 transition" title="View receipt">
                      <ExternalLink size={13} />
                    </a>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-end space-x-2">
        <Button variant="outline" size="sm" onClick={goPrev} disabled={cursorStack.length === 0}>
          <ChevronLeft size={14} className="mr-1" /> Previous
        </Button>
        <Button variant="outline" size="sm" onClick={goNext} disabled={!data?.has_more}>
          Next <ChevronRight size={14} className="ml-1" />
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Subscriptions tab (direct from Stripe)
// ---------------------------------------------------------------------------
function SubscriptionsTab({ orgId, accessToken }: { orgId: number; accessToken: string }) {
  const [status, setStatus] = useState('active')

  const { data, error, isLoading } = useSWR(
    [`/stripe/subscriptions/${orgId}`, accessToken, status],
    () => getStripeSubscriptions(orgId, accessToken, status),
    { revalidateOnFocus: false }
  )

  const statuses = ['active', 'trialing', 'past_due', 'canceled', 'all']

  if (isLoading) return <PageLoading />
  if (error) return <StripeUnavailable />

  return (
    <div className="space-y-3">
      {/* Status filter */}
      <div className="flex items-center space-x-1">
        {statuses.map(s => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${
              status === s ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {(!data?.data?.length) ? <Empty message={`No ${status} subscriptions`} /> : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Payment method</TableHead>
                <TableHead>Current period</TableHead>
                <TableHead>Next billing</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.map((sub: any) => (
                <TableRow key={sub.id}>
                  <TableCell>
                    <div className="flex flex-col min-w-0">
                      <span className="font-medium truncate">{sub.customer?.name ?? sub.customer?.email ?? '—'}</span>
                      {sub.customer?.name && sub.customer?.email && (
                        <span className="text-xs text-gray-400 truncate">{sub.customer.email}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {sub.plan ? (
                      <div className="flex flex-col">
                        <span className="font-medium">{fmt(sub.plan.amount, sub.plan.currency)}/{sub.plan.interval}</span>
                        {sub.plan.nickname && <span className="text-xs text-gray-400">{sub.plan.nickname}</span>}
                      </div>
                    ) : '—'}
                  </TableCell>
                  <TableCell><CardChip brand={sub.card?.brand} last4={sub.card?.last4} /></TableCell>
                  <TableCell className="text-sm text-gray-600 whitespace-nowrap">
                    {fmtDate(sub.current_period_start)} – {fmtDate(sub.current_period_end)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="text-sm">{fmtDate(sub.current_period_end)}</span>
                      {sub.cancel_at_period_end && (
                        <span className="text-xs text-red-500 flex items-center gap-1">
                          <Clock size={10} /> Cancels then
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell><StatusPill status={sub.status} /></TableCell>
                  <TableCell className="text-sm text-gray-500">{fmtDate(sub.created)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared utility components
// ---------------------------------------------------------------------------
function Empty({ message }: { message: string }) {
  return <div className="bg-white border border-gray-200 rounded-xl py-12 text-center text-sm text-gray-400">{message}</div>
}

function StripeUnavailable() {
  return (
    <div className="bg-white border border-gray-200 rounded-xl py-10 text-center space-y-1">
      <AlertCircle size={20} className="mx-auto text-gray-400" />
      <p className="text-sm text-gray-500">Could not reach Stripe. Check your connection or configuration.</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
function PaymentsCustomersPage() {
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const { isEnabled, isLoading } = usePaymentsEnabled()
  const [activeTab, setActiveTab] = useState<Tab>('overview')

  if (!isEnabled && !isLoading) return <UnconfiguredPaymentsDisclaimer />
  if (isLoading) return <PageLoading />

  return (
    <div className="ml-10 mr-10 mx-auto space-y-4">
      {/* Inner tab bar */}
      <div className="flex items-center space-x-1 bg-gray-100 p-1 rounded-xl w-fit">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === id
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon size={15} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'overview'      && <OverviewTab       orgId={org.id} accessToken={access_token} />}
        {activeTab === 'customers'     && <CustomersTab      orgId={org.id} accessToken={access_token} />}
        {activeTab === 'transactions'  && <TransactionsTab   orgId={org.id} accessToken={access_token} />}
        {activeTab === 'subscriptions' && <SubscriptionsTab  orgId={org.id} accessToken={access_token} />}
      </div>
    </div>
  )
}

export default PaymentsCustomersPage
