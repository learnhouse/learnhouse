import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import UserAvatar from '@components/Objects/UserAvatar'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { getAPIUrl } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import { Search, Activity, ShieldCheck, RefreshCw, Eye, Globe, Terminal, ChevronLeft, ChevronRight, Calendar, Download } from 'lucide-react'
import React, { useState } from 'react'
import useSWR, { mutate } from 'swr'
import dayjs from 'dayjs'
import toast from 'react-hot-toast'
import { Input } from '@components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@components/ui/select'

const ITEMS_PER_PAGE = 20

const OrgAuditLogs = () => {
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const [offset, setOffset] = useState(0)
  const [searchField, setSearchField] = useState('action')
  const [filters, setFilters] = useState({
    searchValue: '',
    action: '',
    resource: '',
    status_code: '',
    date_range: 'all',
    start_date: '',
    end_date: '',
  })

  const buildQuery = () => {
    const params = new URLSearchParams()
    params.append('limit', ITEMS_PER_PAGE.toString())
    params.append('offset', offset.toString())
    
    // Search logic based on selected field
    if (filters.searchValue) {
      if (searchField === 'user_id') {
        params.append('user_id', filters.searchValue)
      } else if (searchField === 'username') {
        params.append('username', filters.searchValue)
      } else if (searchField === 'name') {
        params.append('name', filters.searchValue)
      } else if (searchField === 'resource') {
        params.append('resource', filters.searchValue)
      } else if (searchField === 'ip_address') {
        params.append('ip_address', filters.searchValue)
      } else {
        params.append('action', filters.searchValue)
      }
    }

    if (filters.resource && filters.resource !== 'all') params.append('resource', filters.resource)
    if (filters.status_code && filters.status_code !== 'all') params.append('status_code', filters.status_code)
    
    let start = filters.start_date
    let end = filters.end_date

    if (filters.date_range !== 'custom' && filters.date_range !== 'all') {
      end = dayjs().endOf('day').toISOString()
      if (filters.date_range === 'today') start = dayjs().startOf('day').toISOString()
      if (filters.date_range === '7d') start = dayjs().subtract(7, 'day').startOf('day').toISOString()
      if (filters.date_range === '30d') start = dayjs().subtract(30, 'day').startOf('day').toISOString()
    }

    if (start) params.append('start_date', start)
    if (end) params.append('end_date', end)

    return params.toString()
  }

  const logsUrl = org && access_token ? `${getAPIUrl()}ee/audit_logs/?${buildQuery()}` : null
  const { data, isLoading, isValidating } = useSWR(
    logsUrl,
    (url) => swrFetcher(url, access_token)
  )

  const logs = data?.items || []
  const total = data?.total || 0

  const handleRefresh = () => {
    mutate(logsUrl)
  }

  const handleExport = async () => {
    const toastId = toast.loading('Generating CSV...')
    try {
      const params = new URLSearchParams()
      if (filters.searchValue) {
        if (searchField === 'user_id') params.append('user_id', filters.searchValue)
        else if (searchField === 'username') params.append('username', filters.searchValue)
        else if (searchField === 'name') params.append('name', filters.searchValue)
        else if (searchField === 'resource') params.append('resource', filters.searchValue)
        else if (searchField === 'ip_address') params.append('ip_address', filters.searchValue)
        else params.append('action', filters.searchValue)
      }
      if (filters.resource && filters.resource !== 'all') params.append('resource', filters.resource)
      if (filters.status_code && filters.status_code !== 'all') params.append('status_code', filters.status_code)
      
      let start = filters.start_date
      let end = filters.end_date
      if (filters.date_range !== 'custom' && filters.date_range !== 'all') {
        end = dayjs().endOf('day').toISOString()
        if (filters.date_range === 'today') start = dayjs().startOf('day').toISOString()
        if (filters.date_range === '7d') start = dayjs().subtract(7, 'day').startOf('day').toISOString()
        if (filters.date_range === '30d') start = dayjs().subtract(30, 'day').startOf('day').toISOString()
      }
      if (start) params.append('start_date', start)
      if (end) params.append('end_date', end)

      const url = `${getAPIUrl()}ee/audit_logs/export?${params.toString()}`
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${access_token}`
        }
      })

      if (!response.ok) throw new Error('Export failed')

      const blob = await response.blob()
      const downloadUrl = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = downloadUrl
      a.download = `audit_logs_${dayjs().format('YYYYMMDD_HHmmss')}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      toast.success('CSV exported successfully', { id: toastId })
    } catch (error) {
      console.error('Export error:', error)
      toast.error('Failed to export CSV', { id: toastId })
    }
  }

  const handlePageChange = (newOffset: number) => {
    setOffset(newOffset)
  }

  const getStatusColor = (code: number) => {
    if (code >= 200 && code < 300) return 'bg-green-100 text-green-700'
    if (code >= 400 && code < 500) return 'bg-orange-100 text-orange-700'
    if (code >= 500) return 'bg-red-100 text-red-700'
    return 'bg-gray-100 text-gray-700'
  }

  return (
    <div>
      <div className="h-6"></div>
      <div className="ml-10 mr-10 mx-auto bg-white rounded-xl shadow-xs px-4 py-4">
        <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 rounded-md mb-3">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="font-bold text-xl text-gray-800 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-indigo-600" />
                Audit Logs
              </h1>
              <h2 className="text-gray-500 text-md">
                Track and monitor all activities within your organization
              </h2>
            </div>
            <div className="flex gap-2 items-center">
               <button 
                onClick={handleRefresh}
                className={`p-2 rounded-md hover:bg-gray-200 transition-colors ${isValidating ? 'animate-spin' : ''}`}
                title="Refresh logs"
               >
                <RefreshCw className="w-4 h-4 text-gray-600" />
               </button>

               <button 
                onClick={handleExport}
                className="p-2 rounded-md hover:bg-gray-200 transition-colors flex items-center gap-2 text-sm text-gray-600"
                title="Export CSV"
               >
                <Download className="w-4 h-4" />
                <span className="hidden md:inline font-medium">Export</span>
               </button>

               <div className="flex items-center gap-0 border border-gray-200 rounded-md overflow-hidden bg-white">
                <Select
                  value={searchField}
                  onValueChange={(val) => setSearchField(val)}
                >
                  <SelectTrigger className="w-[110px] h-9 text-[10px] border-none bg-gray-50 rounded-none focus:ring-0">
                    <SelectValue placeholder="Search by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="action">Action</SelectItem>
                    <SelectItem value="resource">Resource</SelectItem>
                    <SelectItem value="username">Username</SelectItem>
                    <SelectItem value="name">Name</SelectItem>
                    <SelectItem value="user_id">User ID</SelectItem>
                    <SelectItem value="ip_address">IP Address</SelectItem>
                  </SelectContent>
                </Select>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <Input
                    placeholder="Search..."
                    className="pl-9 w-[180px] h-9 text-xs border-none focus-visible:ring-0 rounded-none"
                    value={filters.searchValue}
                    onChange={(e) => {
                      setFilters({ ...filters, searchValue: e.target.value })
                      setOffset(0)
                    }}
                  />
                </div>
              </div>
              
              <Select
                value={filters.resource}
                onValueChange={(val) => {
                    setFilters({ ...filters, resource: val })
                    setOffset(0)
                }}
              >
                <SelectTrigger className="w-[120px] h-9 text-sm">
                  <SelectValue placeholder="Resource" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Resources</SelectItem>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="course">Course</SelectItem>
                  <SelectItem value="org">Organization</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={filters.status_code}
                onValueChange={(val) => {
                    setFilters({ ...filters, status_code: val })
                    setOffset(0)
                }}
              >
                <SelectTrigger className="w-[100px] h-9 text-sm">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="200">200 OK</SelectItem>
                  <SelectItem value="403">403</SelectItem>
                  <SelectItem value="404">404</SelectItem>
                  <SelectItem value="500">500</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={filters.date_range}
                onValueChange={(val) => {
                    setFilters({ ...filters, date_range: val, start_date: '', end_date: '' })
                    setOffset(0)
                }}
              >
                <SelectTrigger className="w-[130px] h-9 text-sm">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-3.5 h-3.5 text-gray-400" />
                    <SelectValue placeholder="Date" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Time</SelectItem>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="7d">Last 7 Days</SelectItem>
                  <SelectItem value="30d">Last 30 Days</SelectItem>
                  <SelectItem value="custom">Custom Range</SelectItem>
                </SelectContent>
              </Select>

              {filters.date_range === 'custom' && (
                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    className="h-9 text-xs w-[130px]"
                    value={filters.start_date ? dayjs(filters.start_date).format('YYYY-MM-DD') : ''}
                    onChange={(e) => {
                      const date = e.target.value ? dayjs(e.target.value).startOf('day').toISOString() : ''
                      setFilters({ ...filters, start_date: date })
                      setOffset(0)
                    }}
                  />
                  <span className="text-gray-400 text-xs">to</span>
                  <Input
                    type="date"
                    className="h-9 text-xs w-[130px]"
                    value={filters.end_date ? dayjs(filters.end_date).format('YYYY-MM-DD') : ''}
                    onChange={(e) => {
                      const date = e.target.value ? dayjs(e.target.value).endOf('day').toISOString() : ''
                      setFilters({ ...filters, end_date: date })
                      setOffset(0)
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        <table className="table-auto w-full text-left whitespace-nowrap rounded-md overflow-hidden">
          <thead className="bg-gray-100 text-gray-500 rounded-xl uppercase">
            <tr className="font-bolder text-[10px] tracking-wider">
              <th className="py-3 px-4">Timestamp</th>
              <th className="py-3 px-4">User</th>
              <th className="py-3 px-4">Resource</th>
              <th className="py-3 px-4">Path & Method</th>
              <th className="py-3 px-4">IP Address</th>
              <th className="py-3 px-4 text-right">Status</th>
              <th className="py-3 px-4 text-right">Payload</th>
            </tr>
          </thead>
          <tbody className="bg-white relative">
            {isLoading && !data ? (
              <tr>
                <td colSpan={7} className="py-20 text-center text-gray-400">
                  <div className="flex flex-col items-center gap-2">
                      <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin opacity-20" />
                      <span className="text-sm font-medium">Loading activity...</span>
                  </div>
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-gray-400">
                  No logs found
                </td>
              </tr>
            ) : (
              logs.map((log: any) => (
                <tr key={log.id} className="border-b border-gray-200 border-dashed hover:bg-gray-50/50 transition-colors">
                  <td className="py-3 px-4">
                    <div className="flex flex-col text-sm">
                      <span className="font-semibold text-gray-700">{dayjs(log.created_at).format('MMM DD, YYYY')}</span>
                      <span className="text-[10px] text-gray-400">{dayjs(log.created_at).format('HH:mm:ss')}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                        <UserAvatar 
                            width={28} 
                            userId={log.user_id?.toString()} 
                            rounded="rounded-full"
                            showProfilePopup={true}
                        />
                        <div className="flex flex-col">
                            <span className="text-sm font-medium text-gray-800">
                                @{log.username || 'System'}
                            </span>
                            {log.user_id && (
                                <span className="text-[10px] text-gray-400 font-mono tracking-tighter">ID: {log.user_id}</span>
                            )}
                        </div>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1.5 text-gray-600">
                      <Activity className="w-3.5 h-3.5 text-gray-400" />
                      <span className="text-sm capitalize">{log.resource}</span>
                      {log.resource_id && (
                        <span className="text-[10px] bg-gray-50 border border-gray-200 px-1 rounded text-gray-400 font-mono">
                          {log.resource_id}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1 text-[11px] text-gray-500 font-mono truncate max-w-[200px]">
                        <Terminal className="w-3 h-3" />
                        {log.path}
                      </div>
                      <span className={`w-fit text-[9px] font-bold px-1.5 py-0.5 rounded ${
                        log.method === 'GET' ? 'text-blue-600 bg-blue-50' :
                        log.method === 'POST' ? 'text-green-600 bg-green-50' :
                        log.method === 'PUT' ? 'text-amber-600 bg-amber-50' :
                        'text-red-600 bg-red-50'
                      }`}>
                        {log.method}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1 text-xs text-gray-400 font-mono">
                      <Globe className="w-3 h-3" />
                      {log.ip_address || '—'}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${getStatusColor(log.status_code)}`}>
                      {log.status_code}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    {log.payload && Object.keys(log.payload).length > 0 ? (
                      <Modal
                        dialogTitle="Event Payload"
                        dialogDescription={`Detailed data for action: ${log.action}`}
                        minHeight="no-min"
                        dialogContent={
                          <div className="bg-gray-900 rounded-lg p-4 mt-2 overflow-auto max-h-[400px]">
                            <pre className="text-xs text-green-400 font-mono">
                              {JSON.stringify(log.payload, null, 2)}
                            </pre>
                          </div>
                        }
                        dialogTrigger={
                          <button className="p-1.5 hover:bg-gray-100 rounded-md transition-colors group">
                            <Eye className="w-4 h-4 text-gray-400 group-hover:text-indigo-600" />
                          </button>
                        }
                      />
                    ) : (
                      <span className="text-gray-300 text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination Controls */}
        {total > ITEMS_PER_PAGE && (
          <div className="mt-4 flex items-center justify-between px-2">
            <div className="text-xs text-gray-500">
              Showing {offset + 1} to {Math.min(offset + ITEMS_PER_PAGE, total)} of {total} logs
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handlePageChange(Math.max(0, offset - ITEMS_PER_PAGE))}
                disabled={offset === 0}
                className="p-1.5 rounded-md border border-gray-200 hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                <ChevronLeft className="w-4 h-4 text-gray-600" />
              </button>
              <button
                onClick={() => handlePageChange(offset + ITEMS_PER_PAGE)}
                disabled={offset + ITEMS_PER_PAGE >= total}
                className="p-1.5 rounded-md border border-gray-200 hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                <ChevronRight className="w-4 h-4 text-gray-600" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default OrgAuditLogs
