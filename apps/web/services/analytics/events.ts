/* eslint-disable no-unused-vars, @typescript-eslint/no-unused-vars --
   Enum members are the public API of this registry; they are referenced by
   call-sites across the app, not within this file. */
/**
 * learnhouse-analytics — central event registry (single source of truth).
 *
 * Naming convention: `object_action`, snake_case, past-tense verb.
 * - Object first so events cluster by feature in PostHog (course_*, podcast_*, …).
 * - Intent vs completion are distinct events (`*_modal_opened` → `*_created`).
 * - Toggles carry their resulting state in a property, never two event names
 *   (`course_published_toggled { published }`, not `course_published`/`_unpublished`).
 *
 * The enum VALUE is the wire name sent to the backend sink. Where the canonical
 * PostHog name should differ from the legacy backend name, add an entry to
 * POSTHOG_NAME_OVERRIDES below — call-sites never deal with this.
 */
export enum AnalyticsEvent {
  // ── Existing events already in code (preserved wire names) ────────────────
  CourseViewed = 'course_view',
  ActivityViewed = 'activity_view',
  TimeOnActivity = 'time_on_activity',
  SearchQuery = 'search_query',
  PageViewed = 'page_view',

  // ── Auth & onboarding ─────────────────────────────────────────────────────
  SignupSubmitted = 'signup_submitted',
  SignupSucceeded = 'signup_succeeded',
  SignupFailed = 'signup_failed',
  LoginSubmitted = 'login_submitted',
  LoginSucceeded = 'login_succeeded',
  LoginFailed = 'login_failed',
  LoginGoogleClicked = 'login_google_clicked',
  SignupGoogleClicked = 'signup_google_clicked',
  LoginSsoClicked = 'login_sso_clicked',
  GoogleOauthCallbackCompleted = 'google_oauth_callback_completed',
  SsoCallbackCompleted = 'sso_callback_completed',
  EmailVerificationCompleted = 'email_verification_completed',
  PasswordResetLinkRequested = 'password_reset_link_requested',
  PasswordResetSubmitted = 'password_reset_submitted',
  EmailVerificationResent = 'email_verification_resent',
  OnboardingWelcomeCompleted = 'onboarding_welcome_completed',
  OnboardingStepActionClicked = 'onboarding_step_action_clicked',
  OnboardingStepCompleted = 'onboarding_step_completed',
  OnboardingStepSkipped = 'onboarding_step_skipped',
  LoginClicked = 'login_clicked',
  SignupClicked = 'signup_clicked',
  LogoutClicked = 'logout_clicked',
  JoinOrgBannerClicked = 'join_org_banner_clicked',
  OrgJoined = 'org_joined',
  OrgSelected = 'org_selected',
  LanguageChanged = 'language_changed',
  FeedbackSubmitted = 'feedback_submitted',

  // ── Course discovery & enrollment (learner) ──────────────────────────────
  CourseCardOpened = 'course_card_opened',
  CourseStarted = 'course_started',
  CourseLeft = 'course_left',
  CourseSignupPrompted = 'course_signup_prompted',
  CourseOfferCtaClicked = 'course_offer_cta_clicked',
  ContributorApplicationSubmitted = 'contributor_application_submitted',
  CourseProgressViewed = 'course_progress_viewed',
  CourseSearched = 'course_searched',
  CourseShared = 'course_shared',

  // ── Activities / lessons consumption ─────────────────────────────────────
  ActivityMarkedComplete = 'activity_marked_complete',
  ActivityNextClicked = 'activity_next_clicked',
  CourseCompleted = 'course_completed',
  FocusModeEntered = 'focus_mode_entered',
  AssignmentSubmitted = 'assignment_submitted',
  AssignmentRetried = 'assignment_retried',
  AssignmentGradeViewed = 'assignment_grade_viewed',
  AssignmentTaskProgressSaved = 'assignment_task_progress_saved',
  QuizBlockSubmitted = 'quiz_block_submitted',
  AiAssistantOpened = 'ai_assistant_opened',
  AiMessageSent = 'ai_message_sent',

  // ── Communities & discussions ────────────────────────────────────────────
  CommunityViewed = 'community_viewed',
  CommunitiesListViewed = 'communities_list_viewed',
  DiscussionViewed = 'discussion_viewed',
  CommunityCreated = 'community_created',
  DiscussionCreated = 'discussion_created',
  CommentPosted = 'comment_posted',
  CreateDiscussionModalOpened = 'create_discussion_modal_opened',
  DiscussionUpvoted = 'discussion_upvoted',
  CommentUpvoted = 'comment_upvoted',
  DiscussionReactionToggled = 'discussion_reaction_toggled',

  // ── Podcasts ─────────────────────────────────────────────────────────────
  EpisodePlayed = 'episode_played',
  PodcastCardOpened = 'podcast_card_opened',
  PodcastViewed = 'podcast_viewed',
  PodcastsListViewed = 'podcasts_list_viewed',
  EpisodeCompleted = 'episode_completed',
  PodcastCreated = 'podcast_created',
  EpisodeCreated = 'episode_created',
  PodcastUpdated = 'podcast_updated',
  EpisodePublishToggled = 'episode_publish_toggled',

  // ── Playgrounds ──────────────────────────────────────────────────────────
  PlaygroundOpened = 'playground_opened',
  PlaygroundViewed = 'playground_viewed',
  PlaygroundCreated = 'playground_created',
  PlaygroundGenerationStarted = 'playground_generation_started',
  PlaygroundGenerationCompleted = 'playground_generation_completed',
  PlaygroundGenerationFailed = 'playground_generation_failed',
  PlaygroundSaved = 'playground_saved',
  PlaygroundPublishToggled = 'playground_publish_toggled',

  // ── Boards ───────────────────────────────────────────────────────────────
  BoardCreated = 'board_created',
  BoardOpened = 'board_opened',
  BoardViewed = 'board_viewed',
  BoardBlockAdded = 'board_block_added',
  BoardMemberAdded = 'board_member_added',
  BoardAiPromptSent = 'board_ai_prompt_sent',
  BoardFeedbackSubmitted = 'board_feedback_submitted',

  // ── Library / media ──────────────────────────────────────────────────────
  FolderCreated = 'folder_created',
  MediaUploaded = 'media_uploaded',
  MediaUploadFailed = 'media_upload_failed',
  LibraryContentAdded = 'library_content_added',
  LibraryViewed = 'library_viewed',
  FolderViewed = 'folder_viewed',
  ResourceVisibilityChanged = 'resource_visibility_changed',
  UsergroupLinked = 'usergroup_linked',
  UsergroupUnlinked = 'usergroup_unlinked',
  FolderLinkShared = 'folder_link_shared',

  // ── Search, Copilot, Trail, Certificates, Account ────────────────────────
  SearchExecuted = 'search_executed',
  SearchResultClicked = 'search_result_clicked',
  CopilotMessageSent = 'copilot_message_sent',
  CopilotResponseCompleted = 'copilot_response_completed',
  CopilotResponseFailed = 'copilot_response_failed',
  CopilotBubbleOpened = 'copilot_bubble_opened',
  CopilotBubbleMessageSent = 'copilot_bubble_message_sent',
  TrailViewed = 'trail_viewed',
  CertificateViewed = 'certificate_viewed',
  CertificateDownloaded = 'certificate_downloaded',
  CertificateSharedLinkedin = 'certificate_shared_linkedin',
  CertificateVerificationViewed = 'certificate_verification_viewed',
  AccountProfileUpdated = 'account_profile_updated',
  AccountBillingPortalOpened = 'account_billing_portal_opened',
  AccountSubpageViewed = 'account_subpage_viewed',

  // ── Store & checkout (buyer) ─────────────────────────────────────────────
  StoreViewed = 'store_viewed',
  StoreOfferCardClicked = 'store_offer_card_clicked',
  OfferViewed = 'offer_viewed',
  OfferCheckoutStarted = 'offer_checkout_started',
  CheckoutLoginRedirected = 'checkout_login_redirected',
  CheckoutSessionCreated = 'checkout_session_created',
  CheckoutSessionFailed = 'checkout_session_failed',
  CheckoutReturned = 'checkout_returned',
  PaywallViewed = 'paywall_viewed',
  PaywallGetAccessClicked = 'paywall_get_access_clicked',

  // ── Course management (creator) ──────────────────────────────────────────
  CourseCreationTypeSelected = 'course_creation_type_selected',
  CourseCreated = 'course_created',
  AiCourseCreated = 'ai_course_created',
  CoursePublishedToggled = 'course_published_toggled',
  CourseChangesSaved = 'course_changes_saved',
  ChapterCreated = 'chapter_created',
  ActivityCreated = 'activity_created',
  ActivityFileUploaded = 'activity_file_uploaded',
  CourseAccessChanged = 'course_access_changed',
  CourseStructureReordered = 'course_structure_reordered',

  // ── Content editor + AI authoring ────────────────────────────────────────
  ActivityEditorOpened = 'activity_editor_opened',
  ActivityContentSaved = 'activity_content_saved',
  EditorBlockInserted = 'editor_block_inserted',
  AiEditorMessageSent = 'ai_editor_message_sent',
  AiEditorPanelOpened = 'ai_editor_panel_opened',
  AiEditorContentInserted = 'ai_editor_content_inserted',
  AiEditorError = 'ai_editor_error',
  MagicBlockGenerationRequested = 'magic_block_generation_requested',
  MagicBlockSaved = 'magic_block_saved',

  // ── Assignments (creator + grading) ──────────────────────────────────────
  AssignmentCreated = 'assignment_created',
  AssignmentPublishToggled = 'assignment_publish_toggled',
  AssignmentTaskCreated = 'assignment_task_created',
  AssignmentSubmissionsViewed = 'assignment_submissions_viewed',
  SubmissionEvaluateOpened = 'submission_evaluate_opened',
  SubmissionGraded = 'submission_graded',
  SubmissionFinalized = 'submission_finalized',

  // ── Org settings & admin config ──────────────────────────────────────────
  SignupMechanismChanged = 'signup_mechanism_changed',
  InviteCodeCreated = 'invite_code_created',
  MembersBatchInvited = 'members_batch_invited',
  ApiTokenCreated = 'api_token_created',
  ApiTokenRevoked = 'api_token_revoked',
  CustomDomainAdded = 'custom_domain_added',
  CustomDomainVerified = 'custom_domain_verified',
  SsoConfigSaved = 'sso_config_saved',
  OrgGeneralSettingsUpdated = 'org_general_settings_updated',
  UsergroupCreated = 'usergroup_created',
  WebhookCreated = 'webhook_created',

  // ── Billing, upgrade & feature gates ─────────────────────────────────────
  FeatureGateUpgradeShown = 'feature_gate_upgrade_shown',
  FeatureGateUpgradeClicked = 'feature_gate_upgrade_clicked',
  UpgradeBannerCtaClicked = 'upgrade_banner_cta_clicked',
  UpgradeModalViewed = 'upgrade_modal_viewed',
  UpgradePlanSelected = 'upgrade_plan_selected',
  PaymentProviderConnectClicked = 'payment_provider_connect_clicked',
  PaymentProviderConnected = 'payment_provider_connected',
  OfferCreated = 'offer_created',
  PaymentsFeatureGateBlocked = 'payments_feature_gate_blocked',

  // ── Super-admin (cross-org) ──────────────────────────────────────────────
  OrganizationCreated = 'organization_created',
  OrganizationPlanUpdated = 'organization_plan_updated',
  SuperadminTokenCreated = 'superadmin_token_created',
  AdminLoginSubmitted = 'admin_login_submitted',
  GlobalAnalyticsViewed = 'global_analytics_viewed',

  // ── Global navigation & cross-cutting ────────────────────────────────────
  CommandPaletteOpened = 'command_palette_opened',
  CommandPaletteResultSelected = 'command_palette_result_selected',
  DashboardNavClicked = 'dashboard_nav_clicked',
  DashboardEntered = 'dashboard_entered',
  ErrorViewShown = 'error_view_shown',
  NotFoundViewShown = 'not_found_view_shown',
}

/**
 * Canonical PostHog names for events whose backend wire name diverges from the
 * `object_action` convention. Consulted by the hook before posthog.capture().
 */
export const POSTHOG_NAME_OVERRIDES: Partial<Record<AnalyticsEvent, string>> = {
  [AnalyticsEvent.CourseViewed]: 'course_viewed',
  [AnalyticsEvent.ActivityViewed]: 'activity_viewed',
  [AnalyticsEvent.SearchQuery]: 'search_executed',
  // PageViewed is emitted to PostHog as the native $pageview via trackPageView,
  // never through capture(AnalyticsEvent.PageViewed).
}

/**
 * Coarse feature group for an event, attached as the `feature` property so
 * events can be filtered/rolled-up by area in PostHog. Derived from the name
 * prefix; falls back to 'other'.
 */
const GROUP_PREFIXES: Array<[string, string[]]> = [
  ['auth', ['signup_', 'login_', 'logout_', 'onboarding_', 'email_verification_', 'password_reset_', 'google_oauth_', 'sso_callback', 'join_org', 'org_joined', 'org_selected']],
  ['course', ['course_', 'chapter_']],
  ['activity', ['activity_', 'focus_mode', 'quiz_', 'video_']],
  ['assignment', ['assignment_', 'submission_', 'task_']],
  ['community', ['community_', 'communities_', 'discussion_', 'comment_']],
  ['podcast', ['podcast_', 'podcasts_', 'episode_', 'player_']],
  ['playground', ['playground_']],
  ['board', ['board_']],
  ['library', ['library_', 'folder_', 'media_', 'resource_', 'usergroup_']],
  ['search', ['search_']],
  ['copilot', ['copilot_', 'ai_assistant', 'ai_message']],
  ['certificate', ['certificate_', 'trail_']],
  ['account', ['account_']],
  ['store', ['store_', 'offer_', 'checkout_', 'paywall_', 'payment_']],
  ['editor', ['editor_', 'magic_block_', 'ai_editor_']],
  ['org_settings', ['invite_', 'members_', 'api_token_', 'custom_domain_', 'sso_config', 'org_general', 'webhook_', 'signup_mechanism']],
  ['billing', ['feature_gate_', 'upgrade_', 'payments_']],
  ['admin', ['organization_', 'superadmin_', 'admin_', 'global_analytics']],
  ['navigation', ['command_palette_', 'dashboard_nav', 'dashboard_entered', 'error_view', 'not_found', 'language_changed', 'feedback_']],
]

export function featureGroupOf(event: AnalyticsEvent | string): string {
  const name = String(event)
  for (const [group, prefixes] of GROUP_PREFIXES) {
    if (prefixes.some((p) => name.startsWith(p))) return group
  }
  return 'other'
}
