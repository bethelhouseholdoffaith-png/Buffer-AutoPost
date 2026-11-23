import React from 'react';
import { motion } from 'motion/react';

interface GreenCheckAnimationProps {
  onComplete?: () => void;
  size?: number;
}

/**
 * Animated Green Check Mark
 * Requirement:
 * 1. Circle outline drawn right to left (counter-clockwise from 0deg / right).
 * 2. Checkmark drawn left to right AFTER the circle is done.
 */
export const GreenCheckAnimation: React.FC<GreenCheckAnimationProps> = ({
  onComplete,
  size = 96,
}) => {
  // SVG Circle parameters: radius 40, center (50, 50)
  // Circumference = 2 * PI * 40 = 251.327
  // Drawing right to left: starting from (90, 50) and going counter-clockwise:
  // Using path: M 90 50 A 40 40 0 1 0 10 50 A 40 40 0 1 0 90 50
  // Or A 40 40 0 0 0 (counter-clockwise sweep flag 0 = right-to-left / counter-clockwise!)
  const circleDuration = 0.7;
  const checkDelay = circleDuration + 0.08;
  const checkDuration = 0.45;

  return (
    <div
      className="flex flex-col items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 100 100"
        className="w-full h-full overflow-visible"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Circle outline: drawn right to left (counter-clockwise sweep from right x=90, y=50) */}
        <motion.path
          d="M 90 50 A 40 40 0 1 0 10 50 A 40 40 0 1 0 90 50"
          stroke="#22c55e" // vibrant green
          strokeWidth="5"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{
            duration: circleDuration,
            ease: 'easeInOut',
          }}
        />

        {/* Checkmark: drawn left to right ONLY AFTER circle is done */}
        <motion.path
          d="M 28 52 L 44 68 L 74 34"
          stroke="#22c55e"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{
            delay: checkDelay,
            duration: checkDuration,
            ease: 'easeOut',
          }}
          onAnimationComplete={onComplete}
        />
      </svg>
    </div>
  );
};
