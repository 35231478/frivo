"use client";

import { Star } from "lucide-react";
import { AVALIACAO_COMENTARIO_MAX, NOTAS, ROTULO_NOTA, nomeDaNota, textoDaAvaliacao } from "@/lib/os/aceite";

/**
 * A AVALIAÇÃO do serviço no momento do aceite: de 1 a 5 estrelas e, para quem deu nota, um comentário.
 * É sempre OPCIONAL — quem não toca nas estrelas confirma do mesmo jeito; tocar de novo na mesma
 * estrela tira a nota. O comentário é da avaliação (não é a ressalva).
 */
export function AvaliacaoDoCliente({ nota, comentario, aoMudarNota, aoMudarComentario, desabilitado = false }: {
  nota: number | null; comentario: string;
  aoMudarNota: (nota: number | null) => void; aoMudarComentario: (texto: string) => void;
  desabilitado?: boolean;
}) {
  return (
    <fieldset className="border border-surface-border rounded-lg px-3 pb-3 pt-1 space-y-2 min-w-0" data-avaliacao-cliente={nota ?? ""}>
      <legend className="text-sm font-semibold text-ink px-1">Como foi o serviço? <span className="font-normal text-ink-muted">(opcional)</span></legend>
      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
        <div role="radiogroup" aria-label="Avaliação do serviço" className="inline-flex items-center">
          {NOTAS.map((n) => (
            <button key={n} type="button" role="radio" aria-checked={nota === n} aria-label={nomeDaNota(n)} disabled={desabilitado} data-estrela={n}
              onClick={() => aoMudarNota(nota === n ? null : n)}
              className="p-1.5 rounded-lg touch-target focus:outline-none focus-visible:ring-4 focus-visible:ring-primary-500/20 disabled:opacity-60">
              <Star className={`w-8 h-8 ${nota !== null && n <= nota ? "text-atencao fill-atencao" : "text-ink-subtle"}`} aria-hidden />
            </button>
          ))}
        </div>
        <span className="text-sm text-ink-muted" aria-live="polite" data-avaliacao-rotulo>
          {nota ? `${textoDaAvaliacao(nota)} · ${ROTULO_NOTA[nota]}` : "Toque nas estrelas para avaliar"}
        </span>
      </div>
      {nota !== null && (
        <label className="block">
          <span className="text-sm text-ink">Comentário <span className="text-ink-muted">(opcional)</span></span>
          <textarea aria-label="Comentário da avaliação" value={comentario} maxLength={AVALIACAO_COMENTARIO_MAX} rows={2} disabled={desabilitado}
            onChange={(e) => aoMudarComentario(e.target.value)} placeholder="Algo sobre o atendimento"
            className="mt-1 w-full bg-white border border-surface-border rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10" />
        </label>
      )}
    </fieldset>
  );
}
