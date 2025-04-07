'use client'; 

import React, { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { searchOrgContent } from '@services/search/search';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { useOrg } from '@components/Contexts/OrgContext';
import { Book, GraduationCap, Users, Search, Filter, X } from 'lucide-react';
import Link from 'next/link';
import { getCourseThumbnailMediaDirectory, getUserAvatarMediaDirectory } from '@services/media/media';
import { getUriWithOrg } from '@services/config/config';
import { removeCoursePrefix } from '@components/Objects/Thumbnails/CourseThumbnail';
import UserAvatar from '@components/Objects/UserAvatar';

// Types from SearchBar component
interface User {
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  avatar_image: string;
  bio: string;
  details: Record<string, any>;
  profile: Record<string, any>;
  id: number;
  user_uuid: string;
}

interface Author {
  user: User;
  authorship: string;
  authorship_status: string;
  creation_date: string;
  update_date: string;
}

interface Course {
  name: string;
  description: string;
  about: string;
  learnings: string;
  tags: string;
  thumbnail_image: string;
  public: boolean;
  open_to_contributors: boolean;
  id: number;
  org_id: number;
  authors: Author[];
  course_uuid: string;
  creation_date: string;
  update_date: string;
}

interface Collection {
  name: string;
  public: boolean;
  description: string;
  id: number;
  courses: string[];
  collection_uuid: string;
  creation_date: string;
  update_date: string;
}

interface SearchResults {
  courses: Course[];
  collections: Collection[];
  users: User[];
  total_courses: number;
  total_collections: number;
  total_users: number;
}

type ContentType = 'all' | 'courses' | 'collections' | 'users';

function SearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const session = useLHSession() as any;
  const org = useOrg() as any;
  
  // Search state
  const [searchResults, setSearchResults] = useState<SearchResults>({
    courses: [],
    collections: [],
    users: [],
    total_courses: 0,
    total_collections: 0,
    total_users: 0
  });
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  
  // URL parameters
  const query = searchParams.get('q') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const type = (searchParams.get('type') as ContentType) || 'all';
  const perPage = 9;

  // Filter state
  const [selectedType, setSelectedType] = useState<ContentType>(type);

  const updateSearchParams = (updates: Record<string, string>) => {
    const current = new URLSearchParams(Array.from(searchParams.entries()));
    Object.entries(updates).forEach(([key, value]) => {
      if (value) {
        current.set(key, value);
      } else {
        current.delete(key);
      }
    });
    router.push(`?${current.toString()}`);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      updateSearchParams({ q: searchQuery, page: '1' });
    }
  };

  useEffect(() => {
    setSearchQuery(query);
  }, [query]);

  useEffect(() => {
    const fetchResults = async () => {
      if (!query.trim()) {
        setSearchResults({
          courses: [],
          collections: [],
          users: [],
          total_courses: 0,
          total_collections: 0,
          total_users: 0
        });
        return;
      }

      setIsLoading(true);
      try {
        const response = await searchOrgContent(
          org?.slug,
          query,
          page,
          perPage,
          selectedType === 'all' ? null : selectedType,
          session?.data?.tokens?.access_token
        );

        // Log the response to see what we're getting
        console.log('Search API Response:', response);

        // The response data is directly what we need
        const results = response.data;
        
        setSearchResults({
          courses: results.courses || [],
          collections: results.collections || [],
          users: results.users || [],
          total_courses: results.courses?.length || 0,
          total_collections: results.collections?.length || 0,
          total_users: results.users?.length || 0
        });
      } catch (error) {
        console.error('Error searching content:', error);
        setSearchResults({
          courses: [],
          collections: [],
          users: [],
          total_courses: 0,
          total_collections: 0,
          total_users: 0
        });
      }
      setIsLoading(false);
    };

    fetchResults();
  }, [query, page, selectedType, org?.slug, session?.data?.tokens?.access_token]);

  const totalResults = searchResults.total_courses + searchResults.total_collections + searchResults.total_users;
  const totalPages = Math.ceil(totalResults / perPage);

  const FilterButton = ({ type, count, icon: Icon }: { type: ContentType; count: number; icon: any }) => (
    <button
      onClick={() => {
        setSelectedType(type);
        updateSearchParams({ type: type === 'all' ? '' : type, page: '1' });
      }}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors ${
        selectedType === type
          ? 'bg-black/10 text-black/80 font-medium'
          : 'hover:bg-black/5 text-black/60'
      }`}
    >
      <Icon size={16} />
      <span>{type.charAt(0).toUpperCase() + type.slice(1)}</span>
      <span className="text-black/40">({count})</span>
    </button>
  );

  const Pagination = () => {
    if (totalPages <= 1) return null;

    return (
      <div className="flex justify-center gap-2 mt-8">
        {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
          <button
            key={pageNum}
            onClick={() => updateSearchParams({ page: pageNum.toString() })}
            className={`w-8 h-8 rounded-lg text-sm transition-colors ${
              page === pageNum
                ? 'bg-black/10 text-black/80 font-medium'
                : 'hover:bg-black/5 text-black/60'
            }`}
          >
            {pageNum}
          </button>
        ))}
      </div>
    );
  };

  const LoadingState = () => (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="bg-white rounded-xl nice-shadow p-4 animate-pulse">
          <div className="w-full h-32 bg-black/5 rounded-lg mb-4" />
          <div className="space-y-2">
            <div className="w-3/4 h-4 bg-black/5 rounded" />
            <div className="w-1/2 h-3 bg-black/5 rounded" />
          </div>
        </div>
      ))}
    </div>
  );

  const EmptyState = () => (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 p-4 bg-black/5 rounded-full">
        <Search className="w-8 h-8 text-black/40" />
      </div>
      <h3 className="text-lg font-medium text-black/80 mb-2">No results found</h3>
      <p className="text-sm text-black/50 max-w-md">
        We couldn't find any matches for "{query}". Try adjusting your search terms or browse our featured content.
      </p>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Search Header */}
      <div className="bg-white border-b border-black/5">
        <div className="container mx-auto px-4 py-6">
          <div className="max-w-2xl mx-auto">
            <h1 className="text-2xl font-semibold  text-black/80 mb-6">Search</h1>
            
            {/* Search Input */}
            <form onSubmit={handleSearch} className="relative group mb-6">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search courses, users, collections..."
                className="w-full h-12 pl-12 pr-4 rounded-xl nice-shadow bg-white 
                         focus:outline-none focus:ring-1 focus:ring-black/5 focus:border-black/20 
                         text-sm placeholder:text-black/40 transition-all"
              />
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Search className="text-black/40 group-focus-within:text-black/60 transition-colors" size={20} />
              </div>
              <button
                type="submit"
                className="absolute inset-y-0 right-0 px-4 flex items-center text-sm text-black/60 hover:text-black/80"
              >
                Search
              </button>
            </form>
            
            {/* Filters */}
            <div className="flex items-center gap-2 overflow-x-auto pb-2">
              <FilterButton type="all" count={totalResults} icon={Search} />
              <FilterButton type="courses" count={searchResults.total_courses} icon={GraduationCap} />
              <FilterButton type="collections" count={searchResults.total_collections} icon={Book} />
              <FilterButton type="users" count={searchResults.total_users} icon={Users} />
            </div>
          </div>
        </div>
      </div>

      {/* Search Results */}
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-7xl mx-auto">
          {query && (
            <div className="text-sm text-black/60 mb-6">
              Found {totalResults} results for "{query}"
            </div>
          )}

          {isLoading ? (
            <LoadingState />
          ) : totalResults === 0 && query ? (
            <EmptyState />
          ) : (
            <div className="space-y-12">
              {/* Courses Grid */}
              {(selectedType === 'all' || selectedType === 'courses') && searchResults.courses.length > 0 && (
                <div>
                  <h2 className="text-lg font-medium text-black/80 mb-4 flex items-center gap-2">
                    <GraduationCap size={20} className="text-black/60" />
                    Courses ({searchResults.courses.length})
                  </h2>
                  <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {searchResults.courses.map((course) => (
                      <Link
                        key={course.course_uuid}
                        href={getUriWithOrg(org?.slug, `/course/${removeCoursePrefix(course.course_uuid)}`)}
                        className="bg-white rounded-xl nice-shadow hover:shadow-md transition-all overflow-hidden group"
                      >
                        <div className="relative h-48">
                          {course.thumbnail_image ? (
                            <img
                              src={getCourseThumbnailMediaDirectory(org?.org_uuid, course.course_uuid, course.thumbnail_image)}
                              alt={course.name}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                          ) : (
                            <div className="w-full h-full bg-black/5 flex items-center justify-center">
                              <GraduationCap size={32} className="text-black/40" />
                            </div>
                          )}
                        </div>
                        <div className="p-4">
                          <h3 className="text-sm font-medium text-black/80 mb-1">{course.name}</h3>
                          <p className="text-xs text-black/50 line-clamp-2">{course.description}</p>
                          {course.authors && course.authors.length > 0 && (
                            <div className="flex items-center gap-2 mt-3">
                              <UserAvatar
                                width={20}
                                avatar_url={course.authors[0].user.avatar_image ? getUserAvatarMediaDirectory(course.authors[0].user.user_uuid, course.authors[0].user.avatar_image) : ''}
                                predefined_avatar={course.authors[0].user.avatar_image ? undefined : 'empty'}
                                userId={course.authors[0].user.id.toString()}
                                showProfilePopup={false}
                                rounded="rounded-full"
                                backgroundColor="bg-gray-100"
                              />
                              <span className="text-xs text-black/40">
                                {course.authors[0].user.first_name} {course.authors[0].user.last_name}
                              </span>
                            </div>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Collections Grid */}
              {(selectedType === 'all' || selectedType === 'collections') && searchResults.collections.length > 0 && (
                <div>
                  <h2 className="text-lg font-medium text-black/80 mb-4 flex items-center gap-2">
                    <Book size={20} className="text-black/60" />
                    Collections ({searchResults.collections.length})
                  </h2>
                  <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {searchResults.collections.map((collection) => (
                      <Link
                        key={collection.collection_uuid}
                        href={getUriWithOrg(org?.slug, `/collection/${collection.collection_uuid.replace('collection_', '')}`)}
                        className="flex items-start gap-4 p-4 bg-white rounded-xl nice-shadow hover:shadow-md transition-all"
                      >
                        <div className="w-12 h-12 bg-black/5 rounded-lg flex items-center justify-center flex-shrink-0">
                          <Book size={24} className="text-black/40" />
                        </div>
                        <div>
                          <h3 className="text-sm font-medium text-black/80 mb-1">{collection.name}</h3>
                          <p className="text-xs text-black/50 line-clamp-2">{collection.description}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Users Grid */}
              {(selectedType === 'all' || selectedType === 'users') && searchResults.users.length > 0 && (
                <div>
                  <h2 className="text-lg font-medium text-black/80 mb-4 flex items-center gap-2">
                    <Users size={20} className="text-black/60" />
                    Users ({searchResults.users.length})
                  </h2>
                  <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {searchResults.users.map((user) => (
                      <Link
                        key={user.user_uuid}
                        href={getUriWithOrg(org?.slug, `/user/${user.username}`)}
                        className="flex items-center gap-4 p-4 bg-white rounded-xl nice-shadow hover:shadow-md transition-all"
                      >
                        <UserAvatar
                          width={48}
                          avatar_url={user.avatar_image ? getUserAvatarMediaDirectory(user.user_uuid, user.avatar_image) : ''}
                          predefined_avatar={user.avatar_image ? undefined : 'empty'}
                          userId={user.id.toString()}
                          showProfilePopup
                          rounded="rounded-full"
                          backgroundColor="bg-gray-100"
                        />
                        <div>
                          <h3 className="text-sm font-medium text-black/80">
                            {user.first_name} {user.last_name}
                          </h3>
                          <p className="text-xs text-black/50">@{user.username}</p>
                          {user.details?.title?.text && (
                            <p className="text-xs text-black/40 mt-1">{user.details.title.text}</p>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <Pagination />
        </div>
      </div>
    </div>
  );
}

export default SearchPage;