'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import posthog from 'posthog-js'
import {
  DollarSign,
  Puzzle,
  Layers,
  Sparkles,
  Users,
  BarChart3,
  Upload,
  LayoutDashboard,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  BookOpen,
} from 'lucide-react'

const POSTHOG_KEY =
  process.env.NEXT_PUBLIC_POSTHOG_KEY ?? 'phc_oIDiGAsHblRSGEK5Bx1R1QNmOpmokBEkAjutriy1Ug7'
const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com'
const SIGNUP_URL = '/auth/signup'

const PAIN_POINTS = [
  {
    icon: DollarSign,
    title: 'Every extra child costs more',
    body: "Most curriculum tools charge by the seat. Two kids? Double the bill. Three? You do the math. Your whole family should be covered at one price.",
  },
  {
    icon: Puzzle,
    title: 'Their plan, not yours',
    body: "Rigid lesson plans don't flex for how you teach or how your child learns. You need a curriculum that fits your family — not the other way around.",
  },
  {
    icon: Layers,
    title: 'Tracking progress is a mess',
    body: "Sticky notes, paper gradebooks, and spreadsheets for every child and subject. Keeping track of where everyone is shouldn't require a system of its own.",
  },
]

const STEPS = [
  {
    step: '1',
    title: 'Create your curriculum',
    body: 'Add subjects and upload your materials — or just describe a topic and let AI build a full lesson plan with readings, activities, and quizzes. You\'re in charge of what gets taught.',
  },
  {
    step: '2',
    title: 'Teach at your pace',
    body: "Assign lessons to your children, track what's done, and adjust on the fly. No rigid schedules. No locked syllabus. Just you and your family.",
  },
  {
    step: '3',
    title: 'Watch your child thrive',
    body: "See completions, quiz scores, and time-on-task — per child, per subject, per lesson — all from one dashboard. No spreadsheets required.",
  },
]

const FEATURES = [
  {
    icon: Sparkles,
    title: 'AI Curriculum Builder',
    body: 'Describe any topic and get a structured course with lessons, readings, and quizzes — ready to teach in seconds.',
  },
  {
    icon: Users,
    title: 'Unlimited Students',
    body: 'One flat price covers your whole family. Add kids as they grow. No per-seat charges, ever.',
  },
  {
    icon: BarChart3,
    title: 'Progress Tracking',
    body: 'Completions, quiz scores, and time-on-task — tracked per child, per subject, per lesson.',
  },
  {
    icon: Upload,
    title: 'Bring Your Own Materials',
    body: 'Upload PDFs, link videos, or paste in text. We wrap your existing materials in a structured, trackable lesson format.',
  },
  {
    icon: LayoutDashboard,
    title: 'Parent Dashboard',
    body: "All your children, all their subjects, one view. Attendance, grades, and what's next — no tab-switching.",
  },
]

const TESTIMONIALS = [
  {
    initials: 'SL',
    name: 'Sarah L.',
    role: 'Homeschool mom of 3',
    quote:
      'Testimonial coming soon — collecting real stories from families using LearnHouse every day.',
  },
  {
    initials: 'MK',
    name: 'Marcus K.',
    role: 'Dad, homeschooling since 2021',
    quote:
      "We're gathering reviews from families just like yours. Check back soon.",
  },
  {
    initials: 'JR',
    name: 'Jennifer R.',
    role: 'Curriculum designer & mom',
    quote:
      'Real reviews from real homeschool parents — not marketing copy. Coming soon.',
  },
]

const FAQS = [
  {
    q: 'Is there a free plan?',
    a: 'Yes. The free plan includes unlimited courses, unlimited students, and AI lesson generation. You only upgrade if you need advanced features like branded portals or priority support.',
  },
  {
    q: 'Can I add multiple children?',
    a: "Absolutely. LearnHouse is designed for families, not individual learners. Add as many children as you have — each with their own progress tracking — and pay the same flat rate.",
  },
  {
    q: 'Does it work for all grade levels?',
    a: 'Yes — from early readers through high school and beyond. The AI adapts lesson plans to the difficulty level and subjects you set for each child.',
  },
  {
    q: 'Can I use curriculum materials I already have?',
    a: "Yes. Upload PDFs, link videos, or paste in text. LearnHouse wraps your existing materials in a structured, trackable lesson format so nothing you've already made goes to waste.",
  },
  {
    q: "I'm not very tech-savvy. Will I be able to use this?",
    a: "That was the whole point when we built it. If you can send an email, you can build a curriculum in LearnHouse. No IT experience needed — just show up and start teaching.",
  },
]

export default function HomeschoolersPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      person_profiles: 'identified_only',
      capture_pageview: false,
      loaded: (ph) => {
        ph.capture('page_view', { page: '/for/homeschoolers' })
      },
    })
  }, [])

  function trackSignupStarted(location: string) {
    try {
      posthog.capture('signup_started', {
        page: '/for/homeschoolers',
        cta_location: location,
      })
    } catch {
      // never break the page
    }
  }

  return (
    <div className="min-h-screen bg-white">
      {/* ── Nav ── */}
      <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur-sm border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-semibold text-gray-900">
            <BookOpen className="w-5 h-5 text-indigo-600" />
            <span>LearnHouse</span>
          </Link>
          <Link
            href={SIGNUP_URL}
            onClick={() => trackSignupStarted('nav')}
            className="text-sm font-semibold bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Start Free
          </Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="bg-gradient-to-b from-indigo-50 to-white px-4 sm:px-6 pt-16 pb-20 sm:pt-24 sm:pb-28">
        <div className="max-w-3xl mx-auto text-center">
          <span className="inline-flex items-center gap-1.5 bg-indigo-100 text-indigo-700 text-xs font-semibold px-3 py-1 rounded-full mb-6">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Free plan · Unlimited students · No credit card required
          </span>
          <h1 className="text-3xl sm:text-5xl font-bold text-gray-900 leading-tight mb-5">
            Build a Full AI-Powered Curriculum{' '}
            <span className="text-indigo-600">for Your Child</span>
          </h1>
          <p className="text-lg sm:text-xl text-gray-600 leading-relaxed mb-8 max-w-2xl mx-auto">
            Stop juggling ten different apps for every subject. LearnHouse gives
            you one home for lessons, progress tracking, and AI-generated
            curriculum — for your whole family, at one price.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href={SIGNUP_URL}
              onClick={() => trackSignupStarted('hero_primary')}
              className="inline-flex items-center justify-center gap-2 bg-indigo-600 text-white font-semibold px-7 py-3.5 rounded-xl hover:bg-indigo-700 transition-colors text-base shadow-sm"
            >
              Start Free Today
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex items-center justify-center gap-2 bg-white text-gray-700 font-semibold px-7 py-3.5 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors text-base"
            >
              See how it works
            </a>
          </div>
        </div>
      </section>

      {/* ── Pain Section ── */}
      <section className="bg-gray-900 px-4 sm:px-6 py-16 sm:py-24">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mb-4">
            Sound familiar?
          </h2>
          <p className="text-gray-400 text-center text-base sm:text-lg mb-12 max-w-xl mx-auto">
            You didn&apos;t choose to homeschool so you could spend your evenings
            managing software.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {PAIN_POINTS.map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="bg-gray-800 rounded-2xl p-6 border border-gray-700"
              >
                <div className="w-10 h-10 bg-indigo-500/20 rounded-lg flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5 text-indigo-400" />
                </div>
                <h3 className="text-white font-semibold text-base mb-2">
                  {title}
                </h3>
                <p className="text-gray-400 text-sm leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section id="how-it-works" className="px-4 sm:px-6 py-16 sm:py-24">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 text-center mb-3">
            Simple to start. Powerful as you grow.
          </h2>
          <p className="text-gray-500 text-center text-base sm:text-lg mb-14 max-w-xl mx-auto">
            Most families have their first course running in under 15 minutes.
          </p>
          <div className="flex flex-col gap-8">
            {STEPS.map(({ step, title, body }, i) => (
              <div
                key={step}
                className="flex flex-col sm:flex-row items-start gap-5 sm:gap-8"
              >
                <div className="flex-shrink-0 w-12 h-12 rounded-2xl bg-indigo-600 text-white font-bold text-lg flex items-center justify-center shadow-sm">
                  {step}
                </div>
                <div className="flex-1 pt-1">
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    {title}
                  </h3>
                  <p className="text-gray-600 leading-relaxed text-base">
                    {body}
                  </p>
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    aria-hidden
                    className="hidden sm:block w-px bg-gray-200 self-stretch ml-6"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Feature Table ── */}
      <section className="bg-indigo-50 px-4 sm:px-6 py-16 sm:py-24">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 text-center mb-3">
            Everything your homeschool needs
          </h2>
          <p className="text-gray-500 text-center text-base sm:text-lg mb-12 max-w-xl mx-auto">
            Built for families. Not for school districts. Not for enterprise IT
            teams.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="bg-white rounded-2xl p-6 border border-indigo-100 shadow-sm"
              >
                <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5 text-indigo-600" />
                </div>
                <h3 className="text-gray-900 font-semibold text-base mb-1.5">
                  {title}
                </h3>
                <p className="text-gray-500 text-sm leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Social Proof ── */}
      <section className="px-4 sm:px-6 py-16 sm:py-24">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 text-center mb-3">
            Trusted by homeschool families
          </h2>
          <p className="text-gray-500 text-center text-base sm:text-lg mb-12 max-w-xl mx-auto">
            We&apos;re collecting real stories from families using LearnHouse
            every day. Here&apos;s what&apos;s coming.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {TESTIMONIALS.map(({ initials, name, role, quote }) => (
              <div
                key={name}
                className="rounded-2xl border border-gray-200 p-6 flex flex-col gap-4"
              >
                <p className="text-gray-600 text-sm leading-relaxed italic">
                  &ldquo;{quote}&rdquo;
                </p>
                <div className="flex items-center gap-3 mt-auto">
                  <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 font-semibold text-sm flex items-center justify-center flex-shrink-0">
                    {initials}
                  </div>
                  <div>
                    <p className="text-gray-900 text-sm font-medium">{name}</p>
                    <p className="text-gray-400 text-xs">{role}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="bg-gray-50 px-4 sm:px-6 py-16 sm:py-24">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 text-center mb-12">
            Questions from homeschool parents
          </h2>
          <div className="flex flex-col divide-y divide-gray-200">
            {FAQS.map(({ q, a }, i) => (
              <div key={q} className="py-5">
                <button
                  className="w-full flex items-start justify-between gap-4 text-left"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  aria-expanded={openFaq === i}
                >
                  <span className="font-medium text-gray-900 text-base leading-snug">
                    {q}
                  </span>
                  {openFaq === i ? (
                    <ChevronUp className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />
                  )}
                </button>
                {openFaq === i && (
                  <p className="mt-3 text-gray-600 text-sm leading-relaxed pr-8">
                    {a}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="bg-indigo-600 px-4 sm:px-6 py-16 sm:py-24">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl sm:text-4xl font-bold text-white mb-4">
            Ready to simplify your homeschool?
          </h2>
          <p className="text-indigo-200 text-base sm:text-lg mb-8 leading-relaxed">
            Set up your first course in minutes. Bring your whole family. No
            credit card required.
          </p>
          <Link
            href={SIGNUP_URL}
            onClick={() => trackSignupStarted('footer_cta')}
            className="inline-flex items-center gap-2 bg-white text-indigo-700 font-bold px-8 py-4 rounded-xl hover:bg-indigo-50 transition-colors text-base shadow-sm"
          >
            Start Free Today
          </Link>
          <p className="text-indigo-300 text-sm mt-5">
            Free plan includes unlimited students, unlimited courses, and AI
            lesson generation.
          </p>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-white border-t border-gray-100 px-4 sm:px-6 py-8">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2 text-gray-500 text-sm">
            <BookOpen className="w-4 h-4 text-indigo-600" />
            <span>LearnHouse</span>
          </Link>
          <p className="text-gray-400 text-xs">
            &copy; {new Date().getFullYear()} LearnHouse. Built for families.
          </p>
          <div className="flex items-center gap-4 text-xs text-gray-400">
            <Link href="/privacy" className="hover:text-gray-600 transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-gray-600 transition-colors">
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
