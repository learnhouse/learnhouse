import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Search, ArrowRight, Sparkles, Book, GraduationCap, ArrowUpRight, TextSearch, ScanSearch } from 'lucide-react';
import { searchOrgCourses } from '@services/courses/courses';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import Link from 'next/link';
import { getCourseThumbnailMediaDirectory } from '@services/media/media';
import { useDebounce } from '@/hooks/useDebounce';
import { useOrg } from '@components/Contexts/OrgContext';
import { getUriWithOrg } from '@services/config/config';
import { removeCoursePrefix } from '../Thumbnails/CourseThumbnail';

interface Course {
  name: string;
  description: string;
  thumbnail_image: string;
  course_uuid: string;
  tags?: string[];
  authors: Array<{
    first_name: string;
    last_name: string;
    avatar_image: string;
  }>;
}

interface SearchBarProps {
  orgslug: string;
  className?: string;
  isMobile?: boolean;
}

const CourseResultsSkeleton = () => (
  <div className="p-2 ">
    <div className="flex items-center gap-2 px-2 py-2">
      <div className="w-4 h-4 bg-black/5 rounded animate-pulse" />
      <div className="w-20 h-4 bg-black/5 rounded animate-pulse" />
    </div>
    {[1, 2].map((i) => (
      <div key={i} className="flex items-center gap-3 p-2">
        <div className="w-10 h-10 bg-black/5 rounded-lg animate-pulse" />
        <div className="flex-1">
          <div className="w-48 h-4 bg-black/5 rounded animate-pulse mb-2" />
          <div className="w-32 h-3 bg-black/5 rounded animate-pulse" />
        </div>
      </div>
    ))}
  </div>
);

export const SearchBar: React.FC<SearchBarProps> = ({ 
  orgslug, 
  className = '', 
  isMobile = false,
}) => {
  const org = useOrg() as any;
  const [searchQuery, setSearchQuery] = useState('');
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const session = useLHSession() as any;
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // Debounce the search query value
  const debouncedSearch = useDebounce(searchQuery, 300);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const fetchCourses = async () => {
      if (debouncedSearch.trim().length === 0) {
        setCourses([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const results = await searchOrgCourses(
          orgslug,
          debouncedSearch,
          1,
          3,
          null,
          session?.data?.tokens?.access_token
        );
        setCourses(results);
      } catch (error) {
        console.error('Error searching courses:', error);
        setCourses([]);
      }
      setIsLoading(false);
      setIsInitialLoad(false);
    };

    fetchCourses();
  }, [debouncedSearch, orgslug, session?.data?.tokens?.access_token]);

  const MemoizedEmptyState = useMemo(() => {
    if (!searchQuery.trim()) {
      return (
        <div className="py-8 px-4">
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 p-3 bg-black/5 rounded-full">
              <Sparkles className="w-6 h-6 text-black/70" />
            </div>
            <h3 className="text-sm font-medium text-black/80 mb-1">
              Discover Your Next Learning Journey
            </h3>
            <p className="text-xs text-black/50 max-w-[240px]">
              Start typing to search through available content
            </p>
          </div>
        </div>
      );
    }
    return null;
  }, [searchQuery]);

  const searchTerms = useMemo(() => [
    { term: searchQuery, type: 'exact', icon: <Search size={14} className="text-black/40" /> },
    { term: `${searchQuery} courses`, type: 'courses', icon: <GraduationCap size={14} className="text-black/40" /> },
    { term: `${searchQuery} collections`, type: 'collections', icon: <Book size={14} className="text-black/40" /> },
  ], [searchQuery]);

  const MemoizedSearchSuggestions = useMemo(() => {
    if (searchQuery.trim()) {
      return (
        <div className="p-2">
          <div className="flex items-center gap-2 px-2 py-2 text-sm text-black/50">
            <ScanSearch size={16} />
            <span className="font-medium">Search suggestions</span>
          </div>
          <div className="space-y-1">
            {searchTerms.map(({ term, type, icon }) => (
              <Link
                key={`${term}-${type}`}
                href={getUriWithOrg(orgslug, `/search?q=${encodeURIComponent(term)}`)}
                className="flex items-center px-3 py-2 hover:bg-black/[0.02] rounded-lg transition-colors group"
              >
                <div className="flex items-center gap-2 flex-1">
                  {icon}
                  <span className="text-sm text-black/70">{term}</span>
                </div>
                <ArrowUpRight size={14} className="text-black/30 group-hover:text-black/50 transition-colors" />
              </Link>
            ))}
          </div>
        </div>
      );
    }
    return null;
  }, [searchQuery, searchTerms, orgslug]);

  const MemoizedCourseResults = useMemo(() => {
    if (!courses.length) return null;
    
    return (
      <div className="p-2">
        <div className="flex items-center gap-2 px-2 py-2 text-sm text-black/50">
          <TextSearch size={16} />
          <span className="font-medium">Quick Results</span>
        </div>
        {courses.map((course) => (
          <Link
            key={course.course_uuid}
            href={getUriWithOrg(orgslug, `/course/${removeCoursePrefix(course.course_uuid)}`)}
            className="flex items-center gap-3 p-2 hover:bg-black/[0.02] rounded-lg transition-colors"
          >
            <div className="relative">
              {course.thumbnail_image ? (
                <img
                  src={getCourseThumbnailMediaDirectory(org?.org_uuid, course.course_uuid, course.thumbnail_image)}
                  alt={course.name}
                  className="w-10 h-10 object-cover rounded-lg"
                />
              ) : (
                <div className="w-10 h-10 bg-black/5 rounded-lg flex items-center justify-center">
                  <Book size={20} className="text-black/40" />
                </div>
              )}
              <div className="absolute -bottom-1 -right-1 bg-white shadow-sm p-1 rounded-full">
                <GraduationCap size={11} className="text-black/60" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-black/80 truncate">{course.name}</h3>
                <span className="text-[10px] font-medium text-black/40 uppercase tracking-wide whitespace-nowrap">Course</span>
              </div>
              <p className="text-xs text-black/50 truncate">{course.description}</p>
            </div>
          </Link>
        ))}
      </div>
    );
  }, [courses, orgslug, org?.org_uuid]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setShowResults(true);
  }, []);

  return (
    <div ref={searchRef} className={`relative ${className}`}>
      <div className="relative group">
        <input
          type="text"
          value={searchQuery}
          onChange={handleSearchChange}
          onFocus={() => setShowResults(true)}
          placeholder="Search courses, users, collections..."
          className="w-full h-9 pl-11 pr-4 rounded-xl nice-shadow bg-white 
                     focus:outline-none focus:ring-1 focus:ring-black/5 focus:border-black/20 
                     text-sm placeholder:text-black/40 transition-all"
        />
        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
          <Search className="text-black/40 group-focus-within:text-black/60 transition-colors" size={18} />
        </div>
      </div>

      <div 
        className={`absolute z-50 w-full mt-2 bg-white rounded-xl nice-shadow 
                   overflow-hidden divide-y divide-black/5
                   transition-all duration-200 ease-in-out transform
                   ${showResults ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'}
                   ${isMobile ? 'max-w-full' : 'min-w-[400px]'}`}
      >
        {(!searchQuery.trim() || isInitialLoad) ? (
          MemoizedEmptyState
        ) : (
          <>
            {MemoizedSearchSuggestions}
            {isLoading ? (
              <CourseResultsSkeleton />
            ) : (
              <>
                {MemoizedCourseResults}
                {(courses.length > 0 || searchQuery.trim()) && (
                  <Link
                    href={getUriWithOrg(orgslug, `/search?q=${encodeURIComponent(searchQuery)}`)}
                    className="flex items-center justify-between px-4 py-2.5 text-xs text-black/50 hover:text-black/70 hover:bg-black/[0.02] transition-colors"
                  >
                    <span>View all results</span>
                    <ArrowRight size={14} />
                  </Link>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}; 