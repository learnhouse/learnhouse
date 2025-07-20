'use client';

import React, { useEffect, useState } from 'react';
import { getCertificateByUuid } from '@services/courses/certifications';
import CertificatePreview from '@components/Dashboard/Pages/Course/EditCourseCertification/CertificatePreview';
import { Shield, CheckCircle, XCircle, AlertTriangle, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { getUriWithOrg } from '@services/config/config';
import { getCourseThumbnailMediaDirectory } from '@services/media/media';
import { useOrg } from '@components/Contexts/OrgContext';

interface CertificateVerificationPageProps {
  certificateUuid: string;
}

const CertificateVerificationPage: React.FC<CertificateVerificationPageProps> = ({ certificateUuid }) => {
  const [certificateData, setCertificateData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<'valid' | 'invalid' | 'loading'>('loading');
  const org = useOrg() as any;

  // Fetch certificate data
  useEffect(() => {
    const fetchCertificate = async () => {
      try {
        const result = await getCertificateByUuid(certificateUuid);
        
        if (result.success && result.data) {
          setCertificateData(result.data);
          setVerificationStatus('valid');
        } else {
          setError('Certificate not found');
          setVerificationStatus('invalid');
        }
      } catch (error) {
        console.error('Error fetching certificate:', error);
        setError('Failed to verify certificate. Please try again later.');
        setVerificationStatus('invalid');
      } finally {
        setIsLoading(false);
      }
    };

    fetchCertificate();
  }, [certificateUuid]);

  const getVerificationStatusIcon = () => {
    switch (verificationStatus) {
      case 'valid':
        return <CheckCircle className="w-8 h-8 text-green-600" />;
      case 'invalid':
        return <XCircle className="w-8 h-8 text-red-600" />;
      case 'loading':
        return <AlertTriangle className="w-8 h-8 text-yellow-600" />;
      default:
        return <AlertTriangle className="w-8 h-8 text-yellow-600" />;
    }
  };

  const getVerificationStatusText = () => {
    switch (verificationStatus) {
      case 'valid':
        return 'Certificate Verified';
      case 'invalid':
        return 'Certificate Not Found';
      case 'loading':
        return 'Verifying Certificate...';
      default:
        return 'Verification Status Unknown';
    }
  };

  const getVerificationStatusColor = () => {
    switch (verificationStatus) {
      case 'valid':
        return 'text-green-600 bg-green-50 border-green-200';
      case 'invalid':
        return 'text-red-600 bg-red-50 border-red-200';
      case 'loading':
        return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      default:
        return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
        <div className="bg-white rounded-2xl p-8 nice-shadow max-w-4xl w-full space-y-6">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Verifying Certificate</h1>
            <p className="text-gray-600">Please wait while we verify the certificate...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || verificationStatus === 'invalid') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
        <div className="bg-white rounded-2xl p-8 nice-shadow max-w-2xl w-full space-y-6">
          <div className="flex flex-col items-center space-y-4">
            <div className="bg-red-100 p-4 rounded-full">
              <XCircle className="w-16 h-16 text-red-600" />
            </div>
            
            <h1 className="text-3xl font-bold text-gray-900 text-center">
              Certificate Not Found
            </h1>
            
            <p className="text-gray-600 text-center">
              The certificate with ID <span className="font-mono bg-gray-100 px-2 py-1 rounded">{certificateUuid}</span> could not be found in our system.
            </p>
            
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 w-full">
              <p className="text-red-800 text-sm">
                This could mean:
              </p>
              <ul className="text-red-700 text-sm mt-2 list-disc list-inside space-y-1">
                <li>The certificate ID is incorrect</li>
                <li>The certificate has been revoked</li>
                <li>The certificate has expired</li>
                <li>The certificate was issued by a different organization</li>
              </ul>
            </div>
            
            <div className="pt-4">
              <Link
                href="/"
                className="inline-flex items-center space-x-2 bg-gray-800 text-white px-6 py-3 rounded-full hover:bg-gray-700 transition duration-200"
              >
                <ArrowLeft className="w-5 h-5" />
                <span>Go Home</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!certificateData) {
    return null;
  }

  const qrCodeLink = getUriWithOrg(org?.org_slug || '', `/certificates/${certificateData.certificate_user.user_certification_uuid}/verify`);

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        {/* Header */}
        <div className="bg-white rounded-2xl p-6 mb-8 nice-shadow">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="bg-green-100 p-3 rounded-full">
                <Shield className="w-8 h-8 text-green-600" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Certificate Verification</h1>
                <p className="text-gray-600">Verify the authenticity of this certificate</p>
              </div>
            </div>
            
            <div className={`flex items-center space-x-3 px-4 py-2 rounded-full border ${getVerificationStatusColor()}`}>
              {getVerificationStatusIcon()}
              <span className="font-semibold">{getVerificationStatusText()}</span>
            </div>
          </div>
        </div>

        {/* Certificate Details */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Certificate Preview and Course Info */}
          <div className="lg:col-span-2 space-y-6">
            {/* Certificate Preview */}
            <div className="bg-white rounded-2xl p-6 nice-shadow">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Certificate Preview</h2>
              <div className="max-w-2xl mx-auto" id="certificate-preview">
                <CertificatePreview
                  certificationName={certificateData.certification.config.certification_name}
                  certificationDescription={certificateData.certification.config.certification_description}
                  certificationType={certificateData.certification.config.certification_type}
                  certificatePattern={certificateData.certification.config.certificate_pattern}
                  certificateInstructor={certificateData.certification.config.certificate_instructor}
                  certificateId={certificateData.certificate_user.user_certification_uuid}
                  awardedDate={new Date(certificateData.certificate_user.created_at).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })}
                  qrCodeLink={qrCodeLink}
                />
              </div>
            </div>

            {/* Course Information */}
            <div className="bg-white shadow-md shadow-gray-300/25 outline outline-1 outline-neutral-200/40 rounded-lg overflow-hidden p-4">
              <div className="flex items-start space-x-4">
                {/* Course Thumbnail */}
                <div className="flex-shrink-0">
                  <div className="w-20 h-12 bg-gray-100 rounded-lg overflow-hidden ring-1 ring-inset ring-black/10">
                    {certificateData.course.thumbnail_image ? (
                      <img
                        src={getCourseThumbnailMediaDirectory(
                          org?.org_uuid,
                          certificateData.course.course_uuid,
                          certificateData.course.thumbnail_image
                        )}
                        alt={`${certificateData.course.name} thumbnail`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-gray-200 flex items-center justify-center">
                        <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                        </svg>
                      </div>
                    )}
                  </div>
                </div>

                {/* Course Details */}
                <div className="flex-1 min-w-0">
                  <div className="space-y-1">
                    <div>
                      <h4 className="font-semibold text-gray-900 text-base leading-tight">{certificateData.course.name}</h4>
                      {certificateData.course.description && (
                        <p className="text-sm text-gray-600 line-clamp-2 mt-1">{certificateData.course.description}</p>
                      )}
                    </div>

                    {certificateData.course.authors && certificateData.course.authors.length > 0 && (
                      <div className="flex items-center space-x-1 text-sm text-neutral-400 font-normal">
                        <span>By:</span>
                        <div className="flex items-center space-x-1">
                          {certificateData.course.authors
                            .filter((author: any) => author.authorship_status === 'ACTIVE')
                            .slice(0, 2)
                            .map((author: any, index: number) => (
                              <span key={author.user.user_uuid} className="text-neutral-600">
                                {author.user.first_name} {author.user.last_name}
                                {index < Math.min(2, certificateData.course.authors.filter((a: any) => a.authorship_status === 'ACTIVE').length - 1) && ', '}
                              </span>
                            ))}
                          {certificateData.course.authors.filter((author: any) => author.authorship_status === 'ACTIVE').length > 2 && (
                            <span className="text-neutral-400">
                              +{certificateData.course.authors.filter((author: any) => author.authorship_status === 'ACTIVE').length - 2} more
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* View Course Link */}
                <div className="flex-shrink-0">
                  <Link
                    href={getUriWithOrg(org?.org_slug || '', `/course/${certificateData.course.course_uuid.replace('course_', '')}`)}
                    className="inline-flex items-center space-x-1 text-neutral-400 hover:text-neutral-600 transition-colors text-sm"
                  >
                    <span>View Course</span>
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                </div>
              </div>
            </div>
          </div>

          {/* Certificate Details */}
          <div className="space-y-6">
            <div className="bg-white rounded-2xl p-6 nice-shadow">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Certificate Information</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Certificate ID</label>
                  <div className="bg-gray-50 p-3 rounded-lg">
                    <code className="text-sm text-gray-900 break-all">
                      {certificateData.certificate_user.user_certification_uuid}
                    </code>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Course Name</label>
                  <div className="bg-gray-50 p-3 rounded-lg">
                    <span className="text-gray-900">{certificateData.course.name}</span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Certification Type</label>
                  <div className="bg-gray-50 p-3 rounded-lg">
                    <span className="text-gray-900 capitalize">
                      {certificateData.certification.config.certification_type.replace('_', ' ')}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Awarded Date</label>
                  <div className="bg-gray-50 p-3 rounded-lg">
                    <span className="text-gray-900">
                      {new Date(certificateData.certificate_user.created_at).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  </div>
                </div>

                {certificateData.certification.config.certificate_instructor && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Instructor</label>
                    <div className="bg-gray-50 p-3 rounded-lg">
                      <span className="text-gray-900">{certificateData.certification.config.certificate_instructor}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6">
              <div className="flex items-center space-x-3 mb-3">
                <Shield className="w-6 h-6 text-blue-600" />
                <h3 className="text-lg font-semibold text-blue-800">Security Information</h3>
              </div>
              <ul className="text-blue-700 text-sm space-y-2">
                <li>• Certificate verified against our secure database</li>
                <li>• QR code contains verification link</li>
                <li>• Certificate ID is cryptographically secure</li>
                <li>• Timestamp verified and authenticated</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          <Link
            href="/"
            className="inline-flex items-center space-x-2 bg-gray-800 text-white px-6 py-3 rounded-full hover:bg-gray-700 transition duration-200"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Go Home</span>
          </Link>
        </div>
      </div>
    </div>
  );
};

export default CertificateVerificationPage; 