import React from 'react'
import { AlertCircle, ShoppingCart } from 'lucide-react'
import CoursePaidOptions from './CoursePaidOptions'

interface PaidCourseActivityProps {
  course: any;
}

function PaidCourseActivity({ course }: PaidCourseActivityProps) {
  return (
    <div className="space-y-4 ">
      <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg nice-shadow">
        <div className="flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-amber-800" />
          <h3 className="text-amber-800 font-semibold">Paid Content</h3>
        </div>
        <p className="text-amber-700 text-sm mt-1">
          This content requires a course purchase to access. Please purchase the course to continue.
        </p>
      </div>
      <CoursePaidOptions course={course} />
    </div>
  )
}

export default PaidCourseActivity