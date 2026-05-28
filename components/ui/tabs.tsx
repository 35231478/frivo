"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface Tab {
  id: string;
  label: string;
  badge?: number;
}

interface TabsProps {
  tabs: Tab[];
  defaultTab?: string;
  children: (activeTab: string) => React.ReactNode;
}

export function Tabs({ tabs, defaultTab, children }: TabsProps) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.id ?? "");

  return (
    <div>
      <div className="border-b border-surface-border overflow-x-auto">
        <nav className="flex gap-0 -mb-px">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className={cn(
                "px-4 py-3 text-sm font-medium border-b-2 transition-all whitespace-nowrap",
                active === tab.id
                  ? "border-primary-500 text-primary-600"
                  : "border-transparent text-ink-muted hover:text-ink hover:border-surface-border",
              )}
            >
              {tab.label}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span
                  className={cn(
                    "ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full",
                    active === tab.id
                      ? "bg-primary-100 text-primary-700"
                      : "bg-surface-alt text-ink-muted"
                  )}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>
      <div className="pt-4">{children(active)}</div>
    </div>
  );
}
