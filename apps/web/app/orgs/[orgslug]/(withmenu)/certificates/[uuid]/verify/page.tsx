import CertificateVerificationPage from '@components/Pages/Certificate/CertificateVerificationPage';
import React from 'react';

interface CertificateVerifyPageProps {
  params: {
    uuid: string;
  };
}

const CertificateVerifyPage: React.FC<CertificateVerifyPageProps> = ({ params }) => {
  return <CertificateVerificationPage certificateUuid={params.uuid} />;
};

export default CertificateVerifyPage; 