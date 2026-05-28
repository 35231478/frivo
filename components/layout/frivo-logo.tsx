import { cn } from "@/lib/utils";

interface FrivoLogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  showSubtitle?: boolean;
  variant?: "light" | "dark";
}

const sizes = {
  sm: { icon: 24, text: "text-lg" },
  md: { icon: 32, text: "text-xl" },
  lg: { icon: 56, text: "text-4xl" },
};

export function FrivoLogo({
  className,
  size = "md",
  showSubtitle = true,
  variant = "light",
}: FrivoLogoProps) {
  const s = sizes[size];
  const textColor = variant === "light" ? "text-white" : "text-ink";
  const subtitleColor = variant === "light" ? "text-slate-300" : "text-ink-muted";

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <FrivoMark size={s.icon} />
      <div className="flex flex-col leading-none">
        <span className={cn("font-bold tracking-tight lowercase", s.text, textColor)}>
          frivo
        </span>
        {showSubtitle && (
          <span className={cn("text-[10px] mt-0.5 tracking-wide", subtitleColor)}>
            by Termofrio
          </span>
        )}
      </div>
    </div>
  );
}

export function FrivoMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="frivoGrad" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0EA5E9" />
          <stop offset="1" stopColor="#10B981" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="10" fill="url(#frivoGrad)" />
      {/* Floco de neve estilizado */}
      <g stroke="white" strokeWidth="2" strokeLinecap="round">
        <line x1="20" y1="9"  x2="20" y2="31" />
        <line x1="9"  y1="20" x2="31" y2="20" />
        <line x1="12.5" y1="12.5" x2="27.5" y2="27.5" />
        <line x1="27.5" y1="12.5" x2="12.5" y2="27.5" />
        {/* pontas decorativas */}
        <path d="M16.5 11 L20 9 L23.5 11" fill="none" />
        <path d="M16.5 29 L20 31 L23.5 29" fill="none" />
        <path d="M11 16.5 L9 20 L11 23.5" fill="none" />
        <path d="M29 16.5 L31 20 L29 23.5" fill="none" />
      </g>
    </svg>
  );
}
