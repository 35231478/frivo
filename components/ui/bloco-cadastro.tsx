import { Tag } from "lucide-react";

/** Bloco numerado do cadastro em página única (equipamento, veículo): título + descrição à esquerda no desktop. */
export function Bloco({ numero, titulo, descricao, opcional, children }: { numero: number; titulo: string; descricao: string; opcional?: boolean; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-surface-border rounded-2xl p-5 sm:p-6 lg:grid lg:grid-cols-[220px_1fr] lg:gap-8" data-bloco={titulo}>
      <header className="mb-4 lg:mb-0">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-primary-50 text-primary-700 text-xs font-bold flex items-center justify-center">{numero}</span>
          <h2 className="font-semibold text-ink">{titulo}</h2>
          {opcional && <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle bg-surface-alt px-1.5 py-0.5 rounded">opcional</span>}
        </div>
        <p className="text-xs text-ink-muted mt-1.5 leading-relaxed">{descricao}</p>
      </header>
      <div className="space-y-4 min-w-0">{children}</div>
    </section>
  );
}

/** Agrupa campos opcionais com um rótulo discreto, separados dos obrigatórios. */
export function Opcionais({ rotulo = "Opcionais", children }: { rotulo?: string; children: React.ReactNode }) {
  return (
    <div className="pt-4 border-t border-dashed border-surface-border">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle mb-3"><Tag className="w-3 h-3" /> {rotulo}</p>
      {children}
    </div>
  );
}
