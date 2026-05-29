"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { cn, formatarData, formatarMoeda, LABELS_PERIODICIDADE } from "@/lib/utils";
import { BuscaSelect, type OpcaoBusca } from "@/components/ui/busca-select";
import {
  FileText, Plus, Search, SlidersHorizontal, X, ArrowUp, ArrowDown, ArrowUpDown,
  Filter, BarChart3, Wallet, CalendarClock, AlertTriangle,
} from "lucide-react";

interface ContratoView {
  id: string; numero: string; cliente: string; periodicidade: string; valorMensal: number | null;
  dataInicio: string; dataFim: string | null; status: string; vencido: boolean; vencendo: boolean;
  proximaOs: { id: string; numero: string; status: string; previsaoConclusao: string | null } | null;
}
interface Resumo { ativos: number; valorMensalTotal: number; valorAnualTotal: number; vencendo: number; vencidos: number }

const LABELS_STATUS: Record<string, string> = {
  ATIVO: "Ativo", SUSPENSO: "Suspenso", ENCERRADO: "Encerrado", VENCIDO: "Vencido", AGUARDANDO_ASSINATURA: "Aguard. Assinatura",
};
const COR_STATUS: Record<string, string> = {
  ATIVO: "bg-success-50 text-success-700", SUSPENSO: "bg-orange-50 text-orange-700",
  ENCERRADO: "bg-slate-100 text-slate-600", VENCIDO: "bg-red-50 text-red-700", AGUARDANDO_ASSINATURA: "bg-primary-50 text-primary-700",
};
const COR_FREQ: Record<string, string> = {
  SEMANAL: "bg-slate-100 text-slate-600", QUINZENAL: "bg-slate-100 text-slate-600",
  MENSAL: "bg-primary-50 text-primary-700", BIMESTRAL: "bg-cyan-50 text-cyan-700",
  TRIMESTRAL: "bg-violet-50 text-violet-700", SEMESTRAL: "bg-amber-50 text-amber-700", ANUAL: "bg-success-50 text-success-700",
};

const FILTROS = ["busca", "status", "frequencia", "vigenciaInicio", "vigenciaFim", "valorMin", "valorMax", "clienteId"];

export function ContratosListaClient({ contratos, total, somaMensalFiltrada, resumo, opcoesClientes }: {
  contratos: ContratoView[]; total: number; somaMensalFiltrada: number; resumo: Resumo; opcoesClientes: OpcaoBusca[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const get = (k: string) => sp.get(k) ?? "";
  const sortAtual = get("sort") || "dataInicio";
  const dirAtual = (get("dir") || "desc") as "asc" | "desc";
  const filtrosAtivos = FILTROS.filter((k) => get(k) !== "").length;

  const [avancado, setAvancado] = useState(["vigenciaInicio", "vigenciaFim", "valorMin", "valorMax", "clienteId"].some((k) => get(k) !== ""));
  const [buscaLocal, setBuscaLocal] = useState(get("busca"));
  const [valorMin, setValorMin] = useState(get("valorMin"));
  const [valorMax, setValorMax] = useState(get("valorMax"));

  function setParams(updates: Record<string, string | null>) {
    const novo = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(updates)) { if (v) novo.set(k, v); else novo.delete(k); }
    router.replace(`${pathname}?${novo.toString()}`, { scroll: false });
  }

  useEffect(() => { const t = setTimeout(() => { if (buscaLocal !== get("busca")) setParams({ busca: buscaLocal || null }); }, 500); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [buscaLocal]);
  useEffect(() => { const t = setTimeout(() => { if (valorMin !== get("valorMin")) setParams({ valorMin: valorMin || null }); }, 600); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [valorMin]);
  useEffect(() => { const t = setTimeout(() => { if (valorMax !== get("valorMax")) setParams({ valorMax: valorMax || null }); }, 600); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [valorMax]);

  function ordenarPor(campo: string) {
    if (sortAtual === campo) setParams({ dir: dirAtual === "asc" ? "desc" : "asc" });
    else setParams({ sort: campo, dir: "asc" });
  }
  function limpar() { setBuscaLocal(""); setValorMin(""); setValorMax(""); router.replace(pathname, { scroll: false }); }

  function Seta({ campo }: { campo: string }) {
    if (sortAtual !== campo) return <ArrowUpDown className="inline w-3 h-3 ml-1 text-ink-subtle" />;
    return dirAtual === "asc" ? <ArrowUp className="inline w-3 h-3 ml-1 text-primary-600" /> : <ArrowDown className="inline w-3 h-3 ml-1 text-primary-600" />;
  }
  const selectCls = "w-full bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all";

  const cards = [
    { label: "Contratos ativos", valor: String(resumo.ativos), icone: FileText, cor: "text-primary-600", bg: "bg-primary-50" },
    { label: "Valor mensal total", valor: formatarMoeda(resumo.valorMensalTotal), icone: Wallet, cor: "text-success-700", bg: "bg-success-50" },
    { label: "Valor anual total", valor: formatarMoeda(resumo.valorAnualTotal), icone: BarChart3, cor: "text-success-700", bg: "bg-success-50" },
    { label: "Vencendo em 30 dias", valor: String(resumo.vencendo), icone: CalendarClock, cor: "text-amber-600", bg: "bg-amber-50" },
    { label: "Vencidos", valor: String(resumo.vencidos), icone: AlertTriangle, cor: "text-red-600", bg: "bg-red-50" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-lg"><FileText className="w-5 h-5 text-primary-600" /></div>
          <h1 className="page-title">Contratos</h1>
          <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">{total}</span>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/contratos/relatorio" className="inline-flex items-center gap-2 bg-white border border-surface-border text-ink hover:bg-surface-alt px-4 py-2.5 rounded-lg text-sm font-semibold transition-all">
            <BarChart3 className="w-4 h-4" /> Relatório
          </Link>
          <Link href="/contratos/novo" className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm hover:shadow">
            <Plus className="w-4 h-4" /> Novo Contrato
          </Link>
        </div>
      </div>

      {/* Cards de resumo */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="card p-4">
            <div className={cn("p-2 rounded-lg w-fit mb-2", c.bg)}><c.icone className={cn("w-4 h-4", c.cor)} /></div>
            <p className={cn("text-lg font-bold", c.cor)}>{c.valor}</p>
            <p className="text-xs text-ink-muted mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      <div className="card overflow-hidden">
        {/* Filtros */}
        <div className="p-4 border-b border-surface-border bg-surface-alt/40 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle pointer-events-none" />
              <input value={buscaLocal} onChange={(e) => setBuscaLocal(e.target.value)} placeholder="Buscar por número ou cliente..."
                className="w-full bg-white border border-surface-border rounded-lg pl-9 pr-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all" />
            </div>
            <select value={get("status")} onChange={(e) => setParams({ status: e.target.value || null })} className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10">
              <option value="">Todos status</option>
              <option value="ATIVO">Ativo</option>
              <option value="INATIVO">Inativo</option>
              <option value="VENCENDO">Vencendo (30d)</option>
              <option value="VENCIDO">Vencido</option>
            </select>
            <select value={get("frequencia")} onChange={(e) => setParams({ frequencia: e.target.value || null })} className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10">
              <option value="">Toda frequência</option>
              {Object.entries(LABELS_PERIODICIDADE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button type="button" onClick={() => setAvancado((v) => !v)}
              className={cn("inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors", avancado ? "bg-primary-50 border-primary-200 text-primary-700" : "bg-white border-surface-border text-ink-muted hover:bg-surface-alt")}>
              <SlidersHorizontal className="w-4 h-4" /> Mais filtros
            </button>
          </div>

          {avancado && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-surface-border">
              <div><label className="text-[11px] font-semibold text-ink-muted">Vigência — início de</label><input type="date" defaultValue={get("vigenciaInicio")} onChange={(e) => setParams({ vigenciaInicio: e.target.value || null })} className={selectCls} /></div>
              <div><label className="text-[11px] font-semibold text-ink-muted">Vigência — início até</label><input type="date" defaultValue={get("vigenciaFim")} onChange={(e) => setParams({ vigenciaFim: e.target.value || null })} className={selectCls} /></div>
              <div><label className="text-[11px] font-semibold text-ink-muted">Valor mensal — de</label><input type="number" min="0" step="0.01" value={valorMin} onChange={(e) => setValorMin(e.target.value)} placeholder="R$ mín." className={selectCls} /></div>
              <div><label className="text-[11px] font-semibold text-ink-muted">Valor mensal — até</label><input type="number" min="0" step="0.01" value={valorMax} onChange={(e) => setValorMax(e.target.value)} placeholder="R$ máx." className={selectCls} /></div>
              <div className="lg:col-span-2"><label className="text-[11px] font-semibold text-ink-muted">Cliente</label><BuscaSelect value={get("clienteId")} onChange={(v) => setParams({ clienteId: v || null })} options={opcoesClientes} placeholder="Todos" /></div>
            </div>
          )}

          <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
            <span className="text-sm text-ink-muted">{total} contrato(s){filtrosAtivos > 0 && <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full"><Filter className="w-3 h-3" /> {filtrosAtivos} filtro(s)</span>}</span>
            {filtrosAtivos > 0 && <button type="button" onClick={limpar} className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700"><X className="w-3.5 h-3.5" /> Limpar filtros</button>}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-alt border-b border-surface-border">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Número</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider cursor-pointer select-none hover:text-ink" onClick={() => ordenarPor("cliente")}>Cliente <Seta campo="cliente" /></th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden md:table-cell">Frequência</th>
                <th className="text-right px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider cursor-pointer select-none hover:text-ink" onClick={() => ordenarPor("valorMensal")}>Valor/mês <Seta campo="valorMensal" /></th>
                <th className="text-right px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden md:table-cell">Valor/ano</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden lg:table-cell cursor-pointer select-none hover:text-ink" onClick={() => ordenarPor("dataInicio")}>Início <Seta campo="dataInicio" /></th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden lg:table-cell cursor-pointer select-none hover:text-ink" onClick={() => ordenarPor("dataFim")}>Fim <Seta campo="dataFim" /></th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden xl:table-cell">Próxima OS</th>
              </tr>
            </thead>
            <tbody>
              {contratos.length === 0 ? (
                <tr><td colSpan={9} className="text-center text-ink-subtle py-12">Nenhum contrato encontrado</td></tr>
              ) : contratos.map((ct, idx) => (
                <tr key={ct.id} className={cn("border-b border-surface-border hover:bg-primary-50/40 transition-colors", idx % 2 === 1 && "bg-surface-alt/30", ct.vencido && "bg-red-50/60 hover:bg-red-50")}>
                  <td className="px-4 py-3">
                    <Link href={`/contratos/${ct.id}`} className="font-mono font-semibold text-primary-600 hover:underline">{ct.numero}</Link>
                  </td>
                  <td className="px-4 py-3 text-ink font-medium">{ct.cliente}</td>
                  <td className="px-4 py-3 hidden md:table-cell"><span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", COR_FREQ[ct.periodicidade])}>{LABELS_PERIODICIDADE[ct.periodicidade] ?? ct.periodicidade}</span></td>
                  <td className="px-4 py-3 text-right text-ink font-medium">{formatarMoeda(ct.valorMensal)}</td>
                  <td className="px-4 py-3 text-right text-ink-muted hidden md:table-cell">{ct.valorMensal != null ? formatarMoeda(ct.valorMensal * 12) : "—"}</td>
                  <td className="px-4 py-3 text-ink-muted hidden lg:table-cell">{formatarData(ct.dataInicio)}</td>
                  <td className={cn("px-4 py-3 hidden lg:table-cell", ct.vencido ? "text-red-600 font-medium" : "text-ink-muted")}>{ct.dataFim ? formatarData(ct.dataFim) : "indeterminado"}</td>
                  <td className="px-4 py-3">
                    {ct.vencido ? (
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-red-50 text-red-700">Vencido</span>
                    ) : ct.vencendo ? (
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700">Vence em breve</span>
                    ) : (
                      <span className={cn("text-xs font-semibold px-2.5 py-1 rounded-full", COR_STATUS[ct.status])}>{LABELS_STATUS[ct.status] ?? ct.status}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 hidden xl:table-cell">
                    {ct.proximaOs ? (
                      <Link href={`/ordens/${ct.proximaOs.id}`} className="text-xs text-primary-600 hover:underline">{ct.proximaOs.numero} · {ct.proximaOs.previsaoConclusao ? formatarData(ct.proximaOs.previsaoConclusao) : ""}</Link>
                    ) : <span className="text-xs text-ink-subtle">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            {contratos.length > 0 && (
              <tfoot>
                <tr className="bg-surface-alt border-t-2 border-surface-border">
                  <td colSpan={3} className="px-4 py-3 text-sm font-semibold text-ink">{total} contrato(s) filtrado(s)</td>
                  <td className="px-4 py-3 text-right text-sm font-bold text-success-700">{formatarMoeda(somaMensalFiltrada)}</td>
                  <td className="px-4 py-3 text-right text-sm font-bold text-success-700 hidden md:table-cell">{formatarMoeda(somaMensalFiltrada * 12)}</td>
                  <td colSpan={4} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
