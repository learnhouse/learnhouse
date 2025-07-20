import React, { useEffect, useState } from 'react';
import { Award, CheckCircle, QrCode, Building, User, Calendar, Hash } from 'lucide-react';
import QRCode from 'qrcode';
import { useOrg } from '@components/Contexts/OrgContext';
import { getOrgLogoMediaDirectory } from '@services/media/media';

interface CertificatePreviewProps {
  certificationName: string;
  certificationDescription: string;
  certificationType: string;
  certificatePattern: string;
  certificateInstructor?: string;
  certificateId?: string;
  awardedDate?: string;
  qrCodeLink?: string;
}

const CertificatePreview: React.FC<CertificatePreviewProps> = ({
  certificationName,
  certificationDescription,
  certificationType,
  certificatePattern,
  certificateInstructor,
  certificateId,
  awardedDate,
  qrCodeLink
}) => {
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const org = useOrg() as any;

  // Generate QR code
  useEffect(() => {
    const generateQRCode = async () => {
      try {
        const certificateData = qrCodeLink || `${certificateId}`;
        const qrUrl = await QRCode.toDataURL(certificateData, {
          width: 185,
          margin: 1,
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          },
          errorCorrectionLevel: 'M',
          type: 'image/png'
        });
        setQrCodeUrl(qrUrl);
      } catch (error) {
        console.error('Error generating QR code:', error);
      }
    };

    generateQRCode();
  }, [certificateId, qrCodeLink]);
  // Function to get theme colors for each pattern
  const getPatternTheme = (pattern: string) => {
    switch (pattern) {
      case 'royal':
        return {
          primary: 'text-amber-700',
          secondary: 'text-amber-600',
          icon: 'text-amber-600',
          badge: 'bg-amber-50 text-amber-700 border-amber-200'
        };
      case 'tech':
        return {
          primary: 'text-cyan-700',
          secondary: 'text-cyan-600',
          icon: 'text-cyan-600',
          badge: 'bg-cyan-50 text-cyan-700 border-cyan-200'
        };
      case 'nature':
        return {
          primary: 'text-green-700',
          secondary: 'text-green-600',
          icon: 'text-green-600',
          badge: 'bg-green-50 text-green-700 border-green-200'
        };
      case 'geometric':
        return {
          primary: 'text-purple-700',
          secondary: 'text-purple-600',
          icon: 'text-purple-600',
          badge: 'bg-purple-50 text-purple-700 border-purple-200'
        };
      case 'vintage':
        return {
          primary: 'text-orange-700',
          secondary: 'text-orange-600',
          icon: 'text-orange-600',
          badge: 'bg-orange-50 text-orange-700 border-orange-200'
        };
      case 'waves':
        return {
          primary: 'text-blue-700',
          secondary: 'text-blue-600',
          icon: 'text-blue-600',
          badge: 'bg-blue-50 text-blue-700 border-blue-200'
        };
      case 'minimal':
        return {
          primary: 'text-gray-700',
          secondary: 'text-gray-600',
          icon: 'text-gray-600',
          badge: 'bg-gray-50 text-gray-700 border-gray-200'
        };
      case 'professional':
        return {
          primary: 'text-slate-700',
          secondary: 'text-slate-600',
          icon: 'text-slate-600',
          badge: 'bg-slate-50 text-slate-700 border-slate-200'
        };
      case 'academic':
        return {
          primary: 'text-indigo-700',
          secondary: 'text-indigo-600',
          icon: 'text-indigo-600',
          badge: 'bg-indigo-50 text-indigo-700 border-indigo-200'
        };
      case 'modern':
        return {
          primary: 'text-blue-700',
          secondary: 'text-blue-600',
          icon: 'text-blue-600',
          badge: 'bg-blue-50 text-blue-700 border-blue-200'
        };
      default:
        return {
          primary: 'text-gray-700',
          secondary: 'text-gray-600',
          icon: 'text-gray-600',
          badge: 'bg-gray-50 text-gray-700 border-gray-200'
        };
    }
  };

  // Function to render different certificate patterns
  const renderCertificatePattern = (pattern: string) => {
    switch (pattern) {
      case 'royal':
        return (
          <>
            {/* Royal ornate border with crown elements */}
            <div className="absolute inset-3 border-4 border-amber-200 rounded-lg opacity-60"></div>
            <div className="absolute inset-4 border-2 border-amber-300 rounded-md opacity-40"></div>
            
            {/* Crown-like decorations in corners */}
            <div className="absolute top-1 left-1/2 transform -translate-x-1/2">
              <div className="w-8 h-4 bg-amber-200 opacity-50" style={{
                clipPath: 'polygon(0% 100%, 20% 0%, 40% 100%, 60% 0%, 80% 100%, 100% 0%, 100% 100%)'
              }}></div>
            </div>
            <div className="absolute bottom-1 left-1/2 transform -translate-x-1/2 rotate-180">
              <div className="w-8 h-4 bg-amber-200 opacity-50" style={{
                clipPath: 'polygon(0% 100%, 20% 0%, 40% 100%, 60% 0%, 80% 100%, 100% 0%, 100% 100%)'
              }}></div>
            </div>
            
            {/* Royal background pattern */}
            <div className="absolute inset-0 opacity-3">
              <div className="w-full h-full" style={{
                backgroundImage: `radial-gradient(circle at 25% 25%, #f59e0b 2px, transparent 2px), radial-gradient(circle at 75% 75%, #f59e0b 1px, transparent 1px)`,
                backgroundSize: '16px 16px'
              }}></div>
            </div>
          </>
        );
      
      case 'tech':
        return (
          <>
            {/* Tech circuit board borders */}
            <div className="absolute inset-3 border-2 border-cyan-200 opacity-50"></div>
            
            {/* Circuit-like corner elements */}
            <div className="absolute top-3 left-3 w-6 h-6 border-l-2 border-t-2 border-cyan-300 opacity-60"></div>
            <div className="absolute top-3 left-5 w-2 h-2 bg-cyan-300 opacity-60"></div>
            <div className="absolute top-5 left-3 w-2 h-2 bg-cyan-300 opacity-60"></div>
            
            <div className="absolute top-3 right-3 w-6 h-6 border-r-2 border-t-2 border-cyan-300 opacity-60"></div>
            <div className="absolute top-3 right-5 w-2 h-2 bg-cyan-300 opacity-60"></div>
            <div className="absolute top-5 right-3 w-2 h-2 bg-cyan-300 opacity-60"></div>
            
            <div className="absolute bottom-3 left-3 w-6 h-6 border-l-2 border-b-2 border-cyan-300 opacity-60"></div>
            <div className="absolute bottom-3 left-5 w-2 h-2 bg-cyan-300 opacity-60"></div>
            <div className="absolute bottom-5 left-3 w-2 h-2 bg-cyan-300 opacity-60"></div>
            
            <div className="absolute bottom-3 right-3 w-6 h-6 border-r-2 border-b-2 border-cyan-300 opacity-60"></div>
            <div className="absolute bottom-3 right-5 w-2 h-2 bg-cyan-300 opacity-60"></div>
            <div className="absolute bottom-5 right-3 w-2 h-2 bg-cyan-300 opacity-60"></div>
            
            {/* Tech grid background */}
            <div className="absolute inset-0 opacity-4">
              <div className="w-full h-full" style={{
                backgroundImage: `linear-gradient(90deg, #06b6d4 1px, transparent 1px), linear-gradient(0deg, #06b6d4 1px, transparent 1px)`,
                backgroundSize: '8px 8px'
              }}></div>
            </div>
          </>
        );
      
      case 'nature':
        return (
          <>
            {/* Nature organic border */}
            <div className="absolute inset-3 border-2 border-green-200 rounded-2xl opacity-50"></div>
            
            {/* Leaf-like decorations */}
            <div className="absolute top-2 left-2 w-4 h-6 bg-green-200 opacity-50 rounded-full transform rotate-45"></div>
            <div className="absolute top-2 left-4 w-3 h-4 bg-green-300 opacity-40 rounded-full transform rotate-12"></div>
            
            <div className="absolute top-2 right-2 w-4 h-6 bg-green-200 opacity-50 rounded-full transform -rotate-45"></div>
            <div className="absolute top-2 right-4 w-3 h-4 bg-green-300 opacity-40 rounded-full transform -rotate-12"></div>
            
            <div className="absolute bottom-2 left-2 w-4 h-6 bg-green-200 opacity-50 rounded-full transform -rotate-45"></div>
            <div className="absolute bottom-2 left-4 w-3 h-4 bg-green-300 opacity-40 rounded-full transform -rotate-12"></div>
            
            <div className="absolute bottom-2 right-2 w-4 h-6 bg-green-200 opacity-50 rounded-full transform rotate-45"></div>
            <div className="absolute bottom-2 right-4 w-3 h-4 bg-green-300 opacity-40 rounded-full transform rotate-12"></div>
            
            {/* Organic background pattern */}
            <div className="absolute inset-0 opacity-3">
              <div className="w-full h-full" style={{
                backgroundImage: `radial-gradient(ellipse at 30% 30%, #10b981 1px, transparent 1px), radial-gradient(ellipse at 70% 70%, #10b981 0.5px, transparent 0.5px)`,
                backgroundSize: '12px 8px'
              }}></div>
            </div>
          </>
        );
      
      case 'geometric':
        return (
          <>
            {/* Geometric angular borders */}
            <div className="absolute inset-2 border-2 border-purple-200 opacity-50" style={{
              clipPath: 'polygon(0 10px, 10px 0, calc(100% - 10px) 0, 100% 10px, 100% calc(100% - 10px), calc(100% - 10px) 100%, 10px 100%, 0 calc(100% - 10px))'
            }}></div>
            
            {/* Geometric corner elements */}
            <div className="absolute top-1 left-1 w-6 h-6 border-2 border-purple-300 opacity-60 transform rotate-45"></div>
            <div className="absolute top-1 right-1 w-6 h-6 border-2 border-purple-300 opacity-60 transform rotate-45"></div>
            <div className="absolute bottom-1 left-1 w-6 h-6 border-2 border-purple-300 opacity-60 transform rotate-45"></div>
            <div className="absolute bottom-1 right-1 w-6 h-6 border-2 border-purple-300 opacity-60 transform rotate-45"></div>
            
            {/* Abstract geometric shapes */}
            <div className="absolute top-1/4 left-1 w-2 h-8 bg-purple-200 opacity-30 transform rotate-12"></div>
            <div className="absolute top-1/4 right-1 w-2 h-8 bg-purple-200 opacity-30 transform -rotate-12"></div>
            <div className="absolute bottom-1/4 left-1 w-2 h-8 bg-purple-200 opacity-30 transform -rotate-12"></div>
            <div className="absolute bottom-1/4 right-1 w-2 h-8 bg-purple-200 opacity-30 transform rotate-12"></div>
            
            {/* Geometric background */}
            <div className="absolute inset-0 opacity-4">
              <div className="w-full h-full" style={{
                backgroundImage: `linear-gradient(45deg, #8b5cf6 25%, transparent 25%), linear-gradient(-45deg, #8b5cf6 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #8b5cf6 75%), linear-gradient(-45deg, transparent 75%, #8b5cf6 75%)`,
                backgroundSize: '6px 6px'
              }}></div>
            </div>
          </>
        );
      
      case 'vintage':
        return (
          <>
            {/* Art deco style borders */}
            <div className="absolute inset-2 border-2 border-orange-200 opacity-50"></div>
            <div className="absolute inset-3 border border-orange-300 opacity-40"></div>
            
            {/* Art deco corner decorations */}
            <div className="absolute top-2 left-2 w-8 h-8 border-2 border-orange-300 opacity-50" style={{
              clipPath: 'polygon(0 0, 100% 0, 100% 50%, 50% 100%, 0 100%)'
            }}></div>
            <div className="absolute top-2 right-2 w-8 h-8 border-2 border-orange-300 opacity-50" style={{
              clipPath: 'polygon(0 0, 100% 0, 100% 100%, 50% 100%, 0 50%)'
            }}></div>
            <div className="absolute bottom-2 left-2 w-8 h-8 border-2 border-orange-300 opacity-50" style={{
              clipPath: 'polygon(0 0, 50% 0, 100% 50%, 100% 100%, 0 100%)'
            }}></div>
            <div className="absolute bottom-2 right-2 w-8 h-8 border-2 border-orange-300 opacity-50" style={{
              clipPath: 'polygon(0 50%, 50% 0, 100% 0, 100% 100%, 0 100%)'
            }}></div>
            
            {/* Art deco sunburst pattern */}
            <div className="absolute inset-0 opacity-3">
              <div className="w-full h-full" style={{
                backgroundImage: `repeating-conic-gradient(from 0deg at 50% 50%, #f97316 0deg, #f97316 2deg, transparent 2deg, transparent 8deg)`,
                backgroundSize: '100% 100%'
              }}></div>
            </div>
          </>
        );
      
      case 'waves':
        return (
          <>
            {/* Flowing wave borders */}
            <div className="absolute inset-2 border-2 border-blue-200 rounded-3xl opacity-50"></div>
            
            {/* Wave decorations */}
            <div className="absolute top-2 left-0 right-0 h-4 opacity-30" style={{
              background: `radial-gradient(ellipse at center, #3b82f6 30%, transparent 30%)`,
              backgroundSize: '20px 8px'
            }}></div>
            <div className="absolute bottom-2 left-0 right-0 h-4 opacity-30" style={{
              background: `radial-gradient(ellipse at center, #3b82f6 30%, transparent 30%)`,
              backgroundSize: '20px 8px'
            }}></div>
            
            {/* Side wave patterns */}
            <div className="absolute left-2 top-0 bottom-0 w-4 opacity-30" style={{
              background: `radial-gradient(ellipse at center, #3b82f6 30%, transparent 30%)`,
              backgroundSize: '8px 20px'
            }}></div>
            <div className="absolute right-2 top-0 bottom-0 w-4 opacity-30" style={{
              background: `radial-gradient(ellipse at center, #3b82f6 30%, transparent 30%)`,
              backgroundSize: '8px 20px'
            }}></div>
            
            {/* Wave background */}
            <div className="absolute inset-0 opacity-4">
              <div className="w-full h-full" style={{
                backgroundImage: `repeating-linear-gradient(45deg, #3b82f6 0px, #3b82f6 1px, transparent 1px, transparent 8px), repeating-linear-gradient(-45deg, #3b82f6 0px, #3b82f6 1px, transparent 1px, transparent 8px)`,
                backgroundSize: '12px 12px'
              }}></div>
            </div>
          </>
        );
      
      case 'minimal':
        return (
          <>
            {/* Minimal clean border */}
            <div className="absolute inset-6 border border-gray-300 opacity-60"></div>
            
            {/* Subtle corner accents */}
            <div className="absolute top-5 left-5 w-3 h-3 border-l border-t border-gray-400 opacity-40"></div>
            <div className="absolute top-5 right-5 w-3 h-3 border-r border-t border-gray-400 opacity-40"></div>
            <div className="absolute bottom-5 left-5 w-3 h-3 border-l border-b border-gray-400 opacity-40"></div>
            <div className="absolute bottom-5 right-5 w-3 h-3 border-r border-b border-gray-400 opacity-40"></div>
          </>
        );
      
      case 'professional':
        return (
          <>
            {/* Professional double border */}
            <div className="absolute inset-2 border-2 border-slate-300 opacity-50"></div>
            <div className="absolute inset-3 border border-slate-400 opacity-40"></div>
            
            {/* Professional corner brackets */}
            <div className="absolute top-2 left-2 w-6 h-6 border-l-2 border-t-2 border-slate-400 opacity-60"></div>
            <div className="absolute top-2 right-2 w-6 h-6 border-r-2 border-t-2 border-slate-400 opacity-60"></div>
            <div className="absolute bottom-2 left-2 w-6 h-6 border-l-2 border-b-2 border-slate-400 opacity-60"></div>
            <div className="absolute bottom-2 right-2 w-6 h-6 border-r-2 border-b-2 border-slate-400 opacity-60"></div>
            
            {/* Subtle professional background */}
            <div className="absolute inset-0 opacity-2">
              <div className="w-full h-full" style={{
                backgroundImage: `linear-gradient(90deg, #64748b 1px, transparent 1px), linear-gradient(0deg, #64748b 1px, transparent 1px)`,
                backgroundSize: '20px 20px'
              }}></div>
            </div>
          </>
        );
      
      case 'academic':
        return (
          <>
            {/* Academic traditional border */}
            <div className="absolute inset-2 border-3 border-indigo-300 opacity-50"></div>
            <div className="absolute inset-3 border border-indigo-400 opacity-40"></div>
            
            {/* Academic shield-like corners */}
            <div className="absolute top-2 left-2 w-8 h-8 border-2 border-indigo-400 opacity-50 rounded-tl-lg"></div>
            <div className="absolute top-2 right-2 w-8 h-8 border-2 border-indigo-400 opacity-50 rounded-tr-lg"></div>
            <div className="absolute bottom-2 left-2 w-8 h-8 border-2 border-indigo-400 opacity-50 rounded-bl-lg"></div>
            <div className="absolute bottom-2 right-2 w-8 h-8 border-2 border-indigo-400 opacity-50 rounded-br-lg"></div>
            
            {/* Academic laurel-like decorations */}
            <div className="absolute top-1/2 left-1 transform -translate-y-1/2">
              <div className="w-1 h-6 bg-indigo-300 opacity-40 rounded-full"></div>
            </div>
            <div className="absolute top-1/2 right-1 transform -translate-y-1/2">
              <div className="w-1 h-6 bg-indigo-300 opacity-40 rounded-full"></div>
            </div>
            
            {/* Academic background pattern */}
            <div className="absolute inset-0 opacity-3">
              <div className="w-full h-full" style={{
                backgroundImage: `radial-gradient(circle at 50% 50%, #6366f1 1px, transparent 1px)`,
                backgroundSize: '15px 15px'
              }}></div>
            </div>
          </>
        );
      
      case 'modern':
        return (
          <>
            {/* Modern clean asymmetric border */}
            <div className="absolute inset-2 border-2 border-gray-300 opacity-50" style={{
              clipPath: 'polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px))'
            }}></div>
            
            {/* Modern accent lines */}
            <div className="absolute top-2 left-2 w-8 h-0.5 bg-blue-400 opacity-60"></div>
            <div className="absolute top-2 left-2 w-0.5 h-8 bg-blue-400 opacity-60"></div>
            
            <div className="absolute bottom-2 right-2 w-8 h-0.5 bg-blue-400 opacity-60"></div>
            <div className="absolute bottom-2 right-2 w-0.5 h-8 bg-blue-400 opacity-60"></div>
            
            {/* Modern dot accents */}
            <div className="absolute top-4 right-4 w-2 h-2 bg-blue-400 opacity-50 rounded-full"></div>
            <div className="absolute bottom-4 left-4 w-2 h-2 bg-blue-400 opacity-50 rounded-full"></div>
            
            {/* Modern subtle background */}
            <div className="absolute inset-0 opacity-2">
              <div className="w-full h-full" style={{
                backgroundImage: `linear-gradient(135deg, #3b82f6 0%, transparent 1%), linear-gradient(225deg, #3b82f6 0%, transparent 1%)`,
                backgroundSize: '12px 12px'
              }}></div>
            </div>
          </>
        );
      
      default:
        return null;
    }
  };

  const theme = getPatternTheme(certificatePattern);

  return (
    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4 w-full h-full">
      <div className="bg-white rounded-lg shadow-sm p-6 relative overflow-hidden w-full h-full flex flex-col">
        {/* Dynamic Certificate Pattern */}
        {renderCertificatePattern(certificatePattern)}

        {/* Certificate ID - Top Left */}
        <div className="absolute top-4 left-4 sm:top-6 sm:left-6 z-20">
          <div className="flex items-center space-x-1">
            <Hash className={`w-3 h-3 sm:w-4 sm:h-4 ${theme.icon}`} />
            <span className={`text-xs sm:text-sm ${theme.secondary} font-medium`}>ID: {certificateId || 'LH-2024-001'}</span>
          </div>
        </div>

        {/* QR Code Box - Top Right */}
        <div className="absolute top-4 right-4 sm:top-6 sm:right-6 z-20">
          <div className={`w-16 h-16 sm:w-24 sm:h-24 border-2 ${theme.secondary.replace('text-', 'border-')} rounded-md bg-white/90 backdrop-blur-sm p-1`}>
            {qrCodeUrl ? (
              <img
                src={qrCodeUrl}
                alt="Certificate QR Code"
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <QrCode className={`w-8 h-8 sm:w-12 sm:h-12 ${theme.icon}`} />
              </div>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-center space-y-3 px-6 py-6">
          {/* Header with decorative line */}
          <div className="flex items-center justify-center space-x-2 mb-2">
            <div className={`w-6 sm:w-8 h-px bg-gradient-to-r from-transparent ${theme.secondary.replace('text-', 'to-')}`}></div>
            <div className={`text-xs sm:text-sm ${theme.secondary} font-medium uppercase tracking-wider`}>Certificate</div>
            <div className={`w-6 sm:w-8 h-px bg-gradient-to-l from-transparent ${theme.secondary.replace('text-', 'to-')}`}></div>
          </div>

          {/* Award Icon with decorative elements */}
          <div className="flex justify-center relative">
            <div className={`w-12 h-12 sm:w-16 sm:h-16 bg-gradient-to-br ${theme.icon.replace('text-', 'from-')}-100 ${theme.icon.replace('text-', 'to-')}-200 rounded-full flex items-center justify-center relative`}>
              <Award className={`w-6 h-6 sm:w-8 sm:h-8 ${theme.icon}`} />
              {/* Decorative rays */}
              <div className="absolute inset-0 rounded-full">
                <div className={`absolute top-0 left-1/2 w-px h-2 sm:h-3 ${theme.secondary.replace('text-', 'bg-')} transform -translate-x-1/2 -translate-y-1 opacity-60`}></div>
                <div className={`absolute bottom-0 left-1/2 w-px h-2 sm:h-3 ${theme.secondary.replace('text-', 'bg-')} transform -translate-x-1/2 translate-y-1 opacity-60`}></div>
                <div className={`absolute left-0 top-1/2 w-2 sm:w-3 h-px ${theme.secondary.replace('text-', 'bg-')} transform -translate-y-1/2 -translate-x-1 opacity-60`}></div>
                <div className={`absolute right-0 top-1/2 w-2 sm:w-3 h-px ${theme.secondary.replace('text-', 'bg-')} transform -translate-y-1/2 translate-x-1 opacity-60`}></div>
              </div>
            </div>
          </div>

          {/* Certificate Content */}
          <div className="flex flex-col justify-center items-center flex-1 max-w-full">
            <h4 className={`font-bold text-sm sm:text-base ${theme.primary} mb-2 text-center`}>
              {certificationName || 'Certification Name'}
            </h4>
            <p className={`text-xs sm:text-sm ${theme.secondary} text-center leading-relaxed max-w-xs sm:max-w-sm`}>
              {certificationDescription || 'Certification description will appear here...'}
            </p>
          </div>

          {/* Decorative divider */}
          <div className="flex items-center justify-center space-x-1 py-1">
            <div className={`w-2 h-px ${theme.secondary.replace('text-', 'bg-')} opacity-50`}></div>
            <div className={`w-1 h-1 ${theme.primary.replace('text-', 'bg-')} rounded-full opacity-60`}></div>
            <div className={`w-2 h-px ${theme.secondary.replace('text-', 'bg-')} opacity-50`}></div>
          </div>
          
          {/* Certification Type Badge */}
          <div className={`inline-flex items-center space-x-1 text-xs sm:text-sm ${theme.badge} px-3 py-1 rounded-full border`}>
            <CheckCircle size={12} />
            <span className="font-medium">
              {certificationType === 'completion' ? 'Course Completion' :
               certificationType === 'achievement' ? 'Achievement Based' :
               certificationType === 'assessment' ? 'Assessment Based' :
               certificationType === 'participation' ? 'Participation' :
               certificationType === 'mastery' ? 'Skill Mastery' :
               certificationType === 'professional' ? 'Professional Development' :
               certificationType === 'continuing' ? 'Continuing Education' :
               certificationType === 'workshop' ? 'Workshop Attendance' :
               certificationType === 'specialization' ? 'Specialization' : 'Course Completion'}
            </span>
          </div>
        </div>

        {/* Bottom Section */}
        <div className="relative z-10 mt-auto p-6 pt-8">
          <div className="flex items-end justify-between w-full">
            {/* Left: Teacher/Organization Signature */}
            <div className="flex flex-col items-start space-y-1 flex-1">
              <div className="flex items-center space-x-1">
                <User className={`w-2.5 h-2.5 sm:w-3 sm:h-3 ${theme.icon}`} />
                <span className={`text-xs ${theme.secondary} font-medium`}>Instructor</span>
              </div>
              <div className={`text-xs ${theme.primary} font-semibold`}>
                {certificateInstructor || 'Dr. Jane Smith'}
              </div>
              <div className={`h-px w-10 sm:w-12 ${theme.secondary.replace('text-', 'bg-')} opacity-50`}></div>
            </div>

            {/* Center: Logo */}
            <div className="flex flex-col items-center space-y-1 flex-1">
              <div className={`w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center`}>
                {org?.logo_image ? (
                  <img
                    src={`${getOrgLogoMediaDirectory(org.org_uuid, org?.logo_image)}`}
                    alt="Organization Logo"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className={`w-full h-full ${theme.icon.replace('text-', 'bg-')}-100 rounded-full flex items-center justify-center`}>
                    <Building className={`w-4 h-4 sm:w-5 sm:h-5 ${theme.icon}`} />
                  </div>
                )}
              </div>
              <div className={`text-xs ${theme.secondary} font-medium`}>
                {org?.name || 'LearnHouse'}
              </div>
            </div>

            {/* Right: Award Date */}
            <div className="flex flex-col items-end space-y-1 flex-1">
              <div className="flex items-center space-x-1">
                <Calendar className={`w-2.5 h-2.5 sm:w-3 sm:h-3 ${theme.icon}`} />
                <span className={`text-xs ${theme.secondary} font-medium`}>Awarded</span>
              </div>
              <div className={`text-xs ${theme.primary} font-semibold`}>
                {awardedDate || 'Dec 15, 2024'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CertificatePreview; 