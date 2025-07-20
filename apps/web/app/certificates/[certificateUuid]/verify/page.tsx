import CertificateVerificationPage from '@components/Pages/Certificate/CertificateVerificationPage'

interface CertificateVerifyPageProps {
  params: {
    certificateUuid: string
  }
}

export default function CertificateVerifyPage({ params }: CertificateVerifyPageProps) {
  return <CertificateVerificationPage certificateUuid={params.certificateUuid} />
} 