import React from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import useSWR from 'swr'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@components/ui/table"
import { getOrgCustomers } from '@services/payments/payments'
import { Badge } from '@components/ui/badge'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import { RefreshCcw, SquareCheck } from 'lucide-react'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import UserAvatar from '@components/Objects/UserAvatar'
import { usePaymentsEnabled } from '@hooks/usePaymentsEnabled'
import UnconfiguredPaymentsDisclaimer from '@components/Pages/Payments/UnconfiguredPaymentsDisclaimer'

interface PaymentUserData {
  payment_user_id: number;
  user: {
    username: string;
    first_name: string;
    last_name: string;
    email: string;
    avatar_image: string;
    user_uuid: string;
  };
  product: {
    name: string;
    description: string;
    product_type: string;
    amount: number;
    currency: string;
  };
  status: string;
  creation_date: string;
}

function PaymentsUsersTable({ data }: { data: PaymentUserData[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No customers found
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>User</TableHead>
          <TableHead>Product</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Amount</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Purchase Date</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((item) => (
          <TableRow key={item.payment_user_id}>
            <TableCell className="font-medium">
              <div className="flex items-center space-x-3">
                <UserAvatar
                  border="border-2"
                  rounded="rounded-md"
                  avatar_url={getUserAvatarMediaDirectory(item.user.user_uuid, item.user.avatar_image)}
                />
                <div className="flex flex-col">
                  <span className="font-medium">
                    {item.user.first_name || item.user.username}
                  </span>
                  <span className="text-sm text-gray-500">{item.user.email}</span>
                </div>
              </div>
            </TableCell>
            <TableCell>{item.product.name}</TableCell>
            <TableCell>
              <div className="flex items-center space-x-2">
                {item.product.product_type === 'subscription' ? (
                  <Badge variant="outline" className="flex items-center gap-1">
                    <RefreshCcw size={12} />
                    <span>Subscription</span>
                  </Badge>
                ) : (
                  <Badge variant="outline" className="flex items-center gap-1">
                    <SquareCheck size={12} />
                    <span>One-time</span>
                  </Badge>
                )}
              </div>
            </TableCell>
            <TableCell>
              {new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: item.product.currency
              }).format(item.product.amount)}
            </TableCell>
            <TableCell>
              <Badge
                variant={item.status === 'active' ? 'default' :
                  item.status === 'completed' ? 'default' : 'secondary'}
              >
                {item.status}
              </Badge>
            </TableCell>
            <TableCell>
              {new Date(item.creation_date).toLocaleDateString()}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function PaymentsCustomersPage() {
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const { isEnabled, isLoading } = usePaymentsEnabled()

  const { data: customers, error, isLoading: customersLoading } = useSWR(
    org ? [`/payments/${org.id}/customers`, access_token] : null,
    ([url, token]) => getOrgCustomers(org.id, token)
  )

  if (!isEnabled && !isLoading) {
    return (
      <UnconfiguredPaymentsDisclaimer />
    )
  }

  if (isLoading || customersLoading) return <PageLoading />
  if (error) return <div>Error loading customers</div>
  if (!customers) return <div>No customer data available</div>

  return (
    <div className="ml-10 mr-10 mx-auto bg-white rounded-xl nice-shadow px-4 py-4">
      <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 rounded-md mb-3">
        <h1 className="font-bold text-xl text-gray-800">Customers</h1>
        <h2 className="text-gray-500 text-md">View and manage your customer information</h2>
      </div>

      <PaymentsUsersTable data={customers} />
    </div>
  )
}

export default PaymentsCustomersPage