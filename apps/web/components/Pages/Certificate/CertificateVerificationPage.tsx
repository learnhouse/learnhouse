'use client';

import React, { useEffect, useState } from 'react';
import { getCertificateByUuid } from '@services/courses/certifications';
import CertificatePreview from '@components/Dashboard/Pages/Course/EditCourseCertification/CertificatePreview';
import { Shield, CheckCircle, XCircle, AlertTriangle, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { getUriWithOrg } from '@services/config/config';
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
          {/* Certificate Preview */}
          <div className="lg:col-span-2">
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