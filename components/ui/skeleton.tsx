import { cn } from "@/lib/utils";

/** Bloco base de carregamento (shimmer). Reaproveitado pelos loading.tsx das rotas. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-surface-border/70", className)} />;
}

/** Cabeçalho de página (título + ação) em estado de carregamento. */
export function SkeletonHeader() {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Skeleton className="w-9 h-9 rounded-lg" />
        <Skeleton className="h-7 w-40" />
      </div>
      <Skeleton className="h-10 w-36 rounded-lg" />
    </div>
  );
}

/** Grade de cartões de resumo (dashboard e páginas com KPIs). */
export function SkeletonCards({ quantidade = 4 }: { quantidade?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: quantidade }).map((_, i) => (
        <div key={i} className="card-padded space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="w-9 h-9 rounded-lg" />
          </div>
          <Skeleton className="h-8 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Tabela genérica em carregamento (filtros + linhas). */
export function SkeletonTable({ linhas = 8, colunas = 5 }: { linhas?: number; colunas?: number }) {
  return (
    <div className="card overflow-hidden">
      <div className="p-4 border-b border-surface-border flex flex-wrap gap-3 bg-surface-alt/40">
        <Skeleton className="h-10 flex-1 min-w-[200px] rounded-lg" />
        <Skeleton className="h-10 w-40 rounded-lg" />
        <Skeleton className="h-10 w-28 rounded-lg" />
      </div>
      <div className="divide-y divide-surface-border">
        {Array.from({ length: linhas }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-4">
            {Array.from({ length: colunas }).map((_, j) => (
              <Skeleton key={j} className={cn("h-4", j === 0 ? "flex-1" : "w-20 hidden sm:block")} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
