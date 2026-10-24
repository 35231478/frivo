"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { CampoBusca, Paginacao, sugerirPorUrl } from "@/components/listagem/listagem-ui";
import { DEBOUNCE_BUSCA_MS, useTamanhoPreferido } from "@/components/listagem/use-listagem-url";
import Link from "next/link";
import { OsInativarBotao } from "@/components/os/os-inativar";
import { CheckboxLinha, CheckboxPagina, useAcoesMassaDisponiveis } from "@/components/acoes-massa/selecao";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { cn, formatarData, MESES_PT, LABELS_STATUS_OS, LABELS_PRIORIDADE, LABELS_ORIGEM_OS } from "@/lib/utils";
import { BuscaSelect, type OpcaoBusca } from "@/components/ui/busca-select";
import { AvatarCliente } from "@/components/ui/avatar-cliente";
import { AvatarStack } from "@/components/ui/avatar-stack";
import { formatarDiaCivil, prazoVencido } from "@/lib/os/prazos";
import { chaveHojeBR } from "@/lib/fuso";
import {
  ClipboardList, Plus, Search, SlidersHorizontal, X, ArrowUp, ArrowDown, ArrowUpDown,
  LayoutGrid, List, Download, Headset, Filter, ChevronLeft, ChevronRight, CalendarDays, CalendarCheck,
} from "lucide-react";
import { InputData } from "@/components/ui/input-data";

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

const FILTROS_CHAVE = ["busca", "status", "prioridade", "origem", "clienteId", "responsavelId", "tipoOsId", "contratoId", "numero", "dataInicio", "dataFim"];
const AVANCADOS = ["dataInicio", "dataFim", "clienteId", "responsavelId", "tipoOsId", "numero", "origem", "contratoId"];

const DIAS_SEMANA = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const STATUS_PENDENTE = ["ABERTA", "AGUARDANDO_ATENDIMENTO", "AGENDADA", "AGUARDANDO_PECA"];
const STATUS_ANDAMENTO = ["EM_ANDAMENTO", "PAUSADA"];
const STATUS_FINALIZADA = ["CONCLUIDA", "CANCELADA"];

// "2026-06-02" → Date no horário local (evita o deslocamento de fuso do new Date("yyyy-mm-dd"))
function parseDia(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
// Date → "2026-06-02" no horário local
function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dataPorExtenso(s: string): string {
  const d = parseDia(s);
  return `${DIAS_SEMANA[d.getDay()]}, ${String(d.getDate()).padStart(2, "0")} de ${MESES_PT[d.getMonth()]} de ${d.getFullYear()}`;
}
// Cor do badge do dia conforme a situação geral das OS (atrasada > pendente > em andamento > concluídas)
function corDoDia(ordens: OrdemView[]): string {
  // Atrasada só depois do dia da previsão (no fuso de Brasília), não às 21h da véspera
  const atrasada = ordens.some((o) => prazoVencido(o.previsaoConclusao) && !STATUS_FINALIZADA.includes(o.status));
  if (atrasada) return "pill-atrasado";
  if (ordens.some((o) => STATUS_PENDENTE.includes(o.status))) return "pill-atencao";
  if (ordens.some((o) => STATUS_ANDAMENTO.includes(o.status))) return "pill-acento";
  return "pill-ok";
}

export function OrdensListaClient({ ordens, total, pagina, porPagina, opcoes }: { ordens: OrdemView[]; total: number; pagina: number; porPagina: number; opcoes: Opcoes }) {
  const router = useRouter();
  const { pode } = usePermissoes();
  const pathname = usePathname();
  const sp = useSearchParams();
  const get = (k: string) => sp.get(k) ?? "";

  const view = get("view") === "cards" ? "cards" : "tabela";
  const massa = useAcoesMassaDisponiveis("ordens");
  const sortAtual = get("sort") || "criadoEm";
  const dirAtual = (get("dir") || "desc") as "asc" | "desc";
  const filtrosAtivos = FILTROS_CHAVE.filter((k) => get(k) !== "").length;

  const [mostrarAvancados, setMostrarAvancados] = useState(AVANCADOS.some((k) => get(k) !== ""));
  const [buscaLocal, setBuscaLocal] = useState(get("busca"));
  const [numeroLocal, setNumeroLocal] = useState(get("numero"));

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
  // Debounce do número
  useEffect(() => {
    const t = setTimeout(() => { if (numeroLocal !== get("numero")) setParams({ numero: numeroLocal || null }); }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numeroLocal]);

  // --- Navegação por data ---
  const dataAtual = get("data");
  const hojeStr = chaveHojeBR(); // hoje em Brasília (não vira amanhã às 21h)
  const ehHoje = dataAtual === hojeStr;

  // Define o dia (limpa o intervalo "de/até" para não conflitar com a navegação)
  function setData(valor: string | null) {
    setParams({ data: valor, dataInicio: null, dataFim: null });
  }
  function deslocarDia(dias: number) {
    const base = parseDia(dataAtual || hojeStr);
    base.setDate(base.getDate() + dias);
    setData(ymdLocal(base));
  }
  const irParaHoje = () => setData(hojeStr);

  // Atalhos de teclado: ← dia anterior · → próximo dia · T volta para hoje
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const alvo = document.activeElement as HTMLElement | null;
      const tag = alvo?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || alvo?.isContentEditable) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); deslocarDia(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); deslocarDia(1); }
      else if (e.key === "t" || e.key === "T") { e.preventDefault(); irParaHoje(); }
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataAtual]);

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

  function limparFiltros() {
    const novo = new URLSearchParams();
    if (get("view")) novo.set("view", get("view"));
    if (get("data")) novo.set("data", get("data"));
    if (get("por")) novo.set("por", get("por"));
    setBuscaLocal(""); setNumeroLocal("");
    router.replace(`${pathname}${novo.toString() ? `?${novo}` : ""}`, { scroll: false });
  }

  const exportUrl = `/api/ordens/export${sp.toString() ? `?${sp.toString()}` : ""}`;

  function Seta({ campo }: { campo: string }) {
    if (sortAtual !== campo) return <ArrowUpDown className="inline w-3 h-3 ml-1 text-ink-subtle" />;
    return dirAtual === "asc" ? <ArrowUp className="inline w-3 h-3 ml-1 text-acento" /> : <ArrowDown className="inline w-3 h-3 ml-1 text-acento" />;
  }

  const selectCls = "input-base py-2";
  // Botão quadrado de ícone (navegação por data, visão)
  const btnIcone = "p-2 rounded-lg border border-surface-border bg-white text-ink-muted hover:bg-surface-page hover:text-ink transition-colors";
  // Chip de filtro (status/prioridade): ligado = acento claro
  const chip = (ligado: boolean) => cn("text-xs px-2.5 py-1 rounded-full border transition-colors",
    ligado ? "bg-acento-claro border-acento/40 text-acento font-semibold" : "bg-white border-surface-border text-ink-muted hover:border-acento/40 hover:text-ink");

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-acento-claro rounded-lg"><ClipboardList className="w-5 h-5 text-acento" aria-hidden="true" /></div>
          <h1 className="page-title">Ordens de Serviço</h1>
          <span className="pill-previsto font-display tabular-nums">{total}</span>
        </div>
        {pode("ordens", "criar") && (
          <Link href="/ordens/nova" className="btn-primary shrink-0">
            <Plus className="w-4 h-4" /> Nova OS
          </Link>
        )}
      </div>

      {/* Navegação por data */}
      <div className="card px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => deslocarDia(-1)} title="Dia anterior (←)" aria-label="Dia anterior"
            className={btnIcone}>
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button type="button" onClick={irParaHoje} title="Voltar para hoje (T)"
            aria-pressed={ehHoje}
            className={cn("inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors",
              ehHoje ? "bg-acento border-acento text-white" : "bg-white border-surface-border text-acento hover:bg-acento-claro")}>
            <CalendarCheck className="w-4 h-4" /> Hoje
          </button>
          <button type="button" onClick={() => deslocarDia(1)} title="Próximo dia (→)" aria-label="Próximo dia"
            className={btnIcone}>
            <ChevronRight className="w-4 h-4" />
          </button>
          <div className="relative">
            <button type="button" title="Escolher data"
              className={btnIcone}>
              <CalendarDays className="w-4 h-4" />
            </button>
            {/* Só o calendário do aparelho (invisível, sobre o botão): nenhum texto de data aparece aqui */}
            <input type="date" value={dataAtual || hojeStr} onChange={(e) => e.target.value && setData(e.target.value)}
              aria-label="Selecionar data" className="absolute inset-0 opacity-0 cursor-pointer" />
          </div>
        </div>

        <div key={dataAtual || "todos"} className="anim-data flex flex-1 items-center justify-center gap-2 flex-wrap min-w-[260px] text-center">
          {dataAtual ? (
            <>
              <span className="text-sm font-semibold text-ink">{dataPorExtenso(dataAtual)}</span>
              <span className={cn(corDoDia(ordens), "font-semibold")}>
                {total} {total === 1 ? "ordem de serviço" : "ordens de serviço"}
              </span>
            </>
          ) : (
            <span className="text-sm font-semibold text-ink-muted">
              Todas as datas · {total} {total === 1 ? "ordem de serviço" : "ordens de serviço"}
            </span>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 min-w-[140px]">
          {dataAtual && (
            <button type="button" onClick={() => setData(null)}
              className="inline-flex items-center gap-1 text-xs font-medium text-acento hover:text-acento-hover">
              <X className="w-3.5 h-3.5" /> Ver todos os dias
            </button>
          )}
        </div>
      </div>

      <div className="card overflow-hidden">
        {/* Filtros principais */}
        <div className="p-4 sm:p-5 border-b border-surface-border space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex-1 min-w-[220px]">
              <CampoBusca
                valor={buscaLocal} onChange={setBuscaLocal} placeholder="Buscar por número, descrição ou cliente…" rotulo="Buscar ordens de serviço"
                sugerir={sugerir} onEscolher={(s) => s.href && router.push(s.href)} carregando={pendente}
              />
            </div>
            <button type="button" onClick={() => setMostrarAvancados((v) => !v)}
              aria-expanded={mostrarAvancados}
              className={cn("inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors", mostrarAvancados ? "bg-acento-claro border-acento/40 text-acento" : "bg-white border-surface-border text-ink-muted hover:bg-surface-page hover:text-ink")}>
              <SlidersHorizontal className="w-4 h-4" /> Mais filtros
            </button>
            {/* Alternar visualização */}
            <div className="flex items-center bg-surface-page border border-surface-border rounded-lg p-0.5">
              <button type="button" onClick={() => setParams({ view: null })} aria-pressed={view === "tabela"} className={cn("p-1.5 rounded-md transition-colors", view === "tabela" ? "bg-white text-acento shadow-card" : "text-ink-muted hover:text-ink")} title="Tabela"><List className="w-4 h-4" /></button>
              <button type="button" onClick={() => setParams({ view: "cards" })} aria-pressed={view === "cards"} className={cn("p-1.5 rounded-md transition-colors", view === "cards" ? "bg-white text-acento shadow-card" : "text-ink-muted hover:text-ink")} title="Cards"><LayoutGrid className="w-4 h-4" /></button>
            </div>
            <a href={exportUrl} className="btn-secondary px-3 py-2 font-medium text-ink-muted">
              <Download className="w-4 h-4" /> Exportar
            </a>
          </div>

          {/* Chips de status e prioridade (multi) */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider mr-1">Status</span>
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
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider mr-1">Prioridade</span>
              {Object.entries(LABELS_PRIORIDADE).map(([v, l]) => (
                <button key={v} type="button" onClick={() => toggleLista("prioridade", v)} aria-pressed={naLista("prioridade", v)}
                  className={chip(naLista("prioridade", v))}>{l}</button>
              ))}
            </div>
          </div>

          {/* Filtros avançados */}
          {mostrarAvancados && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t border-surface-linha [&>div]:flex [&>div]:flex-col [&>div]:gap-1.5">
              <div>
                <label htmlFor="f-os-de" className="text-xs font-medium text-ink-muted">Abertura — de</label>
                <InputData id="f-os-de" defaultValue={get("dataInicio")} onChange={(v) => setParams({ dataInicio: v || null, data: null })} />
              </div>
              <div>
                <label htmlFor="f-os-ate" className="text-xs font-medium text-ink-muted">Abertura — até</label>
                <InputData id="f-os-ate" defaultValue={get("dataFim")} onChange={(v) => setParams({ dataFim: v || null, data: null })} />
              </div>
              <div>
                <span className="text-xs font-medium text-ink-muted">Cliente</span>
                <BuscaSelect value={get("clienteId")} onChange={(v) => setParams({ clienteId: v || null })} options={opcoes.clientes} placeholder="Todos" />
              </div>
              <div>
                <span className="text-xs font-medium text-ink-muted">Técnico responsável</span>
                <BuscaSelect value={get("responsavelId")} onChange={(v) => setParams({ responsavelId: v || null })} options={opcoes.usuarios} placeholder="Todos" />
              </div>
              <div>
                <label htmlFor="f-os-tipo" className="text-xs font-medium text-ink-muted">Tipo de OS</label>
                <select id="f-os-tipo" value={get("tipoOsId")} onChange={(e) => setParams({ tipoOsId: e.target.value || null })} className={selectCls}>
                  <option value="">Todos</option>
                  {opcoes.tiposOs.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="f-os-numero" className="text-xs font-medium text-ink-muted">Número da OS</label>
                <input id="f-os-numero" value={numeroLocal} onChange={(e) => setNumeroLocal(e.target.value)} placeholder="OS-2026-..." className={selectCls} />
              </div>
              <div>
                <label htmlFor="f-os-origem" className="text-xs font-medium text-ink-muted">Origem</label>
                <select id="f-os-origem" value={get("origem")} onChange={(e) => setParams({ origem: e.target.value || null })} className={selectCls}>
                  <option value="">Todas</option>
                  {Object.entries(LABELS_ORIGEM_OS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <span className="text-xs font-medium text-ink-muted">Contrato</span>
                <BuscaSelect value={get("contratoId")} onChange={(v) => setParams({ contratoId: v || null })} options={opcoes.contratos} placeholder="Todos" />
              </div>
            </div>
          )}

          {/* Resumo / ações de filtro */}
          <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
            <div className="flex items-center gap-3 text-sm text-ink-muted">
              <span data-contador><strong className="text-ink">{total.toLocaleString("pt-BR")}</strong> {total === 1 ? "ordem de serviço" : "ordens de serviço"}</span>
              {filtrosAtivos > 0 && (
                <span className="pill-acento font-semibold">
                  <Filter className="w-3 h-3" /> {filtrosAtivos} filtro(s) ativo(s)
                </span>
              )}
            </div>
            {filtrosAtivos > 0 && (
              <button type="button" onClick={limparFiltros} className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink">
                <X className="w-3.5 h-3.5" /> Limpar filtros
              </button>
            )}
          </div>
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
          <div className="overflow-x-auto hidden md:block">
            <table className="w-full text-sm">
              <thead className="bg-surface-page border-b border-surface-border">
                <tr>
                  {massa && <th className="w-px pl-4 pr-1 py-3"><CheckboxPagina /></th>}
                  <Th onClick={() => ordenarPor("numero")}>Número <Seta campo="numero" /></Th>
                  <Th onClick={() => ordenarPor("cliente")}>Cliente <Seta campo="cliente" /></Th>
                  <th scope="col" className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden lg:table-cell">Técnico</th>
                  <Th className="hidden lg:table-cell" onClick={() => ordenarPor("criadoEm")}>Abertura <Seta campo="criadoEm" /></Th>
                  <Th className="hidden xl:table-cell" onClick={() => ordenarPor("previsaoConclusao")}>Previsão <Seta campo="previsaoConclusao" /></Th>
                  <Th onClick={() => ordenarPor("status")}>Status <Seta campo="status" /></Th>
                  <Th className="hidden md:table-cell" onClick={() => ordenarPor("prioridade")}>Prioridade <Seta campo="prioridade" /></Th>
                  <th scope="col" className="text-right px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Equipe</th>
                  <th className="w-px px-2 py-3"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {ordens.map((os) => (
                  <tr key={os.id} className="border-b border-surface-linha last:border-0 hover:bg-surface-page transition-colors">
                    {massa && <td className="w-px pl-4 pr-1 py-3"><CheckboxLinha id={os.id} rotulo={os.chamadoNumero ?? os.numero} /></td>}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Link href={`/ordens/${os.id}`} className="font-display font-semibold tabular-nums text-acento hover:underline">{os.chamadoNumero ?? os.numero}</Link>
                      {os.origem === "PORTAL_CLIENTE" && <span className="ml-2 pill-acento text-[11px] px-2"><Headset className="w-3 h-3" aria-hidden="true" /> Portal</span>}
                    </td>
                    <td className="px-4 py-3 text-ink font-medium">
                      <div className="flex items-center gap-2">
                        <AvatarCliente nome={os.cliente} logoUrl={os.clienteLogo} size={28} />
                        <span className="truncate">{os.cliente}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-muted hidden lg:table-cell">{os.responsavel ?? "—"}</td>
                    <td className="px-4 py-3 text-ink-muted tabular-nums hidden lg:table-cell">{formatarData(os.criadoEm)}</td>
                    <td className="px-4 py-3 text-ink-muted tabular-nums hidden xl:table-cell">{formatarDiaCivil(os.previsaoConclusao)}</td>
                    <td className="px-4 py-3"><span className={CLASSE_STATUS[os.status]}>{LABELS_STATUS_OS[os.status]}</span></td>
                    <td className="px-4 py-3 hidden md:table-cell"><span className={CLASSE_PRIORIDADE[os.prioridade]}>{LABELS_PRIORIDADE[os.prioridade]}</span></td>
                    <td className="px-4 py-3"><div className="flex justify-end"><AvatarStack tecnicos={os.tecnicos} size={28} /></div></td>
                    <td className="px-2 py-3"><OsInativarBotao osId={os.id} numero={os.chamadoNumero ?? os.numero} status={os.status} variante="icone" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

/** Cabeçalho ordenável: o clique é num <button> real (teclado e leitor de tela), não no <th>. */
function Th({ children, onClick, className }: { children: React.ReactNode; onClick: () => void; className?: string }) {
  return (
    <th scope="col" className={cn("text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider", className)}>
      <button type="button" onClick={onClick} className="inline-flex items-center uppercase tracking-wider select-none hover:text-ink rounded">
        {children}
      </button>
    </th>
  );
}
