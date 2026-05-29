"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn, formatarData, formatarMoeda, nomeMes, MESES_PT, LABELS_PERIODICIDADE } from "@/lib/utils";
import {
  CalendarDays, ChevronLeft, ChevronRight, ChevronDown, ExternalLink, Plus,
  CheckCircle2, Clock, AlertTriangle, Loader2,
} from "lucide-react";

type StatusMes = "CONCLUIDO" | "EM_ANDAMENTO" | "PENDENTE" | "ATRASADO";

interface OsMes { id: string; numero: string; status: string; previsaoConclusao: string | null; tecnicoId: string | null; tecnicoNome: string | null }
interface Item {
  contratoId: string; numero: string; cliente: string; clienteId: string; periodicidade: string;
  valorMensal: number | null; statusMes: StatusMes; progresso: number; dataAgendada: string;
  os: OsMes | null; ultimaManutencao: string | null;
}
interface Opcao { value: string; label: string }

const LABEL_STATUS: Record<StatusMes, string> = { CONCLUIDO: "Concluído", EM_ANDAMENTO: "Em andamento", PENDENTE: "Pendente", ATRASADO: "Atrasado" };
const COR_STATUS: Record<StatusMes, string> = {
  CONCLUIDO: "bg-success-50 text-success-700", EM_ANDAMENTO: "bg-primary-50 text-primary-700",
  PENDENTE: "bg-amber-50 text-amber-700", ATRASADO: "bg-red-50 text-red-700",
};
const COR_BARRA: Record<StatusMes, string> = {
  CONCLUIDO: "bg-success-500", EM_ANDAMENTO: "bg-primary-500", PENDENTE: "bg-amber-400", ATRASADO: "bg-red-500",
};
const COR_FREQ: Record<string, string> = {
  SEMANAL: "bg-slate-100 text-slate-600", QUINZENAL: "bg-slate-100 text-slate-600", MENSAL: "bg-primary-50 text-primary-700",
  BIMESTRAL: "bg-cyan-50 text-cyan-700", TRIMESTRAL: "bg-violet-50 text-violet-700", SEMESTRAL: "bg-amber-50 text-amber-700", ANUAL: "bg-success-50 text-success-700",
};

export function RelatorioContratosClient({ mes, ano, itens, tecnicos, clientes }: { mes: number; ano: number; itens: Item[]; tecnicos: Opcao[]; clientes: Opcao[] }) {
  const router = useRouter();
  const [fStatus, setFStatus] = useState("");
  const [fTecnico, setFTecnico] = useState("");
  const [fCliente, setFCliente] = useState("");
  const [expandido, setExpandido] = useState<Set<string>>(new Set());
  const [gerando, setGerando] = useState<string | null>(null);

  function irPara(m: number, a: number) { router.push(`/contratos/relatorio?mes=${m}&ano=${a}`); }
  const mesAnterior = mes === 1 ? { m: 12, a: ano - 1 } : { m: mes - 1, a: ano };
  const mesSeguinte = mes === 12 ? { m: 1, a: ano + 1 } : { m: mes + 1, a: ano };

  const filtrados = itens.filter((i) =>
    (!fStatus || i.statusMes === fStatus) &&
    (!fTecnico || i.os?.tecnicoId === fTecnico) &&
    (!fCliente || i.clienteId === fCliente),
  );

  const total = itens.length;
  const concluidos = itens.filter((i) => i.statusMes === "CONCLUIDO").length;
  const andamento = itens.filter((i) => i.statusMes === "EM_ANDAMENTO").length;
  const pendentes = itens.filter((i) => i.statusMes === "PENDENTE").length;
  const atrasados = itens.filter((i) => i.statusMes === "ATRASADO").length;
  const pct = total > 0 ? Math.round((concluidos / total) * 100) : 0;
  const corPct = pct <= 50 ? "bg-red-500" : pct <= 80 ? "bg-amber-400" : "bg-success-500";

  // Donut (conic-gradient)
  const seg = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  const p1 = seg(concluidos), p2 = p1 + seg(andamento), p3 = p2 + seg(pendentes);
  const donut = total > 0
    ? `conic-gradient(#10B981 0 ${p1}%, #0EA5E9 ${p1}% ${p2}%, #F59E0B ${p2}% ${p3}%, #EF4444 ${p3}% 100%)`
    : "conic-gradient(#E2E8F0 0 100%)";

  function toggle(id: string) { setExpandido((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }); }

  async function gerarOs(contratoId: string) {
    setGerando(contratoId);
    try {
      const res = await fetch(`/api/contratos/${contratoId}/gerar-os`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mes, ano }) });
      if (res.ok) router.refresh();
    } finally { setGerando(null); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/contratos" className="p-2 rounded-lg text-ink-muted hover:text-primary-600 hover:bg-surface-alt"><ChevronLeft className="w-5 h-5" /></Link>
          <div className="p-2 bg-primary-50 rounded-lg"><CalendarDays className="w-5 h-5 text-primary-600" /></div>
          <h1 className="page-title">Relatório de manutenções — {nomeMes(mes)}/{ano}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => irPara(mesAnterior.m, mesAnterior.a)} className="p-2 rounded-lg border border-surface-border hover:bg-surface-alt"><ChevronLeft className="w-4 h-4" /></button>
          <select value={mes} onChange={(e) => irPara(Number(e.target.value), ano)} className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm">
            {MESES_PT.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <input type="number" value={ano} onChange={(e) => irPara(mes, Number(e.target.value) || ano)} className="w-24 bg-white border border-surface-border rounded-lg px-3 py-2 text-sm" />
          <button onClick={() => irPara(mesSeguinte.m, mesSeguinte.a)} className="p-2 rounded-lg border border-surface-border hover:bg-surface-alt"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>

      {/* Resumo do mês + donut */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card-padded lg:col-span-2 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Resumo label="Requerem atendimento" valor={total} cor="text-ink" />
            <Resumo label="Realizadas (concluídas)" valor={concluidos} cor="text-success-700" />
            <Resumo label="Pendentes" valor={total - concluidos} cor="text-amber-600" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-ink">Execução geral do mês</span>
              <span className="text-sm font-bold text-ink">{pct}%</span>
            </div>
            <div className="h-4 w-full bg-surface-alt rounded-full overflow-hidden">
              <div className={cn("h-full rounded-full transition-all", corPct)} style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
        <div className="card-padded flex items-center gap-4">
          <div className="relative shrink-0" style={{ width: 110, height: 110 }}>
            <div className="rounded-full" style={{ width: 110, height: 110, background: donut }} />
            <div className="absolute inset-0 m-auto bg-white rounded-full flex flex-col items-center justify-center" style={{ width: 66, height: 66 }}>
              <span className="text-lg font-bold text-ink leading-none">{pct}%</span>
              <span className="text-[10px] text-ink-muted">concluído</span>
            </div>
          </div>
          <div className="text-xs space-y-1">
            <Legenda cor="#10B981" label="Concluído" n={concluidos} />
            <Legenda cor="#0EA5E9" label="Em andamento" n={andamento} />
            <Legenda cor="#F59E0B" label="Pendente" n={pendentes} />
            <Legenda cor="#EF4444" label="Atrasado" n={atrasados} />
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="card p-4 flex flex-wrap gap-2">
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm">
          <option value="">Todos status do mês</option>
          {Object.entries(LABEL_STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={fTecnico} onChange={(e) => setFTecnico(e.target.value)} className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm">
          <option value="">Todos técnicos</option>
          {tecnicos.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select value={fCliente} onChange={(e) => setFCliente(e.target.value)} className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm">
          <option value="">Todos clientes</option>
          {clientes.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <span className="ml-auto self-center text-sm text-ink-muted">{filtrados.length} de {total} contrato(s)</span>
      </div>

      {/* Lista de contratos do mês */}
      {filtrados.length === 0 ? (
        <div className="card-padded text-center text-ink-muted py-10">Nenhum contrato a atender neste mês com os filtros aplicados.</div>
      ) : (
        <div className="space-y-3">
          {filtrados.map((i) => {
            const aberto = expandido.has(i.contratoId);
            return (
              <div key={i.contratoId} className="card overflow-hidden">
                <button onClick={() => toggle(i.contratoId)} className="w-full text-left p-4 hover:bg-surface-alt/40 transition-colors">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-mono font-semibold text-primary-600">{i.numero}</span>
                      <span className="text-sm font-medium text-ink truncate">{i.cliente}</span>
                      <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full", COR_FREQ[i.periodicidade])}>{LABELS_PERIODICIDADE[i.periodicidade] ?? i.periodicidade}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {i.valorMensal != null && <span className="text-sm font-semibold text-ink">{formatarMoeda(i.valorMensal)}</span>}
                      <span className={cn("text-xs font-semibold px-2.5 py-1 rounded-full inline-flex items-center gap-1", COR_STATUS[i.statusMes])}>
                        {i.statusMes === "CONCLUIDO" ? <CheckCircle2 className="w-3 h-3" /> : i.statusMes === "ATRASADO" ? <AlertTriangle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                        {LABEL_STATUS[i.statusMes]}
                      </span>
                      <ChevronDown className={cn("w-4 h-4 text-ink-muted transition-transform", aberto && "rotate-180")} />
                    </div>
                  </div>
                  <div className="mt-2 h-2 w-full bg-surface-alt rounded-full overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all", COR_BARRA[i.statusMes])} style={{ width: `${i.progresso}%` }} />
                  </div>
                </button>

                {aberto && (
                  <div className="border-t border-surface-border p-4 bg-surface-alt/20 text-sm space-y-3">
                    {i.os ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div><span className="text-ink-muted">OS do mês:</span> <span className="font-mono text-primary-600">{i.os.numero}</span></div>
                        <div><span className="text-ink-muted">Técnico:</span> {i.os.tecnicoNome ?? "A designar"}</div>
                        <div><span className="text-ink-muted">Agendada:</span> {i.os.previsaoConclusao ? formatarData(i.os.previsaoConclusao) : formatarData(i.dataAgendada)}</div>
                        <div><span className="text-ink-muted">Última manutenção:</span> {i.ultimaManutencao ? formatarData(i.ultimaManutencao) : "—"}</div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-ink-muted">Nenhuma OS gerada para este mês. Prevista para <strong>{formatarData(i.dataAgendada)}</strong>. Última manutenção: {i.ultimaManutencao ? formatarData(i.ultimaManutencao) : "—"}.</p>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      {i.os ? (
                        <Link href={`/ordens/${i.os.id}`} className="inline-flex items-center gap-1.5 text-sm font-medium bg-white border border-surface-border px-3 py-1.5 rounded-lg hover:bg-surface-alt"><ExternalLink className="w-3.5 h-3.5" /> Ver OS</Link>
                      ) : (
                        <button onClick={() => gerarOs(i.contratoId)} disabled={gerando === i.contratoId} className="inline-flex items-center gap-1.5 text-sm font-medium bg-primary-500 text-white px-3 py-1.5 rounded-lg hover:bg-primary-600 disabled:opacity-60">
                          {gerando === i.contratoId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Gerar OS
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Resumo({ label, valor, cor }: { label: string; valor: number; cor: string }) {
  return (
    <div className="bg-surface-alt/50 rounded-lg p-3 text-center">
      <p className={cn("text-2xl font-bold", cor)}>{valor}</p>
      <p className="text-xs text-ink-muted mt-0.5">{label}</p>
    </div>
  );
}
function Legenda({ cor, label, n }: { cor: string; label: string; n: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: cor }} />
      <span className="text-ink-muted">{label}</span>
      <span className="font-semibold text-ink ml-auto">{n}</span>
    </div>
  );
}
