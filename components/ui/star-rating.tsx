"use client";

import { cn } from "@/lib/utils";
import { Star } from "lucide-react";

interface StarRatingProps {
  value: number | null | undefined;
  onChange?: (value: number) => void;
  size?: "sm" | "md";
  readOnly?: boolean;
}

export function StarRating({ value, onChange, size = "md", readOnly = !onChange }: StarRatingProps) {
  const current = value ?? 0;
  const sizeClass = size === "sm" ? "w-3.5 h-3.5" : "w-5 h-5";

  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={readOnly}
          onClick={() => onChange?.(current === n ? 0 : n)}
          className={cn(
            "transition-colors",
            readOnly ? "cursor-default" : "cursor-pointer hover:scale-110",
          )}
          title={readOnly ? `${current} de 5` : `${n} estrela${n > 1 ? "s" : ""}`}
        >
          <Star
            className={cn(
              sizeClass,
              n <= current
                ? "text-amber-400 fill-amber-400"
                : "text-gray-300",
            )}
          />
        </button>
      ))}
    </div>
  );
}
