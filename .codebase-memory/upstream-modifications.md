# Upstream File Modifications Log

This file tracks any modifications made to upstream-owned files that could cause merge conflicts when pulling new releases.

## Format

Each entry includes: file, date, reason (why no extension point exists), and the exact diff so it can be re-applied after pulling upstream.

## Current Modifications

All Jev (TypeSafe) integration. New, non-upstream files (no conflict risk): `apps/api/src/services/ai/jev/**`, `apps/api/src/services/ai/jev_integration.py`, `apps/api/src/tests/**/test_jev_*.py`. `apps/api/src/services/ai/base.py` is intentionally unmodified (Jev title generation was removed).

### `apps/api/config/config.py`

- **Date**: 2026-10-03
- **Reason**: Config is a single monolithic function with no plugin/registry mechanism; Jev settings must be parsed alongside Judge0/Tinybird and exposed on `LearnHouseConfig`. Adds `JevConfig`, two tolerant parse helpers and one additive block.
- **Diff**:

```diff
diff --git a/apps/api/config/config.py b/apps/api/config/config.py
index aa82a5b1..18fbf3b6 100644
--- a/apps/api/config/config.py
+++ b/apps/api/config/config.py
@@ -29,6 +29,17 @@ class Judge0Config(BaseModel):
     client_secret: str | None
 
 
+class JevConfig(BaseModel):
+    enabled: bool = False
+    api_key: str = ""
+    timeout: float = 3.0
+    # Explicit opt-in: an empty list disables Jev for every organization.
+    allowed_org_ids: list[int] = []
+    quiz_validation_enabled: bool = False
+    guardrails_enabled: bool = True
+    intent_routing_enabled: bool = False
+
+
 class GeneralConfig(BaseModel):
     development_mode: bool
     sentry_config: SentryConfig
@@ -154,6 +165,7 @@ class LearnHouseConfig(BaseModel):
     payments_config: InternalPaymentsConfig
     tinybird_config: TinybirdConfig | None
     judge0_config: Judge0Config | None
+    jev_config: JevConfig | None
 
 
 def _env_bool(env_value, yaml_value):
@@ -178,6 +190,51 @@ def _env_bool(env_value, yaml_value):
     return str(value).strip().lower() in ("true", "1", "yes", "on")
 
 
+def _parse_jev_float(env_value, yaml_value, default: float) -> float:
+    """Parse a float setting; log a warning and use the default on bad input."""
+    raw = yaml_value if env_value is None or env_value == "" else env_value
+    if raw is None or raw == "":
+        return default
+    try:
+        value = float(raw)
+        if value <= 0:
+            raise ValueError("must be positive")
+        return value
+    except (TypeError, ValueError):
+        import logging as _jev_log
+        _jev_log.getLogger(__name__).warning(
+            "Invalid Jev timeout setting; using default %s", default
+        )
+        return default
+
+
+def _parse_jev_org_ids(env_value, yaml_value) -> list[int]:
+    """Parse a list of org IDs from a comma-separated env string or a YAML list.
+
+    Invalid entries are skipped with a warning; config load never fails.
+    """
+    raw = yaml_value if env_value is None or env_value == "" else env_value
+    if raw is None or raw == "":
+        return []
+    if isinstance(raw, (list, tuple)):
+        items = list(raw)
+    else:
+        items = str(raw).split(",")
+    ids: list[int] = []
+    for item in items:
+        text = str(item).strip()
+        if not text:
+            continue
+        try:
+            ids.append(int(text))
+        except ValueError:
+            import logging as _jev_log
+            _jev_log.getLogger(__name__).warning(
+                "Ignoring invalid Jev allowed org id entry"
+            )
+    return ids
+
+
 _yaml_cache: dict = {}
 
 
@@ -554,6 +611,40 @@ def get_learnhouse_config() -> LearnHouseConfig:
             client_secret=judge0_client_secret,
         )
 
+    # Jev (TypeSafe) config — requires enabled flag AND an API key. Per-org
+    # opt-in is enforced at call time via allowed_org_ids (empty = nobody).
+    jev_yaml = yaml_config.get("jev_config", {}) or {}
+    jev_api_key = os.environ.get("LEARNHOUSE_JEV_API_KEY") or jev_yaml.get("api_key") or ""
+    jev_enabled = bool(
+        _env_bool(os.environ.get("LEARNHOUSE_JEV_ENABLED"), jev_yaml.get("enabled", False))
+    )
+
+    jev_config = None
+    if jev_enabled and jev_api_key:
+        jev_config = JevConfig(
+            enabled=True,
+            api_key=str(jev_api_key),
+            timeout=_parse_jev_float(
+                os.environ.get("LEARNHOUSE_JEV_TIMEOUT"), jev_yaml.get("timeout"), 3.0
+            ),
+            allowed_org_ids=_parse_jev_org_ids(
+                os.environ.get("LEARNHOUSE_JEV_ALLOWED_ORG_IDS"),
+                jev_yaml.get("allowed_org_ids"),
+            ),
+            quiz_validation_enabled=bool(_env_bool(
+                os.environ.get("LEARNHOUSE_JEV_QUIZ_VALIDATION"),
+                jev_yaml.get("quiz_validation_enabled", False),
+            )),
+            guardrails_enabled=bool(_env_bool(
+                os.environ.get("LEARNHOUSE_JEV_GUARDRAILS"),
+                jev_yaml.get("guardrails_enabled", True),
+            )),
+            intent_routing_enabled=bool(_env_bool(
+                os.environ.get("LEARNHOUSE_JEV_INTENT_ROUTING"),
+                jev_yaml.get("intent_routing_enabled", False),
+            )),
+        )
+
     # Payments config
     env_stripe_secret_key = os.environ.get("LEARNHOUSE_STRIPE_SECRET_KEY")
     env_stripe_publishable_key = os.environ.get("LEARNHOUSE_STRIPE_PUBLISHABLE_KEY")
@@ -753,6 +844,7 @@ def get_learnhouse_config() -> LearnHouseConfig:
         ),
         tinybird_config=tinybird_config,
         judge0_config=judge0_config,
+        jev_config=jev_config,
     )
 
     return config
```

### `apps/api/pyproject.toml`

- **Date**: 2026-10-03
- **Reason**: Dependency pin for the optional TypeSafe SDK; there is no separate requirements extension point for a fork.
- **Diff**:

```diff
diff --git a/apps/api/pyproject.toml b/apps/api/pyproject.toml
index d94e081a..aee7defd 100644
--- a/apps/api/pyproject.toml
+++ b/apps/api/pyproject.toml
@@ -49,6 +49,7 @@ dependencies = [
     "pgvector==0.5.0",
     "pypdf==6.19.0",
     "regex==2026.9.10",
+    "typesafe-sdk==0.7.2",
 ]
 
 [tool.ruff]
```

### `apps/api/src/services/ai/rag/query_service.py`

- **Date**: 2026-10-03 (re-applied 2026-10-11 after upstream RAG access-scope restructure: rerank now lives in `search_course_content`; `course_name` fetched after `_open_rag`)
- **Reason**: Reranking must happen between the vector query and context assembly inside `query_course_rag`; there is no hook between those steps. Logic lives in `jev/client.py`; the hunk is a candidate-count helper plus one call.
- **Diff**:

```diff
diff --git a/apps/api/src/services/ai/rag/query_service.py b/apps/api/src/services/ai/rag/query_service.py
index 5934714c..81e0844a 100644
--- a/apps/api/src/services/ai/rag/query_service.py
+++ b/apps/api/src/services/ai/rag/query_service.py
@@ -1,13 +1,13 @@
 """
 RAG query service.
 
-Handles vector similarity search and streaming LLM responses
-grounded in course content.
+Handles vector similarity search, optional Jev reranking, and streaming
+LLM responses grounded in course content.
 """
 
 import json
 import logging
-from typing import AsyncGenerator
+from typing import AsyncGenerator, Optional
 
 from sqlalchemy import bindparam, text
 from sqlmodel.ext.asyncio.session import AsyncSession
@@ -24,6 +24,35 @@ TOP_K = 5
 OVERFETCH_FACTOR = 4
 SNIPPET_CHARS = 280
 
+# Candidates fetched from vector search when Jev reranking is active. (MKA fork)
+JEV_RERANK_CANDIDATES = 10
+
+
+def _resolve_rag_limits(top_k: int, org_id: Optional[int] = None) -> tuple[int, int]:
+    """Return (retrieve_k, final_k). MKA fork: Jev reranking over-retrieves.
+
+    When Jev reranking is active for this org we keep more candidates from
+    vector search than the caller asked for, rerank them, then trim to the
+    original top_k. Otherwise the two values are identical (no behaviour change).
+    """
+    from src.services.ai.jev.client import jev_enabled
+
+    if jev_enabled(org_id):
+        return max(top_k, JEV_RERANK_CANDIDATES), top_k
+    return top_k, top_k
+
+
+async def _jev_rerank(question: str, results: list, final_k: int) -> list:
+    """Rerank vector-search results via Jev. Falls back to vector order
+    (trimmed to final_k) if Jev is unavailable or fails. (MKA fork)"""
+    from src.services.ai.jev.client import jev_rerank_chunks
+
+    reranked = await jev_rerank_chunks(question, results, final_k)
+    if reranked is None:
+        logger.debug("Jev reranking unavailable; using vector ordering")
+        return results[:final_k]
+    return reranked[:final_k]
+
 _KIND_LABELS = {
     SourceType.COURSE.value: "Course",
     SourceType.CHAPTER.value: "Chapter",
@@ -53,6 +82,7 @@ async def search_course_content(
     if not scope.course_ids:
         return []
 
+    retrieve_k, final_k = _resolve_rag_limits(top_k, org_id)  # MKA fork (Jev rerank)
     query_embedding = await embed_single_text(question)
     embedding_str = "[" + ",".join(str(v) for v in query_embedding) + "]"
 
@@ -74,11 +104,14 @@ async def search_course_content(
         "query_embedding": embedding_str,
         "org_id": org_id,
         "course_ids": scope.course_ids,
-        "limit": top_k * OVERFETCH_FACTOR,
+        "limit": retrieve_k * OVERFETCH_FACTOR,
     }
 
     rows = (await db_session.execute(sql, params)).fetchall()
-    return (await filter_readable_chunks(rows, scope, db_session))[:top_k]
+    readable = (await filter_readable_chunks(rows, scope, db_session))[:retrieve_k]
+    if retrieve_k > final_k and readable:  # MKA fork: optional Jev reranking
+        return await _jev_rerank(question, readable, final_k)
+    return readable[:final_k]
 
 
 def source_from_row(row) -> Source:
```

### `apps/api/src/services/ai/quiz.py`

- **Date**: 2026-10-03
- **Reason**: Single additive call after generation to the log-only validator in `services/ai/jev_integration.py`; no post-generation hook exists.
- **Diff**:

```diff
diff --git a/apps/api/src/services/ai/quiz.py b/apps/api/src/services/ai/quiz.py
index 9a10cb95..5fd8282b 100644
--- a/apps/api/src/services/ai/quiz.py
+++ b/apps/api/src/services/ai/quiz.py
@@ -116,6 +116,20 @@ async def generate_quiz(
         output_type=GeneratedQuiz,
     )
 
+    # Optional Jev quiz validation (log-only, opt-in, never fails generation)
+    from src.services.ai.jev_integration import validate_generated_quiz
+    await validate_generated_quiz(
+        [
+            {
+                "question": q.question,
+                "answers": [{"answer": a.answer, "correct": a.correct} for a in q.answers],
+            }
+            for q in generated.questions
+        ],
+        org_id=org_id,
+        course_content=context,
+    )
+
     block_quiz = _to_block_quiz(generated)
 
     # Record the exchange so a follow-up refine turn can amend the actual quiz
```

### `apps/api/src/routers/ai/rag.py`

- **Date**: 2026-10-03 (re-applied 2026-10-11 after upstream RAG access-scope restructure: rerank now lives in `search_course_content`; `course_name` fetched after `_open_rag`)
- **Reason**: Needs a fire-and-forget audit call after the final SSE event and an intent-routing check before retrieval; no middleware hook exists inside the SSE generator or endpoint. Logic lives in `services/ai/jev_integration.py`.
- **Diff**:

```diff
diff --git a/apps/api/src/routers/ai/rag.py b/apps/api/src/routers/ai/rag.py
index 3efd5435..07e2c5b5 100644
--- a/apps/api/src/routers/ai/rag.py
+++ b/apps/api/src/routers/ai/rag.py
@@ -64,7 +64,9 @@ class RAGChatRequest(BaseModel):
     message: str = Field(max_length=AI_MESSAGE_MAX_CHARS)
     course_uuid: Optional[str] = None
     aichat_uuid: Optional[str] = None
-    mode: Literal["course_only", "general"] = "course_only"
+    # None = client expressed no preference (treated as "course_only"; the only
+    # case where opt-in Jev intent routing may switch to "general").
+    mode: Optional[Literal["course_only", "general"]] = None
     org_slug: Optional[str] = None
 
 
@@ -147,6 +149,16 @@ async def rag_chat_event_generator(
         # Send done event
         yield f"data: {json.dumps({'type': 'done', 'aichat_uuid': aichat_uuid})}\n\n"
 
+        # Jev output audit: fire-and-forget, never blocks the stream
+        from src.services.ai.jev_integration import schedule_guardrail_audit
+        schedule_guardrail_audit(
+            full_response,
+            user_question=user_message,
+            org_id=org_id,
+            source_context=context_text[:2000] if context_text else "",
+            chat_id=aichat_uuid,
+        )
+
         # Generate follow-up suggestions
         follow_ups = await generate_follow_up_suggestions(
             full_response,
@@ -294,6 +306,11 @@ async def api_rag_chat(
     org_id, access_scope = await _open_rag(
         request, current_user, chat_request.course_uuid, chat_request.org_slug, db_session
     )
+    course_name = ""  # MKA fork: used by opt-in Jev intent routing
+    if chat_request.course_uuid:
+        course_name = (await db_session.execute(
+            select(Course.name).where(Course.course_uuid == chat_request.course_uuid)
+        )).scalars().first() or ""
     chat_acting_user_id = resolve_acting_user_id(current_user)
 
     # Validate session ownership BEFORE reserving credits. Reserving first means
@@ -311,6 +328,18 @@ async def api_rag_chat(
     # Get or create chat session
     chat_session = get_chat_session_history(chat_request.aichat_uuid)
 
+    # Optional Jev intent routing (opt-in; only when the client sent no explicit mode)
+    effective_mode = chat_request.mode or "course_only"
+    from src.services.ai.jev_integration import should_route_to_general
+    if await should_route_to_general(
+        chat_request.message,
+        org_id=org_id,
+        mode=chat_request.mode,
+        course_name=course_name,
+        history=chat_session["message_history"],
+    ):
+        effective_mode = "general"
+
     # Perform RAG query with streaming
     stream, sources = await query_course_rag_stream(
         question=chat_request.message,
@@ -318,7 +347,7 @@ async def api_rag_chat(
         db_session=db_session,
         message_history=chat_session["message_history"],
         scope=access_scope,
-        mode=chat_request.mode or "course_only",
+        mode=effective_mode,
     )
 
     return StreamingResponse(
@@ -332,7 +361,7 @@ async def api_rag_chat(
             user_id=chat_acting_user_id,
             course_uuid=chat_request.course_uuid,
             is_new_session=is_new_session,
-            mode=chat_request.mode,
+            mode=effective_mode,
             org_id=org_id,
         ),
         media_type="text/event-stream",
```

Follow-up (Executor E): `RAGChatRequest.mode` became `Optional[Literal["course_only","general"]] = None` (None = no explicit client choice; intent routing applies only then, and `effective_mode` falls back to `"course_only"`). The SSE generator now receives `mode=effective_mode` (instead of `chat_request.mode`) so chat history records the mode actually used. Re-apply:

```diff
-    mode: Literal["course_only", "general"] = "course_only"
+    # None = client expressed no preference (treated as "course_only"; the only
+    # case where opt-in Jev intent routing may switch to "general").
+    mode: Optional[Literal["course_only", "general"]] = None
@@ rag_chat_event_generator(...) call in api_rag_chat
-            mode=chat_request.mode,
+            mode=effective_mode,
```

### `apps/api/src/routers/ai/ai.py`

- **Date**: 2026-10-03
- **Reason**: Same as rag.py: one fire-and-forget audit call after the done event in `activity_chat_event_generator`.
- **Diff**:

```diff
diff --git a/apps/api/src/routers/ai/ai.py b/apps/api/src/routers/ai/ai.py
index d31fe3ff..42508ccd 100644
--- a/apps/api/src/routers/ai/ai.py
+++ b/apps/api/src/routers/ai/ai.py
@@ -120,6 +120,15 @@ async def activity_chat_event_generator(
         # Send done event immediately (without waiting for follow-ups)
         yield f"data: {json.dumps({'type': 'done', 'aichat_uuid': aichat_uuid, 'activity_uuid': activity_uuid})}\n\n"
 
+        # Jev output audit: fire-and-forget, never blocks the stream
+        from src.services.ai.jev_integration import schedule_guardrail_audit
+        schedule_guardrail_audit(
+            full_response,
+            user_question=user_message,
+            org_id=org_id,
+            chat_id=aichat_uuid,
+        )
+
         # Generate follow-up suggestions and send as separate event
         follow_ups = await generate_follow_up_suggestions(
             full_response,
```

## Moderation wiring (frontend, Executor D)
- **Date**: 2026-10-04
- **Reason**: Staff-only AI moderation UI. All logic lives in new files (`apps/web/services/moderation/flags.ts`, `apps/web/components/Dashboard/Moderation/*`, `apps/web/components/Dashboard/Pages/Org/OrgEditAI/OrgEditAIModeration.tsx`, `apps/web/app/orgs/[orgslug]/dash/moderation/page.tsx`). Upstream files below only get import + one-line mounts; no extension point exists for these components. `apps/web/locales/en.json` gains a new top-level `moderation` key (additive; other locales fall back to English via i18next).
- **Re-apply**: after pulling upstream, re-add each hunk below (imports + one JSX line each).
- **Diff**:

```diff
diff --git a/apps/web/app/orgs/[orgslug]/dash/assignments/[assignmentuuid]/subpages/AssignmentSubmissionsSubPage.tsx b/apps/web/app/orgs/[orgslug]/dash/assignments/[assignmentuuid]/subpages/AssignmentSubmissionsSubPage.tsx
index a56f55b4..857d1f63 100644
--- a/apps/web/app/orgs/[orgslug]/dash/assignments/[assignmentuuid]/subpages/AssignmentSubmissionsSubPage.tsx
+++ b/apps/web/app/orgs/[orgslug]/dash/assignments/[assignmentuuid]/subpages/AssignmentSubmissionsSubPage.tsx
@@ -26,0 +27,2 @@ import EvaluateAssignment from './Modals/EvaluateAssignment';
+import { ModerationFlagIndicator } from '@components/Dashboard/Moderation/ModerationFlagIndicator';
+import useAdminStatus from '@components/Hooks/useAdminStatus';
@@ -484,0 +487,3 @@ function SubmissionRow({
+    // Dashboard-only page (AdminAuthorization). The API decides per-course whether
+    // this grader may see flags; 403/404 render nothing.
+    const { isAdmin: isDashboardUser } = useAdminStatus();
@@ -600,0 +606,9 @@ function SubmissionRow({
+            {/* Staff-only moderation signal (this grading page is dashboard-only) */}
+            <div className="me-4 empty:hidden">
+                <ModerationFlagIndicator
+                    contentType="assignment_submission"
+                    contentUuid={submission.assignmentusersubmission_uuid}
+                    isStaff={isDashboardUser === true}
+                />
+            </div>
+
diff --git a/apps/web/components/Dashboard/Menus/DashLeftMenu.tsx b/apps/web/components/Dashboard/Menus/DashLeftMenu.tsx
index 4e11e71f..02dde8ca 100644
--- a/apps/web/components/Dashboard/Menus/DashLeftMenu.tsx
+++ b/apps/web/components/Dashboard/Menus/DashLeftMenu.tsx
@@ -26,0 +27 @@ import {
+  ShieldCheck,
@@ -83,0 +85 @@ import useAdminStatus from '@components/Hooks/useAdminStatus'
+import useCanModerate from '@components/Hooks/useCanModerate'
@@ -197,0 +200 @@ function DashLeftMenu() {
+  const { canModerate } = useCanModerate()
@@ -523,0 +527,9 @@ function DashLeftMenu() {
+            {canModerate && (
+              <MenuLink
+                href="/dash/moderation"
+                icon={<ShieldCheck size={20} weight="fill" />}
+                label={t('moderation.nav')}
+                isCollapsed={isCollapsed}
+                active={isActivePath('/dash/moderation')}
+              />
+            )}
diff --git a/apps/web/components/Dashboard/Pages/Org/OrgEditAI/OrgEditAI.tsx b/apps/web/components/Dashboard/Pages/Org/OrgEditAI/OrgEditAI.tsx
--- a/apps/web/components/Dashboard/Pages/Org/OrgEditAI/OrgEditAI.tsx
+++ b/apps/web/components/Dashboard/Pages/Org/OrgEditAI/OrgEditAI.tsx
@@ -15,0 +16 @@ import Image from 'next/image'
+import OrgEditAIModeration from './OrgEditAIModeration'
@@ -176,0 +178,2 @@ const OrgEditAI: React.FC = () => {
+
+        <OrgEditAIModeration />
diff --git a/apps/web/components/Dashboard/Pages/Users/UserAnalytics/UserDossier.tsx b/apps/web/components/Dashboard/Pages/Users/UserAnalytics/UserDossier.tsx
--- a/apps/web/components/Dashboard/Pages/Users/UserAnalytics/UserDossier.tsx
+++ b/apps/web/components/Dashboard/Pages/Users/UserAnalytics/UserDossier.tsx
@@ -19,0 +20 @@ import BehaviorSection from './sections/BehaviorSection'
+import ModerationFlagsSection from '@components/Dashboard/Moderation/ModerationFlagsSection'
@@ -92,0 +94,3 @@ export default function UserDossier({ dossier }: { dossier: any }) {
+      {/* Staff-only AI moderation flags (review aids, not verdicts) */}
+      <ModerationFlagsSection userUuid={user.user_uuid} />
+
diff --git a/apps/web/components/Objects/Communities/CommentCard.tsx b/apps/web/components/Objects/Communities/CommentCard.tsx
--- a/apps/web/components/Objects/Communities/CommentCard.tsx
+++ b/apps/web/components/Objects/Communities/CommentCard.tsx
@@ -23,0 +24 @@ import { CommentUpvoteButton } from './CommentUpvoteButton'
+import { ModerationFlagIndicator } from '@components/Dashboard/Moderation/ModerationFlagIndicator'
@@ -204,0 +206 @@ export function CommentCard({ comment, canManage = false, onDeleted, onUpdated }
+                  <ModerationFlagIndicator contentType="discussion_comment" contentUuid={comment.comment_uuid} isStaff={canManage} />
diff --git a/apps/web/components/Objects/Communities/DiscussionCard.tsx b/apps/web/components/Objects/Communities/DiscussionCard.tsx
--- a/apps/web/components/Objects/Communities/DiscussionCard.tsx
+++ b/apps/web/components/Objects/Communities/DiscussionCard.tsx
@@ -22,0 +23 @@ import { getUriWithOrg } from '@services/config/config'
+import { ModerationFlagIndicator } from '@components/Dashboard/Moderation/ModerationFlagIndicator'
@@ -274,0 +276 @@ export function DiscussionCard({
+              <ModerationFlagIndicator contentType="discussion" contentUuid={discussion.discussion_uuid} isStaff={canManage} />
```

## Moderation wiring (backend, Executor C)
- **Date**: 2026-10-04
- **Reason**: Advisory AI moderation (record flags for staff review). All logic is in NEW isolated files: `apps/api/src/services/moderation_ai/**`, `apps/api/src/db/moderation_flags.py`, `apps/api/src/routers/moderation_flags.py` (also serves `PUT/GET /orgs/{org_id}/config/ai-moderation`, so `routers/orgs/orgs.py` and `services/orgs/orgs.py` are untouched), `apps/api/migrations/versions/f1a2b3c4d5e7_add_moderation_flag.py`, tests `src/tests/services/test_moderation_ai.py` and `src/tests/routers/test_moderation_flags_router.py`. Upstream files below only get an import + one call each (no extension point exists for "after this row is saved"), the org toggle model, router registration, and a shutdown drain. The org toggle is stored in the org config JSON blob (no migration): v2 `admin_toggles.moderation_ai`, v1 `features.moderation_ai`. The new `moderation_flag` table is created by Alembic `f1a2b3c4d5e7` (down_revision `b1c2d3e4f5a6`); re-point `down_revision` at the new head after pulling upstream migrations.
- **Re-apply**: after pulling upstream, re-add each hunk below.
- **Diff**:

```diff
diff --git a/apps/api/src/core/events/events.py b/apps/api/src/core/events/events.py
@@ -117,0 +118,3 @@ def shutdown_app(app: FastAPI) -> Callable:
+        # Let in-flight AI moderation passes finish (fail-open, own sessions).
+        from src.services.moderation_ai.scheduler import drain_moderation_tasks
+        await drain_moderation_tasks()
diff --git a/apps/api/src/db/organization_config.py b/apps/api/src/db/organization_config.py
@@ -168,0 +169,11 @@ class SecurityAdminToggle(BaseModel):
+class ModerationAIAdminToggle(BaseModel):
+    enabled: bool = False
+    surfaces: Optional[list[str]] = None
+
@@ -169,0 +181 @@ class AdminToggles(BaseModel):
+    moderation_ai: ModerationAIAdminToggle = ModerationAIAdminToggle()
diff --git a/apps/api/src/router.py b/apps/api/src/router.py
@@ -10,0 +11 @@ from src.routers import plans
+from src.routers import moderation_flags as moderation_flags_router_module
@@ -105,0 +107,12 @@ v1_router.include_router(
+v1_router.include_router(
+    moderation_flags_router_module.org_settings_router,
+    prefix="/orgs",
+    tags=["moderation"],
+    dependencies=[Depends(require_authenticated_user)]
+)
+v1_router.include_router(
+    moderation_flags_router_module.router,
+    prefix="/moderation-flags",
+    tags=["moderation"],
+    dependencies=[Depends(require_authenticated_user)]
+)
diff --git a/apps/api/src/services/communities/comments.py b/apps/api/src/services/communities/comments.py
@@ -19,0 +20 @@ from src.services.webhooks.dispatch import dispatch_webhooks
+from src.services.moderation_ai import schedule_moderation, forum_text
@@ -84,0 +86 @@ async def create_comment(   (after commit/refresh)
+    schedule_moderation(kind="forum_post", content_type="discussion_comment", content_uuid=comment.comment_uuid, org_id=community.org_id, author_user_id=comment.author_id, text_loader=forum_text(comment.content))
@@ -231,0 +234 @@ async def update_comment(   (after commit/refresh)
+    schedule_moderation(kind="forum_post", content_type="discussion_comment", content_uuid=comment.comment_uuid, org_id=discussion.org_id if discussion else None, author_user_id=comment.author_id, text_loader=forum_text(comment.content))
diff --git a/apps/api/src/services/communities/discussions.py b/apps/api/src/services/communities/discussions.py
@@ -31,0 +32 @@ from src.services.communities.moderation import (
+from src.services.moderation_ai import schedule_moderation, forum_text
@@ -153,0 +155 @@ async def create_discussion(   (after commit/refresh)
+    schedule_moderation(kind="forum_post", content_type="discussion", content_uuid=discussion.discussion_uuid, org_id=community.org_id, author_user_id=discussion.author_id, text_loader=forum_text(discussion.title, discussion.content))
@@ -440,0 +443 @@ async def update_discussion(   (after commit/refresh)
+    schedule_moderation(kind="forum_post", content_type="discussion", content_uuid=discussion.discussion_uuid, org_id=discussion.org_id, author_user_id=discussion.author_id, text_loader=forum_text(discussion.title, discussion.content))
diff --git a/apps/api/src/services/courses/activities/assignments.py b/apps/api/src/services/courses/activities/assignments.py
@@ -84,0 +85 @@ from src.services.webhooks.dispatch import dispatch_webhooks
+from src.services.moderation_ai import schedule_moderation, assignment_submission_text
@@ -2976,0 +2978 @@ async def create_assignment_submission(   (inside `if won_insert:`, after dispatch_webhooks; NOT in handle_assignment_task_submission/autosave)
+        schedule_moderation(kind="assignment_submission", content_type="assignment_submission", content_uuid=assignment_user_submission.assignmentusersubmission_uuid, org_id=course.org_id, author_user_id=submitter.id, text_loader=assignment_submission_text(submitter.id, assignment.id))
diff --git a/apps/api/src/services/users/users.py b/apps/api/src/services/users/users.py
@@ -50,0 +51 @@ from src.services.webhooks.dispatch import dispatch_webhooks
+from src.services.moderation_ai import schedule_moderation, profile_text
@@ -600,0 +602 @@ async def update_user(   (after commit/refresh, before UserRead conversion)
+    schedule_moderation(kind="general", content_type="user_profile", content_uuid=user.user_uuid, org_id=None, author_user_id=user.id, text_loader=profile_text(user.bio, user.first_name, user.last_name))
```

Executor E follow-up to the shutdown hunk above (same hunk in `events.py`, placed right after the moderation drain; drains Jev background audits, then closes the shared SDK client):

```diff
+        # Jev: drain fire-and-forget audits, then close the shared SDK client.
+        from src.services.ai import jev_integration
+        from src.services.ai.jev.client import aclose_jev_client
+        if jev_integration._background_tasks:
+            await asyncio.gather(*list(jev_integration._background_tasks), return_exceptions=True)
+        await aclose_jev_client()
```

`apps/api/src/db/organization_config.py` (complete hunk, including the 4 docstring lines the diff above elides):

```diff
+class ModerationAIAdminToggle(BaseModel):
+    """Per-org opt-in for advisory AI content moderation (off by default).
+
+    ``surfaces`` empty/None means every surface; otherwise a subset of
+    discussion | discussion_comment | assignment_submission | user_profile.
+    """
+
+    enabled: bool = False
+    surfaces: Optional[list[str]] = None
+
@@ class AdminToggles(BaseModel):
+    moderation_ai: ModerationAIAdminToggle = ModerationAIAdminToggle()
```

Other files touched by the Jev/moderation work (additive; re-apply or re-merge after upstream pulls):
- `apps/web/locales/en.json`: new top-level `moderation` key (additive; other locales fall back to English).
- `docs/content/self-hosting/configuration/environment-variables.mdx`: new "Jev (TypeSafe) AI add-ons" section plus the "AI content moderation (advisory)" subsection. `LEARNHOUSE_JEV_INTENT_ROUTING` is documented as opt-in, default `false` (Executor E).
- `apps/api/uv.lock`: regenerated lock for the new `typesafe-sdk` dependency from `pyproject.toml`; after pulling upstream, re-run `uv lock` instead of merging by hand.

Docs: a "AI content moderation (advisory)" subsection was appended to `docs/content/self-hosting/configuration/environment-variables.mdx` (inside the Jev section Executor B wrote).

## Moderation wiring (frontend fixes, Executor F)

- **Reason**: Follow-up fixes. Logic stays in new files (`flags.ts`, `useModerationFlags.ts`, `ModerationFlagCard.tsx`, `OrgEditAIModeration.tsx`); upstream hunks are minimal.
- `apps/web/app/orgs/[orgslug]/dash/assignments/[assignmentuuid]/subpages/AssignmentSubmissionsSubPage.tsx` (SubmissionRow): added `import useAdminStatus`, one hook line `const { isAdmin: isDashboardUser } = useAdminStatus();`, and changed `isStaff` (hardcoded) to `isStaff={isDashboardUser === true}`.
- `DashLeftMenu.tsx` (diff in the Executor D block above, exact and current) and `DashMobileMenu.tsx` (exact diff below) gate the Moderation links on `canModerate` from the new `useCanModerate` hook:

```diff
diff --git a/apps/web/components/Dashboard/Menus/DashMobileMenu.tsx b/apps/web/components/Dashboard/Menus/DashMobileMenu.tsx
index 5415a755..a77143af 100644
--- a/apps/web/components/Dashboard/Menus/DashMobileMenu.tsx
+++ b/apps/web/components/Dashboard/Menus/DashMobileMenu.tsx
@@ -28,0 +29 @@ import {
+  ShieldCheck,
@@ -36,0 +38 @@ import { useLHSession } from '@components/Contexts/LHSessionContext'
+import useCanModerate from '@components/Hooks/useCanModerate'
@@ -53,0 +56 @@ function DashMobileMenu() {
+  const { canModerate } = useCanModerate()
@@ -228,0 +232 @@ function DashMobileMenu() {
+                {canModerate && <PanelItem href="/dash/moderation" icon={<ShieldCheck size={15} weight="fill" />} label={t('moderation.nav')} active={isActive('/dash/moderation')} onClick={close} />}
```
- `apps/web/locales/en.json`: additive keys under `moderation.settings` (`loading`, `load_error`, `no_provider`, `surfaces_title`, `surface.*`).

## Moderation follow-up fixes (Executor G)

- `apps/web/components/Hooks/useCanModerate.ts` (NEW, fork-safe): `canManageOrg || role in this org with communities.action_update`, mirroring the API's `is_moderation_staff`. `useAdminStatus` is deliberately untouched: its `rights` object only merges a fixed key set and never contains `communities`. The two menu hunks above and `ModerationQueue.tsx` (new file; 403 `ErrorUI` guard) use it. Caveat: `/dash/*` is still gated by `dashboard.action_access` in `AdminAuthorization`, so a moderator without dashboard access still cannot reach the page.
- Backend (new files only): `moderation_ai/service.py` `flags_by_user` returns `[]` before any user/flag query for non-staff callers without courses update rights; `moderation_ai/scheduler.py` adds a per-content cap (5 provider calls per rolling 60s, Redis sorted set with in-memory fallback). No upstream files touched.

## Jev provider generalization (Executor H, config.py)

- **Reason**: make the AI-judgment layer provider-neutral (TypeSafe Jev or Cloudflare Workers AI Clef). Logic lives in `apps/api/src/services/ai/jev/**` (fork-owned); the only upstream-file hunk is in `apps/api/config/config.py` (additive to the existing Jev block; re-apply after pulling upstream).
- Env vars: `LEARNHOUSE_JEV_PROVIDER`, `_MODEL`, `_CLOUDFLARE_ACCOUNT_ID`, `_MODEL_RERANK|GUARDRAILS|MODERATION|INTENT|QUIZ`. Docs: Jev section of `docs/content/self-hosting/configuration/environment-variables.mdx`.

Exact `git diff <merge-base with dev> -- apps/api/config/config.py` (202 lines incl. headers, +163 lines; additive only, re-apply after pulling upstream):

```diff
diff --git a/apps/api/config/config.py b/apps/api/config/config.py
index aa82a5b1..51c5b396 100644
--- a/apps/api/config/config.py
+++ b/apps/api/config/config.py
@@ -29,6 +29,26 @@ class Judge0Config(BaseModel):
     client_secret: str | None
 
 
+class JevConfig(BaseModel):
+    enabled: bool = False
+    api_key: str = ""
+    timeout: float = 3.0
+    # Explicit opt-in: an empty list disables Jev for every organization.
+    allowed_org_ids: list[int] = []
+    quiz_validation_enabled: bool = False
+    guardrails_enabled: bool = True
+    intent_routing_enabled: bool = False
+    # Provider-neutral System One backend: 'typesafe' (Jev via typesafe-sdk) or
+    # 'cloudflare' (Workers AI Clef). ``api_key`` is the TypeSafe key OR a
+    # Cloudflare API token scoped to Workers AI.
+    provider: str = "typesafe"
+    # None => SDK default (typesafe) / 'clef-flash' (cloudflare).
+    model: str | None = None
+    cloudflare_account_id: str = ""
+    # Optional per-capability model overrides (rerank|guardrails|moderation|intent|quiz).
+    models: dict[str, str] = {}
+
+
 class GeneralConfig(BaseModel):
     development_mode: bool
     sentry_config: SentryConfig
@@ -154,6 +174,7 @@ class LearnHouseConfig(BaseModel):
     payments_config: InternalPaymentsConfig
     tinybird_config: TinybirdConfig | None
     judge0_config: Judge0Config | None
+    jev_config: JevConfig | None
 
 
 def _env_bool(env_value, yaml_value):
@@ -178,6 +199,94 @@ def _env_bool(env_value, yaml_value):
     return str(value).strip().lower() in ("true", "1", "yes", "on")
 
 
+def _parse_jev_float(env_value, yaml_value, default: float) -> float:
+    """Parse a float setting; log a warning and use the default on bad input."""
+    raw = yaml_value if env_value is None or env_value == "" else env_value
+    if raw is None or raw == "":
+        return default
+    try:
+        value = float(raw)
+        if value <= 0:
+            raise ValueError("must be positive")
+        return value
+    except (TypeError, ValueError):
+        import logging as _jev_log
+        _jev_log.getLogger(__name__).warning(
+            "Invalid Jev timeout setting; using default %s", default
+        )
+        return default
+
+
+def _parse_jev_org_ids(env_value, yaml_value) -> list[int]:
+    """Parse a list of org IDs from a comma-separated env string or a YAML list.
+
+    Invalid entries are skipped with a warning; config load never fails.
+    """
+    raw = yaml_value if env_value is None or env_value == "" else env_value
+    if raw is None or raw == "":
+        return []
+    if isinstance(raw, (list, tuple)):
+        items = list(raw)
+    else:
+        items = str(raw).split(",")
+    ids: list[int] = []
+    for item in items:
+        text = str(item).strip()
+        if not text:
+            continue
+        try:
+            ids.append(int(text))
+        except ValueError:
+            import logging as _jev_log
+            _jev_log.getLogger(__name__).warning(
+                "Ignoring invalid Jev allowed org id entry"
+            )
+    return ids
+
+
+JEV_PROVIDERS = ("typesafe", "cloudflare")
+JEV_CAPABILITIES = ("rerank", "guardrails", "moderation", "intent", "quiz")
+
+
+def _parse_jev_provider(env_value, yaml_value) -> str:
+    """Return 'typesafe' or 'cloudflare'; warn and default on anything else."""
+    raw = yaml_value if env_value is None or env_value == "" else env_value
+    if raw is None or str(raw).strip() == "":
+        return "typesafe"
+    value = str(raw).strip().lower()
+    if value in JEV_PROVIDERS:
+        return value
+    import logging as _jev_log
+    _jev_log.getLogger(__name__).warning(
+        "Invalid Jev provider setting; using default 'typesafe'"
+    )
+    return "typesafe"
+
+
+def _clean_jev_str(env_value, yaml_value) -> str | None:
+    raw = yaml_value if env_value is None or env_value == "" else env_value
+    if raw is None:
+        return None
+    text = str(raw).strip()
+    return text or None
+
+
+def _parse_jev_models(yaml_value) -> dict[str, str]:
+    """Per-capability model overrides from env (``LEARNHOUSE_JEV_MODEL_<CAP>``)
+    layered over the YAML ``models`` mapping. Unknown capabilities are ignored."""
+    models: dict[str, str] = {}
+    if isinstance(yaml_value, dict):
+        for cap in JEV_CAPABILITIES:
+            val = _clean_jev_str(None, yaml_value.get(cap))
+            if val:
+                models[cap] = val
+    for cap in JEV_CAPABILITIES:
+        val = _clean_jev_str(os.environ.get(f"LEARNHOUSE_JEV_MODEL_{cap.upper()}"), None)
+        if val:
+            models[cap] = val
+    return models
+
+
 _yaml_cache: dict = {}
 
 
@@ -554,6 +663,59 @@ def get_learnhouse_config() -> LearnHouseConfig:
             client_secret=judge0_client_secret,
         )
 
+    # Jev (TypeSafe) config — requires enabled flag AND an API key. Per-org
+    # opt-in is enforced at call time via allowed_org_ids (empty = nobody).
+    jev_yaml = yaml_config.get("jev_config", {}) or {}
+    jev_api_key = os.environ.get("LEARNHOUSE_JEV_API_KEY") or jev_yaml.get("api_key") or ""
+    jev_enabled = bool(
+        _env_bool(os.environ.get("LEARNHOUSE_JEV_ENABLED"), jev_yaml.get("enabled", False))
+    )
+
+    jev_provider = _parse_jev_provider(
+        os.environ.get("LEARNHOUSE_JEV_PROVIDER"), jev_yaml.get("provider")
+    )
+    jev_cf_account = _clean_jev_str(
+        os.environ.get("LEARNHOUSE_JEV_CLOUDFLARE_ACCOUNT_ID"),
+        jev_yaml.get("cloudflare_account_id"),
+    ) or ""
+    jev_ready = bool(jev_enabled and jev_api_key)
+    if jev_ready and jev_provider == "cloudflare" and not jev_cf_account:
+        import logging as _jev_log
+        _jev_log.getLogger(__name__).warning(
+            "Jev provider 'cloudflare' needs LEARNHOUSE_JEV_CLOUDFLARE_ACCOUNT_ID; Jev disabled"
+        )
+        jev_ready = False
+
+    jev_config = None
+    if jev_ready:
+        jev_config = JevConfig(
+            provider=jev_provider,
+            model=_clean_jev_str(os.environ.get("LEARNHOUSE_JEV_MODEL"), jev_yaml.get("model")),
+            cloudflare_account_id=jev_cf_account,
+            models=_parse_jev_models(jev_yaml.get("models")),
+            enabled=True,
+            api_key=str(jev_api_key),
+            timeout=_parse_jev_float(
+                os.environ.get("LEARNHOUSE_JEV_TIMEOUT"), jev_yaml.get("timeout"), 3.0
+            ),
+            allowed_org_ids=_parse_jev_org_ids(
+                os.environ.get("LEARNHOUSE_JEV_ALLOWED_ORG_IDS"),
+                jev_yaml.get("allowed_org_ids"),
+            ),
+            quiz_validation_enabled=bool(_env_bool(
+                os.environ.get("LEARNHOUSE_JEV_QUIZ_VALIDATION"),
+                jev_yaml.get("quiz_validation_enabled", False),
+            )),
+            guardrails_enabled=bool(_env_bool(
+                os.environ.get("LEARNHOUSE_JEV_GUARDRAILS"),
+                jev_yaml.get("guardrails_enabled", True),
+            )),
+            intent_routing_enabled=bool(_env_bool(
+                os.environ.get("LEARNHOUSE_JEV_INTENT_ROUTING"),
+                jev_yaml.get("intent_routing_enabled", False),
+            )),
+        )
+
     # Payments config
     env_stripe_secret_key = os.environ.get("LEARNHOUSE_STRIPE_SECRET_KEY")
     env_stripe_publishable_key = os.environ.get("LEARNHOUSE_STRIPE_PUBLISHABLE_KEY")
@@ -753,6 +915,7 @@ def get_learnhouse_config() -> LearnHouseConfig:
         ),
         tinybird_config=tinybird_config,
         judge0_config=judge0_config,
+        jev_config=jev_config,
     )
 
     return config
```

Other upstream-file hunks (all additive; exact diffs via `git diff <merge-base> -- <file>`):

- `apps/web/locales/en.json`: 1 hunk `@@ -6689,5 +6689,84 @@`, +79 lines: closes the previous top-level object with `},` and appends a new top-level `"moderation": { ... }` key (nav/title/status/severity/content_type/scores/dossier/settings strings) before the final `}`.
- `docs/content/self-hosting/configuration/environment-variables.mdx`: 1 hunk `@@ -100,0 +101,46 @@`, +46 lines: new "Jev AI add-ons" section (providers, generic Cloudflare production setup with compose passthrough lines, data-flow/privacy) and the "AI content moderation (advisory)" subsection.
- `apps/api/uv.lock`: 3 hunks, +18 lines: `@@ -740,0 +741 @@` (one `dependencies` entry), `@@ -786,0 +788 @@` (one `requires-dist` entry), `@@ -1597,0 +1600,16 @@` (the `typesafe-sdk` 0.7.2 package block). Regenerate with `uv lock` after pulling upstream.
- `apps/api/pyproject.toml`: 1 hunk `@@ -51,0 +52 @@`, +1 line (the `typesafe-sdk` dependency).

## MKA deployment notes (fork-only)

- The compose file used by the deployment tool lists API-service environment variables explicitly, so every new variable must be passed through or it never reaches the container. For the Jev provider generalization these are: `LEARNHOUSE_JEV_PROVIDER`, `LEARNHOUSE_JEV_MODEL`, `LEARNHOUSE_JEV_CLOUDFLARE_ACCOUNT_ID`, `LEARNHOUSE_JEV_MODEL_RERANK`, `LEARNHOUSE_JEV_MODEL_GUARDRAILS`, `LEARNHOUSE_JEV_MODEL_MODERATION`, `LEARNHOUSE_JEV_MODEL_INTENT`, `LEARNHOUSE_JEV_MODEL_QUIZ`, each as `- 'NAME=${NAME:-}'`. The API token variable (and `LEARNHOUSE_JEV_ENABLED`) follow the same rule.
- The Cloudflare token must be scoped to Workers AI (Read and Edit) only, and supplied via the deployment tool's secret store, never committed.
- Changing a variable needs a redeploy of the API service; the docs in the upstream-bound MDX are intentionally generic.

### Google-only email domains (`MKA_GOOGLE_ONLY_DOMAINS`)

- **Date**: 2026-10-03
- **Reason**: Google SSO stays open to all, but addresses in the configured domains (mkausa.org) must authenticate only via Google (so Workspace suspension removes access) and must carry the Workspace `hd` claim. No extension points exist in these upstream functions, so each gets a 1-2 line call. All logic is in the new fork-only file `apps/api/src/services/auth/mka_google_only.py`; tests in `apps/api/src/tests/services/auth/test_mka_google_only.py`. Unset env = no-op.
- **Hook sites and diffs**:

1. `apps/api/src/services/auth/utils.py` (Google path, `hd` requirement)
```diff
+from src.services.auth.mka_google_only import require_workspace_hd  # MKA fork
@@ in signWithGoogle, directly after `user_email = google_email.strip().lower()`
+    require_workspace_hd(user_email, google_user.get("hd"))  # MKA fork
```
2. `apps/api/src/services/auth/session.py` (central chokepoint: password login, magic-link verify, email-verification auto-signin, admin magic link all pass through it)
```diff
-from src.security.session_context import AMR_CLAIM, SORG_CLAIM, session_claims
+from src.security.session_context import AMR_CLAIM, AUTH_METHOD_GOOGLE, SORG_CLAIM, session_claims
+from src.services.auth.mka_google_only import block_non_google_auth  # MKA fork
@@ first lines of issue_session_or_challenge body (after docstring)
+    if amr != AUTH_METHOD_GOOGLE:  # MKA fork
+        block_non_google_auth(user.email)
```
3. `apps/api/src/routers/auth.py` (early login block, before password verification; magic-link request)
```diff
+from src.services.auth.mka_google_only import block_non_google_auth, is_google_only_email  # MKA fork
@@ login(), before "# Step 2: Authenticate"
+    block_non_google_auth(username)  # MKA fork
@@ magic_link_request(), right after `generic = {...}`
+    if is_google_only_email(str(body.email)):  # MKA fork
+        return generic
```
4. `apps/api/src/services/users/users.py` (email/password signup incl. invite signup, which calls create_user; email change)
```diff
+from src.services.auth.mka_google_only import block_email_change, block_non_google_auth  # MKA fork
@@ create_user() and create_user_without_org(), first statement of body
+    if not is_oauth:  # MKA fork
+        block_non_google_auth(user_object.email)
@@ update_user(), just before "# Update user; strip protected fields..."
+    block_email_change(user.email, user_object.email)  # MKA fork
```
5. `apps/api/src/services/users/password_reset.py` (4 functions)
```diff
+from src.services.auth.mka_google_only import block_non_google_auth, is_google_only_email  # MKA fork
@@ send_reset_password_code() and send_reset_password_code_platform(), first statement
+    if is_google_only_email(email):  # MKA fork: issue nothing, same response
+        return "If an account with that email exists, a reset code has been sent"
@@ change_password_with_reset_code() and change_password_with_reset_code_platform(), first statement
+    block_non_google_auth(email)  # MKA fork
```

- **Not hooked (by design)**: `services/admin/admin.py` admin-API user creation with a password and `services/setup/setup.py` first-run setup (operator actions; the password cannot be used to log in for these domains anyway, since login is blocked at hooks 2 and 3); `update_user_password` (logged-in change; resulting password is unusable for login).
- **Re-apply after pulling upstream**: re-add each hook at the location named above. Verify with `grep -rn "MKA fork" apps/api/src` (expect 17 lines, including the new module docstring) and run `uv run pytest src/tests/services/auth/test_mka_google_only.py` in apps/api.
- **Upstream PR**: none


### Majlis / Region profile fields (`mka_user_profile` side table)

- **Date**: 2026-10-04
- **Reason**: Capture Majlis (required), derived Region, and optional Mobile / AMC ID / Tanzeem at signup, and gate users who lack a profile. All logic is fork-only (file list in section D); upstream files get 1-3 line `MKA fork` hooks. Region is always derived server-side. Spec: `docs/superpowers/specs/2026-10-04-mka-profile-fields-design.md`.
- **Diff base**: `74807657` (origin/dev); regenerate with `git diff 74807657..HEAD -- <file>`.

#### A. Source hooks (upstream-owned files, edited)

1. `apps/api/src/db/users.py`
   - **Why / no extension point**: `UserCreate` gains one optional `mka_profile: Optional[dict]` field so signup payloads can carry the profile. No extension point: a pydantic model field has to live on the class. Profile data is stored in the fork-only side table, never in `extra_metadata`.

```diff
diff --git a/apps/api/src/db/users.py b/apps/api/src/db/users.py
index a818aed1..0847d2cd 100644
--- a/apps/api/src/db/users.py
+++ b/apps/api/src/db/users.py
@@ -34,6 +34,8 @@ class UserCreate(UserBase):
     # request could write an arbitrary blob. Values here are validated against
     # the org's declared fields before anything is stored.
     custom_fields: Optional[dict] = None
+    # MKA fork: Majlis/Region profile (validated in services/users/mka_profile.py)
+    mka_profile: Optional[dict] = None
 
 
 class UserUpdate(UserBase):
```

2. `apps/api/src/services/users/users.py`
   - **Why / no extension point**: 1 import, plus in each of `create_user()` and `create_user_without_org()`: `validate_signup_profile` directly AFTER the `rbac_check(...)` line (moved there in the fix wave so a forbidden signup answers 403, never a 409 AMC-ID oracle; still BEFORE the user row exists) and `save_signup_profile` right after the user commit/refresh. `create_user_with_invite` calls `create_user`, so it needs no hook. No extension point: the create functions have no hook registry. The import sits next to the Google-only import from the 2026-10-03 entry.

```diff
diff --git a/apps/api/src/services/users/users.py b/apps/api/src/services/users/users.py
index 24b06f32..268462a6 100644
--- a/apps/api/src/services/users/users.py
+++ b/apps/api/src/services/users/users.py
@@ -16,6 +16,7 @@ from src.security.features_utils.usage import (
 from src.core.deployment_mode import get_deployment_mode
 from src.services.users.usergroups import add_users_to_usergroup
 from src.services.auth.mka_google_only import block_email_change, block_non_google_auth  # MKA fork
+from src.services.users.mka_profile import save_signup_profile, validate_signup_profile  # MKA fork
 from src.services.users.emails import (
     send_account_creation_email,
 )
@@ -203,6 +204,7 @@ async def create_user(
 
     # RBAC check
     await rbac_check(request, current_user, "create", "user_x", db_session)
+    mka_profile = await validate_signup_profile(db_session, user_object.mka_profile, is_oauth)  # MKA fork
 
     # Complete the user object
     user.user_uuid = f"user_{uuid4()}"
@@ -277,6 +279,7 @@ async def create_user(
     db_session.add(user)
     await db_session.commit()
     await db_session.refresh(user)
+    await save_signup_profile(db_session, user, mka_profile)  # MKA fork
 
     # Link user and organization
     user_organization = UserOrganization(
@@ -453,6 +456,7 @@ async def create_user_without_org(
 
     # RBAC check
     await rbac_check(request, current_user, "create", "user_x", db_session)
+    mka_profile = await validate_signup_profile(db_session, user_object.mka_profile, is_oauth)  # MKA fork
 
     # Complete the user object
     user.user_uuid = f"user_{uuid4()}"
@@ -505,6 +509,7 @@ async def create_user_without_org(
     db_session.add(user)
     await db_session.commit()
     await db_session.refresh(user)
+    await save_signup_profile(db_session, user, mka_profile)  # MKA fork
 
     user_read = UserRead.model_validate(user)
```

2b. `apps/api/src/services/admin/admin.py` (GDPR; added in the fix wave)
   - **Why / no extension point**: 1 import + 2 one-line hooks. `export_user_data` adds an `"mka_profile"` key (the `profile_status` output) so the GDPR export includes the profile; `anonymize_user` calls `delete_profile(...)` BEFORE its commit so the profile row (mobile, AMC ID, Majlis) is deleted atomically with the scrub and the AMC ID is freed. Hard user delete needs nothing (DB FK cascade). No extension point: both functions build their result/transaction inline.

```diff
diff --git a/apps/api/src/services/admin/admin.py b/apps/api/src/services/admin/admin.py
index 610df4a7..9dc843fa 100644
--- a/apps/api/src/services/admin/admin.py
+++ b/apps/api/src/services/admin/admin.py
@@ -34,6 +34,7 @@ from src.db.usergroups import UserGroup, UserGroupRead
 from src.db.user_organizations import UserOrganization
 from src.db.users import APITokenUser, User, UserRead
 from src.services.trail.trail import _build_trail_read
+from src.services.users.mka_profile import delete_profile, profile_status  # MKA fork
 from src.services.courses.certifications import (
     check_course_completion_and_create_certificate,
     is_course_fully_completed,
@@ -2432,6 +2433,7 @@ async def export_user_data(
         "user_groups": [
             UserGroupRead.model_validate(g).model_dump() for g, _ in group_rows
         ],
+        "mka_profile": await profile_status(db_session, user_id),  # MKA fork
         "exported_at": datetime.now().isoformat(),
     }
 
@@ -2486,6 +2488,7 @@ async def anonymize_user(
     user.signup_method = "anonymized"
     user.update_date = str(datetime.now())
     db_session.add(user)
+    await delete_profile(db_session, user_id)  # MKA fork
     await db_session.commit()
 
     try:
```

3. `apps/api/src/router.py`
   - **Why / no extension point**: 1 import + 1 `include_router` (prefix `/mka/profile`, `get_non_api_token_user` dependency) for the fork router. No router plugin registry.

```diff
diff --git a/apps/api/src/router.py b/apps/api/src/router.py
index 6a0a747b..8c6f2452 100644
--- a/apps/api/src/router.py
+++ b/apps/api/src/router.py
@@ -11,6 +11,7 @@ from src.routers import plans
 from src.routers import usergroups
 from src.routers import dev, trail, users, auth, orgs, roles, search
 from src.routers import mfa as mfa_router_module
+from src.routers import mka_profile as mka_profile_router_module  # MKA fork
 from src.routers import monitoring
 from src.routers import nudges as nudges_router_module
 from src.routers import stream
@@ -71,6 +72,12 @@ v1_router.include_router(
     tags=["users"],
     dependencies=[Depends(get_non_api_token_user)]
 )
+v1_router.include_router(  # MKA fork
+    mka_profile_router_module.router,
+    prefix="/mka/profile",
+    tags=["mka-profile"],
+    dependencies=[Depends(get_non_api_token_user)],
+)
 v1_router.include_router(
     usergroups.router,
     prefix="/usergroups",
```

4. `apps/web/app/api/signup/route.ts`
   - **Why / no extension point**: Add `mka_profile` to `SignupBody`, destructure it, forward ONLY four string/null keys (majlis, mobile, amc_id, tanzeem; never spread client input). No extension point in the Next route.

```diff
diff --git a/apps/web/app/api/signup/route.ts b/apps/web/app/api/signup/route.ts
index 62d64fa1..87328e85 100644
--- a/apps/web/app/api/signup/route.ts
+++ b/apps/web/app/api/signup/route.ts
@@ -29,6 +29,8 @@ interface SignupBody {
   bio?: string
   /** Answers to the org's admin-defined signup fields, keyed by field key. */
   custom_fields?: Record<string, unknown>
+  // MKA fork
+  mka_profile?: { majlis?: string; mobile?: string | null; amc_id?: string | null; tanzeem?: string | null }
   turnstileToken?: string | null
   inviteCode?: string
 }
@@ -53,6 +55,7 @@ export async function POST(request: NextRequest) {
     last_name,
     bio,
     custom_fields,
+    mka_profile, // MKA fork
   } = body
 
   if (!email || !password || !username) {
@@ -107,6 +110,17 @@ export async function POST(request: NextRequest) {
     last_name,
     bio,
     ...(custom_fields ? { custom_fields } : {}),
+    // MKA fork: forward only the four known profile keys (never spread client input)
+    ...(mka_profile && typeof mka_profile === 'object'
+      ? {
+          mka_profile: {
+            majlis: typeof mka_profile.majlis === 'string' ? mka_profile.majlis : undefined,
+            mobile: mka_profile.mobile === null ? null : typeof mka_profile.mobile === 'string' ? mka_profile.mobile : undefined,
+            amc_id: mka_profile.amc_id === null ? null : typeof mka_profile.amc_id === 'string' ? mka_profile.amc_id : undefined,
+            tanzeem: mka_profile.tanzeem === null ? null : typeof mka_profile.tanzeem === 'string' ? mka_profile.tanzeem : undefined,
+          },
+        }
+      : {}),
   }
 
   let url: string
```

5. `apps/web/app/auth/signup/OpenSignup.tsx`
   - **Why / no extension point**: Imports, Formik initial value + validation, send the API-shaped body, map server errors with fork helper `applyMkaServerErrors`, render `<MkaProfileFields/>`. No slot mechanism in the signup form.

```diff
diff --git a/apps/web/app/auth/signup/OpenSignup.tsx b/apps/web/app/auth/signup/OpenSignup.tsx
index feb25160..7eaf2759 100644
--- a/apps/web/app/auth/signup/OpenSignup.tsx
+++ b/apps/web/app/auth/signup/OpenSignup.tsx
@@ -18,6 +18,8 @@ import { PasswordStrengthIndicator, validatePasswordStrength } from '@components
 import TurnstileWidget, { useTurnstileRequired, type TurnstileWidgetHandle } from '@components/Auth/TurnstileWidget'
 import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
 import { getAllowedAuthMethods } from '@services/auth/authMethods'
+import MkaProfileFields from '@components/mka/MkaProfileFields' // MKA fork
+import { emptyMkaProfile, validateMkaProfile, mkaValuesToBody, applyMkaServerErrors } from '@services/mka/profile' // MKA fork
 import CustomSignupFields, {
   initialCustomFieldValues,
   validateCustomFields,
@@ -56,6 +58,10 @@ const validate = (values: any, t: any, customFields: SignupFieldItem[]) => {
     errors.custom_fields = customFieldErrors
   }
 
+  // MKA fork
+  const mkaErrors = validateMkaProfile(values.mka_profile)
+  if (Object.keys(mkaErrors).length > 0) errors.mka_profile = mkaErrors
+
   return errors
 }
 
@@ -105,6 +111,7 @@ function OpenSignUpComponent({ org: propOrg }: OpenSignUpComponentProps = {}) {
       first_name: '',
       last_name: '',
       custom_fields: initialCustomFieldValues(customFields),
+      mka_profile: { ...emptyMkaProfile }, // MKA fork
       turnstileToken: null as string | null,
     },
     validate: (values) => validate(values, t, customFields),
@@ -115,7 +122,9 @@ function OpenSignUpComponent({ org: propOrg }: OpenSignUpComponentProps = {}) {
       setIsSubmitting(true)
       track(AnalyticsEvent.SignupSubmitted, { invite_code_present: false, has_bio: !!values.bio })
       try {
-        let res = await signup(values)
+        // MKA fork: send the API-shaped profile (empty optionals -> null)
+        const body = { ...values, mka_profile: mkaValuesToBody(values.mka_profile) }
+        let res = await signup(body)
         let message = await res.json().catch(() => ({}))
         if (res.status == 200) {
           track(AnalyticsEvent.SignupSucceeded, { email_verified: message.email_verified })
@@ -128,6 +137,7 @@ function OpenSignUpComponent({ org: propOrg }: OpenSignUpComponentProps = {}) {
           // gave us nothing readable.
           track(AnalyticsEvent.SignupFailed, { status_code: res.status })
           setError(getErrorMessage(message?.detail, t('common.something_went_wrong')))
+          applyMkaServerErrors(res.status, message?.detail, formik.setFieldError) // MKA fork
           // Turnstile tokens are single-use — fetch a fresh one for the retry.
           turnstileRef.current?.reset()
         }
@@ -371,6 +381,16 @@ function OpenSignUpComponent({ org: propOrg }: OpenSignUpComponentProps = {}) {
           </FormField>
 
           <CustomSignupFields fields={customFields} formik={formik} />
+          {/* MKA fork */}
+          <MkaProfileFields
+            idPrefix="signup"
+            values={formik.values.mka_profile}
+            errors={formik.touched.mka_profile || formik.submitCount > 0 ? formik.errors.mka_profile : undefined}
+            onChange={(field, value) => {
+              formik.setFieldValue(`mka_profile.${field}`, value)
+              formik.setFieldTouched('mka_profile', true, false)
+            }}
+          />
 
           <TurnstileWidget
             ref={turnstileRef}
```

6. `apps/web/app/auth/signup/InviteOnlySignUp.tsx`
   - **Why / no extension point**: Same touches as OpenSignup.tsx (invite flow has its own form).

```diff
diff --git a/apps/web/app/auth/signup/InviteOnlySignUp.tsx b/apps/web/app/auth/signup/InviteOnlySignUp.tsx
index 0dfac71b..d95a4159 100644
--- a/apps/web/app/auth/signup/InviteOnlySignUp.tsx
+++ b/apps/web/app/auth/signup/InviteOnlySignUp.tsx
@@ -17,6 +17,8 @@ import { useTranslation } from 'react-i18next'
 import { PasswordStrengthIndicator, validatePasswordStrength } from '@components/Auth/PasswordStrengthIndicator'
 import TurnstileWidget, { useTurnstileRequired, type TurnstileWidgetHandle } from '@components/Auth/TurnstileWidget'
 import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
+import MkaProfileFields from '@components/mka/MkaProfileFields' // MKA fork
+import { emptyMkaProfile, validateMkaProfile, mkaValuesToBody, applyMkaServerErrors } from '@services/mka/profile' // MKA fork
 import CustomSignupFields, {
   initialCustomFieldValues,
   validateCustomFields,
@@ -55,6 +57,10 @@ const validate = (values: any, t: any, customFields: SignupFieldItem[]) => {
     errors.custom_fields = customFieldErrors
   }
 
+  // MKA fork
+  const mkaErrors = validateMkaProfile(values.mka_profile)
+  if (Object.keys(mkaErrors).length > 0) errors.mka_profile = mkaErrors
+
   return errors
 }
 
@@ -95,6 +101,7 @@ function InviteOnlySignUpComponent(props: InviteOnlySignUpProps) {
       first_name: '',
       last_name: '',
       custom_fields: initialCustomFieldValues(customFields),
+      mka_profile: { ...emptyMkaProfile }, // MKA fork
       turnstileToken: null as string | null,
     },
     validate: (values) => validate(values, t, customFields),
@@ -105,7 +112,9 @@ function InviteOnlySignUpComponent(props: InviteOnlySignUpProps) {
       setIsSubmitting(true)
       track(AnalyticsEvent.SignupSubmitted, { invite_code_present: true, has_bio: !!values.bio })
       try {
-        let res = await signUpWithInviteCode(values, props.inviteCode)
+        // MKA fork: send the API-shaped profile (empty optionals -> null)
+        const body = { ...values, mka_profile: mkaValuesToBody(values.mka_profile) }
+        let res = await signUpWithInviteCode(body, props.inviteCode)
         let message = await res.json().catch(() => ({}))
         if (res.status == 200) {
           track(AnalyticsEvent.SignupSucceeded, { email_verified: message.email_verified })
@@ -115,6 +124,7 @@ function InviteOnlySignUpComponent(props: InviteOnlySignUpProps) {
           // masking everything past a few statuses behind a generic message.
           track(AnalyticsEvent.SignupFailed, { status_code: res.status })
           setError(getErrorMessage(message?.detail, t('common.something_went_wrong')))
+          applyMkaServerErrors(res.status, message?.detail, formik.setFieldError) // MKA fork
           // Turnstile tokens are single-use — fetch a fresh one for the retry.
           turnstileRef.current?.reset()
         }
@@ -337,6 +347,16 @@ function InviteOnlySignUpComponent(props: InviteOnlySignUpProps) {
           </FormField>
 
           <CustomSignupFields fields={customFields} formik={formik} />
+          {/* MKA fork */}
+          <MkaProfileFields
+            idPrefix="signup"
+            values={formik.values.mka_profile}
+            errors={formik.touched.mka_profile || formik.submitCount > 0 ? formik.errors.mka_profile : undefined}
+            onChange={(field, value) => {
+              formik.setFieldValue(`mka_profile.${field}`, value)
+              formik.setFieldTouched('mka_profile', true, false)
+            }}
+          />
 
           <TurnstileWidget
             ref={turnstileRef}
```

7. `apps/web/app/orgs/[orgslug]/layout.tsx`
   - **Why / no extension point**: Import + mount `<MkaProfileGate />` immediately before `<CompleteSignupFields />`. The org layout is the only mount point (the `(hub)` layout is SaaS-only and deliberately NOT hooked).

```diff
diff --git a/apps/web/app/orgs/[orgslug]/layout.tsx b/apps/web/app/orgs/[orgslug]/layout.tsx
index e1c21c51..5a341679 100644
--- a/apps/web/app/orgs/[orgslug]/layout.tsx
+++ b/apps/web/app/orgs/[orgslug]/layout.tsx
@@ -7,6 +7,7 @@ import Toast from '@components/Objects/StyledElements/Toast/Toast'
 import '@styles/globals.css'
 import Footer from '@components/Footer/Footer'
 import CompleteSignupFields from '@components/Auth/CompleteSignupFields'
+import MkaProfileGate from '@components/mka/MkaProfileGate' // MKA fork
 import { getOrganizationContextInfo } from '@services/organizations/orgs'
 import { getOrgFaviconMediaDirectory } from '@services/media/media'
 
@@ -45,6 +46,7 @@ export default async function RootLayout(props: {
         <OrgLanguageSync />
         <NextTopLoader color="#2e2e2e" initialPosition={0.3} height={4} easing={'ease'} speed={500} showSpinner={false} />
         <Toast />
+        <MkaProfileGate /> {/* MKA fork */}
         <CompleteSignupFields />
         {props.children}
         <Footer />
```

8. `apps/e2e/core/client.ts`
   - **Why / no extension point**: `createStudent` posts `mka_profile: { majlis: 'Zion' }` because the backend now requires a Majlis for non-OAuth signup; without it e2e student creation returns 422.

```diff
diff --git a/apps/e2e/core/client.ts b/apps/e2e/core/client.ts
index 20a72e4e..9bd71b07 100644
--- a/apps/e2e/core/client.ts
+++ b/apps/e2e/core/client.ts
@@ -90,6 +90,7 @@ export async function createStudent(
     password: student.password,
     first_name: student.first_name ?? '',
     last_name: student.last_name ?? '',
+    mka_profile: { majlis: 'Zion' }, // MKA fork: backend requires a Majlis for non-OAuth signup
   })
   return user.id
 }
```

##### `apps/web/components/Dashboard/Pages/Users/OrgUsers/OrgUsers.tsx` (admin profile edit, 4 `MKA fork` markers)

Why no extension point: the members table has no row-action slot or plugin API, so a button in the actions cell and a dialog mount are the minimum. Logic lives in the fork-only `components/mka/MkaProfileEditDialog.tsx`. The button shows only for `canManageOrg` (organizations.action_update: org admin / superadmin), the strictest signal `useAdminStatus` offers; the backend still enforces ADMIN-only and the dialog shows its 403 message. Verbatim `git diff 74807657..HEAD`:

```diff
diff --git a/apps/web/components/Dashboard/Pages/Users/OrgUsers/OrgUsers.tsx b/apps/web/components/Dashboard/Pages/Users/OrgUsers/OrgUsers.tsx
index e683a01a..594b7bb6 100644
--- a/apps/web/components/Dashboard/Pages/Users/OrgUsers/OrgUsers.tsx
+++ b/apps/web/components/Dashboard/Pages/Users/OrgUsers/OrgUsers.tsx
@@ -25,6 +25,7 @@ import { useQuery, useQueryClient } from '@tanstack/react-query'
 import { queryKeys } from '@/lib/query/keys'
 import { readSignupFields } from '@services/settings/org'
 import { useTranslation } from 'react-i18next'
+import MkaProfileEditDialog from '@components/mka/MkaProfileEditDialog' // MKA fork
 import {
   Select,
   SelectContent,
@@ -81,6 +82,7 @@ function OrgUsers() {
   // Per-student analytics (integrated into this Users list)
   const [analyticsUserId, setAnalyticsUserId] = useState<number | null>(null)
   const [comparing, setComparing] = useState(false)
+  const [mkaEdit, setMkaEdit] = useState<{ id: number; name: string } | null>(null) // MKA fork
 
   const buildQuery = () => {
     const params = new URLSearchParams()
@@ -757,6 +759,18 @@ function OrgUsers() {
                                 <ExternalLink className="w-3.5 h-3.5" />
                               </Link>
                             </ToolTip>
+                          {/* MKA fork: admin-only (canManageOrg = org admin / superadmin) */}
+                          {canManageOrg && (
+                            <button
+                              onClick={() => setMkaEdit({ id: user.user.id, name: `${user.user.first_name} ${user.user.last_name}`.trim() || user.user.username })}
+                              className="inline-flex items-center gap-1.5 h-8 px-3 bg-white text-gray-600 hover:bg-indigo-50 hover:text-indigo-600 rounded-md text-xs font-medium nice-shadow transition-all"
+                              aria-label="Edit profile"
+                              title="Edit profile"
+                            >
+                              <User className="w-3.5 h-3.5" />
+                              <span>Edit profile</span>
+                            </button>
+                          )}
                           {canManageOrg && (
                             <ConfirmationModal
                               confirmationButtonText={t('dashboard.users.active_users.modals.remove_user.button')}
@@ -826,6 +840,10 @@ function OrgUsers() {
 
       {/* Per-student analytics (integrated into the Users tab) */}
       <UserDossierModal userId={analyticsUserId} onOpenChange={(o) => !o && setAnalyticsUserId(null)} />
+      {/* MKA fork: admin edit of a member's Majlis/mobile/AMC ID/Tanzeem */}
+      {mkaEdit && org?.id && (
+        <MkaProfileEditDialog open onOpenChange={(o) => !o && setMkaEdit(null)} userId={mkaEdit.id} orgId={org.id} displayName={mkaEdit.name} />
+      )}
       <Dialog open={comparing} onOpenChange={setComparing}>
         <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto bg-[#f8f8f8] p-6 sm:p-8">
           <h2 className="font-bold text-xl tracking-tight mb-4">{t('dashboard.users.analytics.compare_students')}</h2>
```

Re-apply checklist: the `useState` hook, the button and the dialog mount all reference `canManageOrg`, `org` and the row variable `user` (`user.user.id/first_name/last_name/username`); if upstream renames them, adapt the three spots. Also count: `OrgUsers.tsx` 4 `MKA fork` markers.

#### B. Upstream tests edited (upstream-test-edit)

- `apps/api/src/tests/services/test_signup_custom_fields_flow.py` (+9 lines) and `apps/api/src/tests/services/test_users_service.py` (+5 lines): every pre-existing non-OAuth `UserCreate(...)` now passes `mka_profile={"majlis": "Zion"}`, because the signup hook rejects non-OAuth creation without a Majlis. The pattern is one added kwarg line each time. After a merge, any new upstream test that creates a non-OAuth `UserCreate` needs the same kwarg. Regenerate with `git diff 74807657..HEAD -- <file>`.

#### C. Added file inside an upstream directory (no upstream conflict today)

- `apps/web/components/ui/command.tsx`: shadcn registry `command` component, hand-created from `shadcn view command` output (not via `shadcn add`). Wraps `cmdk` (already a dependency) and reuses `ui/dialog`. Used by `components/mka/MajlisCombobox.tsx`. If upstream ever adds its own `command.tsx`, resolve the add/add conflict by taking upstream's version and re-check `MajlisCombobox.tsx`; `bunx shadcn@latest diff command` shows drift.

#### D. Fork-only new files (no merge risk)

- API: `apps/api/src/services/users/mka_profile.py`, `apps/api/src/db/mka_user_profile.py`, `apps/api/src/routers/mka_profile.py`, `apps/api/migrations/versions/mka_20261004_user_profile.py`
- API tests: `src/tests/services/test_mka_profile_{domain,store,signup,gdpr,amc_rule}.py`, `src/tests/routers/test_mka_profile_router.py`
- Web: `apps/web/components/mka/{MajlisCombobox,MkaProfileFields,MkaProfileGate,MkaProfileEditDialog}.tsx`, `apps/web/services/mka/profile.ts`, `apps/web/tests/mka-profile-{validation,admin}.test.mjs`
- Docs: `docs/superpowers/specs/2026-10-04-mka-profile-fields-design.md`, `docs/superpowers/plans/2026-10-04-mka-profile-fields.md`

#### E. Re-apply after upstream merge (checklist)

1. `grep -rn "MKA fork" apps` and confirm every hook above survives. Added `MKA fork` lines per file in this feature: `users.py` 1; `users.py` 5; `admin.py` 3; `router.py` 2; `route.ts` 3; `OpenSignup.tsx` 7; `InviteOnlySignUp.tsx` 7; `layout.tsx` 2; `client.ts` 1; `OrgUsers.tsx` 4. (`services/users/users.py` also carries the 2026-10-03 Google-only hooks, counted separately.) Recount against the diffs above.
2. `alembic heads` (apps/api, venv) must print exactly one head; today `mka_20261004_user_profile`. If upstream adds a migration and two heads appear, add a fork merge migration (prefix `mka_`) merging both. Never edit upstream migrations.
3. Re-check `apps/web/components/ui/dialog.tsx`: `MkaProfileGate.tsx` repeats dialog.tsx's inline `style` properties on purpose (passing `style` replaces them wholesale).
4. Run the focused tests: `src/tests/services/test_mka_profile_*.py`, `src/tests/routers/test_mka_profile_router.py`, `test_signup_custom_fields_flow.py`, `test_users_service.py`; web: `bun test tests` and eslint on the files above.
5. e2e: the `apps/e2e/core/client.ts` hook must be present or e2e student creation 422s.

#### F. Known unlogged documentation caveat

- `docs/content/guides/build-learning-platform/do-it-yourself.mdx:442` shows `POST /users/{org.id}` without `mka_profile`. On this fork that call now needs `mka_profile: {"majlis": "..."}` for non-OAuth users. The upstream doc was not edited (would add merge noise).

- **Upstream PR**: none


### Turnstile signup protection without SaaS mode (`apps/web/lib/mka-turnstile.ts`)

- **Date**: 2026-10-04
- **Reason**: Upstream only runs Cloudflare Turnstile when the deployment is SaaS (which would put the MKA org on free-plan limits, require email verification and hide Google SSO). The fork activates it OUTSIDE SaaS when the keys are configured. In SaaS mode behavior is exactly upstream. Logic is fork-only in `apps/web/lib/mka-turnstile.ts` (pure rules `isMkaTurnstileApplicable`, `mkaTurnstileActiveFor`, `mkaTurnstileEnforcedFor`, wrapper `isMkaTurnstileEnforced(mode)`); tests in `apps/web/tests/mka-turnstile.test.mjs`. Spec: section 12 of `docs/superpowers/specs/2026-10-04-mka-profile-fields-design.md`.
- **Hooks (3 upstream files)**: `TurnstileWidget.tsx` (`isTurnstileConfigured()` short-circuits true when non-SaaS and the site key is set), `app/api/signup/route.ts` (a `!saas && enforced` verify block before `if (saas)`; the SaaS block is untouched, so verification can never run twice), `app/api/turnstile/verify/route.ts` (SaaS keeps the upstream condition; non-SaaS skips unless both keys are set).
- **Superseded 2026-10-05 for `signup/route.ts`**: the `!saas && enforced` verify block was removed; outside SaaS the route now forwards the token to the API (single verifier). See "Backend Turnstile enforcement + signup rate limit" below. The diff below is historical.
- **Custom domain**: ignored only outside SaaS (it can be true for a single-org deployment's own host and would disable protection); SaaS keeps upstream's exclusion.
- **Stale upstream comments**: comments in `TurnstileWidget.tsx` and the verify route still say "SaaS-only"; stale for this fork, left unedited to avoid merge noise.
- **Diff** (`git diff 74807657..HEAD`; the `signup/route.ts` diff is limited to the Turnstile hunks, the `mka_profile` hooks are logged in section A):

```diff
diff --git a/apps/web/app/api/signup/route.ts b/apps/web/app/api/signup/route.ts
@@ -2,6 +2,7 @@ import { NextRequest, NextResponse } from 'next/server'
 import { getServerAPIUrl } from '@services/config/config'
 import { isSaaSMode, isCustomDomainRequest } from '@lib/saas'
 import { verifyTurnstile, clientIpFromHeaders } from '@lib/turnstile'
+import { isMkaTurnstileEnforced } from '@lib/mka-turnstile' // MKA fork
 import { validateSignupEmail } from '@services/emails/disposableEmail'
 import { addContactWithLoops, sendLoopsEvent, LOOPS_SIGNED_USERS_GROUP } from '@services/emails/loops'
 
@@ -63,6 +67,18 @@ export async function POST(request: NextRequest) {
   // this route is a thin proxy to the backend user-create endpoint.
   const saas = await isSaaSMode()
 
+  // MKA fork: outside SaaS, Turnstile runs when both keys are set (SaaS = upstream block below).
+  if (!saas && isMkaTurnstileEnforced('oss')) { // MKA fork
+    const mkaTurnstile = await verifyTurnstile(turnstileToken, clientIpFromHeaders(request.headers)) // MKA fork
+    if (!mkaTurnstile.ok) { // MKA fork
+      const detail = // MKA fork
+        mkaTurnstile.reason === 'missing_token' // MKA fork
+          ? 'Please complete the verification challenge.' // MKA fork
+          : 'Verification failed. Please try again.' // MKA fork
+      return NextResponse.json({ detail }, { status: 403 }) // MKA fork
+    } // MKA fork
+  } // MKA fork
+
   if (saas) {
     // 1. Turnstile — allowed through automatically when no secret is set. Skipped
     // on org custom domains: the hostname-locked widget can't render there, so the
diff --git a/apps/web/app/api/turnstile/verify/route.ts b/apps/web/app/api/turnstile/verify/route.ts
--- a/apps/web/app/api/turnstile/verify/route.ts
+++ b/apps/web/app/api/turnstile/verify/route.ts
@@ -1,6 +1,7 @@
 import { NextRequest, NextResponse } from 'next/server'
 import { isSaaSMode, isCustomDomainRequest } from '@lib/saas'
 import { verifyTurnstile, clientIpFromHeaders } from '@lib/turnstile'
+import { isMkaTurnstileEnforced } from '@lib/mka-turnstile' // MKA fork
 
 // Standalone Turnstile verification endpoint, used by the auth forms that call
 // the backend DIRECTLY (login / forgot-password / reset-password) — they verify
@@ -12,7 +13,8 @@ export async function POST(request: NextRequest) {
   // Off outside SaaS — never challenge OSS/self-hosted users. Also off on org
   // custom domains, where the hostname-locked Turnstile widget can't render, so
   // the client sends no token and would otherwise be blocked here.
-  if (!(await isSaaSMode()) || (await isCustomDomainRequest())) {
+  // MKA fork: SaaS keeps the upstream condition; outside SaaS skip unless both keys are set.
+  if ((await isSaaSMode()) ? await isCustomDomainRequest() : !isMkaTurnstileEnforced('oss')) { // MKA fork
     return NextResponse.json({ ok: true })
   }
 
diff --git a/apps/web/components/Auth/TurnstileWidget.tsx b/apps/web/components/Auth/TurnstileWidget.tsx
--- a/apps/web/components/Auth/TurnstileWidget.tsx
+++ b/apps/web/components/Auth/TurnstileWidget.tsx
@@ -1,5 +1,6 @@
 'use client'
 import { getConfig, getDeploymentMode } from '@services/config/config'
+import { mkaTurnstileActiveFor } from '@lib/mka-turnstile' // MKA fork
 import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile'
 import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
 
@@ -34,6 +35,7 @@ function isOnCustomDomain(): boolean {
  * `useTurnstileRequired`) to avoid hydration mismatches.
  */
 export function isTurnstileConfigured(): boolean {
+  if (mkaTurnstileActiveFor({ mode: getDeploymentMode(), siteKey: getTurnstileSiteKey() })) return true // MKA fork: non-SaaS only
   return getTurnstileSiteKey().length > 0 && getDeploymentMode() === 'saas' && !isOnCustomDomain()
 }
 
```

- **Re-apply**: `grep -rn "MKA fork" apps/web/app/api/signup apps/web/app/api/turnstile apps/web/components/Auth/TurnstileWidget.tsx`.

### `.gitignore` secret-hygiene block (MKA fork)

- **File**: `.gitignore` (upstream-owned)
- **Date**: 2026-10-12
- **Reason**: no extension point; git only reads `.gitignore` files. Single delimited block appended at the end to minimise merge conflicts. Deviations from the first draft: `skills/` anchored to `/skills/` (unanchored would hide tracked `.claude/skills` and `.qwen/skills`), `.qwen/` narrowed to `.qwen/tmp/` + `.qwen/worktrees/` (tracked `.qwen/skills/*` live there), and `docs/agents/` omitted (referenced by CLAUDE.md, must stay trackable).
- **Diff**:
```diff
+# --- MKA fork: never commit secrets or local agent state (see docs/security/secrets.md) ---
+.env.*
+!.env.example
+!.env.sample
+!.env.template
+*.key
+*.p12
+*.pfx
+.agents/
+.considered/
+.hermes/
+.kiro/
+.qwen/tmp/
+.qwen/worktrees/
+.serena/
+/skills/
+skills-lock.json
+docs/superpowers/
+DEVLOG.md
+DEVLOG.raw.md
+# --- end MKA fork ---
```
- **Re-apply after pulling upstream**: if the block is lost, re-append it verbatim.
- **Upstream PR**: none

---

**Reminder**: Before modifying an upstream file, verify that no extension point, plugin, or wrapper approach exists. Document the change here immediately after making it.


### MKA identity attributes (`mka_user_attributes`, Feature A, milestones M1+M2)

- **Date**: 2026-10-04
- **Reason**: Server-derived identity attributes (level / department / role / Majlis / Region) from the Google-verified email, with admin + roster overrides and an audit trail. All logic is fork-only (`services/mka/`, `routers/mka_attributes.py`, `db/mka_user_attributes.py`, migration `mka_20261004_user_attributes`, tests under `src/tests/**/mka*`). Upstream files get ONLY the three hooks below. Spec: `docs/superpowers/specs/2026-10-04-mka-conditional-visibility-design.md` (A1/A2/GDPR).
- **Re-apply after pulling upstream**: `grep -rn "MKA fork" apps/api/src` and run `uv run pytest src/tests/services/mka src/tests/routers/test_mka_attributes_router.py src/tests/routers/test_mka_attributes_security.py`.

1. `apps/api/src/router.py` (hook A1: mount the router; same pattern as the `mka_profile` block). The router admits a session OR an org API token and gates every handler itself (admin routes reuse upstream's `_require_api_token` + `_resolve_org_slug`, as `/admin/{org_slug}/...` does).
```diff
+from src.routers import mka_attributes as mka_attributes_router_module  # MKA fork
@@ after the mka_profile include_router block
+v1_router.include_router(  # MKA fork: session (/me) + org API token (admin routes), gated per handler
+    mka_attributes_router_module.router,
+    prefix="/mka/attributes",
+    tags=["mka-attributes"],
+    dependencies=[Depends(require_authenticated_user_or_api_token)],
+)
```
2. `apps/api/src/services/auth/session.py` (hook A2: derive on login; fail-open, Google-only, SAVEPOINT; the function itself swallows every error)
```diff
+from src.services.mka.attributes import mka_refresh_on_login  # MKA fork
@@ issue_session_or_challenge, right after the block_non_google_auth lines
+    await mka_refresh_on_login(db_session, user, amr)  # MKA fork: fail-open, Google-only
```
3. `apps/api/src/services/admin/admin.py` (GDPR export: one-token change to the EXISTING `# MKA fork` line; `profile_status` returns attributes only when `include_attributes=True`, so learner-facing routes never see them)
```diff
-        "mka_profile": await profile_status(db_session, user_id),  # MKA fork
+        "mka_profile": await profile_status(db_session, user_id, include_attributes=True),  # MKA fork
```
(`delete_profile`, called by upstream `anonymize_user`, now also deletes attribute/audit/roster rows: the change is inside the fork file `services/users/mka_profile.py`, no upstream edit.)

- **Fork-owned file changed (no upstream edit)**: `apps/api/src/services/auth/mka_google_only.py` (fork, added in 4ca921bd) now records the verified `hd` of every Google login in a request-scoped ContextVar (`take_verified_hd`), set inside the existing `require_workspace_hd` call that upstream `signWithGoogle` already makes. The attribute login hook uses it as proof of Workspace ownership (per address). Behaviour of `require_workspace_hd` (accept/reject) is unchanged.
- **Not touched**: `cli.py` (backfill is `python -m src.services.mka.backfill`), `MKA_GOOGLE_ONLY_DOMAINS` / any SSO setting.
- Re-apply test command also includes `src/tests/routers/test_mka_attributes_review_fixes.py`.


### MKA native compliance analytics API (hook H4)

- **Date**: 2026-10-04
- **Reason**: org-scoped compliance cycles / expected roster / read endpoints. All logic is fork-only (`routers/mka_compliance.py`, `services/mka/compliance*.py`, `db/mka_compliance.py`, migration `mka_20261004_compliance`, tests, runbook). Spec: `docs/superpowers/specs/2026-10-04-mka-native-compliance-analytics-design.md`.
- **Re-apply after pulling upstream**: `grep -n "MKA fork" apps/api/src/router.py`; run `uv run --with greenlet pytest src/tests/services/mka src/tests/routers/test_mka_compliance_router.py`.

`apps/api/src/router.py` (import + mount; same pattern as the mka_attributes block; per-handler gating, tokens admitted):
```diff
+from src.routers import mka_compliance as mka_compliance_router_module  # MKA fork
@@ after the mka_attributes include_router block
+v1_router.include_router(  # MKA fork: compliance analytics; session (scope-gated) or org API token, gated per handler
+    mka_compliance_router_module.router,
+    prefix="/mka/compliance",
+    tags=["mka-compliance"],
+    dependencies=[Depends(require_authenticated_user_or_api_token)],
+)

```

### MKA compliance automation API (hook H5)

- **Date**: 2026-10-05
- **Reason**: mounts the fork-only `/mka/automation` router (status now; webhook receiver and cron endpoints in later seams). All logic is fork-only (`routers/mka_automation.py`, `services/mka/automation*.py`, `db/mka_automation.py`, migration `mka_20261005_automation`, tests, runbook). Spec: `docs/superpowers/specs/2026-10-05-mka-compliance-automation-design.md`. No extension point exists for adding a router.
- **No router-level auth dependency, on purpose**: the webhook authenticates by HMAC signature and the cron endpoints by `X-MKA-Cron-Secret`; each handler authenticates itself (`/status`: org admin session or Read-only-or-better org token). Guarded by `test_the_router_is_mounted_without_a_router_level_auth_dependency`.
- **Re-apply after pulling upstream**: `grep -n "mka_automation" apps/api/src/router.py`; run `cd apps/api && uv run --with greenlet python -m pytest src/tests/services/mka src/tests/routers -q -k mka`.

`apps/api/src/router.py` (import + mount, after the mka_compliance block):
```diff
+from src.routers import mka_automation as mka_automation_router_module  # MKA fork
@@ after the mka_compliance include_router block
+v1_router.include_router(  # MKA fork: automation; NO router-level auth dependency on purpose: webhook (HMAC), cron (secret) and admin endpoints each authenticate themselves
+    mka_automation_router_module.router,
+    prefix="/mka/automation",
+    tags=["mka-automation"],
+)
```

### MKA identity sync API (hook H6)

- **Date**: 2026-10-07
- **Reason**: mounts the fork-only `/mka/identity` router (`POST /sync`, `GET /status`). All logic is fork-only (`routers/mka_identity.py`, `services/mka/identity_sync.py`, `db/mka_identity.py`, migration `mka_20261007_identity_sync`, rules `identity_rules/2026.4.json`, tests). The login call site lives in the fork-owned `services/mka/attributes.py` (no upstream hook). Spec: `docs/superpowers/specs/2026-10-07-mka-roles-groups-scope-design.md`. No extension point exists for adding a router.
- **Auth**: same as `/mka/attributes`: `require_authenticated_user_or_api_token` at the router, `_resolve_admin` per handler (org admin session or org API token; a real run needs the Full Access preset, a dry run the Read-only preset).
- **Re-apply after pulling upstream**: `grep -n "mka_identity" apps/api/src/router.py`; run `cd apps/api && uv run --with greenlet python -m pytest src/tests/services/mka src/tests/routers -q -k mka`.

`apps/api/src/router.py` (import + mount, after the mka_automation block):
```diff
+from src.routers import mka_identity as mka_identity_router_module  # MKA fork
@@ after the mka_automation include_router block
+v1_router.include_router(  # MKA fork: identity sync (role + groups); admin session or org API token, gated per handler
+    mka_identity_router_module.router,
+    prefix="/mka/identity",
+    tags=["mka-identity"],
+    dependencies=[Depends(require_authenticated_user_or_api_token)],
+)
```

## MKA native compliance analytics: web hooks H1-H3 (apps/web)

- **Date**: 2026-10-04
- **Reason**: Native "Compliance" nav item + course tab. All logic is fork-only (`services/mka/compliance*.ts`, `components/mka/compliance/*`, `app/orgs/[orgslug]/dash/compliance/*`, dev-only `app/examples/mka-compliance-preview/*`, test `tests/mka-compliance-format.test.mjs`). Upstream files get ONLY the pure-addition lines below (no existing line edited). Visibility is cosmetic; the API enforces on every endpoint. Spec: `docs/superpowers/specs/2026-10-04-mka-native-compliance-analytics-design.md`.
- **Re-apply after pulling upstream**: `grep -rn "MKA fork" apps/web/components/Dashboard/Menus apps/web/app/orgs/*/dash/courses` and run `bun test tests/mka-compliance-format.test.mjs` (the "hook guard" tests fail if a hook line is lost).
- **No extension point exists**: nav items and course tabs are hard-coded JSX / an inline array in upstream.
- **Amended 2026-10-06**: since #18 (moderation) also uses `ShieldCheck`, both menus import it from the shared multi-line `@phosphor-icons/react` import instead of the separate `import { ShieldCheck } ... // MKA fork` lines shown below. If upstream drops `ShieldCheck` from that import on a pull, re-add it (or restore the fork line). The hook-guard test accepts either form.

1. H1 `apps/web/components/Dashboard/Menus/DashLeftMenu.tsx` (hook placed beside `useAdminStatus()`, before the early return, to respect Rules of Hooks; `MenuLink` is a local const so the link must live in this file)
```diff
 import useAdminStatus from '@components/Hooks/useAdminStatus'
+import { ShieldCheck } from '@phosphor-icons/react' // MKA fork
+import { useMkaComplianceScope } from '@services/mka/compliance' // MKA fork
@@
   const { canManageOrg } = useAdminStatus()
+  const mkaScope = useMkaComplianceScope() // MKA fork
@@ after the Analytics </HoverMenu>
+            {mkaScope !== 'none' && <MenuLink href="/dash/compliance" icon={<ShieldCheck size={20} weight="fill" />} label="Compliance" isCollapsed={isCollapsed} active={isActivePath('/dash/compliance')} />} {/* MKA fork */}
```
2. H2 `apps/web/components/Dashboard/Menus/DashMobileMenu.tsx` (`PanelItem` is a local const, not exported)
```diff
 import { useCommandPalette } from '@components/Dashboard/CommandPalette/CommandPaletteContext'
+import { ShieldCheck } from '@phosphor-icons/react' // MKA fork
+import { useMkaComplianceScope } from '@services/mka/compliance' // MKA fork
@@
   const { toggle: openSearch } = useCommandPalette()
+  const mkaScope = useMkaComplianceScope() // MKA fork
@@ after the Analytics PanelItem
+                {mkaScope !== 'none' && <PanelItem href="/dash/compliance" icon={<ShieldCheck size={15} weight="fill" />} label="Compliance" active={isActive('/dash/compliance')} onClick={close} />} {/* MKA fork */}
```
3. H3 `apps/web/app/orgs/[orgslug]/dash/courses/course/[courseuuid]/[subpage]/page.tsx` (push AFTER the array's `]` so no upstream line is edited; `useMkaCourseTabs` is unconditional, before any early return; it keeps the tab while the scope query is pending so a deep link to `/compliance` is not bounced by the page's unknown-subpage redirect)
```diff
 import { DashTabBar, DashTabItem } from '@components/Dashboard/Shared/DashTabBar/DashTabBar';
+import MkaCourseComplianceTab, { useMkaCourseTabs } from '@components/mka/compliance/course-tab' // MKA fork
@@ after the `tabs` array closing `]`
+  tabs.push(...useMkaCourseTabs(params.courseuuid)) // MKA fork
@@ after the analytics render block
+            {!rightsLoading && params.subpage == 'compliance' && hasPermission('update') ? <MkaCourseComplianceTab courseUUID={courseuuid} /> : null} {/* MKA fork */}
```

### Audience block editor hooks (W1/W2/W3, `mkaEditorExtensions`)

- **Date**: 2026-10-05
- **Reason**: TipTap 3.31.3 runs with `enableContentCheck: false`, so a document containing a node the instance does not register renders the WHOLE lesson blank. Every TipTap instance that loads activity content must therefore register the fork's `mkaAudience` / `mkaViewerField` / `mkaCounterparts` nodes. The extension arrays are inline literals in three upstream files, so each gets one import line and one spread line. All logic is fork-only in `apps/web/components/mka/editor/`, `components/mka/audience/`, `services/mka/attributes*.ts`. The guard test `apps/web/tests/mka-editor-hooks.test.mjs` fails if a new upstream TipTap site appears without the hook. `mkaEditorExtensions` never throws and always returns the nodes.
- **Not hooked (verified)**: `DiscussionEditor.tsx` / `DiscussionContent.tsx` (discussion content, never activity JSON), `Boards/BoardCanvas.tsx` (stores an `activityBlock` reference; the activity itself renders through `DynamicCanva`, covered by W2).
- **Hook sites and diffs**:

1. W1 `apps/web/components/Objects/Editor/Editor.tsx` (authoring editor, `extensions` useMemo)
```diff
 import AIStreamingMark from './Extensions/AIStreaming/AIStreamingMark'
+import { mkaEditorExtensions } from '@components/mka/editor' // MKA fork
@@ after `MagicBlock.configure({ editable: true, activity: stableActivity }),`
+      ...mkaEditorExtensions({ editable: true, activity: stableActivity, courseUuid: props.course?.course_uuid }), // MKA fork
```
2. W2 `apps/web/components/Objects/Activities/DynamicCanva/DynamicCanva.tsx` (learner/embed/board viewer; its editor is `editable: true` internally but read-only via the EditorContext provider, so `editable: false` is passed)
```diff
 import AICanvaToolkit from './AI/AICanvaToolkit'
+import { mkaEditorExtensions } from '@components/mka/editor' // MKA fork
@@ after the `MagicBlock.configure({ editable: false, activity: props.activity }),` entry
+      ...mkaEditorExtensions({ editable: false, activity: props.activity, courseUuid: props.courseUuid }), // MKA fork
```
3. W3 `apps/web/components/Objects/Editor/EditorPreview.tsx` (version history / merge conflict previews)
```diff
 import MagicBlock from './Extensions/MagicBlocks/MagicBlock'
+import { mkaEditorExtensions } from '@components/mka/editor' // MKA fork
@@ after the `MagicBlock.configure({ editable: false, activity: activity }),` entry
+      ...mkaEditorExtensions({ editable: false, activity }), // MKA fork
```

### Audience block: AI prompt strip hook (`apps/api/src/services/ai/ai.py`)

- **Date**: 2026-10-05 (user-approved upstream hook)
- **Reason**: the learner "ask AI about this activity" paths serialize `activity.content` into the model context. Audience sections (`mkaAudience` nodes) a learner cannot see must never be part of that context. The fork module `apps/api/src/services/mka/audience_strip.py::mka_content_for_ai` removes every non-matching section and UNWRAPS every matching one (replaced by its children, so the top-level-only serializer reads what the learner sees; fail-closed reader + Python evaluator; can-view-all viewers get all sections unwrapped; any error strips all audience sections). One import line and one call line per site; all logic is fork-only. Three call sites cover the four entry points (`ai_start_activity_chat_session`, `ai_send_activity_chat_message`, and `_get_activity_and_course_info` which both streaming functions use).
- **Why no extension point**: `ai.py` builds the prompt inline from `activity.content`; there is no content filter hook.
- **Note**: `structure_activity_content_by_type` only reads TOP-LEVEL heading / callout / paragraph nodes, so without unwrapping the model would see none of the text inside `mkaAudience` wrappers. Matching sections are therefore unwrapped by the hook.
- **Diff** (same three lines after each `content = activity.content`, plus the import):
```diff
 from src.services.ai.llm import model_for_tier
+from src.services.mka.audience_strip import mka_content_for_ai  # MKA fork
@@ in ai_start_activity_chat_session, ai_send_activity_chat_message, _get_activity_and_course_info
     content = activity.content
+    content = await mka_content_for_ai(content, current_user, db_session, request, course=course)  # MKA fork
```

## MKA fork — added root config `apps/web/bunfig.toml` (2026-10-05, audience block)

Not an upstream file (upstream has none). Added so every bun test run preloads `apps/web/tests/setup/dom.mjs` (happy-dom) before any test file loads; Radix captures `globalThis.document` at module load, so without a global preload the audience picker tests were order-dependent. If upstream ever adds its own `apps/web/bunfig.toml`, merge this in:

```toml
[test]
preload = ["./tests/setup/dom.mjs"]
```

### Backend Turnstile enforcement + signup rate limit (G1/G3, 2026-10-05, revised after PR #19 review)

- **Reason**: Turnstile was enforced only in the Next signup proxy, so a direct `POST /api/v1/users/...` bypassed it, and upstream's `check_signup_rate_limit` was never called. Fork-only logic: `apps/api/src/services/security/mka_signup_guard.py` (FastAPI dependency `mka_signup_guard`: inert in SaaS mode; exempts only API tokens, superadmins and ADMINs of the target org; guarded callers get Turnstile first, then the `MKA_SIGNUP_RATE_LIMIT_PER_HOUR` limiter, default 60, skipped for non-global client IPs), `apps/api/src/services/security/mka_turnstile.py` (siteverify via httpx, enforced only when both keys are set, fails open on Cloudflare errors), `apps/web/lib/mka-signup-proxy.ts` (forwarded headers, loopback API URL; there is no fallback to the public URL, a failed loopback call returns the route's 502). Tests: `apps/api/src/tests/services/test_mka_turnstile.py`, `test_mka_signup_rate_limit.py`, `apps/web/tests/mka-signup-proxy.test.mjs`. Evaluation: `docs/superpowers/specs/2026-10-05-mka-signup-hardening-eval.md`.
- **Why no extension point**: FastAPI has no per-route hook registry; a route-level `Depends` is the smallest change. Not hooked into `create_user` (OAuth also calls it). The Next route has no fetch hook; the fetch call is wrapped in one line.
- **Single-use token / loopback**: outside SaaS the Next route no longer verifies; it forwards `X-Turnstile-Token` (plus `X-Forwarded-For` / `X-Real-IP` verbatim) and calls the API on loopback only (`mkaSignupFetch`; no public-URL fallback). The API verifies once. SaaS mode: no extra headers, original URL, upstream verify block unchanged, API guard inert.
- **Diff** (`git diff origin/dev..HEAD`, verbatim):

```diff
diff --git a/apps/api/src/routers/users.py b/apps/api/src/routers/users.py
index a2ad932a..2e1dcd5b 100644
--- a/apps/api/src/routers/users.py
+++ b/apps/api/src/routers/users.py
@@ -16,6 +16,7 @@ from src.services.security.rate_limiting import (
     check_invite_acceptance_rate_limit,
 )
 from src.services.orgs.orgs import get_org_join_mechanism
+from src.services.security.mka_signup_guard import mka_signup_guard  # MKA fork
 from src.security.auth import get_current_user, get_authenticated_user
 from src.core.events.database import get_db_session
 from src.db.courses.courses import CourseRead
@@ -190,6 +191,7 @@ async def api_create_user_with_orgid(
     request: Request,
     db_session: AsyncSession = Depends(get_db_session),
     current_user: PublicUser = Depends(get_current_user),
+    _mka_signup_guard: None = Depends(mka_signup_guard),  # MKA fork
     user_object: UserCreate,
     org_id: int,
 ) -> UserRead:
@@ -229,6 +231,7 @@ async def api_create_user_with_orgid_and_invite(
     request: Request,
     db_session: AsyncSession = Depends(get_db_session),
     current_user: PublicUser = Depends(get_current_user),
+    _mka_signup_guard: None = Depends(mka_signup_guard),  # MKA fork
     user_object: UserCreate,
     invite_code: str,
     org_id: int,
@@ -284,6 +287,7 @@ async def api_create_user_without_org(
     request: Request,
     db_session: AsyncSession = Depends(get_db_session),
     current_user: PublicUser = Depends(get_current_user),
+    _mka_signup_guard: None = Depends(mka_signup_guard),  # MKA fork
     user_object: UserCreate,
 ) -> UserRead:
     """
```

```diff
diff --git a/apps/web/app/api/signup/route.ts b/apps/web/app/api/signup/route.ts
index 8deab550..b3c95d8f 100644
--- a/apps/web/app/api/signup/route.ts
+++ b/apps/web/app/api/signup/route.ts
@@ -2,7 +2,7 @@ import { NextRequest, NextResponse } from 'next/server'
 import { getServerAPIUrl } from '@services/config/config'
 import { isSaaSMode, isCustomDomainRequest } from '@lib/saas'
 import { verifyTurnstile, clientIpFromHeaders } from '@lib/turnstile'
-import { isMkaTurnstileEnforced } from '@lib/mka-turnstile' // MKA fork
+import { mkaSignupFetch, mkaSignupForwardHeaders } from '@lib/mka-signup-proxy' // MKA fork
 import { validateSignupEmail } from '@services/emails/disposableEmail'
 import { addContactWithLoops, sendLoopsEvent, LOOPS_SIGNED_USERS_GROUP } from '@services/emails/loops'
 
@@ -67,17 +67,7 @@ export async function POST(request: NextRequest) {
   // this route is a thin proxy to the backend user-create endpoint.
   const saas = await isSaaSMode()
 
-  // MKA fork: outside SaaS, Turnstile runs when both keys are set (SaaS = upstream block below).
-  if (!saas && isMkaTurnstileEnforced('oss')) { // MKA fork
-    const mkaTurnstile = await verifyTurnstile(turnstileToken, clientIpFromHeaders(request.headers)) // MKA fork
-    if (!mkaTurnstile.ok) { // MKA fork
-      const detail = // MKA fork
-        mkaTurnstile.reason === 'missing_token' // MKA fork
-          ? 'Please complete the verification challenge.' // MKA fork
-          : 'Verification failed. Please try again.' // MKA fork
-      return NextResponse.json({ detail }, { status: 403 }) // MKA fork
-    } // MKA fork
-  } // MKA fork
+  // MKA fork: outside SaaS the API verifies the single-use Turnstile token (forwarded by mkaSignupForwardHeaders below).
 
   if (saas) {
     // 1. Turnstile — allowed through automatically when no secret is set. Skipped
@@ -153,9 +143,9 @@ export async function POST(request: NextRequest) {
 
   let backendRes: Response
   try {
-    backendRes = await fetch(url, {
+    backendRes = await mkaSignupFetch(saas, base, url, { // MKA fork: non-SaaS calls the API on loopback
       method: 'POST',
-      headers: { 'Content-Type': 'application/json' },
+      headers: { 'Content-Type': 'application/json', ...mkaSignupForwardHeaders(saas, request.headers, turnstileToken) }, // MKA fork
       body: JSON.stringify(backendBody),
       signal: AbortSignal.timeout(8000),
     })
```

- **Re-apply**: `grep -n "MKA fork" apps/api/src/routers/users.py apps/web/app/api/signup/route.ts` (4 lines in users.py: 1 import + 3 route params; in route.ts this change owns the `mka-signup-proxy` import, the "API verifies" comment, the `mkaSignupFetch(...)` call line, the fetch `headers` line and the final `NextResponse.json(..., { headers: mkaSignupResponseHeaders(...) })` line that passes the API's `Retry-After` through; the other `MKA fork` lines there are the `mka_profile` hooks from section A).

## Member Majlis groups: signup hook (`apps/api/src/services/users/users.py`, 2026-10-08)

Why: `create_user` saves the MKA profile before the `UserOrganization` row exists, so the profile-save hook finds no org at signup. One call after the org join re-runs the (fail-open, flag-gated) group sync. No extension point exists after the join.

```diff
-from src.services.users.mka_profile import save_signup_profile, validate_signup_profile  # MKA fork
+from src.services.users.mka_profile import save_signup_profile, sync_member_groups_after_save, validate_signup_profile  # MKA fork
@@ create_user
     await db_session.refresh(user_organization)
+    await sync_member_groups_after_save(db_session, user_organization.user_id)  # MKA fork
```

Re-apply: `grep -n "sync_member_groups_after_save" apps/api/src/services/users/users.py` (2 lines).

### Org join hooks (`apps/api/src/services/orgs/join.py`, 2026-10-08)

Why: a member who already has a profile and joins another org (invite or open join) must land in that org's Majlis/Region groups. Fail-open: the helper never raises.

```diff
+from src.services.users.mka_profile import sync_member_groups_after_save  # MKA fork
@@ invite join, after the UserOrganization commit
     await db_session.commit()
+    await sync_member_groups_after_save(db_session, user.id)  # MKA fork
@@ open join, after the UserOrganization commit
     await db_session.commit()
+    await sync_member_groups_after_save(db_session, user.id)  # MKA fork
```

Re-apply: `grep -n "MKA fork" apps/api/src/services/orgs/join.py` (3 lines).

### Course audience router registration (`apps/api/src/router.py`, 2026-10-08)

Why: the new fork router `routers/mka_course_audience.py` (`/mka/courses/{course_uuid}/audience`) must be mounted; same registration point as every other `mka_*` router.

```diff
+from src.routers import mka_course_audience as mka_course_audience_router_module  # MKA fork
@@ after the mka_identity include_router
+v1_router.include_router(  # MKA fork: course audience; session (author/admin of the course) or org API token, gated per handler
+    mka_course_audience_router_module.router,
+    prefix="/mka/courses",
+    tags=["mka-course-audience"],
+    dependencies=[Depends(require_authenticated_user_or_api_token)],
+)
```

Re-apply: `grep -n "mka_course_audience" apps/api/src/router.py` (2 lines + the include block). No other upstream file is touched: the publish-triggered enrolment is a SQLAlchemy `after_commit` listener in the fork file `services/mka/course_audience.py`; the sign-in / profile-save / backfill hooks live in the fork file `services/mka/identity_sync.py`.

### Course Audience panel mount (`apps/web/components/Dashboard/Pages/Course/EditCourseAccess/EditCourseAccess.tsx`, 2026-10-08)

Why: the per-course Audience panel must sit on the course Access tab; EditCourseAccess has no slot/extension point. The panel is flag-gated (`NEXT_PUBLIC_MKA_COURSE_AUDIENCE_ENABLED=1`) and renders nothing when off. All logic lives in `apps/web/components/mka/course-audience/` and `apps/web/services/mka/courseAudience*.ts`.

```diff
 import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
+import CourseAudiencePanel from '@components/mka/course-audience/CourseAudiencePanel' // MKA fork
@@ EditCourseAccess return, directly above the "Access type cards" block
+                <CourseAudiencePanel /> {/* MKA fork */}
                 {/* Access type cards */}
```

Re-apply: `grep -n "MKA fork" apps/web/components/Dashboard/Pages/Course/EditCourseAccess/EditCourseAccess.tsx` (2 lines).

### RAG audience guard hook (`apps/api/src/services/ai/rag/sources/__init__.py`, 2026-10-13)

Why: the shared per-course RAG index embedded `mkaAudience` (restricted) lesson text, readable by every learner via RAG chat/search. The walker (`dynamic._NODE_HANDLERS`) and extractor registry (`_EXTRACTORS`) have no plugin point, and this package `__init__` is the one module every extraction (web, queue consumer, scheduler, CLI backfill) must import, so the fork installs its guard at its end. All logic lives in the fork file `services/mka/rag_audience.py` (no-op `mkaAudience` handler + wrapper that strips audience nodes and drops segments of audience-referenced blocks, fail closed). One-off cleanup: `services/mka/rag_audience_reindex.py`.

```diff
 register_ee_rag_sources()
+
+from src.services.mka.rag_audience import install as _mka_install_rag_audience  # noqa: E402  # MKA fork
+
+_mka_install_rag_audience()  # MKA fork: keep audience-restricted lesson text out of the shared index
```

Re-apply: `grep -n "MKA fork" apps/api/src/services/ai/rag/sources/__init__.py` (2 lines, at the end of the file, after `register_ee_rag_sources()`). Guarded by `src/tests/services/mka/test_rag_audience.py` (fails if the registry/walker is renamed). Extractors registered after import time (plugins) are not wrapped.

### Run DB migrations at container start (`docker/start.sh`, `apps/api/src/router.py`, 2026-10-13)

Why: deploys build the root Dockerfile and nothing runs Alembic (the API only does `create_all`, which never adds columns), so upstream v1.4.0's `assignmenttask.order` was missing on dev. `docker/start.sh` has no hook point, so one line calls the fork-owned `apps/api/scripts/mka-migrate.sh` (all logic is in fork files: `services/mka/schema_migrate.py`, `services/mka/schema_drift.py`, `routers/mka_health.py`). `router.py` mounts the unauthenticated schema health router, same registration point as every other `mka_*` router. The Dockerfile is NOT touched (the script lives under `apps/api`, which it already copies).

```diff
--- a/docker/start.sh
@@ before "# Start the services"
+# MKA fork: apply DB migrations before the API starts (never blocks startup)
+sh /app/api/scripts/mka-migrate.sh
+
--- a/apps/api/src/router.py
+from src.routers import mka_health as mka_health_router_module  # MKA fork
@@ before the usergroups include_router
+v1_router.include_router(  # MKA fork: schema health; deliberately unauthenticated (deploy checks), returns counts only
+    mka_health_router_module.router,
+    prefix="/mka/health",
+    tags=["mka-health"],
+)
```

Re-apply: `grep -n "mka-migrate" docker/start.sh` (1 line) and `grep -n "mka_health" apps/api/src/router.py` (2 lines + the include block).

## Learner activity navigation and submit labels (fix/mka-lesson-nav-ui)

Why: usability test found bottom NEXT looking disabled, and three different final-submit labels. No extension point exists for these upstream components, so each edit is minimal.

- `apps/web/app/orgs/[orgslug]/(withmenu)/course/[courseuuid]/activity/[activityid]/activity.tsx` (`NextActivityButton`): class swap `bg-gray-200 ... text-gray-600 ... hover:bg-gray-200` -> `bg-gray-800 ... nice-shadow text-white ... hover:bg-gray-700`, label `text-gray-500` -> `text-gray-300`.
- `apps/web/locales/en.json` (English only): `activities.save_answers` "Save answers" -> "Save draft"; `assignments.submit_for_grading`, `assignments.hand_in`, `assignments.submit_assignment` -> "Submit".
- `apps/e2e/features/assignments/pages/student.ts`: selectors follow the new labels (`getByText('Submit', { exact: true })`, button `Submit` exact).

Re-apply: after a sync, re-check those four en.json keys and the `NextActivityButton` class string; re-run `git diff origin/dev -- <files>` from the PR.

## Route all AI through the MKA Brand Center MCP (feat/mka-brandcenter-ai)

Why: owner decision to apply MKA brand/culture guardrails to every AI call (live MCP tool-calling plus a deterministic cached floor). `llm/client.py::_agent` and `image/generator.py::generate_image` are the only choke points for text and images; no extension point exists. All logic lives in the fork-owned `apps/api/src/services/ai/mka_brand/`; no upstream signature changes. Enabled iff `MKA_BRANDCENTER_TOKEN` is set (kill switch: unset it, behavior is identical to upstream). Other AI entry points (`base.py`, `editor.py`, `captions.py`, `rag/media.py`, `caption_jobs.py`, `ai.py`, `quiz.py`, etc.) all funnel into `llm.client.generate/generate_stream`, so they need no hook. Not covered: TTS audio synthesis in `audio/generator.py` (speech, not text; its script text does go through `generate`).

- `apps/api/src/services/ai/llm/client.py` (`_agent`): import `mka_brand`; hoist `build_model(...)` into a local so `toolsets_for(model)` can check tool support.
- `apps/api/src/services/ai/image/generator.py` (`generate_image`): import `mka_brand`; rewrite the prompt after the length clamp.
- `apps/api/pyproject.toml` + `apps/api/uv.lock`: `pydantic-ai-slim` gains the `mcp` extra (regenerate the lock with `uv lock`, never hand-merge).

```diff
--- a/apps/api/src/services/ai/llm/client.py
+from src.services.ai import mka_brand  # MKA fork
 from src.services.ai.llm.provider import build_model
@@ def _agent
-    return Agent(
-        build_model(model_name),
-        output_type=output_type,
-        system_prompt=system_prompt or (),
-    )
+    model = build_model(model_name)  # MKA fork: hoisted so toolsets_for can inspect it
+    return Agent(
+        model,
+        output_type=output_type,
+        system_prompt=mka_brand.augment(system_prompt) or (),  # MKA fork
+        toolsets=mka_brand.toolsets_for(model),  # MKA fork
+    )
--- a/apps/api/src/services/ai/image/generator.py
+from src.services.ai import mka_brand  # MKA fork
 from src.services.ai.llm import AINotConfiguredError
@@ generate_image, after the MAX_PROMPT_CHARS clamp
+    prompt = await mka_brand.brand_image_prompt(  # MKA fork
+        prompt, editing=bool(input_images), max_chars=MAX_PROMPT_CHARS
+    )
--- a/apps/api/pyproject.toml
-    "pydantic-ai-slim[openai,anthropic,google,mistral]==2.54.0",
+    "pydantic-ai-slim[openai,anthropic,google,mistral,mcp]==2.54.0",
```

Re-apply: `grep -n "MKA fork" apps/api/src/services/ai/llm/client.py apps/api/src/services/ai/image/generator.py` (4 + 2 lines), then `cd apps/api && uv lock`. Guarded by `apps/api/src/tests/mka_brand/` (fails if `_agent` stops honoring toolsets/system prompt). Note: pydantic-ai 2.54 has no `MCPServerStreamableHTTP`; the integration uses `pydantic_ai.mcp.MCPToolset` (fastmcp client, `headers=`).
