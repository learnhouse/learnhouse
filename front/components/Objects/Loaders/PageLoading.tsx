'use client';
import { motion } from "framer-motion";

const variants = {
    hidden: { opacity: 0, x: 0, y: 0 },
    enter: { opacity: 1, x: 0, y: 0 },
    exit: { opacity: 0, x: 0, y: 0 },
  };

function PageLoading() {
    
    return (
        <motion.main
        variants={variants} // Pass the variant object into Framer Motion
        initial="hidden" // Set the initial state to variants.hidden
        animate="enter" // Animated state to variants.enter
        exit="exit" // Exit state (used later) to variants.exit
        transition={{ type: "linear" }} // Set the transition to linear
        className=""
      >
        <div className="max-w-7xl mx-auto px-4 py-20 transition-all">
            <div className="animate-pulse mx-auto flex space-x-4">
                <svg className="mx-auto" width="295" height="295" viewBox="0 0 295 295" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect opacity="0.51" x="6.5" y="6.5" width="282" height="282" rx="78.5" stroke="#454545" strokeOpacity="0.46" stroke-width="13" stroke-dasharray="11 11" />
                    <path d="M135.8 200.8V130L122.2 114.6L135.8 110.4V102.8L122.2 87.4L159.8 76V200.8L174.6 218H121L135.8 200.8Z" fill="#454545" fillOpacity="0.13" />
                </svg>
            </div>
        </div>
        </motion.main>
    )
}

export default PageLoading