/**
 * The landing page icon set (mirror of ICONS in apps/api/src/services/landing/schema.py;
 * tests/landing-model.test.ts checks both lists match). Only these icons are
 * bundled, never the whole icon library.
 */
import type { Icon } from '@phosphor-icons/react'
import { ArrowRight, ArrowUpRight, BookOpen, GraduationCap, Certificate, Users, UsersThree, ChalkboardTeacher, Lightning, Star, Heart, Check, CheckCircle, Clock, Calendar, Globe, Rocket, Target, Trophy, Medal, ChartLineUp, ChatCircle, ChatsCircle, Play, PlayCircle, VideoCamera, Headphones, Microphone, Laptop, DeviceMobile, Code, Palette, PaintBrush, Lightbulb, Brain, Sparkle, ShieldCheck, Lock, Gift, Tag, CurrencyDollar, Briefcase, Buildings, MapPin, Envelope, Phone, Question, Info, Leaf, Sun, Moon, Flame, Mountains, Compass, Books, Notebook, PencilSimple, Exam, Student, Handshake, HandHeart, Smiley, Infinity as InfinityIcon, Lifebuoy, Crown, Seal, Quotes, ListChecks, Path, Circuitry, Garage, InstagramLogo, XLogo, LinkedinLogo, YoutubeLogo, FacebookLogo, TiktokLogo, GithubLogo, DiscordLogo } from '@phosphor-icons/react'

export const LANDING_ICONS: Record<string, Icon> = { ArrowRight, ArrowUpRight, BookOpen, GraduationCap, Certificate, Users, UsersThree, ChalkboardTeacher, Lightning, Star, Heart, Check, CheckCircle, Clock, Calendar, Globe, Rocket, Target, Trophy, Medal, ChartLineUp, ChatCircle, ChatsCircle, Play, PlayCircle, VideoCamera, Headphones, Microphone, Laptop, DeviceMobile, Code, Palette, PaintBrush, Lightbulb, Brain, Sparkle, ShieldCheck, Lock, Gift, Tag, CurrencyDollar, Briefcase, Buildings, MapPin, Envelope, Phone, Question, Info, Leaf, Sun, Moon, Flame, Mountains, Compass, Books, Notebook, PencilSimple, Exam, Student, Handshake, HandHeart, Smiley, Infinity: InfinityIcon, Lifebuoy, Crown, Seal, Quotes, ListChecks, Path, Circuitry, Garage, InstagramLogo, XLogo, LinkedinLogo, YoutubeLogo, FacebookLogo, TiktokLogo, GithubLogo, DiscordLogo }

export const LANDING_ICON_NAMES = Object.keys(LANDING_ICONS)
