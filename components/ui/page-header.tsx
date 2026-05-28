import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  backHref: string;
  actions?: ReactNode;
}

export function PageHeader({ title, description, backHref, actions }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-6 gap-4">
      <div className="flex items-start gap-3">
        <Link
          href={backHref}
          className="mt-1 p-2 rounded-lg text-ink-muted hover:text-primary-600 hover:bg-surface-alt transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-ink tracking-tight">{title}</h1>
          {description && <p className="text-sm text-ink-muted mt-1">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
