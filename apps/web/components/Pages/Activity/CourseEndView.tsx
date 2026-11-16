import React, { useMemo, useEffect, useState, useRef } from 'react';
import toast from 'react-hot-toast';
import dynamic from 'next/dynamic';
const ReactConfetti = dynamic(() => import('react-confetti'), { ssr: false });
import {
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  Certificate,
  CheckCircle,
  Circle,
  CircleHalf,
  DownloadSimple,
  ShareNetwork,
  ShieldCheck,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { getUriWithOrg, getAbsoluteUriWithOrg } from '@services/config/config';
import { getCourseThumbnailMediaDirectory } from '@services/media/media';
import { useWindowSize } from 'usehooks-ts';
import { useOrg } from '@components/Contexts/OrgContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { getUserCertificates } from '@services/courses/certifications';
import { useContentLanguage } from '@/hooks/useContentLanguage'
import { useCourseCertification } from '@components/Hooks/useCourseCertification';
import CertificatePreview from '@components/Dashboard/Pages/Course/EditCourseCertification/CertificatePreview';
import {
  downloadCertificateNodeAsPdf,
  certificateFileName,
  CERTIFICATE_CAPTURE_WIDTH,
} from '@services/courses/certificateDownload';
import { useTranslation } from 'react-i18next';
import { courseEndFlags, getCourseEndConfig, resolveCourseEndButton, resolveSecondaryButton, type CourseEndButton } from './courseEndConfig';
import { getCourseEndProgress } from './courseEndProgress';
import ThumbnailImage from '@components/Objects/Thumbnails/ThumbnailImage';
import { useMyPaths } from '@/hooks/queries/usePaths';
import { coursePath } from '@/lib/seo/paths';
import { Panel, Skeleton, buttonClass } from '@/design';
import CompanyContextChip from '@ee/components/Companies/CompanyContextChip'

interface CourseEndViewProps {
  courseName: string;
  orgslug: string;
  courseUuid: string;
  thumbnailImage: string;
  course: any;
  trailData: any;
}

// The API stores "2026-11-04 22:54:15.878736"; Safari needs the "T".
const parseApiDate = (value: unknown): Date | null => {
  if (!value) return null;
  const d = new Date(String(value).replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
};

const CourseEndView: React.FC<CourseEndViewProps> = ({
  courseName,
  orgslug,
  courseUuid,
  thumbnailImage,
  course,
  trailData
}) => {
  const { t, i18n } = useTranslation();
  const { width, height } = useWindowSize();
  const org = useOrg() as any;
  const session = useLHSession() as any;
  const [userCertificate, setUserCertificate] = useState<any>(null);
  const [isLoadingCertificate, setIsLoadingCertificate] = useState(false);
  const [certificateError, setCertificateError] = useState<string | null>(null);
  // Offscreen, fixed-width render of the certificate used as the PDF source.
  // The visible copy is fluid (narrower on mobile), so capturing it directly
  // would make the exported file depend on the viewer's screen.
  const certificateCaptureRef = useRef<HTMLDivElement>(null);

  // This course's completion screen (course editor → Certification tab),
  // falling back to the organization-level config, then to the defaults.
  const courseEndConfig = getCourseEndConfig(org, course);
  const courseEndTitle = (courseEndConfig.title || '').trim();
  const courseEndMessage = (courseEndConfig.message || '').trim();
  const { confetti: showConfetti, backButton: showBackButton } = courseEndFlags(courseEndConfig);
  const nextButton = resolveCourseEndButton(courseEndConfig);
  const nextButtonLabel = nextButton.text || t('courses.browse_all_courses');
  const secondaryButton = resolveSecondaryButton(courseEndConfig);

  const courseHref = getUriWithOrg(orgslug, coursePath({ slug: course?.slug, course_uuid: courseUuid }));
  const cleanCourseUuid = courseUuid.replace('course_', '');

  // Certificate copy is hidden only when this course definitively has no
  // certification. While the answer is loading (or if the request failed)
  // we keep the certificate UI, so a blip never tells a certified course's
  // students that no certificate is coming.
  const {
    isEnabled: certificationEnabled,
    isUnknown: certificationUnknown,
    isLoading: isLoadingCertificationStatus,
  } = useCourseCertification(courseUuid);
  const showCertificateUI = certificationEnabled || certificationUnknown;

  // Recipient's display name for the certificate (full name -> username ->
  // session user). Empty when unknown so the "Presented to" line is skipped.
  const getLearnerName = (): string => {
    const u = userCertificate?.user;
    const full = [u?.first_name, u?.last_name].filter(Boolean).join(' ').trim();
    if (full) return full;
    if (u?.username) return u.username;
    const s = session?.data?.user;
    const sessionFull = [s?.first_name, s?.last_name].filter(Boolean).join(' ').trim();
    return sessionFull || s?.username || '';
  };
  const learnerName = getLearnerName();
  const certificateUuid = userCertificate?.certificate_user?.user_certification_uuid;
  const verifyPath = `/certificates/${certificateUuid}/verify`;
  // Absolute: encoded in the QR code on the certificate PDF, scanned outside the app
  const qrCodeLink = getAbsoluteUriWithOrg(orgslug, verifyPath);

  // Done / total, per chapter, the first unfinished activity and when the
  // last one was finished: all from the structure + trail already loaded.
  const progress = useMemo(() => getCourseEndProgress(course, trailData), [course, trailData]);
  const isCourseCompleted = !!trailData && progress.completed;

  // Course name on the certificate in the learner's content language (published translation).
  const contentLang = useContentLanguage();

  // Fetch user certificate when course is completed
  useEffect(() => {
    const fetchUserCertificate = async () => {
      if (!isCourseCompleted || !contentLang.ready) return;

      // Nothing to fetch until we know the course certifies at all, and
      // nothing to fetch ever if it does not.
      if (isLoadingCertificationStatus || !showCertificateUI) return;

      if (!session?.data?.tokens?.access_token) {
        setCertificateError(t('auth.authenticate_to_contribute')); // Reusing an auth error key
        return;
      }

      if (!org?.id) {
        return; // Wait for org to be available
      }

      setIsLoadingCertificate(true);
      setCertificateError(null);
      try {
        const result = await getUserCertificates(
          `course_${cleanCourseUuid}`,
          org.id,
          session.data.tokens.access_token,
          contentLang.lang || undefined
        );

        if (result.success && result.data && result.data.length > 0) {
          setUserCertificate(result.data[0]);
        } else {
          setCertificateError(t('certificate.no_certificate'));
        }
      } catch (error) {
        console.error('Error fetching user certificate:', error);
        setCertificateError(t('certificate.failed_load_certificates'));
      } finally {
        setIsLoadingCertificate(false);
      }
    };

    fetchUserCertificate();
  }, [isCourseCompleted, cleanCourseUuid, session?.data?.tokens?.access_token, org?.id, isLoadingCertificationStatus, showCertificateUI, contentLang.lang, contentLang.ready]);

  // The PDF is rasterised from a hidden, fixed-width render of the same
  // <CertificatePreview> the learner sees (see `certificateCaptureRef`), so
  // the download always matches the on-screen and admin-preview certificate.
  const downloadCertificate = async () => {
    if (!userCertificate) return;
    const node = certificateCaptureRef.current;
    if (!node) return;

    try {
      await downloadCertificateNodeAsPdf(
        node,
        certificateFileName(userCertificate.certification?.config?.certification_name),
      );
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast.error(t('certificate.download_failed', 'Failed to generate PDF. Please try again.'));
    }
  };

  // Native share sheet where there is one (phones), else copy the public
  // verification link.
  const shareCertificate = async () => {
    if (!certificateUuid) return;
    const title = userCertificate?.certification?.config?.certification_name || courseName;
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    if (nav?.share) {
      try {
        await nav.share({ title, url: qrCodeLink });
        return;
      } catch (error: any) {
        if (error?.name === 'AbortError') return;
      }
    }
    try {
      await nav?.clipboard?.writeText(qrCodeLink);
      toast.success(t('certificate.user_page.link_copied_toast'));
    } catch {
      toast.error(t('certificate.user_page.copy_failed'));
    }
  };

  // Single source of truth for the certificate's contents. Both the visible
  // certificate and the offscreen one we rasterise into the PDF are rendered
  // from this, so they cannot drift apart.
  const certificatePreviewProps = useMemo(() => {
    if (!userCertificate) return null;
    const config = userCertificate.certification?.config || {};
    return {
      certificationName: config.certification_name,
      certificationDescription: config.certification_description,
      certificationType: config.certification_type,
      certificatePattern: config.certificate_pattern,
      certificateInstructor: config.certificate_instructor,
      certificateId: userCertificate.certificate_user.user_certification_uuid,
      learnerName,
      awardedDate: new Date(userCertificate.certificate_user.created_at).toLocaleDateString(
        i18n.language === 'fr' ? 'fr-FR' : 'en-US',
        { year: 'numeric', month: 'long', day: 'numeric' },
      ),
      qrCodeLink,
    };
  }, [userCertificate, learnerName, qrCodeLink, i18n.language]);

  // "Completed on …": the certificate's award date, else the last finished activity.
  const completedOn = useMemo(() => {
    const date = parseApiDate(userCertificate?.certificate_user?.created_at) || progress.completedAt;
    if (!date) return null;
    try {
      return new Intl.DateTimeFormat(i18n.language || undefined, { dateStyle: 'long' }).format(date);
    } catch {
      return date.toLocaleDateString();
    }
  }, [userCertificate, progress.completedAt, i18n.language]);

  // Next course in a learning path that contains this one (Paths orgs only).
  const pathsEnabled = org?.config?.config?.resolved_features?.paths?.enabled === true;
  const { data: myPaths } = useMyPaths(isCourseCompleted && pathsEnabled ? org?.id : undefined);
  const nextInPath = useMemo(() => {
    if (!Array.isArray(myPaths)) return null;
    for (const path of myPaths) {
      const items = Array.isArray(path.courses) ? path.courses : [];
      if (!items.some((c) => String(c.course_uuid).replace('course_', '') === cleanCourseUuid)) continue;
      const next = items.find(
        (c) => !c.completed && !c.locked && String(c.course_uuid).replace('course_', '') !== cleanCourseUuid,
      );
      if (next?.course) return { name: next.course.name || '', path: coursePath(next.course) };
    }
    return null;
  }, [myPaths, cleanCourseUuid]);

  // One short, subtle burst when the screen opens; none for reduced motion.
  const [confettiOn, setConfettiOn] = useState(false);
  const [confettiColors, setConfettiColors] = useState<string[]>(['#171717', '#a3a3a3', '#e5e5e5']);
  useEffect(() => {
    if (!isCourseCompleted || !showConfetti) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const root = document.querySelector('.lh-theme') || document.documentElement;
    const accent = getComputedStyle(root).getPropertyValue('--lh-accent').trim();
    if (accent) setConfettiColors([accent, '#a3a3a3', '#e5e5e5']);
    setConfettiOn(true);
  }, [isCourseCompleted, showConfetti]);

  const thumbnailSrc = thumbnailImage
    ? getCourseThumbnailMediaDirectory(org?.org_uuid, courseUuid, thumbnailImage)
    : null;

  const header = (eyebrow: React.ReactNode, meta: React.ReactNode) => (
    <>
    {/* Back to the company space this course was opened from (EE). */}
    <CompanyContextChip orgslug={orgslug} className="self-start" />
    <header className="flex items-center gap-3 sm:gap-4 min-w-0">
      <ThumbnailImage
        src={thumbnailSrc}
        alt=""
        loading="eager"
        className="w-24 h-[54px] sm:w-32 sm:h-[72px] shrink-0 rounded-lg sm:rounded-xl ring-1 ring-black/5 bg-neutral-100"
      />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-lh-accent-ink">{eyebrow}</p>
        <h1 className="mt-0.5 text-lg sm:text-2xl font-bold tracking-tight text-neutral-900 leading-snug line-clamp-2 break-words">
          <bdi>{courseName}</bdi>
        </h1>
        {meta && <p className="mt-0.5 text-[13px] text-neutral-500">{meta}</p>}
      </div>
    </header>
    </>
  );

  const linkButton = (button: CourseEndButton, label: string, variant: 'primary' | 'secondary') => {
    const cls = buttonClass(variant, 'lg', 'max-w-full min-w-0');
    const content = (
      <>
        <span className="truncate">{label}</span>
        {button.external ? (
          <ArrowSquareOut size={16} className="shrink-0" />
        ) : (
          <ArrowRight size={16} className="shrink-0 rtl:rotate-180" />
        )}
      </>
    );
    return button.external ? (
      <a key={label} href={button.href} target="_blank" rel="noopener noreferrer" className={cls}>
        {content}
      </a>
    ) : (
      <Link key={label} href={getUriWithOrg(orgslug, button.href)} className={cls}>
        {content}
      </Link>
    );
  };

  // Decorative fine dot grid behind the header, fading out downwards.
  const backdrop = (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 h-64 -z-10"
      style={{
        backgroundImage: 'radial-gradient(rgba(0,0,0,0.12) 1px, transparent 1.2px)',
        backgroundSize: '14px 14px',
        backgroundPosition: 'center top',
        maskImage: 'radial-gradient(90% 100% at 50% 0%, black 0%, transparent 70%)',
        WebkitMaskImage: 'radial-gradient(90% 100% at 50% 0%, black 0%, transparent 70%)',
      }}
    />
  );

  if (isCourseCompleted) {
    const hasCertificate = !!(userCertificate && certificatePreviewProps);
    const onward: React.ReactNode[] = [];
    // One primary per view: the PDF when there is a certificate, else the
    // first way onward.
    if (nextInPath) {
      onward.push(linkButton({ text: nextInPath.name, href: nextInPath.path, external: false }, t('trail.paths.next', { defaultValue: 'Next: {{name}}', name: nextInPath.name }), hasCertificate ? 'secondary' : 'primary'));
    }
    onward.push(linkButton(nextButton, nextButtonLabel, hasCertificate || nextInPath ? 'secondary' : 'primary'));
    if (secondaryButton) onward.push(linkButton(secondaryButton, secondaryButton.text, 'secondary'));

    return (
      <div className="relative isolate w-full">
        {backdrop}
        {confettiOn && (
          <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 'var(--z-overlay)' }}>
            <ReactConfetti
              width={width}
              height={height}
              numberOfPieces={70}
              recycle={false}
              gravity={0.22}
              tweenDuration={2500}
              confettiSource={{ x: width / 2 - 160, y: -10, w: 320, h: 0 }}
              colors={confettiColors}
              onConfettiComplete={() => setConfettiOn(false)}
            />
          </div>
        )}

        <div className="mx-auto w-full max-w-2xl flex flex-col gap-5 pt-2 pb-10 sm:pt-10">
          {header(
            <>
              <CheckCircle size={14} weight="fill" className="shrink-0" />
              <span className="truncate" dir="auto">{courseEndTitle || t('courses.end.completed', 'Course completed')}</span>
            </>,
            completedOn ? t('courses.end.completed_on', { defaultValue: 'Completed on {{date}}', date: completedOn }) : null,
          )}

          {courseEndMessage && (
            <blockquote className="border-s-2 border-neutral-200 ps-4 text-sm leading-relaxed text-neutral-600 whitespace-pre-line break-words">
              <bdi>{courseEndMessage}</bdi>
            </blockquote>
          )}

          {/* Courses without certification skip this block entirely: no
              placeholder, no "no certificate" box for something never offered. */}
          {showCertificateUI && (
            isLoadingCertificate || isLoadingCertificationStatus ? (
              <Panel className="lh-t-card overflow-hidden">
                <span className="sr-only" role="status">{t('certificate.loading_certificate')}</span>
                <div className="bg-neutral-50 p-3 sm:p-6">
                  <Skeleton className="mx-auto w-full max-w-xl aspect-[1.414] rounded-sm" />
                </div>
                <div className="flex items-center gap-3 p-4 sm:px-5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="ms-auto h-9 w-28 rounded-xl" />
                </div>
              </Panel>
            ) : hasCertificate ? (
              <Panel className="lh-t-card overflow-hidden">
                <div className="bg-neutral-50 border-b border-neutral-100 p-3 sm:p-6">
                  <div className="mx-auto max-w-xl rounded-sm overflow-hidden shadow-sm ring-1 ring-black/5">
                    <CertificatePreview {...certificatePreviewProps!} />
                  </div>
                </div>
                {/* PDF source. Identical props to the visible certificate above,
                    just pinned to a fixed width so the export is the same on
                    every screen. Kept in the layout (offscreen, not display:none)
                    because html2canvas cannot measure a hidden subtree. */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none fixed top-0 start-0 -z-50 opacity-0"
                  style={{ transform: 'translateX(-200vw)' }}
                >
                  <div ref={certificateCaptureRef} style={{ width: CERTIFICATE_CAPTURE_WIDTH }}>
                    <CertificatePreview {...certificatePreviewProps!} />
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 sm:px-5">
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <span className="w-8 h-8 rounded-lg bg-lh-accent-soft text-lh-accent-ink lh-t-tile flex items-center justify-center shrink-0">
                      <Certificate size={16} />
                    </span>
                    <p className="text-sm font-semibold text-neutral-900 truncate">
                      <bdi>{userCertificate.certification?.config?.certification_name || courseName}</bdi>
                    </p>
                  </div>
                  <div className="grid grid-cols-2 sm:flex gap-2">
                    <button type="button" onClick={downloadCertificate} className={buttonClass('primary', 'lg', 'col-span-2 px-3 sm:px-4')}>
                      <DownloadSimple size={16} weight="bold" className="shrink-0" />
                      <span className="truncate">{t('certificate.page.download')}</span>
                    </button>
                    <button type="button" onClick={shareCertificate} className={buttonClass('secondary', 'lg', 'px-3 sm:px-4')}>
                      <ShareNetwork size={16} className="shrink-0" />
                      <span className="truncate">{t('courses.end.share', 'Share')}</span>
                    </button>
                    <Link href={getUriWithOrg(orgslug, verifyPath)} className={buttonClass('secondary', 'lg', 'px-3 sm:px-4')}>
                      <ShieldCheck size={16} className="shrink-0" />
                      <span className="truncate">{t('certificate.verify')}</span>
                    </Link>
                  </div>
                </div>
              </Panel>
            ) : (
              <Panel padded className="lh-t-card flex items-center gap-3">
                <span className="w-9 h-9 rounded-xl bg-neutral-100 text-neutral-500 flex items-center justify-center shrink-0">
                  <Certificate size={18} />
                </span>
                <p className="text-sm text-neutral-600">
                  {certificateError || t('certificate.no_certificate_available')}
                </p>
              </Panel>
            )
          )}

          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 pt-1">
            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:order-2 sm:ms-auto min-w-0">
              {onward}
            </div>
            {showBackButton && (
              <Link href={courseHref} className={buttonClass('ghost', 'lg', 'sm:order-1 sm:-ms-2')}>
                <ArrowLeft size={16} className="shrink-0 rtl:rotate-180" />
                <span>{t('courses.back_to_course')}</span>
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  // In progress: where the learner stands and the one thing to do next.
  const next = progress.next;
  const nextHref = next
    ? getUriWithOrg(orgslug, `/course/${cleanCourseUuid}/activity/${next.activityId}`)
    : courseHref;

  return (
    <div className="relative isolate w-full">
      {backdrop}
      <div className="mx-auto w-full max-w-2xl flex flex-col gap-5 pt-2 pb-10 sm:pt-10">
        {header(
          <span>{t('trail.courses.in_progress', 'In progress')}</span>,
          t('courses.completed_of', { completed: progress.done, total: progress.total }),
        )}

        <Panel className="lh-t-card p-4 sm:p-5 flex flex-col gap-4">
          <div className="flex items-end justify-between gap-3">
            <div className="text-[26px] font-bold leading-none tracking-tight tabular-nums text-neutral-900">
              {progress.percent}%
            </div>
            {showCertificateUI && (
              <p className="flex items-center gap-1.5 text-xs text-neutral-500 text-end">
                <Certificate size={14} className="shrink-0" />
                <span>{t('courses.unlock_certificate_message')}</span>
              </p>
            )}
          </div>
          <div
            role="progressbar"
            aria-label={t('courses.course_progress')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress.percent}
            className="h-2 w-full rounded-full bg-neutral-100 overflow-hidden"
          >
            <div
              className="lh-t-progress h-full rounded-full bg-lh-accent transition-[width] duration-500 ease-lh-out"
              style={{ width: `${progress.percent}%` }}
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <Link href={nextHref} className={buttonClass('primary', 'lg', 'min-w-0 max-w-full sm:max-w-[70%]')}>
              <span className="truncate" dir="auto">
                {next
                  ? t('courses.end.continue_to', { defaultValue: 'Continue: {{name}}', name: next.name })
                  : t('courses.continue_learning')}
              </span>
              <ArrowRight size={16} className="shrink-0 rtl:rotate-180" />
            </Link>
            {next && (
              <Link href={courseHref} className={buttonClass('secondary', 'lg')}>
                <ArrowLeft size={16} className="shrink-0 rtl:rotate-180" />
                <span>{t('courses.back_to_course')}</span>
              </Link>
            )}
          </div>
        </Panel>

        {progress.chapters.length > 0 && (
          <Panel as="ol" divided className="lh-t-card" aria-label={t('courses.chapters')}>
            {progress.chapters.map((chapter, index) => {
              const finished = chapter.total > 0 && chapter.done === chapter.total;
              const isNext = !!next && next.chapterIndex === index;
              return (
                <li key={chapter.id} className="flex items-center gap-3 px-4 sm:px-5 py-3 min-w-0">
                  {finished ? (
                    <CheckCircle size={18} weight="fill" className="shrink-0 text-lh-accent-ink lh-t-accent" />
                  ) : chapter.done > 0 ? (
                    <CircleHalf size={18} weight="fill" className="shrink-0 text-neutral-400" />
                  ) : (
                    <Circle size={18} className={`shrink-0 ${isNext ? 'text-lh-accent-ink lh-t-accent' : 'text-neutral-300'}`} />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm truncate ${finished ? 'text-neutral-500' : 'font-medium text-neutral-900'}`}>
                      <bdi>{chapter.name || t('trail.continue.chapter', { n: index + 1 })}</bdi>
                    </p>
                    {isNext && next && (
                      <Link
                        href={nextHref}
                        className="mt-0.5 flex items-center gap-1 text-xs font-medium text-lh-accent-ink lh-t-link min-w-0"
                      >
                        <span className="shrink-0">{t('courses.end.up_next', 'Up next')}:</span>
                        <span dir="auto" className="truncate">{next.name}</span>
                      </Link>
                    )}
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-neutral-400">
                    {chapter.done}/{chapter.total}
                  </span>
                </li>
              );
            })}
          </Panel>
        )}
      </div>
    </div>
  );
};

export default CourseEndView;
