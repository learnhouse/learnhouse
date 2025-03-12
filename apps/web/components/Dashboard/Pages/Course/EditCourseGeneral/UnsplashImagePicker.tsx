import React, { useState, useEffect, useCallback } from 'react';
import { createApi } from 'unsplash-js';
import { Search, X, Cpu, Briefcase, GraduationCap, Heart, Palette, Plane, Utensils, 
  Dumbbell, Music, Shirt, Book, Building, Bike, Camera, Microscope, Coins, Coffee, Gamepad, 
  Flower} from 'lucide-react';
import Modal from '@components/Objects/StyledElements/Modal/Modal';

const unsplash = createApi({
  accessKey: process.env.NEXT_PUBLIC_UNSPLASH_ACCESS_KEY as string,
});

const IMAGES_PER_PAGE = 20;

const predefinedLabels = [
  { name: 'Nature', icon: Flower },
  { name: 'Technology', icon: Cpu },
  { name: 'Business', icon: Briefcase },
  { name: 'Education', icon: GraduationCap },
  { name: 'Health', icon: Heart },
  { name: 'Art', icon: Palette },
  { name: 'Science', icon: Microscope },
  { name: 'Travel', icon: Plane },
  { name: 'Food', icon: Utensils },
  { name: 'Sports', icon: Dumbbell },
  { name: 'Music', icon: Music },
  { name: 'Fashion', icon: Shirt },
  { name: 'History', icon: Book },
  { name: 'Architecture', icon: Building },
  { name: 'Fitness', icon: Bike },
  { name: 'Photography', icon: Camera },
  { name: 'Biology', icon: Microscope },
  { name: 'Finance', icon: Coins },
  { name: 'Lifestyle', icon: Coffee },
  { name: 'Gaming', icon: Gamepad },
];

interface UnsplashImagePickerProps {
  onSelect: (imageUrl: string) => void;
  onClose: () => void;
  isOpen?: boolean;
}

const UnsplashImagePicker: React.FC<UnsplashImagePickerProps> = ({ onSelect, onClose, isOpen = true }) => {
  const [query, setQuery] = useState('');
  const [images, setImages] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const fetchImages = useCallback(async (searchQuery: string, pageNum: number) => {
    setLoading(true);
    try {
      const result = await unsplash.search.getPhotos({
        query: searchQuery,
        page: pageNum,
        perPage: IMAGES_PER_PAGE,
      });
      if (result && result.response) {
        setImages(prevImages => pageNum === 1 ? result.response.results : [...prevImages, ...result.response.results]);
      }
    } catch (error) {
      console.error('Error fetching images:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const debouncedFetchImages = useCallback(
    debounce((searchQuery: string) => {
      setPage(1);
      fetchImages(searchQuery, 1);
    }, 300),
    [fetchImages]
  );

  useEffect(() => {
    if (query) {
      debouncedFetchImages(query);
    }
  }, [query, debouncedFetchImages]);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  };

  const handleLabelClick = (label: string) => {
    setQuery(label);
  };

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchImages(query, nextPage);
  };

  const handleImageSelect = (imageUrl: string) => {
    onSelect(imageUrl);
    onClose();
  };

  const modalContent = (
    <div className="flex flex-col h-full">
      <div className="p-4 space-y-4">
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={handleSearch}
            placeholder="Search for images..."
            className="w-full p-2 pl-10 border rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
          />
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
        </div>
        <div className="flex flex-wrap gap-2">
          {predefinedLabels.map(label => (
            <button
              key={label.name}
              onClick={() => handleLabelClick(label.name)}
              className="px-3 py-1 bg-neutral-100 rounded-lg hover:bg-neutral-200 nice-shadow transition-colors flex items-center gap-1 space-x-1"
            >
              <label.icon size={16} />
              <span>{label.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 pt-0">
        <div className="grid grid-cols-3 gap-4">
          {images.map(image => (
            <div key={image.id} className="relative w-full pb-[56.25%]">
              <img
                src={image.urls.small}
                alt={image.alt_description}
                className="absolute inset-0 w-full h-full object-cover rounded-lg cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => handleImageSelect(image.urls.regular)}
              />
            </div>
          ))}
        </div>
        {loading && <p className="text-center mt-4">Loading...</p>}
        {!loading && images.length > 0 && (
          <button
            onClick={handleLoadMore}
            className="mt-4 w-full px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            Load More
          </button>
        )}
      </div>
    </div>
  );

  return (
    <Modal
      dialogTitle="Choose an image from Unsplash"
      dialogContent={modalContent}
      onOpenChange={onClose}
      isDialogOpen={isOpen}
      minWidth="lg"
      minHeight="lg"
      customHeight="h-[80vh]"
    />
  );
};

// Custom debounce function
const debounce = (func: Function, delay: number) => {
  let timeoutId: NodeJS.Timeout;
  return (...args: any[]) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  };
};

export default UnsplashImagePicker;