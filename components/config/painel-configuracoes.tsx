"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Loader2, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { Drawer } from "@/components/ui/drawer";
import {
  SECOES_CONFIGURACOES, hrefAbaConfig, hrefSecaoConfig, itemConfig, type SecaoConfigId,
} from "@/lib/navegacao/configuracoes";

interface Props {
  /** Itens que o perfil pode abrir (ids) — a filtragem por permissão é feita no servidor */
  visiveis: string[];
  abaInicial: SecaoConfigId | null;
  /** Item aberto na gaveta segundo a URL (?secao=…), já liberado no servidor */
  secaoAberta: string | null;
  /** ?secao=… pedido mas não liberado para o perfil (ou inexistente) */
  secaoNegada?: string | null;
  /** A tela completa do item aberto (renderizada no servidor) */
  children?: ReactNode;
}

/**
 * Página de Configurações: 3 abas (Operacionais, Financeiras, Conta) com cartões. Clicar num cartão
 * abre a tela COMPLETA do item numa gaveta lateral — criar/editar/excluir sem sair da página. A URL
 * acompanha (?aba=…&secao=…): refresh e links reabrem a mesma gaveta; fechar volta aos cartões.
 */
export function PainelConfiguracoes({ visiveis, abaInicial, secaoAberta, secaoNegada, children }: Props) {
  const router = useRouter();
  const pode = new Set(visiveis);
  const abas = SECOES_CONFIGURACOES
    .map((s) => ({ ...s, subgrupos: s.subgrupos.map((g) => ({ ...g, itens: g.itens.filter((i) => pode.has(i.id)) })).filter((g) => g.itens.length > 0) }))
    .filter((s) => s.subgrupos.length > 0);

  const [aba, setAba] = useState<SecaoConfigId | null>(abaInicial ?? abas[0]?.id ?? null);
  // A gaveta abre na hora (com "carregando") e a tela chega do servidor logo depois
  const [alvo, setAlvo] = useState<string | null>(secaoAberta);
  useEffect(() => { setAlvo(secaoAberta); }, [secaoAberta]);
  useEffect(() => { if (abaInicial) setAba(abaInicial); }, [abaInicial]);

  const abaAtual = abas.find((s) => s.id === aba) ?? abas[0];
  const itemAberto = itemConfig(alvo);

  function trocarAba(id: SecaoConfigId) {
    setAba(id);
    // Só a aba: troca na hora, sem ida ao servidor (a URL acompanha para o refresh)
    window.history.replaceState(null, "", hrefAbaConfig(id));
  }
  function abrir(id: string) {
    setAlvo(id);
    router.push(hrefSecaoConfig(id), { scroll: false });
  }
  function fechar() {
    setAlvo(null);
    router.replace(hrefAbaConfig(itemConfig(alvo)?.aba ?? abaAtual?.id ?? "operacionais"), { scroll: false });
  }

  return (
    <div className="space-y-6 max-w-6xl" data-pagina-configuracoes>
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary-50 rounded-lg"><Settings className="w-5 h-5 text-primary-600" /></div>
        <div>
          <h1 className="page-title">Configurações</h1>
          <p className="page-subtitle">Parâmetros do sistema, organizados por assunto</p>
        </div>
      </div>

      {secaoNegada && (
        <div role="alert" className="rounded-card border border-atencao/30 bg-atencao-claro px-4 py-3 text-sm text-atencao-texto" data-secao-negada>
          Seu perfil de acesso não libera esta configuração{itemConfig(secaoNegada) ? ` (${itemConfig(secaoNegada)!.label})` : ""}.
        </div>
      )}

      {abas.length === 0 ? (
        <div className="bg-white rounded-card border border-dashed border-surface-border p-10 text-center text-sm text-ink-muted">
          Seu perfil de acesso não libera nenhuma configuração.
        </div>
      ) : (<>
        {/* Abas: as 3 seções (só as que o perfil pode ver) */}
        <div role="tablist" aria-label="Seções de configurações" className={cn("grid gap-2", abas.length === 3 ? "grid-cols-3" : abas.length === 2 ? "grid-cols-2" : "grid-cols-1")}>
          {abas.map((s) => {
            const ativa = s.id === abaAtual.id;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                id={`aba-config-${s.id}`}
                aria-selected={ativa}
                aria-controls={`painel-config-${s.id}`}
                onClick={() => trocarAba(s.id)}
                data-aba-config={s.id}
                className={cn(
                  "flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 rounded-card border px-2 py-2.5 sm:py-3 text-xs sm:text-sm font-medium transition-colors text-center",
                  ativa ? "bg-primary-500 border-primary-500 text-white shadow-sm" : "bg-white border-surface-border text-ink-muted hover:text-ink hover:border-primary-200",
                )}
              >
                <s.icone className="w-5 h-5 sm:w-4 sm:h-4 shrink-0" />
                <span>{s.curto}</span>
              </button>
            );
          })}
        </div>

        <section role="tabpanel" id={`painel-config-${abaAtual.id}`} aria-labelledby={`aba-config-${abaAtual.id}`} className="space-y-6" data-secao-config={abaAtual.id}>
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-card bg-acento-claro text-acento shrink-0"><abaAtual.icone className="w-5 h-5" /></div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-ink">{abaAtual.label}</h2>
              <p className="text-sm text-ink-muted">{abaAtual.descricao}</p>
            </div>
          </div>

          {abaAtual.subgrupos.map((g) => (
            <div key={g.titulo} className="space-y-2.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-ink-muted" data-subgrupo>{g.titulo}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {g.itens.map((i) => (
                  <Link
                    key={i.id}
                    href={hrefSecaoConfig(i.id)}
                    scroll={false}
                    aria-haspopup="dialog"
                    data-cartao-config={i.id}
                    onClick={(e) => {
                      // Ctrl/⌘/meio: abre em outra aba normalmente; clique simples: gaveta na hora
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                      e.preventDefault();
                      abrir(i.id);
                    }}
                    className={cn(
                      "group flex items-center gap-3 rounded-card border bg-white p-3.5 sm:p-4 shadow-card hover:border-primary-300 hover:shadow-card-hover transition-all min-w-0 text-left",
                      alvo === i.id ? "border-primary-400" : "border-surface-border",
                    )}
                  >
                    <span className="p-2 rounded-lg bg-primary-50 text-primary-600 shrink-0"><i.icone className="w-5 h-5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-ink group-hover:text-primary-700">{i.label}</span>
                      <span className="block text-xs text-ink-muted leading-snug">{i.dica}</span>
                    </span>
                    <ChevronRight className="w-4 h-4 text-ink-subtle shrink-0 group-hover:text-primary-500" />
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </section>
      </>)}

      <Drawer
        aberto={!!itemAberto}
        onFechar={fechar}
        titulo={itemAberto ? (
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="hidden sm:inline text-ink-muted font-normal">Configurações ›</span>
            <span className="truncate">{itemAberto.label}</span>
          </span>
        ) : ""}
        largura="w-full sm:w-[88vw] md:w-[76vw] lg:w-[64vw] lg:min-w-[720px] lg:max-w-[1200px]"
      >
        {/* A tela completa do item; o "voltar" da página some (quem fecha é a gaveta) */}
        <div className="[&_[data-voltar]]:hidden" data-gaveta-config={alvo ?? undefined}>
          {alvo && alvo === secaoAberta ? children : (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-muted" role="status" data-carregando-config>
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Carregando…
            </div>
          )}
        </div>
      </Drawer>
    </div>
  );
}
