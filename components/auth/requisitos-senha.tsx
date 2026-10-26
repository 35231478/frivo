import { Check, Circle } from "lucide-react";
import { REQUISITOS_SENHA } from "@/lib/acesso/senha";
import { cn } from "@/lib/utils";

/** Lista os requisitos da senha nova, marcando ao vivo o que já foi atendido. */
export function RequisitosSenha({ senha, className }: { senha: string; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-x-4 gap-y-1 text-xs", className)} aria-label="Requisitos da senha">
      {REQUISITOS_SENHA.map((r) => {
        const ok = r.ok(senha);
        return (
          <li key={r.id} data-requisito={r.id} data-ok={ok} className={cn("inline-flex items-center gap-1", ok ? "text-ok-texto" : "text-ink-muted")}>
            {ok ? <Check className="w-3.5 h-3.5" /> : <Circle className="w-3 h-3" />} {r.texto}
          </li>
        );
      })}
    </ul>
  );
}
