'use client'
import { motion } from 'framer-motion'

const variants = {
  hidden: { opacity: 0, x: 0, y: 0 },
  enter: { opacity: 1, x: 0, y: 0 },
  exit: { opacity: 0, x: 0, y: 0 },
}

// Animation variants for the dots
const dotVariants = {
  initial: { scale: 0.8, opacity: 0.4 },
  animate: (i: number) => ({
    scale: [0.8, 1.2, 0.8],
    opacity: [0.4, 1, 0.4],
    transition: {
      duration: 1.5,
      repeat: Infinity,
      delay: i * 0.2,
      ease: "easeInOut"
    }
  })
}

function PageLoading() {
  return (
    <motion.main
      variants={variants}
      initial="hidden"
      animate="enter"
      exit="exit"
      transition={{ type: 'linear' }}
      className=""
    >
      <div className="max-w-7xl mx-auto px-4 py-20 transition-all">
        <div className="flex flex-col items-center justify-center h-40">
          {/* Animated dots */}
          <div className="flex space-x-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <motion.div
                key={i}
                custom={i}
                variants={dotVariants}
                initial="initial"
                animate="animate"
                className="w-4 h-4 rounded-full bg-gray-500 dark:bg-gray-400"
              />
            ))}
          </div>
          
          <motion.p 
            className="mt-6 text-sm text-gray-500 dark:text-gray-400"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            Loading...
          </motion.p>
        </div>
      </div>
    </motion.main>
  )
}

export default PageLoading
