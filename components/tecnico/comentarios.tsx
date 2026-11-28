"use client";

import { useEffect, useMemo, useState } from "react";
import { MessageCircle, MessageSquare, Send } from "lucide-react";
import { cn, formatarDataHora } from "@/lib/utils";
import { Dica } from "@/components/ui/dica";
import { irPara, useTecnico } from "@/components/tecnico/contexto";
import { novoClientId } from "@/lib/tecnico/offline/motor";
import { chaveVisto, novosComentarios, ordenarComentarios, TEXTO_MAX, type ComentarioTela } from "@/lib/tecnico/comentarios";
import { preencherCitacoes } from "@/lib/chat/regras";
import { Citacao } from "@/components/chat/citacao";
import type { ExecucaoTela, NovaOperacao } from "@/lib/tecnico/offline/tipos";

const VISIVEIS = 4;

/**
 * Comentários da OS: a conversa interna com o escritório (o cliente nunca vê). Grava no aparelho (sem sinal também);
 * as respostas do escritório chegam no retrato. Abrir a OS marca como visto neste aparelho.
 */
export function ComentariosDaOs({ x, registrar }: { x: ExecucaoTela; registrar: (ops: NovaOperacao[]) => Promise<void> }) {
  const { motor } = useTecnico();
  const osId = x.os.id;
  const lista = useMemo(() => preencherCitacoes(ordenarComentarios(x.comentarios ?? [])), [x.comentarios]);
  const [vistoAntes, setVistoAntes] = useState<string | null | undefined>(undefined);
  const [todos, setTodos] = useState(false);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);

  // O que era novo quando a OS abriu fica destacado nesta visita; o "visto" do aparelho avança para o mais recente
  useEffect(() => {
    if (!motor) return;
    let vivo = true;
    void motor.banco.ler<string>(chaveVisto(osId)).then((v) => { if (vivo) setVistoAntes((atual) => (atual === undefined ? v ?? null : atual)); });
    return () => { vivo = false; };
  }, [motor, osId]);
  const ultimo = lista.filter((c) => !c.pendente).at(-1)?.criadoEm ?? null;
  // Só depois de ler o "visto" anterior (senão a gravação ganha a corrida e o novo some antes de aparecer)
  const lido = vistoAntes !== undefined;
  useEffect(() => { if (motor && ultimo && lido) void motor.banco.gravar(chaveVisto(osId), ultimo); }, [motor, osId, ultimo, lido]);

  const novos = vistoAntes === undefined ? 0 : novosComentarios(lista, vistoAntes);
  const mostrar = todos ? lista : lista.slice(-VISIVEIS);
  const ehNovo = (c: ComentarioTela) => vistoAntes !== undefined && !c.meu && (!vistoAntes || c.criadoEm > vistoAntes);

  async function enviar() {
    const t = texto.trim();
    if (!t || enviando) return;
    setEnviando(true);
    try {
      await registrar([{ tipo: "comentario", atividadeId: x.atividade.id, dados: { clientId: novoClientId(), texto: t } }]);
      setTexto("");
    } finally { setEnviando(false); }
  }

  return (
    <section className="space-y-2" data-comentarios id="comentarios">
      <h2 className="text-base font-bold text-ink inline-flex items-center gap-1.5">
        <MessageSquare className="w-4 h-4 text-ink-muted" /> Comentários
        {novos > 0 && <span className="text-xs font-semibold rounded-full bg-acento text-white px-2 py-0.5" data-comentarios-novos={novos}>{novos === 1 ? "1 novo" : `${novos} novos`}</span>}
        <Dica rotulo="Comentários" texto="Conversa interna com o escritório sobre esta OS. O cliente não vê. Sem sinal, o comentário fica no aparelho e sobe sozinho." />
      </h2>
      {/* CHAT-1: a conversa com o Escritório (todas as OS; aqui ficam só as desta) */}
      <button type="button" onClick={() => irPara({ ver: "chat" })} data-abrir-chat
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-700 touch-target">
        <MessageCircle className="w-4 h-4" aria-hidden /> Abrir no Chat
      </button>
      {lista.length > VISIVEIS && !todos && (
        <button type="button" onClick={() => setTodos(true)} className="text-sm font-semibold text-primary-700 touch-target" data-ver-todos-comentarios>
          Ver os {lista.length} comentários
        </button>
      )}
      {mostrar.length > 0 && (
        <ul className="space-y-2">
          {mostrar.map((c) => (
            <li key={c.clientId ?? c.id} data-comentario={c.origem} data-pendente={c.pendente || undefined} data-novo={ehNovo(c) || undefined}
              className={cn("rounded-card border p-3 space-y-1", c.meu ? "bg-primary-50 border-primary-200 ml-6" : "bg-white border-surface-border mr-6", ehNovo(c) && "ring-2 ring-acento/40")}>
              <p className="text-xs text-ink-muted">
                <span className="font-semibold text-ink">{c.meu ? "Minha mensagem" : c.autor}</span>{c.origem === "ESCRITORIO" ? " · escritório" : ""} · {c.pendente ? "no aparelho" : formatarDataHora(c.criadoEm)}
              </p>
              {/* CHAT-1: a resposta mostra a citação, igual à do Chat (responder é pelo Chat) */}
              {c.respostaA && <Citacao c={c.respostaA} />}
              <p className="text-base text-ink whitespace-pre-line break-words">{c.texto}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={TEXTO_MAX} rows={2} placeholder="Escreva para o escritório" aria-label="Comentário para o escritório" data-novo-comentario
          className="flex-1 min-w-0 rounded-card border border-surface-border px-3 py-2.5 text-base resize-none" />
        <button type="button" onClick={enviar} disabled={!texto.trim() || enviando} aria-label="Enviar comentário" data-enviar-comentario
          className="shrink-0 rounded-card bg-primary-600 text-white w-14 h-14 inline-flex items-center justify-center disabled:opacity-40 touch-target">
          <Send className="w-6 h-6" />
        </button>
      </div>
    </section>
  );
}

/** Meu dia: quantos comentários novos há em cada OS do dia (pelo retrato guardado e o "visto" deste aparelho). */
export function useComentariosNovos(cartoes: { atividadeId: string; osId: string }[]): Map<string, number> {
  const { motor, estado } = useTecnico();
  const [mapa, setMapa] = useState<Map<string, number>>(() => new Map());
  const chave = cartoes.map((c) => c.atividadeId).join(",");
  useEffect(() => {
    if (!motor || !chave) return;
    let vivo = true;
    void Promise.all(cartoes.map(async (c) => {
      const [g, visto] = await Promise.all([motor.banco.retrato(c.atividadeId), motor.banco.ler<string>(chaveVisto(c.osId))]);
      return [c.atividadeId, novosComentarios(g?.retrato.execucao.comentarios, visto)] as const;
    })).then((l) => { if (vivo) setMapa(new Map(l.filter(([, n]) => n > 0))); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motor, chave, estado.versao]);
  return mapa;
}
