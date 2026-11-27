"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, MessageSquare, Send } from "lucide-react";
import { cn, formatarDataHora } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dica } from "@/components/ui/dica";
import { toast } from "@/components/ui/avisos";
import { atualizarSino } from "@/lib/ui/sino";
import { TEXTO_MAX, type ComentarioTela } from "@/lib/tecnico/comentarios";

/**
 * OS › Resumo: a conversa interna com o técnico (o app). Abrir marca como lido (o aviso do sino apaga). Responder é de
 * quem edita a OS. O cliente nunca vê.
 */
export function ComentariosOs({ osId, podeResponder }: { osId: string; podeResponder: boolean }) {
  const [lista, setLista] = useState<ComentarioTela[] | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/ordens/${osId}/comentarios`, { cache: "no-store" });
      const l = r.ok ? (await r.json().catch(() => null))?.comentarios : null;
      setLista(Array.isArray(l) ? l : []);
      if (r.ok) atualizarSino();
    } catch { setLista([]); }
  }, [osId]);
  useEffect(() => { void carregar(); }, [carregar]);

  async function responder() {
    const t = texto.trim();
    if (!t) return;
    setEnviando(true);
    const r = await fetch(`/api/ordens/${osId}/comentarios`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texto: t }) });
    const j = await r.json().catch(() => null);
    setEnviando(false);
    if (!r.ok) { toast(j?.erro ?? "Não foi possível enviar.", "erro"); return; }
    setTexto("");
    setLista((l) => [...(l ?? []), j.comentario]);
  }

  return (
    <section className="space-y-3" data-comentarios-os id="comentarios">
      <h3 className="section-title inline-flex items-center gap-1.5"><MessageSquare className="w-4 h-4 text-ink-subtle" /> Comentários
        <Dica rotulo="Comentários" texto="Conversa interna com o técnico pelo app. O cliente não vê. O técnico recebe a resposta na próxima sincronização do app." lado="direita" />
      </h3>
      {lista === null && <div className="py-2"><Loader2 className="w-4 h-4 animate-spin text-ink-subtle" /></div>}
      {lista !== null && !lista.length && <p className="text-sm text-ink-muted" data-sem-comentarios>Nenhum comentário.</p>}
      {lista !== null && lista.length > 0 && (
        <ul className="space-y-2 max-h-96 overflow-y-auto">
          {lista.map((c) => (
            <li key={c.id ?? c.clientId} data-comentario-os={c.origem}
              className={cn("rounded-lg border px-3 py-2 text-sm", c.origem === "APP" ? "bg-white border-surface-border mr-10" : "bg-primary-50 border-primary-200 ml-10")}>
              <p className="text-xs text-ink-muted"><span className="font-semibold text-ink">{c.autor}</span> · {c.origem === "APP" ? "app" : "escritório"} · {formatarDataHora(c.criadoEm)}</p>
              <p className="text-ink whitespace-pre-line break-words">{c.texto}</p>
            </li>
          ))}
        </ul>
      )}
      {podeResponder && (
        <div className="flex items-end gap-2">
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={TEXTO_MAX} rows={2} placeholder="Responder ao técnico" aria-label="Comentário para o técnico" data-responder-comentario
            className="flex-1 min-w-0 rounded-lg border border-surface-border px-3 py-2 text-sm resize-none" />
          <Button onClick={responder} loading={enviando} disabled={!texto.trim()} data-enviar-comentario-os><Send className="w-4 h-4" /> Enviar</Button>
        </div>
      )}
    </section>
  );
}
