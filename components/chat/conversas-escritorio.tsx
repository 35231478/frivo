"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Camera, CheckCheck, MessageCircle, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dica } from "@/components/ui/dica";
import { ConversaEscritorio } from "@/components/chat/conversa-escritorio";
import { useNovidades } from "@/components/chat/use-novidades";
import { URL_NOVIDADES_ESCRITORIO } from "@/lib/chat/novidades-cliente";
import { filtrarConversas, horaDaLista, textoDaUltima, urlConversaEscritorio, type ConversaResumo } from "@/lib/chat/regras";

type SemConversa = { osId: string; osNumero: string; cliente: string };

const AJUDA = "Uma conversa por OS, com os técnicos pelo app. O cliente não vê. A mesma conversa aparece no Resumo da OS. Atualiza sozinha enquanto esta tela está aberta. Para começar uma conversa, busque a OS pelo número ou pelo cliente.";

/**
 * CHAT-1 — a tela Conversas do escritório (estilo WhatsApp Web): à esquerda as conversas (nº da OS, cliente, técnicos,
 * última mensagem, hora e não lidas; busca e "Não lidas"); à direita a conversa aberta. No celular, uma coisa de cada
 * vez (a lista; tocar abre a conversa; voltar). A conversa aberta fica no endereço (?os=), para o push e o sino.
 */
export function ConversasEscritorio({ osInicial, podeEscrever }: { osInicial: string | null; podeEscrever: boolean }) {
  const router = useRouter();
  const [aberta, setAberta] = useState<string | null>(osInicial);
  const [conversas, setConversas] = useState<ConversaResumo[] | null>(null);
  const [semConversa, setSemConversa] = useState<SemConversa[]>([]);
  const [busca, setBusca] = useState("");
  const [soNaoLidas, setSoNaoLidas] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async (q: string) => {
    try {
      const r = await fetch(`/api/conversas${q.trim() ? `?busca=${encodeURIComponent(q.trim())}` : ""}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!r.ok || !Array.isArray(j?.conversas)) { setErro(j?.erro ?? "Não foi possível carregar as conversas."); setConversas((c) => c ?? []); return; }
      setErro(null);
      setConversas(j.conversas);
      setSemConversa(j.semConversa ?? []);
    } catch {
      setErro("Sem conexão: a lista não foi atualizada.");
      setConversas((c) => c ?? []);
    }
  }, []);

  // A busca vai ao servidor (acha também OS sem conversa e além das 100 mais recentes), com uma pausa de digitação
  useEffect(() => {
    const t = setTimeout(() => void carregar(busca), busca ? 300 : 0);
    return () => clearTimeout(t);
  }, [busca, carregar]);
  useNovidades(URL_NOVIDADES_ESCRITORIO, (r) => { if (r.mudou) void carregar(busca); });

  function abrir(osId: string | null) {
    setAberta(osId);
    router.replace(urlConversaEscritorio(osId), { scroll: false });
  }

  const visiveis = useMemo(() => filtrarConversas(conversas ?? [], "", soNaoLidas), [conversas, soNaoLidas]);
  const atual = conversas?.find((c) => c.osId === aberta) ?? null;
  // A conversa aberta zera o contador dela na lista (abrir marca como lida)
  const aoCarregar = useCallback((c: ConversaResumo) => {
    setConversas((l) => (l ? (l.some((x) => x.osId === c.osId) ? l.map((x) => (x.osId === c.osId ? { ...c, naoLidas: 0 } : x)) : l) : l));
  }, []);
  const [resumoAberta, setResumoAberta] = useState<ConversaResumo | null>(null);
  const cabecalho = atual ?? resumoAberta;

  return (
    <div className="space-y-3" data-conversas>
      <div className={cn(aberta && "hidden lg:block")}>
        <h1 className="page-title flex items-center gap-1.5">Conversas <Dica texto={AJUDA} rotulo="Conversas" lado="direita" /></h1>
      </div>
      <div className="card p-0 overflow-hidden grid lg:grid-cols-[22rem_1fr] h-[calc(100dvh-11rem)] min-h-[28rem]">
        {/* Lista */}
        <aside className={cn("flex flex-col min-h-0 border-r border-surface-border", aberta && "hidden lg:flex")} data-lista-conversas>
          <div className="p-3 space-y-2 border-b border-surface-border">
            <label className="relative block">
              <Search className="w-4 h-4 text-ink-subtle absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar OS, cliente ou técnico" aria-label="Buscar conversa" data-busca-conversas
                className="w-full rounded-full border border-surface-border bg-surface-page pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40" />
              {busca && <button type="button" onClick={() => setBusca("")} aria-label="Limpar a busca" className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-subtle"><X className="w-4 h-4" /></button>}
            </label>
            <div className="flex gap-2">
              {([[false, "Todas"], [true, "Não lidas"]] as const).map(([v, r]) => (
                <button key={r} type="button" onClick={() => setSoNaoLidas(v)} aria-pressed={soNaoLidas === v} data-filtro-conversas={v ? "nao-lidas" : "todas"}
                  className={cn("rounded-full px-3 py-1 text-xs font-semibold border", soNaoLidas === v ? "bg-primary-600 text-white border-primary-600" : "bg-white text-ink-muted border-surface-border")}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {erro && <p className="text-xs text-atrasado px-3 py-2" role="alert">{erro}</p>}
            {conversas === null ? <p className="text-sm text-ink-muted p-4">Carregando…</p>
              : !visiveis.length && !semConversa.length ? (
                <p className="text-sm text-ink-muted p-4" data-sem-conversas>{soNaoLidas ? "Nenhuma conversa com mensagem por ler." : busca ? "Nenhuma conversa encontrada." : "Nenhuma conversa ainda."}</p>
              ) : (
                <ul>
                  {visiveis.map((c) => (
                    <li key={c.osId}>
                      <button type="button" onClick={() => abrir(c.osId)} data-conversa-item={c.osId} aria-current={aberta === c.osId || undefined}
                        className={cn("w-full text-left px-3 py-2.5 flex gap-3 border-b border-surface-linha hover:bg-surface-alt", aberta === c.osId && "bg-primary-50")}>
                        <span className="shrink-0 w-10 h-10 rounded-full bg-primary-100 text-primary-700 inline-flex items-center justify-center" aria-hidden><MessageCircle className="w-5 h-5" /></span>
                        <span className="flex-1 min-w-0">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="font-semibold text-ink truncate">{c.osNumero} · {c.cliente}</span>
                            {c.ultima && <span className={cn("shrink-0 text-[11px]", c.naoLidas ? "text-primary-700 font-semibold" : "text-ink-subtle")}>{horaDaLista(c.ultima.criadoEm)}</span>}
                          </span>
                          {c.tecnicos.length > 0 && <span className="block text-[11px] text-ink-subtle truncate">{c.tecnicos.join(", ")}</span>}
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-sm text-ink-muted truncate inline-flex items-center gap-1" data-ultima>
                              {c.ultima?.minha && <CheckCheck className="w-3.5 h-3.5 shrink-0 text-ink-subtle" aria-label="Mensagem minha" />}
                              {c.ultima?.foto && <Camera className="w-3.5 h-3.5 shrink-0" aria-hidden />}
                              {c.ultima && !c.ultima.minha && <span className="font-medium text-ink">{c.ultima.autor.split(" ")[0]}:</span>}
                              <span className="truncate">{textoDaUltima(c.ultima)}</span>
                            </span>
                            {c.naoLidas > 0 && (
                              <span className="shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-primary-600 text-white text-[11px] font-bold inline-flex items-center justify-center" data-nao-lidas={c.naoLidas}
                                aria-label={c.naoLidas === 1 ? "1 mensagem não lida" : `${c.naoLidas} mensagens não lidas`}>{c.naoLidas}</span>
                            )}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                  {semConversa.length > 0 && !soNaoLidas && (
                    <li className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase text-ink-subtle">Começar conversa</li>
                  )}
                  {!soNaoLidas && semConversa.map((o) => (
                    <li key={o.osId}>
                      <button type="button" onClick={() => abrir(o.osId)} data-comecar-conversa={o.osId}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-surface-alt border-b border-surface-linha">
                        <span className="font-semibold text-ink">{o.osNumero}</span> · <span className="text-ink-muted">{o.cliente}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
          </div>
        </aside>

        {/* Conversa aberta */}
        <section className={cn("flex-col min-h-0", aberta ? "flex" : "hidden lg:flex")} data-conversa-aberta={aberta ?? undefined}>
          {aberta ? (
            <>
              <header className="flex items-center gap-2 px-3 py-2 border-b border-surface-border bg-white">
                <button type="button" onClick={() => abrir(null)} className="lg:hidden p-2 -ml-1 text-ink-muted touch-target" aria-label="Voltar às conversas" data-voltar-conversas>
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink truncate">
                    <Link href={`/ordens/${aberta}`} className="hover:underline" data-link-os>{cabecalho?.osNumero ?? "OS"}</Link>
                    {cabecalho?.cliente ? ` · ${cabecalho.cliente}` : ""}
                  </p>
                  <p className="text-xs text-ink-muted truncate">{cabecalho?.tecnicos.length ? cabecalho.tecnicos.join(", ") : "Sem técnico na OS"}</p>
                </div>
              </header>
              <ConversaEscritorio key={aberta} osId={aberta} podeEscrever={podeEscrever} className="flex-1"
                aoCarregar={(c) => { setResumoAberta(c); aoCarregar(c); }} />
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-ink-muted p-6 text-center" data-nenhuma-aberta>
              <MessageCircle className="w-10 h-10 text-ink-subtle" aria-hidden />
              <p className="text-sm">Escolha uma conversa à esquerda.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
