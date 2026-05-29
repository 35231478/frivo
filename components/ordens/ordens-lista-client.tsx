"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { cn, formatarData, LABELS_STATUS_OS, LABELS_PRIORIDADE, LABELS_ORIGEM_OS } from "@/lib/utils";
import { BuscaSelect, type OpcaoBusca } from "@/components/ui/busca-select";
import {
  ClipboardList, Plus, Search, SlidersHorizontal, X, ArrowUp, ArrowDown, ArrowUpDown,
  LayoutGrid, List, Download, Headset, Filter,
} from "lucide-react";

interface OrdemView {
  id: string; numero: string; chamadoNumero: string | null; origem: string;
  cliente: string; unidade: string | null; responsavel: string | null; atividades: number;
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

export function OrdensListaClient({ ordens, total, exibindo, opcoes }: { ordens: OrdemView[]; total: number; exibindo: number; opcoes: Opcoes }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const get = (k: string) => sp.get(k) ?? "";

  const view = get("view") === "cards" ? "cards" : "tabela";
  const sortAtual = get("sort") || "criadoEm";
  const dirAtual = (get("dir") || "desc") as "asc" | "desc";
  const filtrosAtivos = FILTROS_CHAVE.filter((k) => get(k) !== "").length;

  const [mostrarAvancados, setMostrarAvancados] = useState(AVANCADOS.some((k) => get(k) !== ""));
  const [buscaLocal, setBuscaLocal] = useState(get("busca"));
  const [numeroLocal, setNumeroLocal] = useState(get("numero"));

  function setParams(updates: Record<string, string | null>) {
    const novo = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(updates)) { if (v) novo.set(k, v); else novo.delete(k); }
    router.replace(`${pathname}?${novo.toString()}`, { scroll: false });
  }

  // Debounce da busca geral
  useEffect(() => {
    const t = setTimeout(() => { if (buscaLocal !== get("busca")) setParams({ busca: buscaLocal || null }); }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscaLocal]);
  // Debounce do número
  useEffect(() => {
    const t = setTimeout(() => { if (numeroLocal !== get("numero")) setParams({ numero: numeroLocal || null }); }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numeroLocal]);

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
    setBuscaLocal(""); setNumeroLocal("");
    router.replace(`${pathname}${novo.toString() ? `?${novo}` : ""}`, { scroll: false });
  }

  const exportUrl = `/api/ordens/export${sp.toString() ? `?${sp.toString()}` : ""}`;

  function Seta({ campo }: { campo: string }) {
    if (sortAtual !== campo) return <ArrowUpDown className="inline w-3 h-3 ml-1 text-ink-subtle" />;
    return dirAtual === "asc" ? <ArrowUp className="inline w-3 h-3 ml-1 text-primary-600" /> : <ArrowDown className="inline w-3 h-3 ml-1 text-primary-600" />;
  }

  const selectCls = "w-full bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-lg"><ClipboardList className="w-5 h-5 text-primary-600" /></div>
          <h1 className="page-title">Ordens de Serviço</h1>
          <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">{total}</span>
        </div>
        <Link href="/ordens/nova" className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm hover:shadow">
          <Plus className="w-4 h-4" /> Nova OS
        </Link>
      </div>

      <div className="card overflow-hidden">
        {/* Filtros principais */}
        <div className="p-4 border-b border-surface-border bg-surface-alt/40 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle pointer-events-none" />
              <input value={buscaLocal} onChange={(e) => setBuscaLocal(e.target.value)} placeholder="Buscar por número, descrição ou cliente..."
                className="w-full bg-white border border-surface-border rounded-lg pl-9 pr-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all" />
            </div>
            <button type="button" onClick={() => setMostrarAvancados((v) => !v)}
              className={cn("inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors", mostrarAvancados ? "bg-primary-50 border-primary-200 text-primary-700" : "bg-white border-surface-border text-ink-muted hover:bg-surface-alt")}>
              <SlidersHorizontal className="w-4 h-4" /> Mais filtros
            </button>
            {/* Alternar visualização */}
            <div className="flex rounded-lg border border-surface-border overflow-hidden">
              <button type="button" onClick={() => setParams({ view: null })} className={cn("p-2", view === "tabela" ? "bg-primary-500 text-white" : "bg-white text-ink-muted hover:bg-surface-alt")} title="Tabela"><List className="w-4 h-4" /></button>
              <button type="button" onClick={() => setParams({ view: "cards" })} className={cn("p-2", view === "cards" ? "bg-primary-500 text-white" : "bg-white text-ink-muted hover:bg-surface-alt")} title="Cards"><LayoutGrid className="w-4 h-4" /></button>
            </div>
            <a href={exportUrl} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-white border border-surface-border text-ink-muted hover:bg-surface-alt transition-colors">
              <Download className="w-4 h-4" /> Exportar
            </a>
          </div>

          {/* Chips de status e prioridade (multi) */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider mr-1">Status</span>
              {Object.entries(LABELS_STATUS_OS).map(([v, l]) => (
                <button key={v} type="button" onClick={() => toggleLista("status", v)}
                  className={cn("text-xs px-2 py-1 rounded-full border transition-colors", naLista("status", v) ? "bg-primary-500 border-primary-500 text-white" : "bg-white border-surface-border text-ink-muted hover:border-primary-300")}>{l}</button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider mr-1">Prioridade</span>
              {Object.entries(LABELS_PRIORIDADE).map(([v, l]) => (
                <button key={v} type="button" onClick={() => toggleLista("prioridade", v)}
                  className={cn("text-xs px-2 py-1 rounded-full border transition-colors", naLista("prioridade", v) ? "bg-primary-500 border-primary-500 text-white" : "bg-white border-surface-border text-ink-muted hover:border-primary-300")}>{l}</button>
              ))}
            </div>
          </div>

          {/* Filtros avançados */}
          {mostrarAvancados && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-surface-border">
              <div>
                <label className="text-[11px] font-semibold text-ink-muted">Abertura — de</label>
                <input type="date" defaultValue={get("dataInicio")} onChange={(e) => setParams({ dataInicio: e.target.value || null })} className={selectCls} />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-ink-muted">Abertura — até</label>
                <input type="date" defaultValue={get("dataFim")} onChange={(e) => setParams({ dataFim: e.target.value || null })} className={selectCls} />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-ink-muted">Cliente</label>
                <BuscaSelect value={get("clienteId")} onChange={(v) => setParams({ clienteId: v || null })} options={opcoes.clientes} placeholder="Todos" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-ink-muted">Técnico responsável</label>
                <BuscaSelect value={get("responsavelId")} onChange={(v) => setParams({ responsavelId: v || null })} options={opcoes.usuarios} placeholder="Todos" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-ink-muted">Tipo de OS</label>
                <select value={get("tipoOsId")} onChange={(e) => setParams({ tipoOsId: e.target.value || null })} className={selectCls}>
                  <option value="">Todos</option>
                  {opcoes.tiposOs.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-ink-muted">Número da OS</label>
                <input value={numeroLocal} onChange={(e) => setNumeroLocal(e.target.value)} placeholder="OS-2026-..." className={selectCls} />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-ink-muted">Origem</label>
                <select value={get("origem")} onChange={(e) => setParams({ origem: e.target.value || null })} className={selectCls}>
                  <option value="">Todas</option>
                  {Object.entries(LABELS_ORIGEM_OS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-ink-muted">Contrato</label>
                <BuscaSelect value={get("contratoId")} onChange={(v) => setParams({ contratoId: v || null })} options={opcoes.contratos} placeholder="Todos" />
              </div>
            </div>
          )}

          {/* Resumo / ações de filtro */}
          <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
            <div className="flex items-center gap-3 text-sm text-ink-muted">
              <span>Exibindo <strong className="text-ink">{exibindo}</strong> de <strong className="text-ink">{total}</strong> ordens de serviço</span>
              {filtrosAtivos > 0 && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full">
                  <Filter className="w-3 h-3" /> {filtrosAtivos} filtro(s) ativo(s)
                </span>
              )}
            </div>
            {filtrosAtivos > 0 && (
              <button type="button" onClick={limparFiltros} className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700">
                <X className="w-3.5 h-3.5" /> Limpar filtros
              </button>
            )}
          </div>
        </div>

        {/* Resultados */}
        {ordens.length === 0 ? (
          <p className="text-center text-ink-subtle py-12">Nenhuma OS encontrada com os filtros aplicados.</p>
        ) : view === "cards" ? (
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {ordens.map((os) => (
              <Link key={os.id} href={`/ordens/${os.id}`} className="border border-surface-border rounded-xl p-4 hover:border-primary-200 hover:shadow-card transition-all">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-semibold text-primary-600">{os.chamadoNumero ?? os.numero}</span>
                  {os.origem === "PORTAL_CLIENTE" && <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-cyan-50 text-cyan-700 px-1.5 py-0.5 rounded"><Headset className="w-3 h-3" /> Portal</span>}
                </div>
                <p className="text-sm font-medium text-ink mt-1 truncate">{os.cliente}</p>
                <p className="text-xs text-ink-muted truncate">{os.unidade ?? "—"}{os.responsavel ? ` · ${os.responsavel}` : ""}</p>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className={CLASSE_STATUS[os.status]}>{LABELS_STATUS_OS[os.status]}</span>
                  <span className={CLASSE_PRIORIDADE[os.prioridade]}>{LABELS_PRIORIDADE[os.prioridade]}</span>
                </div>
                <p className="text-[11px] text-ink-subtle mt-2">Aberta {formatarData(os.criadoEm)}{os.previsaoConclusao ? ` · Prev. ${formatarData(os.previsaoConclusao)}` : ""}</p>
              </Link>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-alt border-b border-surface-border">
                <tr>
                  <Th onClick={() => ordenarPor("numero")}>Número <Seta campo="numero" /></Th>
                  <Th onClick={() => ordenarPor("cliente")}>Cliente <Seta campo="cliente" /></Th>
                  <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden lg:table-cell">Técnico</th>
                  <Th className="hidden lg:table-cell" onClick={() => ordenarPor("criadoEm")}>Abertura <Seta campo="criadoEm" /></Th>
                  <Th className="hidden xl:table-cell" onClick={() => ordenarPor("previsaoConclusao")}>Previsão <Seta campo="previsaoConclusao" /></Th>
                  <Th onClick={() => ordenarPor("status")}>Status <Seta campo="status" /></Th>
                  <Th className="hidden md:table-cell" onClick={() => ordenarPor("prioridade")}>Prioridade <Seta campo="prioridade" /></Th>
                </tr>
              </thead>
              <tbody>
                {ordens.map((os, idx) => (
                  <tr key={os.id} className={cn("border-b border-surface-border hover:bg-primary-50/40 transition-colors", idx % 2 === 1 && "bg-surface-alt/30")}>
                    <td className="px-4 py-3">
                      <Link href={`/ordens/${os.id}`} className="font-mono font-semibold text-primary-600 hover:underline">{os.chamadoNumero ?? os.numero}</Link>
                      {os.origem === "PORTAL_CLIENTE" && <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-semibold bg-cyan-50 text-cyan-700 px-1.5 py-0.5 rounded"><Headset className="w-3 h-3" /> Portal</span>}
                    </td>
                    <td className="px-4 py-3 text-ink font-medium">{os.cliente}</td>
                    <td className="px-4 py-3 text-ink-muted hidden lg:table-cell">{os.responsavel ?? "—"}</td>
                    <td className="px-4 py-3 text-ink-muted hidden lg:table-cell">{formatarData(os.criadoEm)}</td>
                    <td className="px-4 py-3 text-ink-muted hidden xl:table-cell">{os.previsaoConclusao ? formatarData(os.previsaoConclusao) : "—"}</td>
                    <td className="px-4 py-3"><span className={CLASSE_STATUS[os.status]}>{LABELS_STATUS_OS[os.status]}</span></td>
                    <td className="px-4 py-3 hidden md:table-cell"><span className={CLASSE_PRIORIDADE[os.prioridade]}>{LABELS_PRIORIDADE[os.prioridade]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Th({ children, onClick, className }: { children: React.ReactNode; onClick: () => void; className?: string }) {
  return (
    <th className={cn("text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider cursor-pointer select-none hover:text-ink", className)} onClick={onClick}>
      {children}
    </th>
  );
}
