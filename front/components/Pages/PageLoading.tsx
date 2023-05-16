import React from 'react'

function PageLoading() {
    return (
        <div className="max-w-7xl mx-auto px-4 py-20">
            <div className="animate-pulse mx-auto flex space-x-4">
                <svg className="mx-auto" width="295" height="295" viewBox="0 0 295 295" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect opacity="0.51" x="6.5" y="6.5" width="282" height="282" rx="78.5" stroke="#454545" stroke-opacity="0.46" stroke-width="13" stroke-dasharray="11 11" />
                    <path d="M135.8 200.8V130L122.2 114.6L135.8 110.4V102.8L122.2 87.4L159.8 76V200.8L174.6 218H121L135.8 200.8Z" fill="#454545" fill-opacity="0.13" />
                </svg>
            </div>
        </div>
    )
}

export default PageLoading