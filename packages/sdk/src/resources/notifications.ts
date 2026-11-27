import type { HttpCore } from '../core/http'
import type { BaseRequestOptions } from '../core/types'
import type { components } from '../generated/schema'
import type {
  Notification,
  NotificationAudience,
  NotificationCategory,
  NotificationChange,
  NotificationPage,
  NotificationUnread,
} from '../models'

export interface ListNotificationsOptions extends BaseRequestOptions {
  /** Only this org's notifications. */
  orgId?: number
  unreadOnly?: boolean
  category?: NotificationCategory
  /** `personal` (default), `admin` (admin events) or `all`. */
  audience?: NotificationAudience
  /** List archived notifications instead of the inbox. */
  archived?: boolean
  /** Only one notification type, e.g. `assignment_graded`. */
  type?: string
  important?: boolean
  /** Text search in titles and bodies. */
  q?: string
  /** `next_cursor` of the previous page. */
  cursor?: string
  /** 1..100. Default 30 (server side). */
  limit?: number
}

export interface MarkReadInput {
  /** These notifications, or `all: true` for every one (optionally narrowed by org/category/audience). */
  uuids?: string[]
  all?: boolean
  orgId?: number
  category?: NotificationCategory
  audience?: NotificationAudience
}

export interface RegisterDeviceInput {
  /** The Expo / APNs / FCM push token. */
  token: string
  platform: 'ios' | 'android'
  /** Only push this org's notifications to the device. */
  orgId?: number
  deviceName?: string
  appVersion?: string
}

/** The signed-in user's notification inbox, push devices and preferences. Sessions only. */
export function createNotificationsResource(http: HttpCore) {
  // Named so methods still work when destructured off the resource.
  const resource = {
    /** One page, newest first. `GET /api/v1/notifications` */
    list(options: ListNotificationsOptions = {}): Promise<NotificationPage> {
      const { orgId, unreadOnly, category, audience, archived, type, important, q, cursor, limit, ...rest } = options
      return http.GET('/api/v1/notifications', {
        ...rest,
        params: {
          query: {
            org_id: orgId,
            unread_only: unreadOnly,
            category,
            audience,
            archived,
            type,
            important,
            q,
            cursor,
            limit,
          },
        },
      }) as Promise<NotificationPage>
    },
    /**
     * Every notification, following `next_cursor` until the last page.
     * `for await (const n of lh.notifications.listAll({ unreadOnly: true })) {}`
     */
    async *listAll(options: Omit<ListNotificationsOptions, 'cursor'> = {}): AsyncGenerator<Notification, void, undefined> {
      let cursor: string | undefined
      for (;;) {
        const page = await resource.list({ ...options, cursor })
        yield* page.items
        if (!page.next_cursor || !page.items.length) return
        cursor = page.next_cursor
      }
    },
    /** `GET /api/v1/notifications/unread_count` */
    unreadCount(options: BaseRequestOptions & { orgId?: number; audience?: NotificationAudience } = {}): Promise<NotificationUnread> {
      const { orgId, audience, ...rest } = options
      return http.GET('/api/v1/notifications/unread_count', {
        ...rest,
        params: { query: { org_id: orgId, audience } },
      }) as Promise<NotificationUnread>
    },
    /** Personal and admin unread counts in one call. `GET /api/v1/notifications/counts` */
    counts(options: BaseRequestOptions & { orgId?: number } = {}): Promise<{ personal: NotificationUnread; admin: NotificationUnread }> {
      const { orgId, ...rest } = options
      return http.GET('/api/v1/notifications/counts', { ...rest, params: { query: { org_id: orgId } } }) as Promise<{
        personal: NotificationUnread
        admin: NotificationUnread
      }>
    },
    /** Mark several (or all) read. `POST /api/v1/notifications/read` */
    markRead(input: MarkReadInput, options?: BaseRequestOptions): Promise<NotificationChange> {
      return http.POST('/api/v1/notifications/read', {
        ...options,
        body: {
          notification_uuids: input.uuids ?? [],
          all: input.all ?? false,
          org_id: input.orgId ?? null,
          category: input.category ?? null,
          audience: input.audience ?? 'personal',
        },
      }) as Promise<NotificationChange>
    },
    /** `POST /api/v1/notifications/{notification_uuid}/read` */
    markOneRead(notificationUuid: string, options?: BaseRequestOptions): Promise<NotificationChange> {
      return http.POST('/api/v1/notifications/{notification_uuid}/read', {
        ...options,
        params: { path: { notification_uuid: notificationUuid } },
      }) as Promise<NotificationChange>
    },
    /** `POST /api/v1/notifications/{notification_uuid}/unread` */
    markOneUnread(notificationUuid: string, options?: BaseRequestOptions): Promise<NotificationChange> {
      return http.POST('/api/v1/notifications/{notification_uuid}/unread', {
        ...options,
        params: { path: { notification_uuid: notificationUuid } },
      }) as Promise<NotificationChange>
    },
    /** `POST /api/v1/notifications/{notification_uuid}/archive` */
    archive(notificationUuid: string, options?: BaseRequestOptions): Promise<NotificationChange> {
      return http.POST('/api/v1/notifications/{notification_uuid}/archive', {
        ...options,
        params: { path: { notification_uuid: notificationUuid } },
      }) as Promise<NotificationChange>
    },
    /** `POST /api/v1/notifications/{notification_uuid}/unarchive` */
    unarchive(notificationUuid: string, options?: BaseRequestOptions): Promise<NotificationChange> {
      return http.POST('/api/v1/notifications/{notification_uuid}/unarchive', {
        ...options,
        params: { path: { notification_uuid: notificationUuid } },
      }) as Promise<NotificationChange>
    },
    /** `DELETE /api/v1/notifications/{notification_uuid}` */
    delete(notificationUuid: string, options?: BaseRequestOptions): Promise<{ deleted: boolean }> {
      return http.DELETE('/api/v1/notifications/{notification_uuid}', {
        ...options,
        params: { path: { notification_uuid: notificationUuid } },
      }) as Promise<{ deleted: boolean }>
    },
    /** Push and email preferences. `GET /api/v1/notifications/preferences` */
    getPreferences(options?: BaseRequestOptions): Promise<Record<string, unknown>> {
      return http.GET('/api/v1/notifications/preferences', options) as Promise<Record<string, unknown>>
    },
    /** Change only the fields given. `PUT /api/v1/notifications/preferences` */
    updatePreferences(
      input: {
        push_enabled?: boolean
        /** `{ [category]: boolean }` */
        push_categories?: Record<string, boolean>
        /** `{ [category]: { push?: boolean, email?: boolean } }` */
        channels?: Record<string, Record<string, boolean>>
        email_digest?: 'off' | 'daily' | 'weekly'
      },
      options?: BaseRequestOptions,
    ): Promise<Record<string, unknown>> {
      return http.PUT('/api/v1/notifications/preferences', { ...options, body: input }) as Promise<Record<string, unknown>>
    },
    /** The user's registered push devices. `GET /api/v1/notifications/devices` */
    listDevices(options?: BaseRequestOptions): Promise<unknown> {
      return http.GET('/api/v1/notifications/devices', options)
    },
    /** Register a phone for push notifications. `POST /api/v1/notifications/devices` */
    registerDevice(input: RegisterDeviceInput, options?: BaseRequestOptions): Promise<unknown> {
      const body: components['schemas']['DeviceRegister'] = {
        token: input.token,
        platform: input.platform,
        org_id: input.orgId ?? null,
      }
      if (input.deviceName !== undefined) body.device_name = input.deviceName
      if (input.appVersion !== undefined) body.app_version = input.appVersion
      return http.POST('/api/v1/notifications/devices', { ...options, body })
    },
    /** Stop pushing to a device (on sign-out). `POST /api/v1/notifications/devices/unregister` */
    unregisterDevice(token: string, options?: BaseRequestOptions): Promise<unknown> {
      return http.POST('/api/v1/notifications/devices/unregister', { ...options, body: { token } })
    },
  }
  return resource
}

export type NotificationsResource = ReturnType<typeof createNotificationsResource>
