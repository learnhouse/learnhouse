import React from 'react'
import { useRouter } from 'next/router'
import Layout from '../../components/ui/layout'
import { Title } from '../../components/ui/styles/title'
import { Header } from '../../components/ui/header'

const OrgHome = () => {
  const router = useRouter()
  const { orgslug } = router.query

  return (
    <div>
      <Layout title="Index">
      <Header></Header>
        <Title>Welcome {orgslug} 👋🏻</Title>
      </Layout>
    </div>
  )
}


export default OrgHome;