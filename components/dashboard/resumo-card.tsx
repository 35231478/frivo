import Link from "next/link";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface ResumoCardProps {
  titulo: string;
  valor: number;
  icone: LucideIcon;
  corIcone?: string;
  corFundo?: string;
  href: string;
  descricao?: string;
}

export function ResumoCard({
  titulo,
  valor,
  icone: Icone,
  corIcone = "text-success-600",
  corFundo = "bg-success-50",
  href,
  descricao,
}: ResumoCardProps) {
  return (
    <Link
      href={href}
      className="group bg-white rounded-xl border border-surface-border p-6 shadow-card hover:shadow-card-hover hover:border-primary-200 transition-all"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{titulo}</p>
          <p className="text-3xl font-bold text-ink mt-2 tracking-tight">
            {valor.toLocaleString("pt-BR")}
          </p>
          {descricao && (
            <p className="text-xs text-ink-subtle mt-1">{descricao}</p>
          )}
        </div>
        <div className={cn("p-3 rounded-xl shrink-0 transition-transform group-hover:scale-105", corFundo)}>
          <Icone className={cn("w-6 h-6", corIcone)} />
        </div>
      </div>
    </Link>
  );
}
