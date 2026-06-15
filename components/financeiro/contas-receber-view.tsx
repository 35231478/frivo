"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { cn, formatarMoeda, formatarData, formatarCpfCnpj, LABELS_FORMA_PAGAMENTO } from "@/lib/utils";
import { statusVisualReceber } from "@/lib/financeiro-status";
import { AvatarCliente } from "@/components/ui/avatar-cliente";
import { ContaReceberAcoes } from "@/components/financeiro/conta-receber-acoes";
import { SincronizarBoletos } from "@/components/financeiro/sincronizar-boletos";
import {
  Receipt, AlertTriangle, CalendarClock, CheckCircle2, Search, SlidersHorizontal,
  Plus, Download, X, Barcode,
} from "lucide-react";

export interface ContaView {
  id: string; numero: string; descricao: string; categoria: string | null; valor: number;
  dataVencimento: string | null; dataRecebimento: string | null; status: string; banco: string | null;
  clienteId: string; clienteNome: string; clienteCnpj: string | null; clienteLogo: string | null;
  formaPagamento: string | null;
  whatsapp: string | null; email: string | null; notificacaoEnviadaEm: string | null;
  boletoStatus: string | null; boletoEmitidoEm: string | null; boletoVencimento: string | null;
  boletoLinhaDigitavel: string | null; boletoCodigoBarras: string | null;
}
interface Opcao { id: string; nome: string }

type CardKey = "A_RECEBER" | "VENCIDO" | "VENCE_HOJE" | "RECEBIDO";

const inicioMes = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); };

export function ContasReceberView({ contas, clientes, categorias, interAtivo, clienteIdInicial = "" }: { contas: ContaView[]; clientes: Opcao[]; categorias: { nome: string; cor: string }[]; interAtivo: boolean; clienteIdInicial?: string }) {
  const [card, setCard] = useState<CardKey | null>(null);
  const [busca, setBusca] = useState("");
  const [painel, setPainel] = useState(!!clienteIdInicial);
  const [f, setF] = useState({ vencDe: "", vencAte: "", clienteId: clienteIdInicial, forma: "", banco: "", categoria: "", valorMin: "", valorMax: "", status: new Set<string>() });

  // status visual por conta (memo)
  const comStatus = useMemo(() => contas.map((c) => ({ c, sv: statusVisualReceber(c.status, c.dataVencimento) })), [contas]);

  // Cards (sobre o conjunto completo)
  const resumo = useMemo(() => {
    const ini = inicioMes().getTime();
    let aReceber = { v: 0, q: 0 }, vencido = { v: 0, q: 0 }, hoje = { v: 0, q: 0 }, recebido = { v: 0, q: 0 };
    for (const { c, sv } of comStatus) {
      if (sv.chave === "PREVISTO" || sv.chave === "A_VENCER") { aReceber.v += c.valor; aReceber.q++; }
      else if (sv.chave === "VENCIDO") { vencido.v += c.valor; vencido.q++; }
      else if (sv.chave === "VENCE_HOJE") { hoje.v += c.valor; hoje.q++; }
      if (sv.chave === "PAGO" && c.dataRecebimento && new Date(c.dataRecebimento).getTime() >= ini) { recebido.v += c.valor; recebido.q++; }
    }
    return { aReceber, vencido, hoje, recebido };
  }, [comStatus]);

  const filtrosAtivos =
    (f.vencDe ? 1 : 0) + (f.vencAte ? 1 : 0) + (f.clienteId ? 1 : 0) + (f.forma ? 1 : 0) +
    (f.banco ? 1 : 0) + (f.categoria ? 1 : 0) + (f.valorMin ? 1 : 0) + (f.valorMax ? 1 : 0) + (f.status.size ? 1 : 0);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return comStatus.filter(({ c, sv }) => {
      // cards
      if (card === "A_RECEBER" && !(sv.chave === "PREVISTO" || sv.chave === "A_VENCER")) return false;
      if (card === "VENCIDO" && sv.chave !== "VENCIDO") return false;
      if (card === "VENCE_HOJE" && sv.chave !== "VENCE_HOJE") return false;
      if (card === "RECEBIDO" && sv.chave !== "PAGO") return false;
      // busca
      if (q && !(`${c.clienteNome} ${c.descricao} ${c.numero}`.toLowerCase().includes(q))) return false;
      // painel
      if (f.clienteId && c.clienteId !== f.clienteId) return false;
      if (f.categoria && c.categoria !== f.categoria) return false;
      if (f.forma && c.formaPagamento !== f.forma) return false;
      if (f.banco && !(c.banco ?? "").toLowerCase().includes(f.banco.toLowerCase())) return false;
      if (f.valorMin && c.valor < Number(f.valorMin)) return false;
      if (f.valorMax && c.valor > Number(f.valorMax)) return false;
      if (f.status.size && !f.status.has(sv.chave)) return false;
      if (f.vencDe && (!c.dataVencimento || c.dataVencimento < f.vencDe)) return false;
      if (f.vencAte && (!c.dataVencimento || c.dataVencimento.slice(0, 10) > f.vencAte)) return false;
      return true;
    });
  }, [comStatus, card, busca, f]);

  const totalFiltrado = filtradas.reduce((s, x) => s + x.c.valor, 0);

  function limpar() {
    setF({ vencDe: "", vencAte: "", clienteId: "", forma: "", banco: "", categoria: "", valorMin: "", valorMax: "", status: new Set() });
  }
  function toggleStatus(chave: string) {
    setF((p) => { const s = new Set(p.status); s.has(chave) ? s.delete(chave) : s.add(chave); return { ...p, status: s }; });
  }
  function exportar() {
    const linhas = [["Número", "Cliente", "CNPJ", "Descrição", "Categoria", "Vencimento", "Valor", "Status"]];
    for (const { c, sv } of filtradas) {
      linhas.push([c.numero, c.clienteNome, c.clienteCnpj ?? "", c.descricao, c.categoria ?? "", c.dataVencimento ? formatarData(c.dataVencimento) : "", String(c.valor).replace(".", ","), sv.label]);
    }
    const csv = linhas.map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "contas-a-receber.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  const inputCls = "bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all";

  const CARDS: { key: CardKey; label: string; icone: any; cor: string; bgSel: string; borda: string; v: number; q: number }[] = [
    { key: "A_RECEBER", label: "A Receber", icone: Receipt, cor: "text-primary-600", bgSel: "bg-primary-50", borda: "border-b-primary-500", v: resumo.aReceber.v, q: resumo.aReceber.q },
    { key: "VENCIDO", label: "Vencido", icone: AlertTriangle, cor: "text-red-600", bgSel: "bg-red-50", borda: "border-b-red-500", v: resumo.vencido.v, q: resumo.vencido.q },
    { key: "VENCE_HOJE", label: "Vence Hoje", icone: CalendarClock, cor: "text-amber-600", bgSel: "bg-amber-50", borda: "border-b-amber-500", v: resumo.hoje.v, q: resumo.hoje.q },
    { key: "RECEBIDO", label: "Recebido (mês)", icone: CheckCircle2, cor: "text-success-600", bgSel: "bg-success-50", borda: "border-b-success-500", v: resumo.recebido.v, q: resumo.recebido.q },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-lg"><Receipt className="w-5 h-5 text-primary-600" /></div>
          <h1 className="page-title">Contas a Receber</h1>
        </div>
        <div className="flex items-center gap-2">
          {interAtivo && <SincronizarBoletos />}
          <button onClick={exportar} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-white border border-surface-border text-ink-muted hover:bg-surface-alt transition-colors"><Download className="w-4 h-4" /> Exportar</button>
          <Link href="/financeiro/contas-receber/nova" className="inline-flex items-center gap-1.5 bg-success-500 hover:bg-success-600 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-sm"><Plus className="w-4 h-4" /> Nova Cobrança</Link>
        </div>
      </div>

      {/* Cards de resumo (clicáveis) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {CARDS.map((c) => {
          const sel = card === c.key;
          return (
            <button key={c.key} type="button" onClick={() => setCard(sel ? null : c.key)}
              className={cn(
                "text-left rounded-xl border border-surface-border border-b-2 bg-white p-4 transition-all hover:shadow-card",
                c.borda, sel ? `${c.bgSel} ring-2 ring-offset-1 ring-primary-200` : "hover:border-primary-200",
              )}>
              <div className="flex items-start justify-between">
                <c.icone className={cn("w-5 h-5", c.cor)} />
                {sel && <X className="w-3.5 h-3.5 text-ink-subtle" />}
              </div>
              <p className="text-xs text-ink-muted mt-2">{c.label}</p>
              <p className="text-xl font-bold text-ink mt-0.5">{formatarMoeda(c.v)}</p>
              <p className="text-[11px] text-ink-subtle mt-0.5">{c.q} cobrança{c.q === 1 ? "" : "s"}</p>
            </button>
          );
        })}
      </div>

      {/* Busca + filtros */}
      <div className="card overflow-hidden">
        <div className="p-3 border-b border-surface-border flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle pointer-events-none" />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por cliente, descrição ou número…" className={cn(inputCls, "w-full pl-9")} />
          </div>
          <button onClick={() => setPainel((v) => !v)} className={cn("inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors", painel || filtrosAtivos ? "bg-primary-50 border-primary-200 text-primary-700" : "bg-white border-surface-border text-ink-muted hover:bg-surface-alt")}>
            <SlidersHorizontal className="w-4 h-4" /> Filtros
            {filtrosAtivos > 0 && <span className="text-[10px] font-bold bg-primary-500 text-white rounded-full w-4 h-4 flex items-center justify-center">{filtrosAtivos}</span>}
          </button>
        </div>

        {painel && (
          <div className="p-4 border-b border-surface-border bg-surface-alt/40 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <FiltroCampo label="Vencimento — de"><input type="date" value={f.vencDe} onChange={(e) => setF({ ...f, vencDe: e.target.value })} className={inputCls} /></FiltroCampo>
              <FiltroCampo label="Vencimento — até"><input type="date" value={f.vencAte} onChange={(e) => setF({ ...f, vencAte: e.target.value })} className={inputCls} /></FiltroCampo>
              <FiltroCampo label="Cliente">
                <select value={f.clienteId} onChange={(e) => setF({ ...f, clienteId: e.target.value })} className={inputCls}>
                  <option value="">Todos</option>
                  {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </FiltroCampo>
              <FiltroCampo label="Categoria">
                <select value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })} className={inputCls}>
                  <option value="">Todas</option>
                  {categorias.map((c) => <option key={c.nome} value={c.nome}>{c.nome}</option>)}
                </select>
              </FiltroCampo>
              <FiltroCampo label="Forma de pagamento">
                <select value={f.forma} onChange={(e) => setF({ ...f, forma: e.target.value })} className={inputCls}>
                  <option value="">Todas</option>
                  {Object.entries(LABELS_FORMA_PAGAMENTO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </FiltroCampo>
              <FiltroCampo label="Banco"><input value={f.banco} onChange={(e) => setF({ ...f, banco: e.target.value })} className={inputCls} placeholder="Banco" /></FiltroCampo>
              <FiltroCampo label="Valor de"><input type="number" value={f.valorMin} onChange={(e) => setF({ ...f, valorMin: e.target.value })} className={inputCls} placeholder="0,00" /></FiltroCampo>
              <FiltroCampo label="Valor até"><input type="number" value={f.valorMax} onChange={(e) => setF({ ...f, valorMax: e.target.value })} className={inputCls} placeholder="0,00" /></FiltroCampo>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-1.5">Status</p>
              <div className="flex flex-wrap gap-1.5">
                {(["PREVISTO", "A_VENCER", "VENCE_HOJE", "VENCIDO", "PAGO", "CANCELADO"] as const).map((s) => (
                  <button key={s} type="button" onClick={() => toggleStatus(s)}
                    className={cn("text-xs px-2.5 py-1 rounded-full border transition-colors", f.status.has(s) ? "bg-primary-500 border-primary-500 text-white" : "bg-white border-surface-border text-ink-muted hover:border-primary-300")}>
                    {LABEL_CHAVE[s]}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={limpar} className="text-sm text-ink-muted hover:text-ink px-3 py-1.5">Limpar</button>
              <button onClick={() => setPainel(false)} className="text-sm font-semibold text-white bg-primary-500 hover:bg-primary-600 px-4 py-1.5 rounded-lg">Aplicar</button>
            </div>
          </div>
        )}

        {/* Tabela */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-alt border-b border-surface-border">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Cliente</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden lg:table-cell">Descrição</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden md:table-cell">Categoria</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden md:table-cell">Vencimento</th>
                <th className="text-right px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Valor</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Status</th>
                <th className="text-right px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.length === 0 ? (
                <tr><td colSpan={7} className="text-center text-ink-subtle py-12">Nenhuma cobrança encontrada</td></tr>
              ) : filtradas.map(({ c, sv }) => {
                const cat = categorias.find((x) => x.nome === c.categoria);
                return (
                  <tr key={c.id} className={cn("border-b border-surface-border transition-colors", sv.linhaVermelha ? "bg-red-50 hover:bg-red-100/50" : "hover:bg-surface-alt/60")}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <AvatarCliente nome={c.clienteNome} logoUrl={c.clienteLogo} size={32} />
                        <div className="min-w-0">
                          <p className="font-medium text-ink truncate max-w-[180px]">{c.clienteNome}</p>
                          {c.clienteCnpj && <p className="text-xs text-ink-subtle">{formatarCpfCnpj(c.clienteCnpj)}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-muted hidden lg:table-cell truncate max-w-[200px]">{c.descricao}</td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {c.categoria ? <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: `${cat?.cor ?? "#64748B"}1a`, color: cat?.cor ?? "#64748B" }}>{c.categoria}</span> : <span className="text-ink-subtle">—</span>}
                    </td>
                    <td className="px-4 py-3 text-ink-muted hidden md:table-cell">{c.dataVencimento ? formatarData(c.dataVencimento) : "—"}</td>
                    <td className="px-4 py-3 text-right font-bold text-success-700">{formatarMoeda(c.valor)}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={cn("inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full", sv.classe)}>
                          {sv.linhaVermelha && <AlertTriangle className="w-3 h-3" />}{sv.label}
                        </span>
                        {c.boletoStatus === "EMITIDO" && <Barcode className="w-4 h-4 text-emerald-600" aria-label="Boleto emitido" />}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ContaReceberAcoes conta={{
                        id: c.id, numero: c.numero, descricao: c.descricao, categoria: c.categoria, valor: c.valor,
                        dataVencimento: c.dataVencimento, status: c.status, banco: c.banco,
                        clienteNome: c.clienteNome, whatsapp: c.whatsapp, email: c.email, notificacaoEnviadaEm: c.notificacaoEnviadaEm,
                        interAtivo, boletoStatus: c.boletoStatus, boletoEmitidoEm: c.boletoEmitidoEm, boletoVencimento: c.boletoVencimento,
                        boletoLinhaDigitavel: c.boletoLinhaDigitavel, boletoCodigoBarras: c.boletoCodigoBarras,
                      }} categorias={categorias} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-surface-border bg-surface-alt/40 text-sm flex-wrap">
          <span className="text-ink-muted">Exibindo <strong className="text-ink">{filtradas.length}</strong> de <strong className="text-ink">{contas.length}</strong> cobranças</span>
          <span className="text-ink-muted">Total filtrado: <strong className="text-ink">{formatarMoeda(totalFiltrado)}</strong></span>
        </div>
      </div>
    </div>
  );
}

const LABEL_CHAVE: Record<string, string> = { PREVISTO: "Previsto", A_VENCER: "A vencer", VENCE_HOJE: "Vence hoje", VENCIDO: "Vencido", PAGO: "Pago", CANCELADO: "Cancelado" };

function FiltroCampo({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-[11px] font-semibold text-ink-muted">{label}</label><div className="mt-1">{children}</div></div>;
}
