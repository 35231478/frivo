import { Star } from "lucide-react";
import { NOTAS, textoDaAvaliacao } from "@/lib/os/aceite";

/**
 * A nota do cliente em estrelas (só leitura): cheias até a nota. A nota também vai por extenso
 * ("4 de 5 estrelas") — para o leitor de tela e para o PDF impresso sem cor.
 */
export function Estrelas({ nota, tamanho = "md" }: { nota: number; tamanho?: "sm" | "md" }) {
  const lado = tamanho === "sm" ? "w-4 h-4" : "w-5 h-5";
  return (
    <span className="inline-flex items-center gap-2 align-middle flex-wrap" role="img" aria-label={textoDaAvaliacao(nota)} data-estrelas={nota}>
      <span className="inline-flex items-center gap-0.5" aria-hidden>
        {NOTAS.map((n) => <Star key={n} className={`${lado} ${n <= nota ? "text-atencao fill-atencao" : "text-ink-subtle"}`} />)}
      </span>
      <span className="text-sm text-ink" aria-hidden>{textoDaAvaliacao(nota)}</span>
    </span>
  );
}
