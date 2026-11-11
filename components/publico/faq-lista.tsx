import { ChevronDown } from "lucide-react";

// FAQ em acordeão simples e acessível (<details>/<summary> nativos — sem JS).
// Toque ≥44px no cabeçalho de cada pergunta. O conteúdo vem do texto oficial.
export interface FaqItem {
  pergunta: string;
  resposta: React.ReactNode;
}

export function FaqLista({ itens }: { itens: FaqItem[] }) {
  return (
    <div className="divide-y divide-surface-border overflow-hidden rounded-card border border-surface-border bg-white">
      {itens.map((item, i) => (
        <details key={i} className="group">
          <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-left font-medium text-ink marker:content-none hover:bg-surface-page [&::-webkit-details-marker]:hidden">
            <span className="text-[15px] sm:text-base">{item.pergunta}</span>
            <ChevronDown
              className="h-5 w-5 shrink-0 text-ink-subtle transition-transform group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <div className="px-5 pb-5 pt-0 text-[15px] leading-relaxed text-ink/90 sm:text-base [&_a]:text-acento [&_a]:underline [&_a]:underline-offset-2 [&_li]:mb-1 [&_p]:mb-3 [&_p:last-child]:mb-0 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
            {item.resposta}
          </div>
        </details>
      ))}
    </div>
  );
}
