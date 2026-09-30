'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { usePathname } from 'next/navigation'

export default function Template({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  const pageTransition = {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -10 },
  }

  // Check if user prefers reduced motion
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={pathname}
        initial={prefersReducedMotion ? false : 'initial'}
        animate="animate"
        exit="exit"
        variants={pageTransition}
        transition={{ duration: 0.3, ease: 'easeInOut' }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
