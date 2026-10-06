"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Check, Copy, Loader2, Send, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Painel de chat do Frivo IA (no dashboard). Só pergunta e mostra respostas: a IA lê dados
 * do sistema conforme o perfil do usuário e não altera nada.
 */

interface Mensagem { papel: "usuario" | "assistente"; texto: string; erro?: boolean }

const SUGESTOES: { texto: string; ferramenta: string }[] = [
  { texto: "Resumo de hoje", ferramenta: "resumo_periodo" },
  { texto: "Quais OS estão atrasadas?", ferramenta: "listar_os" },
  { texto: "Como está o contas a receber?", ferramenta: "resumo_financeiro" },
  { texto: "Contratos vencendo nos próximos 60 dias", ferramenta: "status_contrato" },
];

/** Negrito **assim**, sem HTML: o texto da IA nunca vira marcação crua. */
function linhaFormatada(linha: string) {
  return linha.split(/(\*\*[^*]+\*\*)/g).map((parte, i) =>
    parte.startsWith("**") && parte.endsWith("**") && parte.length > 4
      ? <strong key={i} className="font-semibold">{parte.slice(2, -2)}</strong>
      : <Fragment key={i}>{parte}</Fragment>,
  );
}

function TextoIA({ texto }: { texto: string }) {
  return (
    <div className="space-y-1.5 text-sm leading-relaxed break-words">
      {texto.split("\n").map((l, i) => {
        const s = l.trimEnd();
        if (!s.trim()) return <div key={i} className="h-1" />;
        const titulo = /^#{1,4}\s+(.*)$/.exec(s);
        if (titulo) return <p key={i} className="font-semibold text-ink pt-1">{linhaFormatada(titulo[1])}</p>;
        const item = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(s);
        if (item) return <p key={i} className="pl-4 relative before:content-['•'] before:absolute before:left-1 before:text-ink-subtle">{linhaFormatada(item[1])}</p>;
        return <p key={i}>{linhaFormatada(s)}</p>;
      })}
    </div>
  );
}

function BotaoCopiar({ texto }: { texto: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" onClick={() => { navigator.clipboard?.writeText(texto).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }); }}
      className="inline-flex items-center gap-1 text-[11px] text-ink-subtle hover:text-ink" aria-label="Copiar resposta">
      {ok ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {ok ? "Copiado" : "Copiar"}
    </button>
  );
}

export function FrivoIA() {
  const [aberto, setAberto] = useState(false);
  const [montado, setMontado] = useState(false);
  const [estado, setEstado] = useState<{ disponivel: boolean; ferramentas: string[] } | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const fimRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!aberto || estado) return;
    fetch("/api/ia/chat").then((r) => r.json()).then((d) => setEstado({ disponivel: !!d.disponivel, ferramentas: d.ferramentas ?? [] }))
      .catch(() => setEstado({ disponivel: false, ferramentas: [] }));
  }, [aberto, estado]);

  // Portal no <body>: o layout tem contêiner com transform (pull-to-refresh), que prenderia o `fixed`
  useEffect(() => setMontado(true), []);
  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [mensagens, enviando]);
  useEffect(() => { if (aberto) setTimeout(() => inputRef.current?.focus(), 50); }, [aberto]);

  async function perguntar(p: string) {
    const pergunta = p.trim();
    if (!pergunta || enviando) return;
    const historico = mensagens.filter((m) => !m.erro).map(({ papel, texto }) => ({ papel, texto }));
    setMensagens((m) => [...m, { papel: "usuario", texto: pergunta }]);
    setTexto("");
    setEnviando(true);
    try {
      const res = await fetch("/api/ia/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pergunta, historico }),
      });
      const d = await res.json().catch(() => ({}));
      setMensagens((m) => [...m, res.ok
        ? { papel: "assistente", texto: d.resposta ?? "" }
        : { papel: "assistente", texto: d.erro ?? "O Frivo IA está indisponível no momento.", erro: true }]);
    } catch {
      setMensagens((m) => [...m, { papel: "assistente", texto: "Erro de conexão. Tente de novo.", erro: true }]);
    } finally {
      setEnviando(false);
    }
  }

  const sugestoes = SUGESTOES.filter((s) => estado?.ferramentas.includes(s.ferramenta));

  if (!montado) return null;
  return createPortal(
    <>
      <button type="button" onClick={() => setAberto(true)} data-acao="abrir-frivo-ia"
        className={cn(
          "fixed z-40 right-4 bottom-20 lg:bottom-6 inline-flex items-center gap-2 rounded-full bg-sidebar text-white pl-3.5 pr-4 py-2.5 shadow-lg",
          "hover:bg-sidebar-700 transition-colors", aberto && "hidden",
        )}>
        <Sparkles className="w-4 h-4 text-primary-300" aria-hidden /> <span className="text-sm font-semibold">Frivo IA</span>
      </button>

      {aberto && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Frivo IA">
          <div className="absolute inset-0 bg-black/30 hidden sm:block" onClick={() => setAberto(false)} />
          <section className="relative flex flex-col bg-white w-full sm:w-[440px] h-full sm:shadow-2xl" data-painel="frivo-ia">
            <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-surface-border">
              <div className="flex items-center gap-2 min-w-0">
                <span className="p-1.5 rounded-lg bg-sidebar"><Sparkles className="w-4 h-4 text-primary-300" aria-hidden /></span>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-ink">Frivo IA</h2>
                  <p className="text-[11px] text-ink-subtle truncate">Consulta os dados do sistema · não altera nada</p>
                </div>
              </div>
              <button type="button" onClick={() => setAberto(false)} className="p-1.5 rounded-md text-ink-muted hover:bg-surface-alt" aria-label="Fechar">
                <X className="w-5 h-5" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-surface-alt/50" aria-live="polite">
              {!estado && (
                <p className="flex items-center gap-2 text-sm text-ink-muted"><Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Carregando…</p>
              )}
              {estado && !estado.disponivel && (
                <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
                  O Frivo IA está indisponível no momento (chave da Anthropic não configurada). O resto do sistema funciona normalmente.
                </div>
              )}
              {mensagens.length === 0 && estado?.disponivel && (
                <div className="space-y-3">
                  <p className="text-sm text-ink-muted">
                    Pergunte sobre ordens de serviço, agenda, clientes, equipamentos e contratos. Para um laudo, peça por exemplo:
                    <span className="block mt-1 font-medium text-ink">“Gere o laudo da OS 0107”</span>
                  </p>
                  {sugestoes.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {sugestoes.map((s) => (
                        <button key={s.texto} type="button" onClick={() => perguntar(s.texto)}
                          className="text-xs rounded-full border border-surface-border bg-white px-3 py-1.5 text-ink hover:border-primary-300 hover:bg-primary-50">
                          {s.texto}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {mensagens.map((m, i) => (
                <div key={i} className={cn("flex", m.papel === "usuario" ? "justify-end" : "justify-start")}>
                  <div className={cn(
                    "max-w-[88%] rounded-2xl px-3.5 py-2.5",
                    m.papel === "usuario" ? "bg-primary-600 text-white rounded-br-md text-sm whitespace-pre-wrap break-words"
                      : m.erro ? "bg-red-50 border border-red-200 text-red-700 rounded-bl-md text-sm"
                        : "bg-white border border-surface-border text-ink rounded-bl-md",
                  )}>
                    {m.papel === "assistente" && !m.erro ? (
                      <>
                        <TextoIA texto={m.texto} />
                        <div className="mt-2 flex justify-end"><BotaoCopiar texto={m.texto} /></div>
                      </>
                    ) : m.texto}
                  </div>
                </div>
              ))}
              {enviando && (
                <div className="flex items-center gap-2 text-sm text-ink-muted">
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Consultando o sistema…
                </div>
              )}
              <div ref={fimRef} />
            </div>

            <form className="border-t border-surface-border p-3 flex items-end gap-2 bg-white" onSubmit={(e) => { e.preventDefault(); perguntar(texto); }}>
              <textarea ref={inputRef} value={texto} onChange={(e) => setTexto(e.target.value)} rows={1} maxLength={2000}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); perguntar(texto); } }}
                placeholder={estado?.disponivel === false ? "Indisponível no momento" : "Pergunte algo… (Enter envia)"}
                disabled={enviando || estado?.disponivel === false} aria-label="Pergunta para o Frivo IA"
                className="flex-1 resize-none max-h-32 rounded-xl border border-surface-border px-3 py-2.5 text-sm focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 disabled:bg-surface-alt" />
              <button type="submit" disabled={enviando || !texto.trim() || estado?.disponivel === false} aria-label="Enviar"
                className="p-2.5 rounded-xl bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40">
                <Send className="w-4 h-4" />
              </button>
            </form>
          </section>
        </div>
      )}
    </>,
    document.body,
  );
}
