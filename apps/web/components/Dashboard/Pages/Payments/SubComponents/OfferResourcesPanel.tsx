'use client';
import React, { useState } from 'react';
import { useOrg } from '@components/Contexts/OrgContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import useSWR, { mutate } from 'swr';
import toast from 'react-hot-toast';
import { BookOpen, Mic, Puzzle, X, Plus, Loader2 } from 'lucide-react';
import { getOrgCourses } from '@services/courses/courses';
import { getOfferResources, addOfferResource, removeOfferResource } from '@services/payments/groups';

interface OfferResourcesPanelProps {
  offerId: number;
  offerName: string;
}

function resourceIcon(uuid: string) {
  if (uuid.startsWith('course_')) return <BookOpen size={14} className="text-indigo-500" />;
  if (uuid.startsWith('podcast_')) return <Mic size={14} className="text-pink-400" />;
  return <Puzzle size={14} className="text-gray-400" />;
}

function resourceLabel(uuid: string) {
  const [type] = uuid.split('_');
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function OfferResourcesPanel({ offerId, offerName }: OfferResourcesPanelProps) {
  const org = useOrg() as any;
  const session = useLHSession() as any;
  const token = session?.data?.tokens?.access_token;
  const [showPicker, setShowPicker] = useState(false);
  const [isLinking, setIsLinking] = useState(false);

  const swrKey = org && token ? [`/offers/${offerId}/resources`, org.id, token] : null;

  const { data: resources, error } = useSWR(
    swrKey,
    ([, orgId, t]: any) => getOfferResources(orgId, offerId, t),
    { revalidateOnFocus: false }
  );

  const { data: coursesData } = useSWR(
    showPicker && org && token ? [`/courses/org`, org.slug, token] : null,
    ([, slug, t]: any) => getOrgCourses(slug, null, t, true),
    { revalidateOnFocus: false }
  );

  if (error) return <div className="text-sm text-red-500">Failed to load resources</div>;
  if (!resources) return <div className="text-sm text-gray-400">Loading resources…</div>;

  const list: string[] = Array.isArray(resources?.data) ? resources.data : Array.isArray(resources) ? resources : [];
  const courses: any[] = coursesData ?? [];
  const linkedUuids = new Set(list);
  const availableCourses = courses.filter(
    (c: any) => !linkedUuids.has(`course_${c.course_uuid?.replace('course_', '')}`)
  );

  const handleRemove = async (resourceUuid: string) => {
    try {
      await removeOfferResource(org.id, offerId, resourceUuid, token);
      mutate(swrKey);
      toast.success('Resource removed from offer');
    } catch {
      toast.error('Failed to remove resource');
    }
  };

  const handleLinkCourse = async (course: any) => {
    const courseUuid = `course_${course.course_uuid?.replace('course_', '')}`;
    setIsLinking(true);
    try {
      await addOfferResource(org.id, offerId, courseUuid, token);
      mutate(swrKey);
      toast.success('Course linked to offer');
      setShowPicker(false);
    } catch {
      toast.error('Failed to link course');
    } finally {
      setIsLinking(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">
        Resources below are accessible to anyone enrolled in <strong>{offerName}</strong>.
      </p>

      {list.length === 0 ? (
        <p className="text-sm text-gray-400 italic">No resources linked yet.</p>
      ) : (
        <ul className="space-y-1">
          {list.map((uuid: string) => (
            <li key={uuid} className="flex items-center justify-between bg-gray-50 rounded px-3 py-1.5 text-sm">
              <div className="flex items-center space-x-2">
                {resourceIcon(uuid)}
                <span className="text-xs font-medium text-gray-500">{resourceLabel(uuid)}</span>
                <span className="font-mono text-xs truncate max-w-[200px]">{uuid}</span>
              </div>
              <button
                onClick={() => handleRemove(uuid)}
                className="text-red-400 hover:text-red-600 ml-2"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Course picker */}
      {!showPicker ? (
        <button
          className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800 mt-1"
          onClick={() => setShowPicker(true)}
        >
          <Plus size={12} /> Link a Course
        </button>
      ) : (
        <div className="border rounded-md p-2 space-y-1 bg-gray-50">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-gray-700">Select a course to link</span>
            <button onClick={() => setShowPicker(false)} className="text-gray-400 hover:text-gray-600">
              <X size={12} />
            </button>
          </div>
          {!coursesData ? (
            <div className="flex items-center gap-1 text-xs text-gray-500 py-1">
              <Loader2 size={12} className="animate-spin" /> Loading courses…
            </div>
          ) : availableCourses.length === 0 ? (
            <p className="text-xs text-gray-400 italic py-1">
              {courses.length === 0 ? 'No courses in this org.' : 'All courses are already linked.'}
            </p>
          ) : (
            <ul className="max-h-40 overflow-y-auto space-y-0.5">
              {availableCourses.map((course: any) => (
                <li key={course.course_uuid}>
                  <button
                    disabled={isLinking}
                    onClick={() => handleLinkCourse(course)}
                    className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-white flex items-center gap-2 disabled:opacity-50"
                  >
                    <BookOpen size={12} className="text-indigo-500 shrink-0" />
                    <span className="truncate">{course.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default OfferResourcesPanel;
