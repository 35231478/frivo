"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Camera, CheckCheck, MessageCircle, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dica } from "@/components/ui/dica";
import { ConversaEscritorio, type AlvoConversa, type ResumoConversa } from "@/components/chat/conversa-escritorio";
import { useNovidades } from "@/components/chat/use-novidades";
import { URL_NOVIDADES_ESCRITORIO } from "@/lib/chat/novidades-cliente";
import {
  filtrarConversas, horaDaLista, iniciais, textoDaUltima, urlConversaEscritorio, urlConversaPessoa, type ConversaResumo, type PessoaResumo,
} from "@/lib/chat/regras";

type SemConversa = { osId: string; osNumero: string; cliente: string };
type Visao = "pessoas" | "os";

const AJUDA = "Pessoas: a conversa com cada técnico, com e sem OS; cada mensagem leva a OS dela, e dentro da OS aparecem só as daquela OS. OS: uma conversa por OS, com todos os envolvidos. O cliente não vê. Atualiza sozinha enquanto esta tela está aberta.";

/**
 * CHAT-1 — a tela Conversas do escritório (estilo WhatsApp Web), com a chave "Pessoas | OS":
 *  - Pessoas (padrão, para quem tem a permissão "Conversas"): à esquerda os técnicos (foto ou iniciais, nome, última
 *    mensagem, hora e não lidas; não lidas primeiro); à direita a conversa com a pessoa, com a etiqueta da OS de cada
 *    grupo de mensagens e o seletor de OS acima do campo de texto;
 *  - OS: uma conversa por OS (nº, cliente, técnicos), como antes.
 * No celular, uma coisa de cada vez (a lista; tocar abre; voltar). A conversa aberta fica no endereço (?pessoa= ou ?os=),
 * para o push e o sino.
 */
export function ConversasEscritorio({ pessoaInicial, osInicial, podeEscrever, podeConversas, podeEnviarConversas }: {
  pessoaInicial: string | null; osInicial: string | null; podeEscrever: boolean; podeConversas: boolean; podeEnviarConversas: boolean;
}) {
  const router = useRouter();
  const [visao, setVisao] = useState<Visao>(osInicial || !podeConversas ? "os" : "pessoas");
  const [aberta, setAberta] = useState<AlvoConversa | null>(
    osInicial ? { tipo: "os", osId: osInicial } : pessoaInicial && podeConversas ? { tipo: "pessoa", usuarioId: pessoaInicial } : null);
  const [conversas, setConversas] = useState<ConversaResumo[] | null>(null);
  const [pessoas, setPessoas] = useState<PessoaResumo[] | null>(null);
  const [semConversa, setSemConversa] = useState<SemConversa[]>([]);
  const [busca, setBusca] = useState("");
  const [soNaoLidas, setSoNaoLidas] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resumo, setResumo] = useState<ResumoConversa | null>(null);
  // A conversa aberta está sendo lida: o contador dela fica zerado mesmo quando a lista chega depois dela
  const abertaRef = useRef(aberta);
  abertaRef.current = aberta;
  const chaveAberta = (a: AlvoConversa | null) => (a ? (a.tipo === "os" ? `os:${a.osId}` : `p:${a.usuarioId}`) : "");

  const carregar = useCallback(async (v: Visao, q: string) => {
    const qs = q.trim() ? `?busca=${encodeURIComponent(q.trim())}` : "";
    try {
      const r = await fetch(v === "pessoas" ? `/api/conversas/pessoas${qs}` : `/api/conversas${qs}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      const a = abertaRef.current;
      if (v === "pessoas") {
        if (!r.ok || !Array.isArray(j?.pessoas)) { setErro(j?.erro ?? "Não foi possível carregar as conversas."); setPessoas((c) => c ?? []); return; }
        setPessoas((j.pessoas as PessoaResumo[]).map((p) => (a?.tipo === "pessoa" && a.usuarioId === p.usuarioId ? { ...p, naoLidas: 0 } : p)));
      } else {
        if (!r.ok || !Array.isArray(j?.conversas)) { setErro(j?.erro ?? "Não foi possível carregar as conversas."); setConversas((c) => c ?? []); return; }
        setConversas((j.conversas as ConversaResumo[]).map((c) => (a?.tipo === "os" && a.osId === c.osId ? { ...c, naoLidas: 0 } : c)));
        setSemConversa(j.semConversa ?? []);
      }
      setErro(null);
    } catch {
      setErro("Sem conexão: a lista não foi atualizada.");
    }
  }, []);

  // A busca vai ao servidor (nome, nº de OS e cliente), com uma pausa de digitação
  useEffect(() => {
    const t = setTimeout(() => void carregar(visao, busca), busca ? 300 : 0);
    return () => clearTimeout(t);
  }, [busca, visao, carregar]);
  useNovidades(URL_NOVIDADES_ESCRITORIO, (r) => { if (r.mudou) void carregar(visao, busca); });

  function abrir(a: AlvoConversa | null) {
    setAberta(a);
    setResumo(null);
    router.replace(!a ? "/conversas" : a.tipo === "os" ? urlConversaEscritorio(a.osId) : urlConversaPessoa(a.usuarioId), { scroll: false });
  }
  function trocarVisao(v: Visao) {
    if (v === visao) return;
    setVisao(v); setBusca(""); setSoNaoLidas(false); abrir(null);
  }

  const aoCarregar = useCallback((r: ResumoConversa) => {
    setResumo(r);
    if (r.tipo === "os") setConversas((l) => l?.map((x) => (x.osId === r.conversa.osId ? { ...r.conversa, naoLidas: 0 } : x)) ?? l);
    else setPessoas((l) => l?.map((x) => (x.usuarioId === r.pessoa.usuarioId ? { ...x, naoLidas: 0 } : x)) ?? l);
  }, []);

  const conversasVisiveis = useMemo(() => filtrarConversas(conversas ?? [], "", soNaoLidas), [conversas, soNaoLidas]);
  const pessoasVisiveis = useMemo(() => (pessoas ?? []).filter((p) => !soNaoLidas || p.naoLidas > 0), [pessoas, soNaoLidas]);
  const lista = visao === "pessoas" ? pessoas : conversas;

  // O cabeçalho da conversa aberta
  const cabecalho = (() => {
    if (!aberta) return null;
    if (aberta.tipo === "pessoa") {
      const p = pessoas?.find((x) => x.usuarioId === aberta.usuarioId);
      const nome = p?.nome ?? (resumo?.tipo === "pessoa" ? resumo.pessoa.nome : "");
      return { titulo: nome || "Conversa", sub: "A OS de cada mensagem aparece na conversa", avatar: p?.avatar ?? (resumo?.tipo === "pessoa" ? resumo.pessoa.avatar : null), linkOs: null as string | null };
    }
    const c = conversas?.find((x) => x.osId === aberta.osId) ?? (resumo?.tipo === "os" ? resumo.conversa : null);
    return { titulo: `${c?.osNumero ?? "OS"}${c?.cliente ? ` · ${c.cliente}` : ""}`, sub: c?.tecnicos.length ? c.tecnicos.join(", ") : "Sem técnico na OS", avatar: null, linkOs: aberta.osId };
  })();

  return (
    <div className="space-y-3" data-conversas data-visao={visao}>
      <div className={cn("flex items-center justify-between gap-3 flex-wrap", aberta && "hidden lg:flex")}>
        <h1 className="page-title flex items-center gap-1.5">Conversas <Dica texto={AJUDA} rotulo="Conversas" lado="direita" /></h1>
        {podeConversas && (
          <div className="inline-flex rounded-full border border-surface-border bg-white p-0.5" role="tablist" aria-label="Ver as conversas por">
            {([["pessoas", "Pessoas"], ["os", "OS"]] as const).map(([v, r]) => (
              <button key={v} type="button" role="tab" aria-selected={visao === v} onClick={() => trocarVisao(v)} data-visao-chave={v}
                className={cn("rounded-full px-4 py-1.5 text-sm font-semibold", visao === v ? "bg-primary-600 text-white" : "text-ink-muted")}>{r}</button>
            ))}
          </div>
        )}
      </div>
      <div className="card p-0 overflow-hidden grid lg:grid-cols-[22rem_1fr] h-[calc(100dvh-11rem)] min-h-[28rem]">
        {/* Lista */}
        <aside className={cn("flex flex-col min-h-0 border-r border-surface-border", aberta && "hidden lg:flex")} data-lista-conversas>
          <div className="p-3 space-y-2 border-b border-surface-border">
            <label className="relative block">
              <Search className="w-4 h-4 text-ink-subtle absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} data-busca-conversas
                placeholder={visao === "pessoas" ? "Pesquisar nome, nº da OS ou cliente" : "Pesquisar OS, cliente ou técnico"} aria-label="Pesquisar conversa"
                className="w-full rounded-full border border-surface-border bg-surface-page pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40" />
              {busca && <button type="button" onClick={() => setBusca("")} aria-label="Limpar a pesquisa" className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-subtle"><X className="w-4 h-4" /></button>}
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
            {lista === null ? <p className="text-sm text-ink-muted p-4">Carregando…</p>
              : visao === "pessoas" ? (
                !pessoasVisiveis.length ? (
                  <p className="text-sm text-ink-muted p-4" data-sem-conversas>{soNaoLidas ? "Nenhuma conversa com mensagem por ler." : busca ? "Ninguém encontrado." : "Nenhum técnico com acesso ao app."}</p>
                ) : (
                  <ul>
                    {pessoasVisiveis.map((p) => {
                      const ativa = aberta?.tipo === "pessoa" && aberta.usuarioId === p.usuarioId;
                      return (
                        <li key={p.usuarioId}>
                          <button type="button" onClick={() => abrir({ tipo: "pessoa", usuarioId: p.usuarioId })} data-pessoa-item={p.usuarioId} aria-current={ativa || undefined}
                            className={cn("w-full text-left px-3 py-2.5 flex gap-3 border-b border-surface-linha hover:bg-surface-alt", ativa && "bg-primary-50")}>
                            {p.avatar
                              // eslint-disable-next-line @next/next/no-img-element
                              ? <img src={p.avatar} alt="" className="shrink-0 w-10 h-10 rounded-full object-cover" />
                              : <span className="shrink-0 w-10 h-10 rounded-full bg-primary-100 text-primary-700 inline-flex items-center justify-center text-sm font-bold" aria-hidden>{iniciais(p.nome)}</span>}
                            <span className="flex-1 min-w-0">
                              <span className="flex items-baseline justify-between gap-2">
                                <span className="font-semibold text-ink truncate">{p.nome}</span>
                                {p.ultima && <span className={cn("shrink-0 text-[11px]", p.naoLidas ? "text-primary-700 font-semibold" : "text-ink-subtle")}>{horaDaLista(p.ultima.criadoEm)}</span>}
                              </span>
                              <span className="flex items-center justify-between gap-2">
                                <span className="text-sm text-ink-muted truncate inline-flex items-center gap-1" data-ultima>
                                  {p.ultima?.minha && <CheckCheck className="w-3.5 h-3.5 shrink-0 text-ink-subtle" aria-label="Mensagem minha" />}
                                  {p.ultima?.foto && <Camera className="w-3.5 h-3.5 shrink-0" aria-hidden />}
                                  {p.ultima?.osNumero && <span className="shrink-0 text-[11px] font-semibold text-ink-subtle">{p.ultima.osNumero}</span>}
                                  <span className="truncate">{p.ultima ? textoDaUltima(p.ultima) : "Sem mensagens ainda."}</span>
                                </span>
                                {p.naoLidas > 0 && (
                                  <span className="shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-primary-600 text-white text-[11px] font-bold inline-flex items-center justify-center" data-nao-lidas={p.naoLidas}
                                    aria-label={p.naoLidas === 1 ? "1 mensagem não lida" : `${p.naoLidas} mensagens não lidas`}>{p.naoLidas}</span>
                                )}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )
              ) : !conversasVisiveis.length && !semConversa.length ? (
                <p className="text-sm text-ink-muted p-4" data-sem-conversas>{soNaoLidas ? "Nenhuma conversa com mensagem por ler." : busca ? "Nenhuma conversa encontrada." : "Nenhuma conversa ainda."}</p>
              ) : (
                <ul>
                  {conversasVisiveis.map((c) => {
                    const ativa = aberta?.tipo === "os" && aberta.osId === c.osId;
                    return (
                      <li key={c.osId}>
                        <button type="button" onClick={() => abrir({ tipo: "os", osId: c.osId })} data-conversa-item={c.osId} aria-current={ativa || undefined}
                          className={cn("w-full text-left px-3 py-2.5 flex gap-3 border-b border-surface-linha hover:bg-surface-alt", ativa && "bg-primary-50")}>
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
                    );
                  })}
                  {semConversa.length > 0 && !soNaoLidas && (
                    <li className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase text-ink-subtle">Começar conversa</li>
                  )}
                  {!soNaoLidas && semConversa.map((o) => (
                    <li key={o.osId}>
                      <button type="button" onClick={() => abrir({ tipo: "os", osId: o.osId })} data-comecar-conversa={o.osId}
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
        <section className={cn("flex-col min-h-0", aberta ? "flex" : "hidden lg:flex")} data-conversa-aberta={aberta ? chaveAberta(aberta) : undefined}>
          {aberta && cabecalho ? (
            <>
              <header className="flex items-center gap-2 px-3 py-2 border-b border-surface-border bg-white">
                <button type="button" onClick={() => abrir(null)} className="lg:hidden p-2 -ml-1 text-ink-muted touch-target" aria-label="Voltar às conversas" data-voltar-conversas>
                  <ArrowLeft className="w-5 h-5" />
                </button>
                {aberta.tipo === "pessoa" && (cabecalho.avatar
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={cabecalho.avatar} alt="" className="shrink-0 w-9 h-9 rounded-full object-cover" />
                  : <span className="shrink-0 w-9 h-9 rounded-full bg-primary-100 text-primary-700 inline-flex items-center justify-center text-sm font-bold" aria-hidden>{iniciais(cabecalho.titulo)}</span>)}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink truncate" data-titulo-conversa>
                    {cabecalho.linkOs ? <Link href={`/ordens/${cabecalho.linkOs}`} className="hover:underline" data-link-os>{cabecalho.titulo}</Link> : cabecalho.titulo}
                  </p>
                  <p className="text-xs text-ink-muted truncate">{cabecalho.sub}</p>
                </div>
              </header>
              <ConversaEscritorio key={chaveAberta(aberta)} alvo={aberta} className="flex-1" aoCarregar={aoCarregar}
                podeEscrever={aberta.tipo === "os" ? podeEscrever : podeEnviarConversas}
                semPermissao={aberta.tipo === "os" ? undefined : "Para escrever é preciso a permissão Conversas › Enviar."} />
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
