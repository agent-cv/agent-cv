import React, { useState, useEffect } from "react";
import { Text } from "ink";

// Same gradient as agent-cv.dev landing page
const COLORS = [
  "#ff6b6b", "#ffa500", "#ffd700", "#4ecdc4", "#45b7d1", "#96c", "#ff6b9d",
];

interface Props {
  children: string;
}

/**
 * Rainbow shimmer text matching agent-cv.dev brand.
 * Use only on "agent-cv" brand text.
 */
export function Shimmer({ children }: Props) {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setOffset((o) => o + 1), 200);
    return () => clearInterval(timer);
  }, []);

  const chars = [...children];

  return (
    <Text bold>
      {chars.map((char, i) => {
        const colorIndex = (i + offset) % COLORS.length;
        return (
          <Text key={i} color={COLORS[colorIndex]}>
            {char}
          </Text>
        );
      })}
    </Text>
  );
}
