"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, MessageSquare, Send } from "lucide-react";
import { cn, formatarDataHora } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dica } from "@/components/ui/dica";
import { toast } from "@/components/ui/avisos";
import { atualizarSino } from "@/lib/ui/sino";
import { TEXTO_MAX, type ComentarioTela } from "@/lib/tecnico/comentarios";

/** De quanto em quanto tempo a conversa se atualiza sozinha enquanto a OS está aberta e visível */
export const INTERVALO_COMENTARIOS_MS = 20_000;

/**
 * OS › Resumo: a conversa interna com o técnico (o app) — TODOS os comentários da OS, de todas as atividades (o do
 * app com a marca da atividade). Abrir marca como lido (o aviso do sino apaga). Responder é de quem edita a OS. O
 * cliente nunca vê.
 * Hotfix: antes a conversa era lida UMA vez, ao abrir a OS — o que o técnico escrevia depois não aparecia até
 * recarregar a página, e um erro da leitura virava "Nenhum comentário". Agora ela se atualiza a cada 20 s enquanto a
 * aba está visível e ao voltar para a aba, e o erro aparece como erro.
 */
export function ComentariosOs({ osId, podeResponder }: { osId: string; podeResponder: boolean }) {
  const [lista, setLista] = useState<ComentarioTela[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/ordens/${osId}/comentarios`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!r.ok || !Array.isArray(j?.comentarios)) {
        setErro(j?.erro ?? "Não foi possível carregar os comentários.");
        setLista((l) => l ?? []);
        return;
      }
      setErro(null);
      setLista(j.comentarios);
      atualizarSino();
    } catch {
      setErro("Sem conexão: os comentários não foram atualizados.");
      setLista((l) => l ?? []);
    }
  }, [osId]);
  useEffect(() => {
    void carregar();
    const visivel = () => typeof document === "undefined" || document.visibilityState === "visible";
    const t = setInterval(() => { if (visivel()) void carregar(); }, INTERVALO_COMENTARIOS_MS);
    const voltou = () => { if (visivel()) void carregar(); };
    document.addEventListener("visibilitychange", voltou);
    window.addEventListener("focus", voltou);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", voltou); window.removeEventListener("focus", voltou); };
  }, [carregar]);

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
        <Dica rotulo="Comentários" texto="Conversa interna com o técnico pelo app, de todas as atividades da OS. Atualiza sozinha enquanto a OS está aberta. O cliente não vê. O técnico recebe a resposta na próxima sincronização do app." lado="direita" />
      </h3>
      {lista === null && <div className="py-2"><Loader2 className="w-4 h-4 animate-spin text-ink-subtle" /></div>}
      {erro && <p role="alert" className="text-sm text-atrasado-texto bg-atrasado-claro rounded-lg px-3 py-2" data-erro-comentarios>{erro}</p>}
      {lista !== null && !lista.length && !erro && <p className="text-sm text-ink-muted" data-sem-comentarios>Nenhum comentário.</p>}
      {lista !== null && lista.length > 0 && (
        <ul className="space-y-2 max-h-96 overflow-y-auto">
          {lista.map((c) => (
            <li key={c.id ?? c.clientId} data-comentario-os={c.origem} data-novo={c.novo ? "sim" : undefined}
              className={cn("rounded-lg border px-3 py-2 text-sm", c.origem === "APP" ? "bg-white border-surface-border mr-10" : "bg-primary-50 border-primary-200 ml-10", c.novo && "ring-2 ring-acento/40")}>
              <p className="text-xs text-ink-muted">
                <span className="font-semibold text-ink">{c.autor}</span> · {c.origem === "APP" ? "app" : "escritório"} · {formatarDataHora(c.criadoEm)}
                {c.novo && <span className="ml-1.5 text-[10px] font-semibold uppercase text-acento" data-comentario-novo>novo</span>}
              </p>
              {c.atividade && <p className="text-[11px] text-ink-muted" data-comentario-atividade>Atividade: {c.atividade}</p>}
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
