// Who a section is shown to. Missing means 'everyone', so landings saved
// before this field existed render exactly as they did.
export type LandingVisibility = 'everyone' | 'logged_in' | 'logged_out';

interface LandingSectionBase {
  visibility?: LandingVisibility;
}

export interface LandingBackground {
  type: 'solid' | 'gradient' | 'image';
  color?: string;
  colors?: Array<string>;
  direction?: string;
  image?: string;
}

export interface LandingTestimonialContent {
  text: string;
  author: string;
}

export interface LandingImage {
  url: string;
  alt: string;
}

export interface LandingHeading {
  text: string;
  color: string;
  size: string;
}

export interface LandingButton {
  text: string;
  link: string;
  color: string;
  background: string;
}

export interface LandingLogos extends LandingSectionBase {
  type: 'logos';
  title: string;
  logos: LandingImage[];
}

export interface LandingUsers {
  user_uuid: string;
  name: string;
  description: string;
  image_url: string;
  username?: string;
}

export interface LandingPeople extends LandingSectionBase {
  type: 'people';
  title: string;
  people: LandingUsers[];
}

export interface LandingTextAndImageSection extends LandingSectionBase {
  type: 'text-and-image';
  title: string;
  text: string;
  flow: 'left' | 'right';
  image: LandingImage;
  buttons: LandingButton[];
}

export interface LandingCourse {
  course_uuid: string;
}

export interface LandingFeaturedCourses extends LandingSectionBase {
  type: 'featured-courses';
  courses: LandingCourse[];
  title: string;
}

export interface LandingHeroSection extends LandingSectionBase {
  type: 'hero';
  title: string;
  background: LandingBackground;
  heading: LandingHeading;
  subheading: LandingHeading;
  buttons: LandingButton[];
  illustration?: {
    image: LandingImage;
    position: 'left' | 'right';
    verticalAlign: 'top' | 'center' | 'bottom';
    size: 'small' | 'medium' | 'large';
  };
  contentAlign?: 'left' | 'center' | 'right';
}

export interface LandingVideoSection extends LandingSectionBase {
  type: 'video';
  title: string;
  description: string;
  // A YouTube, Vimeo or Loom link, or a direct/uploaded video file URL.
  url: string;
}

export type LandingSection = LandingTextAndImageSection | LandingHeroSection | LandingLogos | LandingPeople | LandingFeaturedCourses | LandingVideoSection;

export interface LandingObject {
  sections: LandingSection[];
  enabled?: boolean;
} 