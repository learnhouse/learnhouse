import {
  LinkSimple, Globe, House, BookOpen, GraduationCap, FolderSimple, Headphones,
  ChatsCircle, Cube, ShoppingBag, Star, Heart, CalendarBlank, Newspaper, Users,
  Trophy, Lightbulb, FileText, VideoCamera, MapPin, Question, Gift, RocketLaunch, Lightning,
} from '@phosphor-icons/react'

// Curated icon set selectable for custom menu links. Keyed by a stable name
// stored on the menu item (item.icon).
export const MENU_ICONS: Record<string, any> = {
  LinkSimple, Globe, House, BookOpen, GraduationCap, FolderSimple, Headphones,
  ChatsCircle, Cube, ShoppingBag, Star, Heart, CalendarBlank, Newspaper, Users,
  Trophy, Lightbulb, FileText, VideoCamera, MapPin, Question, Gift, RocketLaunch, Lightning,
}

export const MENU_ICON_NAMES = Object.keys(MENU_ICONS)
export const DEFAULT_MENU_ICON = 'LinkSimple'

export function menuIcon(name?: string) {
  return (name && MENU_ICONS[name]) || MENU_ICONS[DEFAULT_MENU_ICON]
}
