import NextAuth from 'next-auth'
import { nextAuthOptions } from 'app/auth/options'

const handler = NextAuth(nextAuthOptions)

export { handler as GET, handler as POST }
