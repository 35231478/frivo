"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Calculator, ClipboardList, FileSignature, Globe, Loader2, Mail, MessageSquare, ShoppingCart, Wallet,
} from "lucide-react";
import { cn, formatarDataHora } from "@/lib/utils";
import {
  agruparPorMes, contarPorTipo, filtrarEventos, ROTULO_TIPO_HISTORICO, TIPOS_HISTORICO,
  type EventoCliente, type TipoHistorico,
} from "@/lib/clientes/historico";

const ICONE: Record<TipoHistorico, React.ComponentType<{ className?: string }>> = {
  os: ClipboardList, orcamento: Calculator, financeiro: Wallet, pedido: ShoppingCart,
  portal: Globe, comunicacao: Mail, contrato: FileSignature, nota: MessageSquare,
};

/**
 * Leva H — o HISTÓRICO AUTOMÁTICO do cliente: a linha do tempo do que o sistema já registra (OS, orçamentos,
 * faturas e pagamentos, pedidos, ações do cliente pelo link/portal, e-mails e lembretes, contratos), com filtro
 * por tipo. As notas antigas ("interações") aparecem como "Notas". Carrega na primeira vez que a aba abre.
 */
export function HistoricoCliente({ clienteId, ativo }: { clienteId: string; ativo: boolean }) {
  const [eventos, setEventos] = useState<EventoCliente[] | null>(null);
  const [erro, setErro] = useState(false);
  const [tipo, setTipo] = useState<TipoHistorico | "todos">("todos");

  useEffect(() => {
    if (!ativo || eventos) return;
    let vivo = true;
    fetch(`/api/clientes/${clienteId}/historico`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { eventos: (Omit<EventoCliente, "quando"> & { quando: string })[] }) => {
        if (vivo) setEventos(d.eventos.map((e) => ({ ...e, quando: new Date(e.quando) })));
      })
      .catch(() => vivo && setErro(true));
    return () => { vivo = false; };
  }, [ativo, clienteId, eventos]);

  const contagem = useMemo(() => contarPorTipo(eventos ?? []), [eventos]);
  const grupos = useMemo(() => agruparPorMes(filtrarEventos(eventos ?? [], tipo)), [eventos, tipo]);

  if (erro) return <p className="text-sm text-atrasado-texto" data-historico-erro>Não foi possível carregar o histórico. Recarregue a página.</p>;
  if (!eventos) return <p className="text-sm text-ink-muted flex items-center gap-2" data-historico-carregando><Loader2 className="w-4 h-4 animate-spin" /> Carregando o histórico…</p>;
  if (eventos.length === 0) return <p className="text-sm text-ink-muted" data-historico-vazio>Nada registrado ainda para este cliente.</p>;

  const tipos = TIPOS_HISTORICO.filter((t) => (contagem[t] ?? 0) > 0);
  return (
    <div className="space-y-5" data-historico-cliente>
      {tipos.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" role="group" aria-label="Filtrar por tipo" data-filtro-historico>
          {(["todos", ...tipos] as const).map((t) => {
            const ativa = tipo === t;
            return (
              <button key={t} type="button" onClick={() => setTipo(t)} aria-pressed={ativa} data-filtro={t}
                className={cn("shrink-0 min-h-[44px] px-3.5 rounded-full border text-sm font-medium whitespace-nowrap transition-colors",
                  ativa ? "bg-acento border-acento text-white" : "bg-white border-surface-border text-ink-muted hover:text-ink hover:bg-surface-alt")}>
                {t === "todos" ? "Tudo" : ROTULO_TIPO_HISTORICO[t]}
                <span className={cn("ml-1.5 text-xs", ativa ? "text-white/80" : "text-ink-subtle")}>{t === "todos" ? eventos.length : contagem[t]}</span>
              </button>
            );
          })}
        </div>
      )}

      {grupos.map((g) => (
        <section key={g.chave} data-mes={g.chave}>
          <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">{g.rotulo}</h3>
          <ol className="relative border-l border-surface-border ml-3 space-y-1">
            {g.eventos.map((e) => {
              const Icone = ICONE[e.tipo];
              return (
                <li key={e.id} className="relative pl-6 py-2" data-evento={e.tipo}>
                  <span className="absolute -left-3 top-2 flex items-center justify-center w-6 h-6 rounded-full bg-white border border-surface-border text-ink-muted">
                    <Icone className="w-3.5 h-3.5" aria-hidden />
                  </span>
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    {e.href
                      ? <Link href={e.href} className="text-sm font-medium text-ink hover:text-acento hover:underline break-words" data-evento-titulo>{e.titulo}</Link>
                      : <p className="text-sm font-medium text-ink break-words" data-evento-titulo>{e.titulo}</p>}
                    <time className="text-xs text-ink-subtle tabular-nums shrink-0" dateTime={e.quando.toISOString()}>{formatarDataHora(e.quando)}</time>
                  </div>
                  {(e.detalhe || e.autor) && (
                    <p className="text-sm text-ink-muted mt-0.5 break-words whitespace-pre-line line-clamp-3">
                      {e.detalhe}{e.detalhe && e.autor ? " · " : ""}{e.autor ? `por ${e.autor}` : ""}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
