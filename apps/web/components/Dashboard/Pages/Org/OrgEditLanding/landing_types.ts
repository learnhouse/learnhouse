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

export interface LandingLogos {
  type: 'logos';
  logos: LandingImage[];
}

export interface LandingUsers {
  user_uuid: string;
  name: string;
  description: string;
  image_url: string;
}

export interface LandingPeople {
  type: 'people';
  title: string;
  people: LandingUsers[];
}

export interface LandingTextAndImageSection {
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

export interface LandingFeaturedCourses {
  type: 'featured-courses';
  courses: LandingCourse[];
  title: string;
}

export interface LandingHeroSection {
  type: 'hero';
  title: string;
  background: LandingBackground;
  heading: LandingHeading;
  subheading: LandingHeading;
  buttons: LandingButton[];
}

export type LandingSection = LandingTextAndImageSection | LandingHeroSection | LandingLogos | LandingPeople | LandingFeaturedCourses;

export interface LandingObject {
  sections: LandingSection[];
  enabled?: boolean;
} 