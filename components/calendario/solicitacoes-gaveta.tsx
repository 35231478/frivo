"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Inbox, X, Check, MapPin, Phone, CalendarClock, Wrench, Loader2, ExternalLink, AlertTriangle, Image as ImageIcon, QrCode, Headset } from "lucide-react";
import { cn, formatarData, LABELS_PRIORIDADE } from "@/lib/utils";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { OsInativarBotao } from "@/components/os/os-inativar";
import { URL_SOLICITACOES } from "@/lib/solicitacoes";

interface Solicitacao {
  id: string; numero: string; canal: string; prioridade: string; descricao: string; criadoEm: string;
  cliente: string; endereco: string | null; equipamento: string | null;
  contato: string | null; fotos: number;
}

/**
 * Gaveta lateral de Solicitações (triagem rápida dos chamados de clientes) na tela de Calendário.
 * - Fonte: OS de origem PORTAL_CLIENTE em AGUARDANDO_ATENDIMENTO (portal do cliente e QR Code).
 * - Aceitar: abre a tela de Nova OS (modo solicitação) para escolher data/hora — exige `ordens.editar`.
 * - Recusar: mesmo fluxo de inativar da OS (vira Cancelada, motivo no histórico) — exige `ordens.excluir`.
 * Desktop: painel à direita (o calendário encolhe e continua visível). Celular: painel que sobe.
 */
export function SolicitacoesGaveta({ totalInicial, children }: { totalInicial: number; children: React.ReactNode }) {
  const router = useRouter();
  const { pode } = usePermissoes();
  const podeAceitar = pode("ordens", "editar");
  const podeRecusar = pode("ordens", "excluir");
  const permitido = podeAceitar || podeRecusar;

  const [aberta, setAberta] = useState(false);
  const [total, setTotal] = useState(totalInicial);
  const [lista, setLista] = useState<Solicitacao[] | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => { setTotal(totalInicial); }, [totalInicial]);

  const carregar = useCallback(async () => {
    setErro("");
    try {
      const res = await fetch("/api/solicitacoes", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(data)) { setErro(data?.erro ?? "Não foi possível carregar as solicitações."); return; }
      setLista(data); setTotal(data.length);
    } catch { setErro("Erro de conexão."); }
  }, []);

  useEffect(() => { if (aberta) carregar(); }, [aberta, carregar]);

  useEffect(() => {
    if (!aberta) return;
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector('[role="dialog"]')) setAberta(false); };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aberta]);

  function removida(id: string) {
    setLista((l) => l?.filter((s) => s.id !== id) ?? l);
    setTotal((t) => Math.max(0, t - 1));
    router.refresh();
  }

  if (!permitido) return <>{children}</>;

  return (
    <>
      {/* No desktop largo o calendário abre espaço para a gaveta e continua visível ao lado */}
      <div className={cn("transition-[padding] duration-200", aberta && "xl:pr-[24rem]")}>{children}</div>

      {/* ── Aba fixa (desktop/tablet): lateral direita ── */}
      {!aberta && (
        <button
          type="button"
          onClick={() => setAberta(true)}
          data-gaveta-aba
          title={`Solicitações de clientes (${total} pendente${total === 1 ? "" : "s"})`}
          className={cn(
            "hidden md:flex fixed right-0 top-1/2 -translate-y-1/2 z-40 flex-col items-center gap-2 py-3 px-2",
            "rounded-l-xl bg-primary-600 hover:bg-primary-700 text-white shadow-lg shadow-primary-900/20 transition-colors",
            total > 0 && "anim-gaveta-acena",
          )}
        >
          <Inbox className="w-4 h-4" />
          <span className="text-xs font-semibold tracking-wide [writing-mode:vertical-rl] rotate-180">Solicitações</span>
          <ContadorBolha total={total} />
        </button>
      )}

      {/* ── Botão flutuante (celular): acima do menu inferior ── */}
      {!aberta && (
        <button
          type="button"
          onClick={() => setAberta(true)}
          data-gaveta-aba-mobile
          className={cn(
            "md:hidden fixed right-4 bottom-24 z-40 inline-flex items-center gap-2 pl-3 pr-2 py-2.5 rounded-full",
            "bg-primary-600 text-white text-sm font-semibold shadow-lg shadow-primary-900/25",
            total > 0 && "anim-gaveta-acena",
          )}
        >
          <Inbox className="w-4 h-4" /> Solicitações <ContadorBolha total={total} />
        </button>
      )}

      {aberta && (
        <>
          {/* Fundo só no celular/tablet (no desktop o calendário segue utilizável) */}
          <div className="xl:hidden fixed inset-0 z-40 bg-black/30" onClick={() => setAberta(false)} aria-hidden />
          <aside
            data-gaveta
            aria-label="Solicitações de clientes"
            className={cn(
              "fixed z-50 bg-white flex flex-col shadow-2xl",
              // celular: painel que sobe (quase tela cheia)
              "inset-x-0 bottom-0 h-[92dvh] rounded-t-2xl anim-gaveta-sobe",
              // tablet/desktop: barra lateral à direita
              "md:inset-x-auto md:right-0 md:top-0 md:bottom-0 md:h-auto md:w-[24rem] md:rounded-none md:border-l md:border-surface-border md:anim-gaveta-entra",
            )}
          >
            <div className="md:hidden mx-auto mt-2 h-1.5 w-10 rounded-full bg-surface-border" aria-hidden />
            <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-surface-border">
              <div className="flex items-center gap-2 min-w-0">
                <div className="p-1.5 rounded-lg bg-primary-50 text-primary-600"><Inbox className="w-4 h-4" /></div>
                <div className="min-w-0">
                  <h2 className="font-semibold text-ink leading-tight">Solicitações</h2>
                  <p className="text-xs text-ink-muted" data-gaveta-total>
                    {total} pendente{total === 1 ? "" : "s"} · portal do cliente e QR Code
                  </p>
                </div>
              </div>
              <button type="button" onClick={() => setAberta(false)} title="Fechar solicitações" className="p-1.5 rounded-lg text-ink-muted hover:bg-surface-alt">
                <X className="w-4 h-4" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-surface-alt/40">
              {erro && (
                <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {erro}
                </div>
              )}
              {lista === null && !erro && (
                <p className="flex items-center justify-center gap-2 text-sm text-ink-muted py-10"><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</p>
              )}
              {lista?.length === 0 && (
                <div className="text-center py-12 px-4">
                  <Check className="w-8 h-8 mx-auto text-emerald-500" />
                  <p className="mt-2 text-sm font-medium text-ink">Nenhuma solicitação pendente</p>
                  <p className="text-xs text-ink-muted">Os chamados que os clientes abrirem pelo portal ou QR Code aparecem aqui.</p>
                </div>
              )}
              {lista?.map((s) => (
                <article key={s.id} data-solicitacao={s.id} className="bg-white border border-surface-border rounded-xl p-3 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-primary-600">{s.numero}</span>
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-cyan-50 text-cyan-700 px-1.5 py-0.5 rounded">
                      {s.canal === "QR Code" ? <QrCode className="w-3 h-3" /> : <Headset className="w-3 h-3" />} {s.canal}
                    </span>
                  </div>
                  <p className="mt-1 font-semibold text-ink leading-snug">{s.cliente}</p>
                  <p className="mt-1 text-sm text-ink whitespace-pre-line line-clamp-4">{s.descricao}</p>

                  <dl className="mt-2 space-y-1 text-xs text-ink-muted">
                    <div className="flex items-start gap-1.5">
                      <CalendarClock className="w-3.5 h-3.5 shrink-0 mt-px" />
                      <span>Enviada em {formatarData(s.criadoEm, "dd/MM/yyyy 'às' HH:mm")}</span>
                    </div>
                    {s.endereco && <div className="flex items-start gap-1.5"><MapPin className="w-3.5 h-3.5 shrink-0 mt-px" /> <span>{s.endereco}</span></div>}
                    {s.equipamento && <div className="flex items-start gap-1.5"><Wrench className="w-3.5 h-3.5 shrink-0 mt-px" /> <span>{s.equipamento}</span></div>}
                    {s.contato && <div className="flex items-start gap-1.5"><Phone className="w-3.5 h-3.5 shrink-0 mt-px" /> <span className="break-all">{s.contato}</span></div>}
                    <div className="flex items-center gap-2 pt-0.5">
                      <span className="font-medium">Prioridade: {LABELS_PRIORIDADE[s.prioridade] ?? s.prioridade}</span>
                      {s.fotos > 0 && <span className="inline-flex items-center gap-1"><ImageIcon className="w-3 h-3" /> {s.fotos} foto{s.fotos === 1 ? "" : "s"}</span>}
                    </div>
                  </dl>

                  <div className="mt-3 flex items-center gap-2">
                    {podeAceitar && (
                      <Link
                        href={`/ordens/nova?solicitacao=${s.id}`}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold"
                      >
                        <Check className="w-4 h-4" /> Aceitar
                      </Link>
                    )}
                    <OsInativarBotao
                      osId={s.id} numero={s.numero} status="AGUARDANDO_ATENDIMENTO" modo="recusar"
                      className="flex-1 justify-center py-2"
                      onAlterado={() => removida(s.id)}
                    />
                  </div>
                </article>
              ))}
            </div>

            <footer className="p-3 border-t border-surface-border">
              <Link href={URL_SOLICITACOES} className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-surface-border text-sm font-medium text-ink hover:bg-surface-alt">
                <ExternalLink className="w-4 h-4" /> Abrir solicitações (tela completa)
              </Link>
            </footer>
          </aside>
        </>
      )}
    </>
  );
}

function ContadorBolha({ total }: { total: number }) {
  return (
    <span className="relative inline-flex" data-gaveta-contador>
      {total > 0 && <span className="absolute inset-0 rounded-full bg-amber-300 animate-ping opacity-60 motion-reduce:hidden" />}
      <span className={cn("relative min-w-[1.25rem] h-5 px-1 rounded-full text-[11px] font-bold flex items-center justify-center tabular-nums",
        total > 0 ? "bg-amber-400 text-amber-950" : "bg-white/25 text-white")}>
        {total}
      </span>
    </span>
  );
}
