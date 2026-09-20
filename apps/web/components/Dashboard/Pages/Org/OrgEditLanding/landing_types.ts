// Who a section is shown to. Missing means 'everyone', so landings saved
// before this field existed render exactly as they did.
export type LandingVisibility = 'everyone' | 'logged_in' | 'logged_out';

// Optional presentation settings shared by every section type. All of it is
// optional: a section without `style` renders exactly as it always has.
export interface LandingSectionStyle {
  background?: LandingBackground;
  textColor?: string;
  spacing?: 'none' | 'small' | 'medium' | 'large';
  // Becomes the element id, so buttons can link to "#pricing".
  anchor?: string;
  width?: 'normal' | 'narrow';
  titleAlign?: 'start' | 'center';
  // Played once, when the section scrolls into view.
  animation?: 'none' | 'fade' | 'slide-up';
}

interface LandingSectionBase {
  visibility?: LandingVisibility;
  style?: LandingSectionStyle;
  // Kept in the editor but not rendered on the public page.
  hidden?: boolean;
  device?: 'all' | 'desktop' | 'mobile';
  // ISO date-times (as typed into a datetime-local input). Outside the window
  // the section is not rendered, e.g. a launch banner that retires itself.
  showFrom?: string;
  showUntil?: string;
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
  // 'selected' (default) shows the picked courses; 'latest' shows the newest
  // courses the visitor can see, capped at `limit`.
  mode?: 'selected' | 'latest';
  limit?: number;
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
  height?: 'small' | 'medium' | 'large' | 'screen';
  // 0-80: darkens the background so text stays readable over a photo.
  overlay?: number;
}

export interface LandingVideoSection extends LandingSectionBase {
  type: 'video';
  title: string;
  description: string;
  // A YouTube, Vimeo or Loom link, or a direct/uploaded video file URL.
  url: string;
}

export interface LandingRichTextSection extends LandingSectionBase {
  type: 'rich-text';
  title: string;
  // Markdown.
  content: string;
  align: 'left' | 'center';
}

export interface LandingFeatureItem {
  icon: string; // emoji or short text
  title: string;
  description: string;
}

export interface LandingFeaturesSection extends LandingSectionBase {
  type: 'features';
  title: string;
  subtitle: string;
  columns: 2 | 3 | 4;
  items: LandingFeatureItem[];
}

export interface LandingStatItem {
  value: string;
  label: string;
}

export interface LandingStatsSection extends LandingSectionBase {
  type: 'stats';
  title: string;
  items: LandingStatItem[];
}

export interface LandingTestimonialItem {
  quote: string;
  author: string;
  role: string;
  image_url: string;
}

export interface LandingTestimonialsSection extends LandingSectionBase {
  type: 'testimonials';
  title: string;
  items: LandingTestimonialItem[];
}

export interface LandingFaqItem {
  question: string;
  answer: string;
}

export interface LandingFaqSection extends LandingSectionBase {
  type: 'faq';
  title: string;
  items: LandingFaqItem[];
}

export interface LandingCtaSection extends LandingSectionBase {
  type: 'cta';
  heading: string;
  text: string;
  background: LandingBackground;
  textColor: string;
  buttons: LandingButton[];
}

export interface LandingGallerySection extends LandingSectionBase {
  type: 'gallery';
  title: string;
  columns: 2 | 3 | 4;
  images: LandingImage[];
}

export interface LandingSpacerSection extends LandingSectionBase {
  type: 'spacer';
  size: 'small' | 'medium' | 'large';
  divider: boolean;
}

export interface LandingPricingPlan {
  name: string;
  price: string;
  period: string;
  description: string;
  // One feature per line.
  features: string;
  button: LandingButton;
  highlighted: boolean;
}

export interface LandingPricingSection extends LandingSectionBase {
  type: 'pricing';
  title: string;
  subtitle: string;
  plans: LandingPricingPlan[];
}

export interface LandingStepItem {
  title: string;
  description: string;
}

export interface LandingStepsSection extends LandingSectionBase {
  type: 'steps';
  title: string;
  layout: 'horizontal' | 'vertical';
  items: LandingStepItem[];
}

export interface LandingColumnItem {
  // Markdown.
  content: string;
}

export interface LandingColumnsSection extends LandingSectionBase {
  type: 'columns';
  title: string;
  items: LandingColumnItem[];
}

export interface LandingImageSection extends LandingSectionBase {
  type: 'image';
  image: LandingImage;
  caption: string;
  link: string;
  rounded: boolean;
}

export interface LandingEmbedSection extends LandingSectionBase {
  type: 'embed';
  title: string;
  url: string;
  height: number;
}

export interface LandingBannerSection extends LandingSectionBase {
  type: 'banner';
  text: string;
  linkText: string;
  link: string;
  background: string;
  textColor: string;
}

export interface LandingCountdownSection extends LandingSectionBase {
  type: 'countdown';
  heading: string;
  text: string;
  // datetime-local value.
  target: string;
  // Shown instead of the timer once the target has passed.
  doneText: string;
  buttons: LandingButton[];
}

export type LandingSection = LandingTextAndImageSection | LandingHeroSection | LandingLogos | LandingPeople | LandingFeaturedCourses | LandingVideoSection
  | LandingRichTextSection | LandingFeaturesSection | LandingStatsSection | LandingTestimonialsSection
  | LandingFaqSection | LandingCtaSection | LandingGallerySection | LandingSpacerSection
  | LandingPricingSection | LandingStepsSection | LandingColumnsSection | LandingImageSection
  | LandingEmbedSection | LandingBannerSection | LandingCountdownSection;

// Page-wide settings. Optional as a whole: a landing without it renders as before.
export interface LandingPageSettings {
  background?: LandingBackground;
  width?: 'normal' | 'wide';
  // Vertical gap between sections.
  gap?: 'none' | 'small' | 'medium';
}

export interface LandingObject {
  sections: LandingSection[];
  enabled?: boolean;
  settings?: LandingPageSettings;
} 