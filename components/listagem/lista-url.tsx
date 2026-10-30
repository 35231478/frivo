"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { useListagemUrl } from "@/components/listagem/use-listagem-url";
import { CampoBusca, Paginacao, SelectFiltro, sugerirPorUrl, ThOrd, type Opcao } from "@/components/listagem/listagem-ui";
import type { Sugestao } from "@/lib/listagem";
import { InputData } from "@/components/ui/input-data";

/**
 * Peças para listas renderizadas NO SERVIDOR (Clientes, Orçamentos…): a página continua montando
 * as linhas com Prisma; estas ilhas só mexem na URL (busca ao vivo, filtros, ordem, página) e o
 * servidor devolve a página nova. Um provedor por lista guarda a busca digitada e o "carregando".
 *
 *   <ListaUrl chave="clientes" paramBusca="busca" qAtual={busca}>
 *     <BuscaUrl lista="clientes" placeholder="…" />  <FiltroSelectUrl …/>
 *     <ConteudoUrl> …tabela do servidor… </ConteudoUrl>
 *     <PaginacaoUrl total={…} pagina={…} porPagina={…} rotulo="clientes" />
 *   </ListaUrl>
 */
type Ctx = ReturnType<typeof useListagemUrl> & { paramBusca: string };
const ListaCtx = createContext<Ctx | null>(null);

function useLista() {
  const c = useContext(ListaCtx);
  if (!c) throw new Error("Use dentro de <ListaUrl>");
  return c;
}

/** O estado da lista (navegar, busca…) para ilhas próprias da tela (ex.: período + cards de Orçamentos) */
export function useListaUrl() { return useLista(); }

export function ListaUrl({ chave, paramBusca = "q", qAtual, lembrarFiltros = false, children }: {
  chave: string; paramBusca?: string; qAtual: string; lembrarFiltros?: boolean; children: ReactNode;
}) {
  const l = useListagemUrl({ chave, qAtual, paramBusca, lembrarFiltros });
  return <ListaCtx.Provider value={{ ...l, paramBusca }}>{children}</ListaCtx.Provider>;
}

/** Busca ao vivo + sugestões (as ~5 que mais combinam; clicar abre o registro). */
export function BuscaUrl({ lista, placeholder, rotulo }: { lista: string; placeholder: string; rotulo?: string }) {
  const { busca, setBusca, pendente } = useLista();
  const router = useRouter();
  const sugerir = useMemo(() => sugerirPorUrl(`/api/listas/sugestoes?lista=${lista}`), [lista]);
  return (
    <CampoBusca
      valor={busca} onChange={setBusca} placeholder={placeholder} rotulo={rotulo} carregando={pendente}
      sugerir={sugerir} onEscolher={(s: Sugestao) => (s.href ? router.push(s.href) : setBusca(s.rotulo))}
    />
  );
}

export function FiltroSelectUrl({ param, vazio, opcoes }: { param: string; vazio: string; opcoes: Opcao[] }) {
  const { navegar } = useLista();
  const sp = useSearchParams();
  return <SelectFiltro valor={sp.get(param) ?? ""} onChange={(v) => navegar({ [param]: v || null })} vazio={vazio} opcoes={opcoes} />;
}

export function FiltroCheckUrl({ param, rotulo }: { param: string; rotulo: string }) {
  const { navegar } = useLista();
  const sp = useSearchParams();
  return (
    <label className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-ink-muted bg-white border border-surface-border rounded-lg cursor-pointer select-none">
      <input type="checkbox" checked={sp.get(param) === "1"} onChange={(e) => navegar({ [param]: e.target.checked ? "1" : null })} className="accent-primary-600" />
      {rotulo}
    </label>
  );
}

/** Cabeçalho ordenável (?ordem=&dir=); sem ordem escolhida, `padrao` aparece como ativo. */
export function ThOrdUrl({ label, k, padrao, className }: { label: string; k: string; padrao?: string; className?: string }) {
  const { navegar } = useLista();
  const sp = useSearchParams();
  const ordem = sp.get("ordem") || padrao || null;
  const dir = sp.get("dir") === "desc" ? "desc" : "asc";
  return (
    <ThOrd
      label={label} k={k} ordem={ordem} dir={dir} className={className}
      onOrdenar={(c) => navegar({ ordem: c, dir: ordem === c && dir === "asc" ? "desc" : null }, true)}
    />
  );
}

/** A lista do servidor fica esmaecida enquanto a próxima página/busca carrega. */
export function ConteudoUrl({ children, className }: { children: ReactNode; className?: string }) {
  const { pendente } = useLista();
  return <div className={cn("transition-opacity", pendente && "opacity-60", className)} aria-busy={pendente}>{children}</div>;
}

export function PaginacaoUrl({ total, pagina, porPagina, rotulo }: { total: number; pagina: number; porPagina: number; rotulo?: string }) {
  const { navegar } = useLista();
  return <Paginacao total={total} pagina={pagina} porPagina={porPagina} rotulo={rotulo} onNavegar={navegar} />;
}

/** "Limpar busca" no estado vazio. */
export function LimparBuscaUrl() {
  const { setBusca, busca } = useLista();
  if (!busca) return null;
  return <button type="button" onClick={() => setBusca("")} className="text-sm text-primary-600 hover:underline">Limpar busca</button>;
}

/** Data (início/fim de período) na URL. */
export function FiltroDataUrl({ param, titulo }: { param: string; titulo: string }) {
  const { navegar } = useLista();
  const sp = useSearchParams();
  return (
    <InputData
      value={sp.get(param) ?? ""} title={titulo} aria-label={titulo} className="w-40"
      onChange={(v) => navegar({ [param]: v || null })}
    />
  );
}
