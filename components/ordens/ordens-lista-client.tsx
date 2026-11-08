"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { CampoBusca, Paginacao, sugerirPorUrl } from "@/components/listagem/listagem-ui";
import { DEBOUNCE_BUSCA_MS, useTamanhoPreferido } from "@/components/listagem/use-listagem-url";
import Link from "next/link";
import { OsInativarBotao } from "@/components/os/os-inativar";
import { CheckboxLinha, CheckboxPagina, useAcoesMassaDisponiveis } from "@/components/acoes-massa/selecao";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { cn, formatarData, LABELS_STATUS_OS, LABELS_PRIORIDADE, LABELS_ORIGEM_OS } from "@/lib/utils";
import { BarraPeriodo, type PeriodoTela } from "@/components/listagem/periodo-cards";
import { BarraFiltros, FiltroTextoUrl, inputFiltro } from "@/components/listagem/barra-filtros";
import { urlDoAtalho, urlVizinho, type Periodo } from "@/lib/periodo";
import { BuscaSelect, type OpcaoBusca } from "@/components/ui/busca-select";
import { AvatarCliente } from "@/components/ui/avatar-cliente";
import { AvatarStack } from "@/components/ui/avatar-stack";
import { formatarDiaCivil } from "@/lib/os/prazos";
import { ClipboardList, Plus, LayoutGrid, List, Download, Headset } from "lucide-react";
import { TabelaPro } from "@/components/listagem/tabela-pro";
import { PLANILHA } from "@/lib/planilha";

interface TecnicoView { id: string; nome: string; avatar: string | null }
interface OrdemView {
  id: string; numero: string; chamadoNumero: string | null; origem: string;
  cliente: string; clienteLogo: string | null; unidade: string | null; responsavel: string | null; atividades: number;
  tecnicos: TecnicoView[];
  status: string; prioridade: string; criadoEm: string; previsaoConclusao: string | null;
}
interface Opcoes { clientes: OpcaoBusca[]; usuarios: OpcaoBusca[]; tiposOs: OpcaoBusca[]; contratos: OpcaoBusca[] }

const CLASSE_STATUS: Record<string, string> = {
  ABERTA: "badge-status-aberta", AGUARDANDO_ATENDIMENTO: "badge-status-aguardando_atendimento",
  AGENDADA: "badge-status-agendada", EM_ANDAMENTO: "badge-status-em_andamento", PAUSADA: "badge-status-pausada",
  AGUARDANDO_PECA: "badge-status-aguardando_peca", CONCLUIDA: "badge-status-concluida", CANCELADA: "badge-status-cancelada",
};
const CLASSE_PRIORIDADE: Record<string, string> = {
  BAIXA: "badge-prioridade-baixa", NORMAL: "badge-prioridade-normal", ALTA: "badge-prioridade-alta",
  URGENTE: "badge-prioridade-urgente", CRITICO: "badge-prioridade-critico",
};

/** Os filtros do painel "Mais filtros" (o período e a busca ficam fora) */
const PARAMS_FILTROS_OS = ["status", "prioridade", "origem", "clienteId", "responsavelId", "tipoOsId", "contratoId", "numero"];

export function OrdensListaClient({ ordens, total, pagina, porPagina, opcoes, periodo }: { ordens: OrdemView[]; total: number; pagina: number; porPagina: number; opcoes: Opcoes; periodo: PeriodoTela }) {
  const router = useRouter();
  const { pode } = usePermissoes();
  const pathname = usePathname();
  const sp = useSearchParams();
  const get = (k: string) => sp.get(k) ?? "";

  const view = get("view") === "cards" ? "cards" : "tabela";
  const massa = useAcoesMassaDisponiveis("ordens");
  const sortAtual = get("sort") || "criadoEm";
  const dirAtual = (get("dir") || "desc") as "asc" | "desc";
  const filtrosAtivos = [...PARAMS_FILTROS_OS, "busca"].filter((k) => get(k) !== "").length;

  const [buscaLocal, setBuscaLocal] = useState(get("busca"));

  const [pendente, startTransition] = useTransition();
  /** Muda a URL; qualquer filtro novo volta para a página 1 (só a paginação mantém a página). */
  function setParams(updates: Record<string, string | null>, manterPagina = false) {
    const novo = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(updates)) { if (v) novo.set(k, v); else novo.delete(k); }
    if (!manterPagina && !("pagina" in updates)) novo.delete("pagina");
    startTransition(() => router.replace(`${pathname}?${novo.toString()}`, { scroll: false }));
  }
  useTamanhoPreferido((por) => setParams({ por }, true));
  const sugerir = useMemo(() => sugerirPorUrl("/api/listas/sugestoes?lista=ordens"), []);

  // Busca ao vivo (debounce), sem Enter
  useEffect(() => {
    const t = setTimeout(() => { if (buscaLocal !== get("busca")) setParams({ busca: buscaLocal || null }); }, DEBOUNCE_BUSCA_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscaLocal]);
  // Atalhos de teclado: ← período anterior · → período seguinte · T volta para hoje
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const alvo = document.activeElement as HTMLElement | null;
      const tag = alvo?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || alvo?.isContentEditable) return;
      const p = periodo as Periodo;
      if (e.key === "ArrowLeft") { const m = urlVizinho(p, -1); if (m) { e.preventDefault(); setParams(m); } }
      else if (e.key === "ArrowRight") { const m = urlVizinho(p, 1); if (m) { e.preventDefault(); setParams(m); } }
      else if (e.key === "t" || e.key === "T") { e.preventDefault(); setParams(urlDoAtalho("hoje")); }
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo]);

  function toggleLista(param: string, valor: string) {
    const atual = get(param).split(",").filter(Boolean);
    const novo = atual.includes(valor) ? atual.filter((x) => x !== valor) : [...atual, valor];
    setParams({ [param]: novo.join(",") || null });
  }
  const naLista = (param: string, valor: string) => get(param).split(",").includes(valor);

  function ordenarPor(campo: string) {
    if (sortAtual === campo) setParams({ dir: dirAtual === "asc" ? "desc" : "asc" });
    else setParams({ sort: campo, dir: "desc" });
  }

  /** Zera os filtros do painel e a busca (o período fica: é navegação) */
  function limparFiltros() {
    setBuscaLocal("");
    setParams(Object.fromEntries([...PARAMS_FILTROS_OS, "busca"].map((k) => [k, null])));
  }

  const exportUrl = `/api/ordens/export${sp.toString() ? `?${sp.toString()}` : ""}`;

  // Chip de filtro (status/prioridade): ligado = acento claro
  const chip = (ligado: boolean) => cn("text-xs px-2.5 py-1 rounded-full border transition-colors",
    ligado ? "bg-acento-claro border-acento/40 text-acento font-semibold" : "bg-white border-surface-border text-ink-muted hover:border-acento/40 hover:text-ink");

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-surface-alt rounded-lg"><ClipboardList className="w-5 h-5 text-ink-muted" aria-hidden="true" /></div>
          <h1 className="page-title">Ordens de serviço</h1>
          <span className="pill-previsto font-display tabular-nums">{total}</span>
        </div>
        {pode("ordens", "criar") && (
          <Link href="/ordens/nova" className="btn-primary shrink-0">
            <Plus className="w-4 h-4" /> Nova OS
          </Link>
        )}
      </div>

      {/* Barra enxuta: período + busca + "Mais filtros" (painel recolhido) — padrão da casa */}
      <BarraFiltros
        periodo={<BarraPeriodo periodo={periodo} navegar={(m) => setParams(m)} permitirTodos dica="Pelo dia agendado, pela previsão de conclusão ou pela abertura da OS. Atalhos: ← → mudam o período, T volta para hoje." />}
        busca={
          <CampoBusca
            valor={buscaLocal} onChange={setBuscaLocal} placeholder="Pesquisar" rotulo="Pesquisar ordens de serviço"
            sugerir={sugerir} onEscolher={(s) => s.href && router.push(s.href)} carregando={pendente}
          />
        }
        paramBusca="busca" navegar={(m) => setParams(m)}
        extras={
          <>
            <div className="flex items-center bg-surface-page border border-surface-border rounded-lg p-0.5">
              <button type="button" onClick={() => setParams({ view: null })} aria-pressed={view === "tabela"} className={cn("p-1.5 rounded-md transition-colors", view === "tabela" ? "bg-white text-acento shadow-card" : "text-ink-muted hover:text-ink")} title="Tabela"><List className="w-4 h-4" /></button>
              <button type="button" onClick={() => setParams({ view: "cards" })} aria-pressed={view === "cards"} className={cn("p-1.5 rounded-md transition-colors", view === "cards" ? "bg-white text-acento shadow-card" : "text-ink-muted hover:text-ink")} title="Cards"><LayoutGrid className="w-4 h-4" /></button>
            </div>
            <a href={exportUrl} className="btn-secondary px-3 py-2 font-medium text-ink-muted">
              <Download className="w-4 h-4" /> Exportar
            </a>
          </>
        }
        filtros={[
          { id: "status", label: "Status", params: ["status"], largo: true, render: () => (
            <div className="flex flex-wrap items-center gap-1.5">
              {Object.entries(LABELS_STATUS_OS).map(([v, l]) => (
                <button key={v} type="button" onClick={() => toggleLista("status", v)} aria-pressed={naLista("status", v)}
                  className={chip(naLista("status", v))}>{l}</button>
              ))}
              {!get("status") && (
                <span className="text-[11px] text-ink-muted ml-1" title="OS inativadas ficam ocultas; marque “Cancelada” para vê-las">
                  (canceladas ocultas)
                </span>
              )}
            </div>
          ) },
          { id: "prioridade", label: "Prioridade", params: ["prioridade"], largo: true, render: () => (
            <div className="flex flex-wrap items-center gap-1.5">
              {Object.entries(LABELS_PRIORIDADE).map(([v, l]) => (
                <button key={v} type="button" onClick={() => toggleLista("prioridade", v)} aria-pressed={naLista("prioridade", v)}
                  className={chip(naLista("prioridade", v))}>{l}</button>
              ))}
            </div>
          ) },
          { id: "clienteId", label: "Cliente", params: ["clienteId"], render: () => <BuscaSelect value={get("clienteId")} onChange={(v) => setParams({ clienteId: v || null })} options={opcoes.clientes} placeholder="Todos" /> },
          { id: "responsavelId", label: "Técnico responsável", params: ["responsavelId"], render: () => <BuscaSelect value={get("responsavelId")} onChange={(v) => setParams({ responsavelId: v || null })} options={opcoes.usuarios} placeholder="Todos" /> },
          { id: "tipoOsId", label: "Tipo de OS", params: ["tipoOsId"], render: () => (
            <select value={get("tipoOsId")} onChange={(e) => setParams({ tipoOsId: e.target.value || null })} className={inputFiltro(get("tipoOsId"))} aria-label="Tipo de OS">
              <option value="">Todos</option>
              {opcoes.tiposOs.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          ) },
          { id: "numero", label: "Número da OS", params: ["numero"], render: () => <FiltroTextoUrl param="numero" navegar={(m) => setParams(m)} placeholder="OS-2026-..." rotulo="Número da OS" /> },
          { id: "origem", label: "Origem", params: ["origem"], render: () => (
            <select value={get("origem")} onChange={(e) => setParams({ origem: e.target.value || null })} className={inputFiltro(get("origem"))} aria-label="Origem">
              <option value="">Todas</option>
              {Object.entries(LABELS_ORIGEM_OS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          ) },
          { id: "contratoId", label: "Contrato", params: ["contratoId"], render: () => <BuscaSelect value={get("contratoId")} onChange={(v) => setParams({ contratoId: v || null })} options={opcoes.contratos} placeholder="Todos" /> },
        ]}
      />

      <div className="card overflow-hidden">
        <div className="px-4 sm:px-5 py-2.5 border-b border-surface-border flex items-center justify-between flex-wrap gap-2 text-sm text-ink-muted">
          <span data-contador><strong className="text-ink">{total.toLocaleString("pt-BR")}</strong> {total === 1 ? "ordem de serviço" : "ordens de serviço"}{periodo.tipo !== "todos" ? ` · ${periodo.rotulo}` : ""}</span>
        </div>

        {/* Resultados (celular: sempre cartões) */}
        <div className={cn("transition-opacity", pendente && "opacity-60")} aria-busy={pendente}>
        {ordens.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center" data-lista-vazia>
            <p className="text-sm font-medium text-ink">Nenhuma OS encontrada</p>
            <p className="text-xs text-ink-muted">{buscaLocal ? `Nada combina com “${buscaLocal}”.` : "Nenhuma OS com os filtros aplicados."}</p>
            {filtrosAtivos > 0 && <button type="button" onClick={limparFiltros} className="text-sm font-medium text-acento hover:underline">Limpar filtros</button>}
          </div>
        ) : (<>
          <div className={cn("p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3", view !== "cards" && "md:hidden")} data-cartoes>
            {ordens.map((os) => (
              <div key={os.id} className="relative">
              {massa && <CheckboxLinha id={os.id} rotulo={os.chamadoNumero ?? os.numero} className="absolute top-3 right-3 z-10 bg-white rounded" />}
              <Link href={`/ordens/${os.id}`} className="block h-full bg-white border border-surface-border rounded-card p-4 shadow-card hover:border-acento/40 hover:shadow-card-hover transition-shadow">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display font-semibold tabular-nums text-acento">{os.chamadoNumero ?? os.numero}</span>
                  {os.origem === "PORTAL_CLIENTE" && <span className="pill-acento text-[11px] px-2"><Headset className="w-3 h-3" aria-hidden="true" /> Portal</span>}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <AvatarCliente nome={os.cliente} logoUrl={os.clienteLogo} size={28} />
                  <p className="text-sm font-medium text-ink truncate">{os.cliente}</p>
                </div>
                <p className="text-xs text-ink-muted truncate mt-1">{os.unidade ?? "—"}{os.responsavel ? ` · ${os.responsavel}` : ""}</p>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className={CLASSE_STATUS[os.status]}>{LABELS_STATUS_OS[os.status]}</span>
                  <span className={CLASSE_PRIORIDADE[os.prioridade]}>{LABELS_PRIORIDADE[os.prioridade]}</span>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">Equipe:</span>
                  <AvatarStack tecnicos={os.tecnicos} size={28} />
                </div>
                <p className="text-[11px] text-ink-muted mt-2 tabular-nums">Aberta {formatarData(os.criadoEm)}{os.previsaoConclusao ? ` · Prev. ${formatarDiaCivil(os.previsaoConclusao)}` : ""}</p>
              </Link>
              <div className="absolute bottom-2 right-2"><OsInativarBotao osId={os.id} numero={os.chamadoNumero ?? os.numero} status={os.status} variante="icone" /></div>
              </div>
            ))}
          </div>
          {view !== "cards" && (
          <TabelaPro
            tela="ordens"
            ordenacao={{ ativa: sortAtual, dir: dirAtual, onOrdenar: ordenarPor }}
            colunas={[
              ...(massa ? [{ id: "sel", titulo: "Selecionar a página", fixa: true, largura: 36, cabecalho: <CheckboxPagina />, classe: "pl-3" }] : []),
              { id: "numero", titulo: "Número", largura: 176, ordenar: "numero", obrigatoria: true },
              { id: "cliente", titulo: "Cliente", ordenar: "cliente", obrigatoria: true },
              { id: "tecnico", titulo: "Técnico", largura: 140, classe: "truncate" },
              { id: "abertura", titulo: "Abertura", largura: 96, ordenar: "criadoEm" },
              { id: "previsao", titulo: "Previsão", largura: 96, ordenar: "previsaoConclusao" },
              { id: "status", titulo: "Status", largura: 168, ordenar: "status" },
              { id: "prioridade", titulo: "Prioridade", largura: 104, ordenar: "prioridade" },
              { id: "equipe", titulo: "Equipe", largura: 128, alinhar: "direita" },
              { id: "acoes", titulo: "Ações", fixa: true, largura: 40, semTitulo: true, alinhar: "direita", classe: "py-0.5" },
            ]}
            linhas={ordens.map((os) => ({
              id: os.id,
              titulos: { cliente: os.cliente, tecnico: os.responsavel ?? undefined },
              celulas: {
                sel: massa ? <CheckboxLinha id={os.id} rotulo={os.chamadoNumero ?? os.numero} /> : null,
                numero: (
                  <span className="whitespace-nowrap">
                    <Link href={`/ordens/${os.id}`} className={cn(PLANILHA.codigo, "text-acento hover:underline")}>{os.chamadoNumero ?? os.numero}</Link>
                    {os.origem === "PORTAL_CLIENTE" && <span className="ml-2 pill-acento text-[11px] px-2"><Headset className="w-3 h-3" aria-hidden="true" /> Portal</span>}
                  </span>
                ),
                cliente: (
                  <div className="flex items-center gap-2 min-w-0">
                    <AvatarCliente nome={os.cliente} logoUrl={os.clienteLogo} size={24} />
                    <span className={cn(PLANILHA.nome, "truncate")}>{os.cliente}</span>
                  </div>
                ),
                tecnico: <span className={PLANILHA.apagado}>{os.responsavel ?? "—"}</span>,
                abertura: <span className={cn(PLANILHA.data, PLANILHA.apagado)}>{formatarData(os.criadoEm)}</span>,
                previsao: <span className={cn(PLANILHA.data, PLANILHA.apagado)}>{formatarDiaCivil(os.previsaoConclusao)}</span>,
                status: <span className={CLASSE_STATUS[os.status]}>{LABELS_STATUS_OS[os.status]}</span>,
                prioridade: <span className={CLASSE_PRIORIDADE[os.prioridade]}>{LABELS_PRIORIDADE[os.prioridade]}</span>,
                equipe: <div className="flex justify-end"><AvatarStack tecnicos={os.tecnicos} size={24} /></div>,
                acoes: <OsInativarBotao osId={os.id} numero={os.chamadoNumero ?? os.numero} status={os.status} variante="icone" />,
              },
            }))}
          />
          )}
        </>)}
        </div>
        <div className="px-4 sm:px-5 py-3 border-t border-surface-border">
          <Paginacao total={total} pagina={pagina} porPagina={porPagina} rotulo={total === 1 ? "ordem de serviço" : "ordens de serviço"} onNavegar={setParams} />
        </div>
      </div>
    </div>
  );
}
