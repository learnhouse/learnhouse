import CertificateVerificationPage from '@components/Pages/Certificate/CertificateVerificationPage';
import React from 'react';

interface CertificateVerifyPageProps {
  params: Promise<{
    uuid: string;
  }>;
}

const CertificateVerifyPage: React.FC<CertificateVerifyPageProps> = async ({ params }) => {
  const { uuid } = await params;
  return <CertificateVerificationPage certificateUuid={uuid} />;
};

export default CertificateVerifyPage; 