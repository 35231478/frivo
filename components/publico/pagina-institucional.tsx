// Moldura de leitura das páginas institucionais (jurídico/FAQ): título, linha de
// "última atualização" e uma coluna de leitura longa e confortável. Só diagrama —
// o conteúdo vem dos textos oficiais, inserido como children.

interface PaginaInstitucionalProps {
  titulo: string;
  /** Data por extenso da última revisão do texto (ex.: "11 de novembro de 2025"). */
  atualizacao: string;
  /** Linha curta opcional abaixo do título. */
  resumo?: string;
  children: React.ReactNode;
}

export function PaginaInstitucional({ titulo, atualizacao, resumo, children }: PaginaInstitucionalProps) {
  return (
    <div className="mx-auto max-w-3xl px-5 py-10 sm:py-14">
      <header className="mb-8 border-b border-surface-border pb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">{titulo}</h1>
        {resumo && <p className="mt-2 text-sm text-ink-muted sm:text-base">{resumo}</p>}
        <p className="mt-3 text-xs text-ink-muted">Última atualização: {atualizacao}</p>
      </header>
      {children}
    </div>
  );
}

/**
 * Coluna de leitura para texto jurídico longo (Privacidade, Termos). Dá a tipografia
 * de títulos de seção, parágrafos, listas e links sem repetir classe a cada elemento.
 */
export function ProseJuridica({ children }: { children: React.ReactNode }) {
  return (
    <article
      className="
        text-[15px] leading-relaxed text-ink sm:text-base
        [&_a]:text-acento [&_a]:underline [&_a]:underline-offset-2
        [&_h2]:mb-3 [&_h2]:mt-10 [&_h2]:scroll-mt-24 [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-ink sm:[&_h2]:text-xl
        [&_h2:first-child]:mt-0
        [&_h3]:mb-2 [&_h3]:mt-6 [&_h3]:font-display [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-ink
        [&_li]:text-ink/90
        [&_ol]:mb-4 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5
        [&_p]:mb-4 [&_p]:text-ink/90
        [&_strong]:font-semibold [&_strong]:text-ink
        [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5
      "
    >
      {children}
    </article>
  );
}
