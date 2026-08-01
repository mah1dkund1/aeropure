'use client'

import React from 'react'

export const SkeletonLineChart: React.FC<{ height?: number }> = ({ height = 288 }) => {
  return (
    <div className="w-full" style={{ height }}>
      <div className="h-full w-full bg-gradient-to-r from-slate-100 via-slate-50 to-slate-100 rounded-lg animate-pulse" />
    </div>
  )
}

export const SkeletonBarChart: React.FC<{ height?: number }> = ({ height = 320 }) => {
  return (
    <div className="w-full" style={{ height }}>
      <div className="h-full w-full bg-gradient-to-r from-slate-100 via-slate-50 to-slate-100 rounded-lg animate-pulse" />
    </div>
  )
}

export default null
