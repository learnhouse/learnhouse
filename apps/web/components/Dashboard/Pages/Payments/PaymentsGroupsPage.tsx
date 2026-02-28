'use client';
import React, { useState } from 'react';
import { useOrg } from '@components/Contexts/OrgContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import useSWR, { mutate } from 'swr';
import {
  getPaymentsGroups,
  createPaymentsGroup,
  updatePaymentsGroup,
  deletePaymentsGroup,
  getGroupResources,
  addGroupResource,
  removeGroupResource,
  getGroupSyncs,
  addGroupSync,
  removeGroupSync,
} from '@services/payments/groups';
import {
  Plus, Pencil, Trash2, X, BookOpen, Users, RefreshCcw, Layers,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@components/ui/button';
import { Input } from '@components/ui/input';
import { Textarea } from '@components/ui/textarea';
import { Label } from '@components/ui/label';
import Modal from '@components/Objects/StyledElements/Modal/Modal';
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal';
import toast from 'react-hot-toast';
import { getOrgCourses } from '@services/courses/courses';
import { usePaymentsEnabled } from '@hooks/usePaymentsEnabled';
import UnconfiguredPaymentsDisclaimer from '@components/Pages/Payments/UnconfiguredPaymentsDisclaimer';

// ---------------------------------------------------------------------------
// Group Resources Panel
// ---------------------------------------------------------------------------

function GroupResourcePanel({ group, orgId, token }: { group: any; orgId: number; token: string }) {
  const org = useOrg() as any;
  const [pickerOpen, setPickerOpen] = useState(false);

  const swrKey = [`/payments/${orgId}/groups/${group.id}/resources`, orgId, token];

  const { data: resources } = useSWR(swrKey, () => getGroupResources(orgId, group.id, token));

  const { data: coursesData } = useSWR(
    org ? [`/courses/org`, org.slug, token] : null,
    ([, slug, t]: any) => getOrgCourses(slug, null, t, true)
  );

  const rawList: string[] = Array.isArray(resources?.data) ? resources.data : Array.isArray(resources) ? resources : [];
  const courses: any[] = coursesData ?? [];

  // Build a name map from courses
  const nameMap: Record<string, string> = {};
  courses.forEach((c: any) => {
    const uuid = `course_${c.course_uuid?.replace('course_', '')}`;
    nameMap[uuid] = c.name;
  });

  const linkedSet = new Set(rawList);
  const available = courses.filter((c: any) => {
    const uuid = `course_${c.course_uuid?.replace('course_', '')}`;
    return !linkedSet.has(uuid);
  });

  const handleAdd = async (resourceUuid: string) => {
    await addGroupResource(orgId, group.id, resourceUuid, token);
    mutate(swrKey);
    setPickerOpen(false);
    toast.success('Course added to group');
  };

  const handleRemove = async (resourceUuid: string) => {
    await removeGroupResource(orgId, group.id, resourceUuid, token);
    mutate(swrKey);
    toast.success('Course removed');
  };

  return (
    <div className="space-y-2">
      {rawList.length === 0 ? (
        <p className="text-xs text-gray-400 italic py-1">No courses yet — add one below.</p>
      ) : (
        <ul className="space-y-1">
          {rawList.map((uuid: string) => (
            <li key={uuid} className="flex items-center justify-between bg-indigo-50 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <BookOpen size={13} className="text-indigo-500 shrink-0" />
                <span className="text-sm font-medium text-gray-800 truncate max-w-[200px]">
                  {nameMap[uuid] ?? uuid}
                </span>
              </div>
              <button
                onClick={() => handleRemove(uuid)}
                className="text-gray-300 hover:text-red-500 transition-colors ml-2 shrink-0"
                title="Remove"
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Add picker */}
      {!pickerOpen ? (
        <button
          onClick={() => setPickerOpen(true)}
          className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors py-1"
        >
          <Plus size={12} /> Add course
        </button>
      ) : (
        <div className="border border-gray-200 rounded-lg bg-white shadow-sm">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
            <span className="text-xs font-semibold text-gray-600">Select a course to add</span>
            <button onClick={() => setPickerOpen(false)} className="text-gray-400 hover:text-gray-600">
              <X size={13} />
            </button>
          </div>
          {!coursesData ? (
            <p className="text-xs text-gray-400 px-3 py-2">Loading…</p>
          ) : available.length === 0 ? (
            <p className="text-xs text-gray-400 px-3 py-2 italic">All courses are already in this group.</p>
          ) : (
            <ul className="max-h-40 overflow-y-auto divide-y divide-gray-50">
              {available.map((c: any) => {
                const uuid = `course_${c.course_uuid?.replace('course_', '')}`;
                return (
                  <li key={uuid}>
                    <button
                      onClick={() => handleAdd(uuid)}
                      className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-indigo-50 flex items-center gap-2 transition-colors"
                    >
                      <BookOpen size={13} className="text-indigo-400 shrink-0" />
                      <span className="truncate">{c.name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// UserGroup Sync Panel
// ---------------------------------------------------------------------------

function GroupSyncPanel({ group, orgId, token }: { group: any; orgId: number; token: string }) {
  const swrKey = [`/payments/${orgId}/groups/${group.id}/sync`, token];

  const { data: syncs } = useSWR(swrKey, () => getGroupSyncs(orgId, group.id, token));

  const { data: usergroups } = useSWR(
    [`/usergroups/${orgId}`, token],
    async ([, t]) => {
      const { getUserGroups } = await import('@services/usergroups/usergroups');
      const res = await getUserGroups(orgId, t);
      return res?.data ?? res ?? [];
    }
  );

  const syncList: any[] = Array.isArray(syncs?.data) ? syncs.data : Array.isArray(syncs) ? syncs : [];
  const syncedIds = new Set(syncList.map((s: any) => s.usergroup_id));
  const available = (usergroups ?? []).filter((ug: any) => !syncedIds.has(ug.id));

  const handleAdd = async (ugId: number) => {
    await addGroupSync(orgId, group.id, ugId, token);
    mutate(swrKey);
    toast.success('UserGroup synced — enrolled users will be auto-added');
  };

  const handleRemove = async (ugId: number) => {
    await removeGroupSync(orgId, group.id, ugId, token);
    mutate(swrKey);
    toast.success('Sync removed');
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-400 leading-relaxed">
        When a user enrolls, they're automatically added to these groups. When cancelled, they're removed.
      </p>

      {syncList.length > 0 && (
        <ul className="space-y-1">
          {syncList.map((s: any) => (
            <li key={s.usergroup_id} className="flex items-center justify-between bg-orange-50 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <Users size={13} className="text-orange-500 shrink-0" />
                <span className="text-sm font-medium text-gray-800">{s.usergroup_name ?? `Group #${s.usergroup_id}`}</span>
              </div>
              <button
                onClick={() => handleRemove(s.usergroup_id)}
                className="text-gray-300 hover:text-red-500 transition-colors ml-2 shrink-0"
                title="Remove sync"
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {available.length > 0 ? (
        <div className="relative">
          <select
            className="w-full appearance-none text-xs border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-200 cursor-pointer pr-7"
            value=""
            onChange={(e) => { if (e.target.value) handleAdd(Number(e.target.value)); }}
          >
            <option value="">+ Link a UserGroup…</option>
            {available.map((ug: any) => (
              <option key={ug.id} value={ug.id}>{ug.name}</option>
            ))}
          </select>
          <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
        </div>
      ) : syncList.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No UserGroups available to link.</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group Card
// ---------------------------------------------------------------------------

function GroupCard({ group, orgId, token, onEdit, onDelete }: {
  group: any; orgId: number; token: string;
  onEdit: (g: any) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 nice-shadow overflow-hidden flex flex-col">
      {/* Card header */}
      <div className="flex items-start justify-between px-4 pt-4 pb-3 border-b border-gray-50">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="mt-0.5 w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
            <Layers size={14} className="text-indigo-500" />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-sm text-gray-900 leading-snug">{group.name}</h3>
            {group.description && (
              <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{group.description}</p>
            )}
          </div>
        </div>
        <div className="flex gap-1 shrink-0 ml-2">
          <button
            onClick={() => onEdit(group)}
            className="p-1.5 rounded-md text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-colors"
            title="Edit"
          >
            <Pencil size={13} />
          </button>
          <ConfirmationModal
            confirmationButtonText="Delete Group"
            confirmationMessage="All resources and syncs will be removed. Active offers linked to this group will lose their group."
            dialogTitle={`Delete "${group.name}"?`}
            dialogTrigger={
              <button className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors" title="Delete">
                <Trash2 size={13} />
              </button>
            }
            functionToExecute={() => onDelete(group.id)}
            status="warning"
          />
        </div>
      </div>

      <div className="flex flex-col divide-y divide-gray-50 flex-1">
        {/* Courses section */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-1.5 mb-2.5">
            <BookOpen size={12} className="text-indigo-400" />
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Courses</span>
          </div>
          <GroupResourcePanel group={group} orgId={orgId} token={token} />
        </div>

        {/* UserGroup sync section */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-1.5 mb-2.5">
            <RefreshCcw size={12} className="text-orange-400" />
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Access Groups</span>
          </div>
          <GroupSyncPanel group={group} orgId={orgId} token={token} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create / Edit form
// ---------------------------------------------------------------------------

function GroupForm({ initial, onSubmit, onCancel }: {
  initial?: { name: string; description: string };
  onSubmit: (data: { name: string; description: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast.error('Name is required'); return; }
    setLoading(true);
    try {
      await onSubmit({ name: name.trim(), description: description.trim() });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 px-1.5 py-2">
      <div>
        <Label htmlFor="pg-name">Group Name</Label>
        <Input
          id="pg-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Full Access Bundle, Premium Subscription"
        />
      </div>
      <div>
        <Label htmlFor="pg-desc">Description <span className="text-gray-400">(optional)</span></Label>
        <Textarea
          id="pg-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What resources are included in this group?"
          rows={3}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={loading}>
          {loading ? 'Saving…' : initial ? 'Save Changes' : 'Create Group'}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function PaymentsGroupsPage() {
  const org = useOrg() as any;
  const session = useLHSession() as any;
  const token = session?.data?.tokens?.access_token;
  const { isEnabled, isLoading } = usePaymentsEnabled();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<any>(null);

  const swrKey = org && token ? [`/payments/${org.id}/groups`, token] : null;
  const { data: groups, error } = useSWR(swrKey, ([, t]: any) => getPaymentsGroups(org.id, t));

  if (!isEnabled && !isLoading) return <UnconfiguredPaymentsDisclaimer />;
  if (error) return <div className="p-8 text-sm text-red-500">Failed to load groups.</div>;
  if (!groups) return <div className="p-8 text-sm text-gray-400">Loading…</div>;

  const list: any[] = Array.isArray(groups?.data) ? groups.data : Array.isArray(groups) ? groups : [];

  const handleCreate = async (data: { name: string; description: string }) => {
    const res = await createPaymentsGroup(org.id, data, token);
    if (res.success) {
      toast.success('Group created');
      mutate(swrKey);
      setIsCreateOpen(false);
    } else {
      toast.error(res.data?.detail || 'Failed to create group');
    }
  };

  const handleUpdate = async (data: { name: string; description: string }) => {
    if (!editingGroup) return;
    const res = await updatePaymentsGroup(org.id, editingGroup.id, data, token);
    if (res.success) {
      toast.success('Group updated');
      mutate(swrKey);
      setEditingGroup(null);
    } else {
      toast.error(res.data?.detail || 'Failed to update group');
    }
  };

  const handleDelete = async (groupId: number) => {
    const res = await deletePaymentsGroup(org.id, groupId, token);
    if (res.success || res.status === 200) {
      toast.success('Group deleted');
      mutate(swrKey);
    } else {
      toast.error(res.data?.detail || 'Failed to delete group');
    }
  };

  return (
    <div className="ml-10 mr-10 mx-auto bg-white rounded-xl nice-shadow px-4 py-4">
      <Modal
        isDialogOpen={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        dialogTitle="Create Payment Group"
        dialogDescription="Group courses together for subscriptions or bundles"
        dialogContent={
          <GroupForm onSubmit={handleCreate} onCancel={() => setIsCreateOpen(false)} />
        }
      />
      <Modal
        isDialogOpen={!!editingGroup}
        onOpenChange={(open) => { if (!open) setEditingGroup(null); }}
        dialogTitle="Edit Payment Group"
        dialogDescription="Update group name and description"
        dialogContent={
          editingGroup ? (
            <GroupForm
              initial={{ name: editingGroup.name, description: editingGroup.description }}
              onSubmit={handleUpdate}
              onCancel={() => setEditingGroup(null)}
            />
          ) : null
        }
      />

      {/* Page header */}
      <div className="flex items-center justify-between bg-gray-50 px-5 py-3 rounded-md mb-5">
        <div className="-space-y-0.5">
          <h1 className="font-bold text-xl text-gray-800">Payment Groups</h1>
          <p className="text-gray-500 text-sm">Bundle courses together for subscriptions or multi-course offers.</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} size="sm">
          <Plus size={14} className="mr-1.5" /> New Group
        </Button>
      </div>

      {list.length === 0 ? (
        <div className="border border-dashed border-gray-200 rounded-xl p-12 text-center">
          <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center mx-auto mb-3">
            <Layers size={22} className="text-indigo-300" />
          </div>
          <p className="font-semibold text-gray-600 mb-1">No groups yet</p>
          <p className="text-sm text-gray-400 mb-4 max-w-xs mx-auto">
            Groups let you attach multiple courses to a single offer — perfect for subscriptions or bundles.
          </p>
          <Button onClick={() => setIsCreateOpen(true)} variant="outline" size="sm">
            <Plus size={13} className="mr-1.5" /> Create your first group
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map((group: any) => (
            <GroupCard
              key={group.id}
              group={group}
              orgId={org.id}
              token={token}
              onEdit={setEditingGroup}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
