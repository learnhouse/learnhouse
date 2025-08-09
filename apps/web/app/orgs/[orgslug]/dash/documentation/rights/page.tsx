'use client'
import React from 'react'
import { getUriWithOrg } from '@services/config/config'
import { useOrg } from '@components/Contexts/OrgContext'
import { 
  Shield, 
  Users, 
  BookOpen, 
  UserCheck, 
  Lock, 
  Globe, 
  Award, 
  FileText, 
  Settings, 
  Crown,
  User,
  UserCog,
  GraduationCap,
  Eye,
  Edit,
  Trash2,
  Plus,
  CheckCircle,
  XCircle,
  AlertCircle,
  Info,
  ArrowLeft,
  AlertTriangle,
  Key,
  UserCheck as UserCheckIcon
} from 'lucide-react'
import Link from 'next/link'
import { motion } from 'framer-motion'

interface RightsDocumentationProps {
  params: Promise<{ orgslug: string }>
}

const RightsDocumentation = ({ params }: RightsDocumentationProps) => {
  const org = useOrg() as any

  const roleHierarchy = [
    {
      name: 'Admin',
      icon: <Crown className="w-6 h-6 text-purple-600" />,
      color: 'bg-purple-50 border-purple-200',
      description: 'Full platform control with all permissions',
      permissions: ['All permissions', 'Manage organization', 'Manage users', 'Manage courses', 'Manage roles'],
      level: 4
    },
    {
      name: 'Maintainer',
      icon: <Shield className="w-6 h-6 text-blue-600" />,
      color: 'bg-blue-50 border-blue-200',
      description: 'Mid-level manager with wide permissions',
      permissions: ['Manage courses', 'Manage users', 'Manage assignments', ],
      level: 3
    },
    {
      name: 'Instructor',
      icon: <GraduationCap className="w-6 h-6 text-green-600" />,
      color: 'bg-green-50 border-green-200',
      description: 'Can create courses but need ownership for content creation',
      permissions: ['Create courses', 'Manage own courses', 'Create assignments', 'Grade assignments'],
      level: 2
    },
    {
      name: 'User',
      icon: <User className="w-6 h-6 text-gray-600" />,
      color: 'bg-gray-50 border-gray-200',
      description: 'Read-Only Learner',
      permissions: ['View courses', 'Submit assignments', 'Take assessments'],
      level: 1
    }
  ]

  const courseOwnershipTypes = [
    {
      name: 'Creator',
      icon: <Crown className="w-5 h-5 text-yellow-600" />,
      color: 'bg-yellow-50 border-yellow-200',
      description: 'Original course creator with full control',
      permissions: ['Full course control', 'Manage contributors', 'Change access settings', 'Delete course']
    },
    {
      name: 'Maintainer',
      icon: <Shield className="w-5 h-5 text-blue-600" />,
      color: 'bg-blue-50 border-blue-200',
      description: 'Course maintainer with extensive permissions',
      permissions: ['Manage course content', 'Manage contributors', 'Change access settings', 'Cannot delete course']
    },
    {
      name: 'Contributor',
      icon: <UserCog className="w-5 h-5 text-green-600" />,
      color: 'bg-green-50 border-green-200',
      description: 'Course contributor with limited permissions',
      permissions: ['Edit course content', 'Create activities', 'Cannot manage contributors', 'Cannot change access']
    }
  ]

  return (
    <div className="min-h-screen bg-[#f8f8f8] flex items-center justify-center p-6 pt-16 w-full">
      <div className="w-full max-w-none mx-auto px-4 sm:px-6 lg:px-8">
        {/* Top Icon */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-8"
        >
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-full shadow-sm border border-gray-200 mb-6">
            <Shield className="w-8 h-8 text-blue-500" />
          </div>
        </motion.div>

        {/* Header */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="text-center mb-12"
        >
          <Link 
            href={getUriWithOrg(org?.slug, '/dash')}
            className="inline-flex items-center space-x-2 text-gray-600 hover:text-gray-900 mb-6 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="font-medium">Back to Dashboard</span>
          </Link>
          <div className="flex items-center justify-center space-x-3 mb-4">
            <h1 className="text-4xl font-bold text-gray-900">Authorizations & Rights Guide</h1>
          </div>
          <p className="text-gray-600 text-lg max-w-2xl mx-auto">
            Understanding LearnHouse permissions, roles, and access controls based on RBAC system
          </p>
        </motion.div>

        {/* Role Hierarchy Section */}
        <motion.section 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mb-16"
        >
          <h2 className="text-2xl font-bold text-gray-900 mb-8 text-center flex items-center justify-center space-x-2">
            <Crown className="w-6 h-6 text-purple-600" />
            <span>Role Hierarchy</span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-7xl mx-auto">
            {roleHierarchy.map((role, index) => (
              <motion.div
                key={role.name}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + index * 0.1 }}
                className={`bg-white rounded-xl border ${role.color} shadow-sm hover:shadow-lg transition-all duration-200 p-6 text-center`}
              >
                <div className="flex items-center justify-center space-x-3 mb-4">
                  {role.icon}
                  <h3 className="text-lg font-semibold text-gray-900">{role.name}</h3>
                </div>
                <p className="text-gray-600 text-sm mb-4">{role.description}</p>
                <ul className="space-y-2 text-left">
                  {role.permissions.map((permission, permIndex) => (
                    <li key={permIndex} className="flex items-center space-x-2 text-sm text-gray-700">
                      <CheckCircle className="w-3 h-3 text-green-600 flex-shrink-0" />
                      <span>{permission}</span>
                    </li>
                  ))}
                </ul>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* Course Ownership Types */}
        <motion.section 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="mb-16"
        >
          <h2 className="text-2xl font-bold text-gray-900 mb-8 text-center flex items-center justify-center space-x-2">
            <Users className="w-6 h-6 text-blue-600" />
            <span>Course Ownership Types</span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {courseOwnershipTypes.map((type, index) => (
              <motion.div
                key={type.name}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 + index * 0.1 }}
                className={`bg-white rounded-xl border ${type.color} shadow-sm hover:shadow-lg transition-all duration-200 p-6 text-center`}
              >
                <div className="flex items-center justify-center space-x-3 mb-4">
                  {type.icon}
                  <h3 className="text-lg font-semibold text-gray-900">{type.name}</h3>
                </div>
                <p className="text-gray-600 text-sm mb-4">{type.description}</p>
                <ul className="space-y-2 text-left">
                  {type.permissions.map((permission, permIndex) => (
                    <li key={permIndex} className="flex items-center space-x-2 text-sm text-gray-700">
                      <CheckCircle className="w-3 h-3 text-green-600 flex-shrink-0" />
                      <span>{permission}</span>
                    </li>
                  ))}
                </ul>
              </motion.div>
            ))}
          </div>
        </motion.section>
      </div>
    </div>
  )
}

export default RightsDocumentation 