import React, { useMemo, useEffect, useState } from 'react';
import ReactConfetti from 'react-confetti';
import { Trophy, ArrowLeft, BookOpen, Target, Download, Shield } from 'lucide-react';
import Link from 'next/link';
import { getUriWithOrg } from '@services/config/config';
import { getCourseThumbnailMediaDirectory } from '@services/media/media';
import { useWindowSize } from 'usehooks-ts';
import { useOrg } from '@components/Contexts/OrgContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { getUserCertificates } from '@services/courses/certifications';
import CertificatePreview from '@components/Dashboard/Pages/Course/EditCourseCertification/CertificatePreview';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import QRCode from 'qrcode';

interface CourseEndViewProps {
  courseName: string;
  orgslug: string;
  courseUuid: string;
  thumbnailImage: string;
  course: any;
  trailData: any;
}

const CourseEndView: React.FC<CourseEndViewProps> = ({ 
  courseName, 
  orgslug, 
  courseUuid, 
  thumbnailImage, 
  course, 
  trailData 
}) => {
  const { width, height } = useWindowSize();
  const org = useOrg() as any;
  const session = useLHSession() as any;
  const [userCertificate, setUserCertificate] = useState<any>(null);
  const [isLoadingCertificate, setIsLoadingCertificate] = useState(false);
  const [certificateError, setCertificateError] = useState<string | null>(null);
  const qrCodeLink = getUriWithOrg(orgslug, `/certificates/${userCertificate?.certificate_user.user_certification_uuid}/verify`);



  // Check if course is actually completed
  const isCourseCompleted = useMemo(() => {
    if (!trailData || !course) return false;
    
    // Flatten all activities
    const allActivities = course.chapters.flatMap((chapter: any) => 
      chapter.activities.map((activity: any) => ({
        ...activity,
        chapterId: chapter.id
      }))
    );
    
    // Check if all activities are completed
    const isActivityDone = (activity: any) => {
      const cleanCourseUuid = course.course_uuid?.replace('course_', '');
      const run = trailData?.runs?.find(
        (run: any) => {
          const cleanRunCourseUuid = run.course?.course_uuid?.replace('course_', '');
          return cleanRunCourseUuid === cleanCourseUuid;
        }
      );
      
      if (run) {
        return run.steps.find(
          (step: any) => step.activity_id === activity.id && step.complete === true
        );
      }
      return false;
    };
    
    const totalActivities = allActivities.length;
    const completedActivities = allActivities.filter((activity: any) => isActivityDone(activity)).length;
    return totalActivities > 0 && completedActivities === totalActivities;
  }, [trailData, course]);

  // Fetch user certificate when course is completed
  useEffect(() => {
    const fetchUserCertificate = async () => {
      if (!isCourseCompleted) return;
      
      if (!session?.data?.tokens?.access_token) {
        setCertificateError('Authentication required to view certificate');
        return;
      }
      
      setIsLoadingCertificate(true);
      setCertificateError(null);
      try {
        const cleanCourseUuid = courseUuid.replace('course_', '');
        const result = await getUserCertificates(
          `course_${cleanCourseUuid}`,
          session.data.tokens.access_token
        );
        
        if (result.success && result.data && result.data.length > 0) {
          setUserCertificate(result.data[0]);
        } else {
          setCertificateError('No certificate found for this course');
        }
      } catch (error) {
        console.error('Error fetching user certificate:', error);
        setCertificateError('Failed to load certificate. Please try again later.');
      } finally {
        setIsLoadingCertificate(false);
      }
    };

    fetchUserCertificate();
  }, [isCourseCompleted, courseUuid, session?.data?.tokens?.access_token]);

  // Generate PDF using canvas
  const downloadCertificate = async () => {
    if (!userCertificate) return;

    try {
      // Create a temporary div for the certificate
      const certificateDiv = document.createElement('div');
      certificateDiv.style.position = 'absolute';
      certificateDiv.style.left = '-9999px';
      certificateDiv.style.top = '0';
      certificateDiv.style.width = '800px';
      certificateDiv.style.height = '600px';
      certificateDiv.style.background = 'white';
      certificateDiv.style.padding = '40px';
      certificateDiv.style.fontFamily = 'Arial, sans-serif';
      certificateDiv.style.textAlign = 'center';
      certificateDiv.style.display = 'flex';
      certificateDiv.style.flexDirection = 'column';
      certificateDiv.style.justifyContent = 'center';
      certificateDiv.style.alignItems = 'center';
      certificateDiv.style.position = 'relative';
      certificateDiv.style.overflow = 'hidden';

      // Get theme colors based on pattern
      const getPatternTheme = (pattern: string) => {
        switch (pattern) {
          case 'royal':
            return { primary: '#b45309', secondary: '#d97706', icon: '#d97706' };
          case 'tech':
            return { primary: '#0e7490', secondary: '#0891b2', icon: '#0891b2' };
          case 'nature':
            return { primary: '#15803d', secondary: '#16a34a', icon: '#16a34a' };
          case 'geometric':
            return { primary: '#7c3aed', secondary: '#9333ea', icon: '#9333ea' };
          case 'vintage':
            return { primary: '#c2410c', secondary: '#ea580c', icon: '#ea580c' };
          case 'waves':
            return { primary: '#1d4ed8', secondary: '#2563eb', icon: '#2563eb' };
          case 'minimal':
            return { primary: '#374151', secondary: '#4b5563', icon: '#4b5563' };
          case 'professional':
            return { primary: '#334155', secondary: '#475569', icon: '#475569' };
          case 'academic':
            return { primary: '#3730a3', secondary: '#4338ca', icon: '#4338ca' };
          case 'modern':
            return { primary: '#1d4ed8', secondary: '#2563eb', icon: '#2563eb' };
          default:
            return { primary: '#374151', secondary: '#4b5563', icon: '#4b5563' };
        }
      };

      const theme = getPatternTheme(userCertificate.certification.config.certificate_pattern);
      const certificateId = userCertificate.certificate_user.user_certification_uuid;
      const qrCodeData = qrCodeLink;

      // Generate QR code
      const qrCodeDataUrl = await QRCode.toDataURL(qrCodeData, {
        width: 120,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        },
        errorCorrectionLevel: 'M',
        type: 'image/png'
      });

      // Create certificate content
      certificateDiv.innerHTML = `
        <div style="
          position: absolute;
          top: 20px;
          left: 20px;
          font-size: 12px;
          color: ${theme.secondary};
          font-weight: 500;
        ">ID: ${certificateId}</div>
        
        <div style="
          position: absolute;
          top: 20px;
          right: 20px;
          width: 80px;
          height: 80px;
          border: 2px solid ${theme.secondary};
          border-radius: 8px;
          background: white;
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          <img src="${qrCodeDataUrl}" alt="QR Code" style="width: 100%; height: 100%; object-fit: contain;" />
        </div>
        
        <div style="
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          margin-bottom: 30px;
          font-size: 14px;
          color: ${theme.secondary};
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 1px;
        ">
          <div style="width: 24px; height: 1px; background: linear-gradient(90deg, transparent, ${theme.secondary}, transparent);"></div>
          Certificate
          <div style="width: 24px; height: 1px; background: linear-gradient(90deg, transparent, ${theme.secondary}, transparent);"></div>
        </div>
        
        <div style="
          width: 80px;
          height: 80px;
          background: linear-gradient(135deg, ${theme.icon}20 0%, ${theme.icon}40 100%);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 30px;
          font-size: 40px;
          line-height: 1;
        ">🏆</div>
        
        <div style="
          font-size: 32px;
          font-weight: bold;
          color: ${theme.primary};
          margin-bottom: 20px;
          line-height: 1.2;
          max-width: 600px;
        ">${userCertificate.certification.config.certification_name}</div>
        
        <div style="
          font-size: 18px;
          color: #6b7280;
          margin-bottom: 30px;
          line-height: 1.5;
          max-width: 500px;
        ">${userCertificate.certification.config.certification_description || 'This is to certify that the course has been successfully completed.'}</div>
        
        <div style="
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          margin: 20px 0;
        ">
          <div style="width: 8px; height: 1px; background: ${theme.secondary}; opacity: 0.5;"></div>
          <div style="width: 4px; height: 4px; background: ${theme.primary}; border-radius: 50%; opacity: 0.6;"></div>
          <div style="width: 8px; height: 1px; background: ${theme.secondary}; opacity: 0.5;"></div>
        </div>
        
        <div style="
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 16px;
          color: ${theme.primary};
          background: ${theme.icon}10;
          padding: 12px 24px;
          border-radius: 20px;
          border: 1px solid ${theme.icon}20;
          font-weight: 500;
          margin-bottom: 30px;
          white-space: nowrap;
        ">
          <span style="font-weight: bold; font-size: 18px;">✓</span>
          <span>${userCertificate.certification.config.certification_type === 'completion' ? 'Course Completion' :
            userCertificate.certification.config.certification_type === 'achievement' ? 'Achievement Based' :
            userCertificate.certification.config.certification_type === 'assessment' ? 'Assessment Based' :
            userCertificate.certification.config.certification_type === 'participation' ? 'Participation' :
            userCertificate.certification.config.certification_type === 'mastery' ? 'Skill Mastery' :
            userCertificate.certification.config.certification_type === 'professional' ? 'Professional Development' :
            userCertificate.certification.config.certification_type === 'continuing' ? 'Continuing Education' :
            userCertificate.certification.config.certification_type === 'workshop' ? 'Workshop Attendance' :
            userCertificate.certification.config.certification_type === 'specialization' ? 'Specialization' : 'Course Completion'}</span>
        </div>
        
        <div style="
          margin-top: 30px;
          padding: 24px;
          background: #f8fafc;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
          max-width: 400px;
        ">
          <div style="margin: 8px 0; font-size: 14px; color: #374151;">
            <strong style="color: ${theme.primary};">Certificate ID:</strong> ${certificateId}
          </div>
          <div style="margin: 8px 0; font-size: 14px; color: #374151;">
            <strong style="color: ${theme.primary};">Awarded:</strong> ${new Date(userCertificate.certificate_user.created_at).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })}
          </div>
          ${userCertificate.certification.config.certificate_instructor ? 
            `<div style="margin: 8px 0; font-size: 14px; color: #374151;">
              <strong style="color: ${theme.primary};">Instructor:</strong> ${userCertificate.certification.config.certificate_instructor}
            </div>` : ''
          }
        </div>
        
        <div style="
          margin-top: 20px;
          font-size: 12px;
          color: #6b7280;
        ">
          This certificate can be verified at ${qrCodeLink}
        </div>
      `;

      // Add to document temporarily
      document.body.appendChild(certificateDiv);

      // Convert to canvas
      const canvas = await html2canvas(certificateDiv, {
        width: 800,
        height: 600,
        scale: 2, // Higher resolution
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff'
      });

      // Remove temporary div
      document.body.removeChild(certificateDiv);

      // Create PDF
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('landscape', 'mm', 'a4');
      
      // Calculate dimensions to center the certificate
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = 280; // mm
      const imgHeight = 210; // mm
      
      // Center the image
      const x = (pdfWidth - imgWidth) / 2;
      const y = (pdfHeight - imgHeight) / 2;
      
      pdf.addImage(imgData, 'PNG', x, y, imgWidth, imgHeight);
      
      // Save the PDF
      const fileName = `${userCertificate.certification.config.certification_name.replace(/[^a-zA-Z0-9]/g, '_')}_Certificate.pdf`;
      pdf.save(fileName);

    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Failed to generate PDF. Please try again.');
    }
  };

  // Calculate progress for incomplete courses
  const progressInfo = useMemo(() => {
    if (!trailData || !course || isCourseCompleted) return null;
    
    const allActivities = course.chapters.flatMap((chapter: any) => 
      chapter.activities.map((activity: any) => ({
        ...activity,
        chapterId: chapter.id
      }))
    );
    
    const isActivityDone = (activity: any) => {
      const cleanCourseUuid = course.course_uuid?.replace('course_', '');
      const run = trailData?.runs?.find(
        (run: any) => {
          const cleanRunCourseUuid = run.course?.course_uuid?.replace('course_', '');
          return cleanRunCourseUuid === cleanCourseUuid;
        }
      );
      
      if (run) {
        return run.steps.find(
          (step: any) => step.activity_id === activity.id && step.complete === true
        );
      }
      return false;
    };
    
    const totalActivities = allActivities.length;
    const completedActivities = allActivities.filter((activity: any) => isActivityDone(activity)).length;
    const progressPercentage = Math.round((completedActivities / totalActivities) * 100);
    
    return {
      completed: completedActivities,
      total: totalActivities,
      percentage: progressPercentage
    };
  }, [trailData, course, isCourseCompleted]);

  if (isCourseCompleted) {
    // Show congratulations for completed course
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center text-center px-4 relative overflow-hidden">
        <div className="fixed inset-0 pointer-events-none">
          <ReactConfetti
            width={width}
            height={height}
            numberOfPieces={200}
            recycle={false}
            colors={['#6366f1', '#10b981', '#3b82f6']}
          />
        </div>
        
        <div className="bg-white rounded-2xl p-8 nice-shadow max-w-4xl w-full space-y-6 relative z-10">
          <div className="flex flex-col items-center space-y-6">
            {thumbnailImage && (
              <img
                className="w-[200px] h-[114px] rounded-lg shadow-md object-cover"
                src={`${getCourseThumbnailMediaDirectory(
                  org?.org_uuid,
                  courseUuid,
                  thumbnailImage
                )}`}
                alt={courseName}
              />
            )}
            
            <div className="bg-emerald-100 p-4 rounded-full">
              <Trophy className="w-16 h-16 text-emerald-600" />
            </div>
          </div>
          
          <h1 className="text-4xl font-bold text-gray-900">
            Congratulations! 🎉
          </h1>
          
          <p className="text-xl text-gray-600">
            You've successfully completed
            <span className="font-semibold text-gray-900"> {courseName}</span>
          </p>
          
          <p className="text-gray-500">
            Your dedication and hard work have paid off. You've mastered all the content in this course.
          </p>

          {/* Certificate Display */}
          {isLoadingCertificate ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <span className="ml-3 text-gray-600">Loading your certificate...</span>
            </div>
          ) : certificateError ? (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
              <p className="text-yellow-800">
                {certificateError}
              </p>
            </div>
          ) : userCertificate ? (
            <div className="space-y-4">
              <h2 className="text-2xl font-semibold text-gray-900">Your Certificate</h2>
              <div className="max-w-2xl mx-auto" id="certificate-preview">
                <div id="certificate-content">
                  <CertificatePreview
                    certificationName={userCertificate.certification.config.certification_name}
                    certificationDescription={userCertificate.certification.config.certification_description}
                    certificationType={userCertificate.certification.config.certification_type}
                    certificatePattern={userCertificate.certification.config.certificate_pattern}
                    certificateInstructor={userCertificate.certification.config.certificate_instructor}
                    certificateId={userCertificate.certificate_user.user_certification_uuid}
                    awardedDate={new Date(userCertificate.certificate_user.created_at).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    })}
                    qrCodeLink={qrCodeLink}
                  />
                </div>
              </div>
              <div className="flex justify-center space-x-4">
                <button
                  onClick={downloadCertificate}
                  className="inline-flex items-center space-x-2 bg-green-600 text-white px-6 py-3 rounded-full hover:bg-green-700 transition duration-200"
                >
                  <Download className="w-5 h-5" />
                  <span>Download Certificate PDF</span>
                </button>
                <Link
                  href={getUriWithOrg(orgslug, `/certificates/${userCertificate.certificate_user.user_certification_uuid}/verify`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center space-x-2 bg-blue-600 text-white px-6 py-3 rounded-full hover:bg-blue-700 transition duration-200"
                >
                  <Shield className="w-5 h-5" />
                  <span>Verify Certificate</span>
                </Link>
              </div>
            </div>
          ) : (
            <div className="bg-gray-50 rounded-lg p-6">
              <p className="text-gray-600">
                No certificate is available for this course. Contact your instructor for more information.
              </p>
            </div>
          )}

          <div className="pt-6">
            <Link
              href={getUriWithOrg(orgslug, `/course/${courseUuid.replace('course_', '')}`)}
              className="inline-flex items-center space-x-2 bg-gray-800 text-white px-6 py-3 rounded-full hover:bg-gray-700 transition duration-200"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>Back to Course</span>
            </Link>
          </div>
        </div>
      </div>
    );
  } else {
    // Show progress and encouragement for incomplete course
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center text-center px-4">
        <div className="bg-white rounded-2xl p-8 nice-shadow max-w-2xl w-full space-y-6">
          <div className="flex flex-col items-center space-y-6">
            {thumbnailImage && (
              <img
                className="w-[200px] h-[114px] rounded-lg shadow-md object-cover"
                src={`${getCourseThumbnailMediaDirectory(
                  org?.org_uuid,
                  courseUuid,
                  thumbnailImage
                )}`}
                alt={courseName}
              />
            )}
            
            <div className="bg-blue-100 p-4 rounded-full">
              <Target className="w-16 h-16 text-blue-600" />
            </div>
          </div>
          
          <h1 className="text-4xl font-bold text-gray-900">
            Keep Going! 💪
          </h1>
          
          <p className="text-xl text-gray-600">
            You're making great progress in
            <span className="font-semibold text-gray-900"> {courseName}</span>
          </p>
          
          {progressInfo && (
            <div className="bg-gray-50 rounded-lg p-6 space-y-4">
              <div className="flex items-center justify-center space-x-2">
                <BookOpen className="w-5 h-5 text-gray-600" />
                <span className="text-lg font-semibold text-gray-700">Course Progress</span>
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Progress</span>
                  <span className="font-semibold text-gray-900">{progressInfo.percentage}%</span>
                </div>
                
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div 
                    className="bg-blue-600 h-3 rounded-full transition-all duration-500"
                    style={{ width: `${progressInfo.percentage}%` }}
                  ></div>
                </div>
                
                <div className="text-sm text-gray-500">
                  {progressInfo.completed} of {progressInfo.total} activities completed
                </div>
              </div>
            </div>
          )}
          
          <p className="text-gray-500">
            You're doing great! Complete the remaining activities to unlock your course completion certificate.
          </p>

          <div className="pt-6">
            <Link
              href={getUriWithOrg(orgslug, `/course/${courseUuid.replace('course_', '')}`)}
              className="inline-flex items-center space-x-2 bg-blue-600 text-white px-6 py-3 rounded-full hover:bg-blue-700 transition duration-200"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>Continue Learning</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }
};

export default CourseEndView; 