'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { useOrg } from '@components/Contexts/OrgContext';
import { getUserCertificates } from '@services/courses/certifications';
import CertificatePreview from '@components/Dashboard/Pages/Course/EditCourseCertification/CertificatePreview';
import { ArrowLeft, Download, Share2, Copy, Check } from 'lucide-react';
import Link from 'next/link';
import { getUriWithOrg } from '@services/config/config';
import { useLHAnalytics, useTrackView, AnalyticsEvent } from '@services/analytics';
import {
  CERTIFICATE_CAPTURE_WIDTH,
  certificateFileName,
  downloadCertificateNodeAsPdf,
} from '@services/courses/certificateDownload';

interface CertificatePageProps {
  orgslug: string;
  courseid: string;
  qrCodeLink: string;
}

const CertificatePage: React.FC<CertificatePageProps> = ({ orgslug, courseid, qrCodeLink }) => {
  const session = useLHSession() as any;
  const org = useOrg() as any;
  const [userCertificate, setUserCertificate] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const certificateCaptureRef = useRef<HTMLDivElement>(null);
  const { track } = useLHAnalytics('learner');

  useTrackView(AnalyticsEvent.CertificateViewed, {}, !!userCertificate);

  // Recipient's display name for the certificate. Falls back through
  // full name -> username -> the session user, and is empty when unknown so
  // the "Presented to" line simply doesn't render.
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

  // Fetch user certificate
  useEffect(() => {
    const fetchCertificate = async () => {
      if (!session?.data?.tokens?.access_token) {
        setError('Authentication required to view certificate');
        setIsLoading(false);
        return;
      }

      if (!org?.id) {
        return; // Wait for org to be available
      }

      try {
        const cleanCourseId = courseid.replace('course_', '');
        const result = await getUserCertificates(
          `course_${cleanCourseId}`,
          org.id,
          session.data.tokens.access_token
        );

        if (result.success && result.data && result.data.length > 0) {
          setUserCertificate(result.data[0]);
        } else {
          setError('No certificate found for this course');
        }
      } catch (error) {
        console.error('Error fetching certificate:', error);
        setError('Failed to load certificate. Please try again later.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchCertificate();
  }, [courseid, session?.data?.tokens?.access_token, org?.id]);



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
      awardedDate: new Date(userCertificate.certificate_user.created_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      qrCodeLink,
    };
  }, [userCertificate, learnerName, qrCodeLink]);

  // Generate the PDF from the SAME <CertificatePreview> the learner sees.
  //
  // This used to build its own certificate out of a hand-written HTML string,
  // which had drifted into a different design: no pattern artwork, no org logo
  // or name, an emoji instead of the award mark, Arial instead of the app's
  // type. We now rasterise a hidden, fixed-width render of the real component
  // (`certificateCaptureRef` below), the same way CourseEndView does, so the
  // download always matches the certificate on screen.
  const downloadCertificate = async () => {
    if (!userCertificate) return;
    const node = certificateCaptureRef.current;
    if (!node) return;

    try {
      await downloadCertificateNodeAsPdf(
        node,
        certificateFileName(userCertificate.certification?.config?.certification_name),
      );

      track(AnalyticsEvent.CertificateDownloaded, {
        certification_type: userCertificate.certification.config.certification_type,
      });
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast.error('Failed to generate PDF. Please try again.');
    }
  };

  // Open LinkedIn's "Add to Profile" flow, pre-filled with the certificate details
  const shareToLinkedIn = () => {
    if (!userCertificate) return;

    const config = userCertificate.certification.config;
    const awardedAt = new Date(userCertificate.certificate_user.created_at);

    const params = new URLSearchParams({
      startTask: 'CERTIFICATION_NAME',
      name: config.certification_name,
      organizationName: org?.name || '',
      issueYear: String(awardedAt.getFullYear()),
      issueMonth: String(awardedAt.getMonth() + 1),
      certId: userCertificate.certificate_user.user_certification_uuid,
      certUrl: qrCodeLink,
    });

    window.open(
      `https://www.linkedin.com/profile/add?${params.toString()}`,
      '_blank',
      'noopener,noreferrer'
    );

    track(AnalyticsEvent.CertificateSharedLinkedin, {
      certification_name: config.certification_name,
    });
  };

  // Copy the public certificate verification link to the clipboard
  const copyVerificationLink = async () => {
    if (!qrCodeLink) return;

    try {
      await navigator.clipboard.writeText(qrCodeLink);
      setLinkCopied(true);
      toast.success('Verification link copied to clipboard');
      setTimeout(() => setLinkCopied(false), 2000);
    } catch (error) {
      console.error('Error copying verification link:', error);
      toast.error('Failed to copy link. Please try again.');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading certificate...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-6">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <h2 className="text-xl font-semibold text-red-800 mb-2">Certificate Not Available</h2>
            <p className="text-red-600 mb-4">{error}</p>
            <Link
              href={getUriWithOrg(orgslug, '') + `/course/${courseid}`}
              className="inline-flex items-center space-x-2 bg-blue-600 text-white px-6 py-3 rounded-full hover:bg-blue-700 transition duration-200"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>Back to Course</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!userCertificate) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-6">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
            <h2 className="text-xl font-semibold text-yellow-800 mb-2">No Certificate Found</h2>
            <p className="text-yellow-600 mb-4">
              No certificate is available for this course. Please contact your instructor for more information.
            </p>
            <Link
              href={getUriWithOrg(orgslug, '') + `/course/${courseid}`}
              className="inline-flex items-center space-x-2 bg-blue-600 text-white px-6 py-3 rounded-full hover:bg-blue-700 transition duration-200"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>Back to Course</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <Link
            href={getUriWithOrg(orgslug, '') + `/course/${courseid}`}
            className="inline-flex items-center space-x-2 text-gray-600 hover:text-gray-900 transition duration-200"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Back to Course</span>
          </Link>
          
          <div className="flex items-center space-x-3">
            <button
              onClick={copyVerificationLink}
              aria-label="Copy certificate verification link"
              className="inline-flex items-center space-x-2 bg-gray-100 text-gray-700 px-5 py-3 rounded-full hover:bg-gray-200 transition duration-200"
            >
              {linkCopied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
              <span>{linkCopied ? 'Copied' : 'Copy link'}</span>
            </button>
            <button
              onClick={shareToLinkedIn}
              aria-label="Add this certificate to your LinkedIn profile"
              className="inline-flex items-center space-x-2 bg-[#0a66c2] text-white px-6 py-3 rounded-full hover:bg-[#004182] transition duration-200"
            >
              <Share2 className="w-5 h-5" />
              <span>Share on LinkedIn</span>
            </button>
            <button
              onClick={downloadCertificate}
              aria-label="Download certificate as PDF"
              className="inline-flex items-center space-x-2 bg-green-600 text-white px-6 py-3 rounded-full hover:bg-green-700 transition duration-200"
            >
              <Download className="w-5 h-5" />
              <span>Download PDF</span>
            </button>
          </div>
        </div>

        {/* Certificate Display */}
        <div className="bg-white rounded-2xl shadow-lg p-8">
          <div className="max-w-2xl mx-auto">
            {certificatePreviewProps && <CertificatePreview {...certificatePreviewProps} />}
          </div>
        </div>

        {/* PDF source. Identical props to the visible certificate above, just
            pinned to a fixed width so the export is the same on every screen.
            Kept in the layout (offscreen, not display:none) because html2canvas
            cannot measure a hidden subtree. */}
        {certificatePreviewProps && (
          <div
            aria-hidden="true"
            className="pointer-events-none fixed top-0 start-0 -z-50 opacity-0"
            style={{ transform: 'translateX(-200vw)' }}
          >
            <div ref={certificateCaptureRef} style={{ width: CERTIFICATE_CAPTURE_WIDTH }}>
              <CertificatePreview {...certificatePreviewProps} />
            </div>
          </div>
        )}

        {/* Instructions */}
        <div className="mt-8 text-center text-gray-600">
          <p className="mb-2">
            Click "Download PDF" to generate and download a high-quality certificate PDF.
          </p>
          <p className="text-sm">
            The PDF includes a scannable QR code for certificate verification.
          </p>
        </div>
      </div>
    </div>
  );
};

export default CertificatePage; 