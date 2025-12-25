interface NomoLogoProps {
  size?: "sm" | "md" | "lg";
  variant?: "filled" | "outline";
  animated?: boolean;
}

const sizes = {
  sm: 24,
  md: 32,
  lg: 48,
};

export function NomoLogo({ size = "md", variant = "filled", animated = false }: NomoLogoProps) {
  const px = sizes[size];
  const isFilled = variant === "filled";
  const strokeColor = isFilled ? "white" : "#2563EB";

  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      width={px}
      height={px}
      className={animated ? "nomo-logo-animated" : ""}
    >
      {isFilled && <rect width="64" height="64" rx="16" fill="#2563EB" />}
      <path
        d="M20 44L44 20"
        stroke={strokeColor}
        strokeWidth="4"
        strokeLinecap="round"
        className={animated ? "nomo-line-1" : ""}
      />
      <path
        d="M20 32L32 20"
        stroke={strokeColor}
        strokeWidth="4"
        strokeLinecap="round"
        opacity="0.6"
        className={animated ? "nomo-line-2" : ""}
      />
      <path
        d="M32 44L44 32"
        stroke={strokeColor}
        strokeWidth="4"
        strokeLinecap="round"
        opacity="0.6"
        className={animated ? "nomo-line-3" : ""}
      />
      <style>
        {animated
          ? `
          .nomo-line-1 {
            animation: nomo-pulse-1 1.5s ease-in-out infinite;
          }
          .nomo-line-2 {
            animation: nomo-pulse-2 1.5s ease-in-out infinite;
          }
          .nomo-line-3 {
            animation: nomo-pulse-3 1.5s ease-in-out infinite;
          }
          @keyframes nomo-pulse-1 {
            0%, 100% { opacity: 1; }
            33% { opacity: 0.6; }
            66% { opacity: 0.6; }
          }
          @keyframes nomo-pulse-2 {
            0%, 100% { opacity: 0.6; }
            33% { opacity: 1; }
            66% { opacity: 0.6; }
          }
          @keyframes nomo-pulse-3 {
            0%, 100% { opacity: 0.6; }
            33% { opacity: 0.6; }
            66% { opacity: 1; }
          }
        `
          : ""}
      </style>
    </svg>
  );
}
