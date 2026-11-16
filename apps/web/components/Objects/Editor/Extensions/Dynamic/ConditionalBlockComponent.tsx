'use client'
/*
 Conditional block: content only some learners receive (the API drops it for
 everyone else). In the editor its rules read as a sentence of chips,
 "Shown when [Course progress ≥ 50] and [Enrolled in course yes]", each
 editable in a popover. A block right after it with the opposite rules is its
 "Otherwise" branch: both are labelled, and editing the first keeps the
 second in sync (one transaction).

 Rules, label and message are node attrs written once per edit (popover
 close / Apply / blur), never per keystroke.
*/
import React, { useEffect, useState } from 'react'
import { NodeViewContent, NodeViewWrapper, NodeViewProps } from '@tiptap/react'
import { useTranslation } from 'react-i18next'
import { ArrowsSplit, ChatText, Code, EyeSlash, Lightning, NotePencil, SelectionSlash, SlidersHorizontal, UsersThree, Warning } from '@phosphor-icons/react'
import EditorBlockFrame from '../../Blocks/ui/EditorBlockFrame'
import { BlockPopover, CommitInput, Segmented, SettingsField, TEXTAREA_CLASS } from '../../Blocks/ui/BlockChrome'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { cn } from '@/lib/utils'
import {
  Condition,
  DEFAULT_RULES,
  FIELDS,
  OPS,
  PRESETS,
  RuleGroup,
  RuleSyntaxError,
  describeRules,
  isFlatGroup,
  isGroup,
  negateRules,
  parseRules,
  stringifyRules,
} from './dynamicRules'
import { useDynamicLookups } from './useDynamicLookups'
import { useBlockReach } from './DynamicReach'
import { AddConditionChip, ConditionChip, type Lookups } from './RuleChips'
import { branchRole, sameRules } from './conditionalBranch'

type Branch = 'if' | 'else' | null

/** Is this block the "if" of a pair, its "otherwise", or on its own? Follows sibling edits. */
function useBranch(editor: NodeViewProps['editor'], getPos: NodeViewProps['getPos']): Branch {
  const compute = React.useCallback((): Branch => {
    const pos = typeof getPos === 'function' ? getPos() : undefined
    if (typeof pos !== 'number') return null
    try {
      const $pos = editor.state.doc.resolve(pos)
      const parent = $pos.parent
      const index = $pos.index()
      return branchRole(
        index > 0 ? parent.child(index - 1) : null,
        parent.child(index),
        index + 1 < parent.childCount ? parent.child(index + 1) : null,
      )
    } catch {
      return null
    }
  }, [editor, getPos])
  const [role, setRole] = useState<Branch>(null)
  useEffect(() => {
    const update = () => setRole(compute())
    update()
    editor.on('update', update)
    return () => {
      editor.off('update', update)
    }
  }, [editor, compute])
  return role
}

function ConditionalBlockComponent({ node, editor, getPos, updateAttributes, selected }: NodeViewProps) {
  const { t } = useTranslation()
  const editorState = useEditorProvider() as any
  const isEditable = editorState?.isEditable ?? false
  const lookups = useDynamicLookups()
  const rules: RuleGroup = node.attrs.rules ?? DEFAULT_RULES
  const summary = describeRules(rules, lookups.names)

  // Course editors reading the learner page get the raw document: show what
  // the block is for, but don't get in the way of reading it.
  if (!isEditable) {
    return (
      <NodeViewWrapper className="my-3 rounded-xl border border-dashed border-violet-300/80 px-3 pb-0.5 pt-1">
        <div
          contentEditable={false}
          className="-mt-3 mb-1 inline-flex max-w-full items-center gap-1 rounded-full bg-white px-2 text-[11px] font-medium text-violet-700"
          title={summary}
        >
          <UsersThree size={11} weight="fill" />
          <span className="truncate">
            {t('editor.dynamic.visible_to', 'Visible to')}: {summary}
          </span>
        </div>
        <NodeViewContent className="content" />
      </NodeViewWrapper>
    )
  }

  return (
    <ConditionalEditor
      node={node}
      editor={editor}
      getPos={getPos}
      updateAttributes={updateAttributes}
      selected={selected}
      lookups={lookups}
    />
  )
}

function ConditionalEditor({
  node,
  editor,
  getPos,
  updateAttributes,
  selected,
  lookups,
}: Pick<NodeViewProps, 'node' | 'editor' | 'getPos' | 'updateAttributes' | 'selected'> & { lookups: Lookups }) {
  const { t } = useTranslation()
  const rules: RuleGroup = node.attrs.rules ?? DEFAULT_RULES
  const label: string = node.attrs.label ?? ''
  const hiddenMessage: string = node.attrs.hiddenMessage ?? ''
  const reach = useBlockReach(editor, getPos)
  const branch = useBranch(editor, getPos)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // A block inserted from the toolbar opens "add a rule" once.
  const [autoAdd] = useState(() => !!node.attrs.openRules)
  useEffect(() => {
    if (node.attrs.openRules) queueMicrotask(() => updateAttributes({ openRules: null }))
  }, [node.attrs.openRules, updateAttributes])

  const flat = isGroup(rules) && isFlatGroup(rules)
  const conditions = (flat ? rules.conditions : []) as Condition[]

  /** Write new rules; an "otherwise" block right after follows along, same transaction. */
  const commitRules = (next: RuleGroup, extra: Record<string, unknown> = {}) => {
    const pos = typeof getPos === 'function' ? getPos() : undefined
    if (typeof pos !== 'number') return
    const live = editor.state.doc.nodeAt(pos)
    if (!live || live.type.name !== 'conditionalBlock') return
    const old: RuleGroup = live.attrs.rules ?? DEFAULT_RULES
    const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...live.attrs, ...extra, rules: next })
    const nextPos = pos + live.nodeSize
    const sibling = nextPos < tr.doc.content.size ? tr.doc.nodeAt(nextPos) : null
    if (sibling && sibling.type.name === 'conditionalBlock' && old.conditions?.length && sameRules(sibling.attrs.rules, negateRules(old))) {
      tr.setNodeMarkup(nextPos, undefined, { ...sibling.attrs, rules: negateRules(next) })
    }
    editor.view.dispatch(tr)
  }

  const setCondition = (i: number, c: Condition) =>
    commitRules({ ...rules, conditions: conditions.map((x, j) => (j === i ? c : x)) })
  const removeCondition = (i: number) => commitRules({ ...rules, conditions: conditions.filter((_, j) => j !== i) })
  const addCondition = (c: Condition) => commitRules({ ...rules, match: rules.match ?? 'all', conditions: [...conditions, c] })

  const unwrap = () => {
    const pos = typeof getPos === 'function' ? getPos() : undefined
    if (typeof pos !== 'number') return
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.replaceWith(pos, pos + node.nodeSize, node.content)
        return true
      })
      .run()
  }

  const addOtherwise = () => {
    const pos = typeof getPos === 'function' ? getPos() : undefined
    if (typeof pos !== 'number') return
    editor
      .chain()
      .focus()
      .insertContentAt(pos + node.nodeSize, {
        type: 'conditionalBlock',
        attrs: {
          rules: negateRules(rules),
          label: label ? t('editor.dynamic.opposite_label', { label, defaultValue: '{{label}} (otherwise)' }) : '',
        },
        content: [{ type: 'paragraph' }],
      })
      .run()
  }

  const presets = (cancel: () => void) =>
    conditions.length === 0 ? (
      <div className="flex flex-col gap-1.5 border-b border-neutral-100 pb-3">
        <span className="flex items-center gap-1 text-[12px] font-semibold text-neutral-500">
          <Lightning size={11} weight="fill" className="text-violet-500" />
          {t('editor.dynamic.quick_start', 'Quick start')}
        </span>
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              title={t(`editor.dynamic.presets.${preset.id}_hint`, preset.description)}
              onClick={() => {
                const message = preset.hiddenMessage ? t(`editor.dynamic.presets.${preset.id}_message`, preset.hiddenMessage) : ''
                commitRules(preset.rules(), message && !hiddenMessage ? { hiddenMessage: message } : {})
                cancel()
              }}
              className="rounded-full bg-white px-2.5 py-1 text-xs text-neutral-700 ring-1 ring-neutral-200 hover:bg-violet-50 hover:ring-violet-300"
            >
              {t(`editor.dynamic.presets.${preset.id}`, preset.label)}
            </button>
          ))}
        </div>
        {lookups.usergroups.length > 0 && (
          <>
            <span className="pt-1 text-[12px] font-semibold text-neutral-500">
              {t('editor.dynamic.your_groups', 'Your user groups')}
            </span>
            <div className="flex flex-wrap gap-1">
              {lookups.usergroups.map((g) => (
                <button
                  key={g.value}
                  type="button"
                  onClick={() => {
                    commitRules({ match: 'all', conditions: [{ field: 'user.groups', op: 'contains_any', value: [g.value] }] })
                    cancel()
                  }}
                  className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-800 ring-1 ring-violet-600/15 hover:bg-violet-100"
                >
                  {g.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    ) : null

  const lead =
    branch === 'else'
      ? null
      : rules.negate
        ? t('editor.blocks_v2.conditional.hidden_when', 'Hidden when')
        : conditions.length || !flat
          ? t('editor.blocks_v2.conditional.shown_when', 'Shown when')
          : t('editor.blocks_v2.conditional.shown_to_everyone', 'Shown to everyone')

  const tools = (
    <>
      <BlockPopover
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        width={380}
        title={t('editor.dynamic.rules_title', 'Who sees this content?')}
        trigger={
          <HeaderButton title={t('editor.dynamic.edit_rules', 'Edit rules')}>
            <SlidersHorizontal size={14} />
          </HeaderButton>
        }
      >
        <ConditionalSettings
          rules={rules}
          label={label}
          hiddenMessage={hiddenMessage}
          onRules={(next) => commitRules(next)}
          onMeta={(meta) => updateAttributes(meta)}
        />
      </BlockPopover>
      {branch === null && conditions.length > 0 && (
        <HeaderButton title={t('editor.dynamic.add_opposite', 'Add a block for everyone else')} onClick={addOtherwise}>
          <ArrowsSplit size={14} />
        </HeaderButton>
      )}
      <HeaderButton title={t('editor.dynamic.unwrap', 'Show to everyone (remove condition)')} onClick={unwrap}>
        <SelectionSlash size={14} />
      </HeaderButton>
    </>
  )

  return (
    <NodeViewWrapper
      className={cn(
        'rounded-xl bg-violet-50/30 ring-1 ring-violet-200',
        branch === 'if' ? 'mb-1.5 mt-4' : branch === 'else' ? 'mb-4 mt-1.5' : 'my-4',
      )}
      data-branch={branch ?? undefined}
    >
      <EditorBlockFrame
        editable
        node={node}
        editor={editor}
        getPos={getPos}
        selected={selected}
        tone="dynamic"
        editableContent
        label={
          branch === 'else'
            ? t('editor.blocks_v2.conditional.otherwise', 'Otherwise')
            : t('editor.dynamic.conditional_block', 'Conditional content')
        }
      >
        <div
          contentEditable={false}
          className="flex flex-wrap items-center gap-1.5 rounded-t-xl border-b border-violet-100 bg-violet-50 px-3 py-2 text-xs text-violet-800"
          data-testid="conditional-header"
        >
          {branch && (
            <span
              className={cn(
                'inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-semibold',
                branch === 'if' ? 'bg-violet-600 text-white' : 'bg-white text-violet-700 ring-1 ring-violet-300',
              )}
              data-testid="branch-badge"
            >
              {branch === 'if' ? t('editor.blocks_v2.conditional.if', 'If') : t('editor.blocks_v2.conditional.otherwise', 'Otherwise')}
            </span>
          )}
          {!branch && (rules.negate ? <EyeSlash size={14} className="shrink-0" /> : <ArrowsSplit size={14} className="shrink-0" />)}
          {label && branch !== 'else' && <span className="font-semibold">{label} ·</span>}

          {branch === 'else' ? (
            <span className="text-[12px] text-violet-900/80">
              {t('editor.blocks_v2.conditional.else_sentence', 'Everyone who doesn’t see the block above sees this one.')}
            </span>
          ) : (
            <>
              <span className="text-[12px] font-medium text-violet-900/80">{lead}</span>
              {flat ? (
                conditions.map((c, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && (
                      <button
                        type="button"
                        onClick={() => commitRules({ ...rules, match: rules.match === 'any' ? 'all' : 'any' })}
                        title={t('editor.blocks_v2.conditional.toggle_match', 'Switch between and / or')}
                        className="h-6 rounded-md px-1.5 text-[11px] font-semibold text-violet-700 hover:bg-violet-100"
                      >
                        {rules.match === 'any' ? t('editor.blocks_v2.conditional.or', 'or') : t('editor.dynamic.and', 'and')}
                      </button>
                    )}
                    <ConditionChip
                      condition={c}
                      lookups={lookups}
                      onCommit={(next) => setCondition(i, next)}
                      onRemove={() => removeCondition(i)}
                    />
                  </React.Fragment>
                ))
              ) : (
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="inline-flex h-7 max-w-full items-center gap-1 rounded-lg bg-white px-2 text-[12px] text-violet-900 shadow-[0_0_0_1px_rgba(124,58,237,0.22)] hover:bg-violet-50"
                >
                  <Code size={12} />
                  <span className="truncate">{describeRules(rules, lookups.names)}</span>
                </button>
              )}
              {flat && (
                <AddConditionChip
                  lookups={lookups}
                  onAdd={addCondition}
                  defaultOpen={autoAdd}
                  extra={presets}
                  label={conditions.length ? t('editor.blocks_v2.conditional.add_rule_short', 'Rule') : t('editor.blocks_v2.conditional.add_rule', 'Add a rule')}
                />
              )}
            </>
          )}

          <div className="ms-auto flex items-center gap-1.5">
            {hiddenMessage && (
              <span title={hiddenMessage} className="inline-flex shrink-0">
                <ChatText size={13} className="opacity-60" />
              </span>
            )}
            {reach && (
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1',
                  reach.matched === 0 && reach.learners > 0 ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-white text-violet-700 ring-violet-200',
                )}
                title={
                  reach.matched === 0 && reach.learners > 0
                    ? t('editor.dynamic.reach_none', 'No enrolled learner matches these rules yet.')
                    : t('editor.dynamic.reach_hint', 'Learners enrolled in this course who see this block, from the current rules.')
                }
              >
                {t('editor.dynamic.reach', {
                  matched: reach.matched,
                  learners: reach.truncated ? `${reach.learners}+` : reach.learners,
                  defaultValue: '{{matched}} of {{learners}} learners',
                })}
              </span>
            )}
            {tools}
          </div>
        </div>
        {branch !== 'else' && flat && conditions.length === 0 && !rules.negate && (
          <div
            contentEditable={false}
            className="flex items-center gap-1.5 border-b border-violet-100 bg-amber-50/60 px-3 py-1.5 text-[12px] text-amber-900"
          >
            <Warning size={13} weight="fill" className="text-amber-500" />
            {t('editor.dynamic.empty_rules', 'Everyone sees this block for now.')}
          </div>
        )}
        <div className="px-3 py-1">
          <NodeViewContent className="content" />
        </div>
      </EditorBlockFrame>
    </NodeViewWrapper>
  )
}

/** The small violet icon buttons of the block header (as before). */
const HeaderButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { title: string }>(
  ({ title, children, ...rest }, ref) => (
    <button
      ref={ref}
      type="button"
      title={title}
      aria-label={title}
      onMouseDown={(e) => e.preventDefault()}
      className="shrink-0 rounded-md p-1 text-violet-600 hover:bg-violet-100"
      {...rest}
    >
      {children}
    </button>
  ),
)
HeaderButton.displayName = 'HeaderButton'

/** Settings popover: rules as code, the author's label and the message for everyone else. */
function ConditionalSettings({
  rules,
  label,
  hiddenMessage,
  onRules,
  onMeta,
}: {
  rules: RuleGroup
  label: string
  hiddenMessage: string
  onRules: (_r: RuleGroup) => void
  onMeta: (_m: { label?: string; hiddenMessage?: string }) => void
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'note' | 'code'>(isGroup(rules) && !isFlatGroup(rules) ? 'code' : 'note')
  const [code, setCode] = useState(() => stringifyRules(rules))
  const [error, setError] = useState<string | null>(null)
  const apply = () => {
    try {
      onRules(parseRules(code))
      setError(null)
    } catch (e) {
      setError(e instanceof RuleSyntaxError ? e.message : String(e))
    }
  }
  return (
    <>
      <Segmented
        ariaLabel={t('editor.dynamic.rules_title', 'Who sees this content?')}
        value={tab}
        onChange={setTab}
        options={[
          { value: 'note', label: <><NotePencil size={13} />{t('editor.blocks_v2.conditional.tab_note', 'Name & message')}</> },
          { value: 'code', label: <><Code size={13} />{t('editor.dynamic.code', 'Code')}</> },
        ]}
      />
      {tab === 'note' ? (
        <>
          <SettingsField label={t('editor.blocks_v2.conditional.label', 'Name')} hint={t('editor.blocks_v2.conditional.label_hint', 'Only authors see this name.')}>
            <CommitInput
              value={label}
              maxLength={80}
              placeholder={t('editor.dynamic.label_placeholder', 'Name this block (only authors see it), e.g. Advanced track')}
              aria-label={t('editor.blocks_v2.conditional.label', 'Name')}
              onCommit={(v) => onMeta({ label: v.trim() })}
            />
          </SettingsField>
          <SettingsField
            label={t('editor.dynamic.hidden_message', 'Message for everyone else (optional)')}
            hint={t('editor.dynamic.hidden_message_hint', 'Shown as a note in place of the block. Variables work here too.')}
          >
            <CommitInput
              value={hiddenMessage}
              maxLength={300}
              placeholder={t('editor.dynamic.hidden_message_placeholder', 'e.g. This section unlocks after your first week.')}
              aria-label={t('editor.dynamic.hidden_message', 'Message for everyone else (optional)')}
              onCommit={(v) => onMeta({ hiddenMessage: v.trim() })}
            />
          </SettingsField>
        </>
      ) : (
        <>
          <textarea
            className={cn(TEXTAREA_CLASS, 'h-28 font-mono text-xs')}
            value={code}
            spellCheck={false}
            aria-label={t('editor.dynamic.code', 'Code')}
            onChange={(e) => {
              setCode(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) apply()
            }}
            placeholder={'user.groups contains_any ["usergroup_…"] and progress.percent gte 50'}
          />
          {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
          <div className="flex items-center justify-between gap-2">
            <details className="min-w-0 text-[11px] text-neutral-500">
              <summary className="cursor-pointer">{t('editor.dynamic.code_reference', 'Fields and operators')}</summary>
              <ul className="mt-1.5 max-h-32 space-y-0.5 overflow-y-auto font-mono">
                {FIELDS.map((f) => (
                  <li key={f.field}>
                    <span className="text-violet-700">{f.field}</span> {OPS[f.type].join(' | ')}
                  </li>
                ))}
                <li className="pt-1 font-sans">{t('editor.dynamic.code_combine')}</li>
              </ul>
            </details>
            <button type="button" onClick={apply} className={buttonClass('primary', 'sm', 'flex-none self-start')}>
              {t('editor.blocks_v2.conditional.apply', 'Apply')}
            </button>
          </div>
        </>
      )}
    </>
  )
}

export default ConditionalBlockComponent
