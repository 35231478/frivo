import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cn, nomeMes, LABELS_STATUS_OS } from "@/lib/utils";
import { GerarOsRecorrentes } from "@/components/calendario/gerar-os-recorrentes";
import { CalendarDays, ChevronLeft, ChevronRight, Repeat } from "lucide-react";

export const metadata: Metadata = { title: "Calendário" };

const COR_PRIORIDADE: Record<string, string> = {
  BAIXA: "bg-slate-100 text-slate-700 border-l-slate-400",
  NORMAL: "bg-primary-50 text-primary-700 border-l-primary-500",
  ALTA: "bg-orange-50 text-orange-700 border-l-orange-500",
  URGENTE: "bg-red-50 text-red-700 border-l-red-500",
};
const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function chave(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function CalendarioPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; ano?: string; view?: string; tecnicoId?: string; tipoOsId?: string; status?: string; dia?: string }>;
}) {
  const sp = await searchParams;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const hoje = new Date();
  const mes = Number(sp.mes) || hoje.getMonth() + 1;
  const ano = Number(sp.ano) || hoje.getFullYear();
  const view = sp.view === "semanal" ? "semanal" : "mensal";
  const tecnicoId = sp.tecnicoId ?? "";
  const tipoOsId = sp.tipoOsId ?? "";
  const status = sp.status ?? "";

  // Intervalo visível
  let gridInicio: Date;
  let gridFim: Date;
  let dias: Date[] = [];

  if (view === "semanal") {
    const diaRef = Number(sp.dia) || (hoje.getMonth() + 1 === mes && hoje.getFullYear() === ano ? hoje.getDate() : 1);
    const ref = new Date(ano, mes - 1, diaRef);
    const ini = new Date(ref);
    ini.setDate(ref.getDate() - ref.getDay()); // domingo
    gridInicio = new Date(ini.getFullYear(), ini.getMonth(), ini.getDate(), 0, 0, 0);
    for (let i = 0; i < 7; i++) dias.push(new Date(ini.getFullYear(), ini.getMonth(), ini.getDate() + i));
    gridFim = new Date(dias[6].getFullYear(), dias[6].getMonth(), dias[6].getDate(), 23, 59, 59);
  } else {
    const primeiro = new Date(ano, mes - 1, 1);
    const ini = new Date(primeiro);
    ini.setDate(1 - primeiro.getDay()); // volta ao domingo
    gridInicio = new Date(ini.getFullYear(), ini.getMonth(), ini.getDate(), 0, 0, 0);
    // 6 semanas cobrem qualquer mês
    for (let i = 0; i < 42; i++) dias.push(new Date(ini.getFullYear(), ini.getMonth(), ini.getDate() + i));
    const ult = dias[dias.length - 1];
    gridFim = new Date(ult.getFullYear(), ult.getMonth(), ult.getDate(), 23, 59, 59);
  }

  const periodo = { gte: gridInicio, lte: gridFim };
  const filtroAtividade: any = {};
  if (tecnicoId) filtroAtividade.tecnicoId = tecnicoId;
  if (tipoOsId) filtroAtividade.tipoOsId = tipoOsId;

  // Considera OS com previsão de conclusão no período OU com atividade agendada no período
  const where: any = {
    empresaId,
    OR: [
      { previsaoConclusao: periodo },
      { atividades: { some: { ...filtroAtividade, dataAgendada: periodo } } },
    ],
  };
  if (status) where.status = status;
  // Quando há filtro de técnico/tipo, a OS precisa ter ao menos uma atividade compatível
  if (tecnicoId || tipoOsId) where.atividades = { some: filtroAtividade };

  const [ordens, tecnicos, tiposOs] = await Promise.all([
    prisma.ordemServico.findMany({
      where,
      select: {
        id: true, numero: true, status: true, prioridade: true, origem: true, previsaoConclusao: true,
        cliente: { select: { nome: true, nomeFantasia: true } },
        atividades: { where: { dataAgendada: periodo }, select: { dataAgendada: true }, orderBy: { dataAgendada: "asc" } },
      },
      orderBy: { previsaoConclusao: "asc" },
      take: 500,
    }),
    prisma.tecnico.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
    prisma.tipoOs.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
  ]);

  const porDia = new Map<string, typeof ordens>();
  for (const os of ordens) {
    // Posiciona pela previsão de conclusão (se dentro do período) ou pela 1ª atividade agendada no período
    let dataPos: Date | null = os.previsaoConclusao ? new Date(os.previsaoConclusao) : null;
    if (!dataPos || dataPos < gridInicio || dataPos > gridFim) {
      const prox = os.atividades[0]?.dataAgendada;
      dataPos = prox ? new Date(prox) : dataPos;
    }
    if (!dataPos) continue;
    const k = chave(dataPos);
    const arr = porDia.get(k) ?? [];
    arr.push(os);
    porDia.set(k, arr);
  }

  // Navegação mantendo filtros
  const baseParams = (extra: Record<string, string | number>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | number> = { mes, ano, view, ...extra };
    if (tecnicoId) merged.tecnicoId = tecnicoId;
    if (tipoOsId) merged.tipoOsId = tipoOsId;
    if (status) merged.status = status;
    for (const [k, v] of Object.entries(merged)) if (v !== "" && v != null) p.set(k, String(v));
    return `?${p.toString()}`;
  };
  const mesAnterior = mes === 1 ? { mes: 12, ano: ano - 1 } : { mes: mes - 1, ano };
  const mesSeguinte = mes === 12 ? { mes: 1, ano: ano + 1 } : { mes: mes + 1, ano };

  const semanas: Date[][] = [];
  for (let i = 0; i < dias.length; i += 7) semanas.push(dias.slice(i, i + 7));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-lg"><CalendarDays className="w-5 h-5 text-primary-600" /></div>
          <h1 className="page-title">Calendário</h1>
        </div>
        <GerarOsRecorrentes mes={mes} ano={ano} />
      </div>

      <div className="card overflow-hidden">
        {/* Barra de controle */}
        <div className="p-4 border-b border-surface-border bg-surface-alt/40 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Link href={baseParams(mesAnterior)} className="p-2 rounded-lg border border-surface-border hover:bg-surface-alt"><ChevronLeft className="w-4 h-4" /></Link>
            <span className="text-sm font-semibold text-ink min-w-[140px] text-center">{nomeMes(mes)} / {ano}</span>
            <Link href={baseParams(mesSeguinte)} className="p-2 rounded-lg border border-surface-border hover:bg-surface-alt"><ChevronRight className="w-4 h-4" /></Link>
            <Link href={baseParams({ mes: hoje.getMonth() + 1, ano: hoje.getFullYear() })} className="ml-1 text-xs font-medium text-primary-600 hover:underline">Hoje</Link>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-surface-border overflow-hidden text-sm">
              <Link href={baseParams({ view: "mensal" })} className={cn("px-3 py-1.5", view === "mensal" ? "bg-primary-500 text-white" : "bg-white text-ink-muted hover:bg-surface-alt")}>Mês</Link>
              <Link href={baseParams({ view: "semanal" })} className={cn("px-3 py-1.5", view === "semanal" ? "bg-primary-500 text-white" : "bg-white text-ink-muted hover:bg-surface-alt")}>Semana</Link>
            </div>
          </div>
        </div>

        {/* Filtros */}
        <div className="p-4 border-b border-surface-border bg-surface-alt/20">
          <form method="get" className="flex flex-wrap gap-2">
            <input type="hidden" name="mes" value={mes} />
            <input type="hidden" name="ano" value={ano} />
            <input type="hidden" name="view" value={view} />
            <select name="tecnicoId" defaultValue={tecnicoId} className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10">
              <option value="">Todos técnicos</option>
              {tecnicos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </select>
            <select name="tipoOsId" defaultValue={tipoOsId} className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10">
              <option value="">Todos tipos</option>
              {tiposOs.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </select>
            <select name="status" defaultValue={status} className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10">
              <option value="">Todos status</option>
              {Object.entries(LABELS_STATUS_OS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button type="submit" className="bg-primary-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary-600 transition-all shadow-sm">Filtrar</button>
          </form>
        </div>

        {/* Grade */}
        <div className="p-2 md:p-4 overflow-x-auto">
          <div className="grid grid-cols-7 gap-px bg-surface-border rounded-lg overflow-hidden min-w-[760px]">
            {DIAS_SEMANA.map((d) => (
              <div key={d} className="bg-surface-alt text-center py-2 text-xs font-semibold text-ink-muted uppercase tracking-wider">{d}</div>
            ))}
            {semanas.flat().map((d, idx) => {
              const k = chave(d);
              const doMes = d.getMonth() === mes - 1;
              const eHoje = chave(hoje) === k;
              const eventos = porDia.get(k) ?? [];
              return (
                <div key={idx} className={cn("bg-white min-h-[110px] p-1.5 align-top", !doMes && "bg-surface-alt/40")}>
                  <div className={cn(
                    "text-xs font-semibold mb-1 w-6 h-6 flex items-center justify-center rounded-full",
                    eHoje ? "bg-primary-500 text-white" : doMes ? "text-ink" : "text-ink-subtle",
                  )}>
                    {d.getDate()}
                  </div>
                  <div className="space-y-1">
                    {eventos.slice(0, 4).map((os) => (
                      <Link
                        key={os.id}
                        href={`/ordens/${os.id}`}
                        title={`${os.numero} — ${os.cliente.nomeFantasia ?? os.cliente.nome}`}
                        className={cn("block border-l-2 rounded px-1.5 py-1 text-[11px] leading-tight truncate hover:opacity-80 transition-opacity", COR_PRIORIDADE[os.prioridade] ?? COR_PRIORIDADE.NORMAL)}
                      >
                        <span className="inline-flex items-center gap-1">
                          {os.origem === "RECORRENTE" && <Repeat className="w-2.5 h-2.5 shrink-0" />}
                          <span className="font-mono font-semibold">{os.numero}</span>
                        </span>
                        <span className="block truncate text-[10px] opacity-80">{os.cliente.nomeFantasia ?? os.cliente.nome}</span>
                      </Link>
                    ))}
                    {eventos.length > 4 && (
                      <p className="text-[10px] text-ink-muted px-1">+{eventos.length - 4} mais</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-surface-border flex flex-wrap items-center gap-4 text-xs text-ink-muted">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-slate-200 border-l-2 border-l-slate-400" /> Baixa</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-primary-100 border-l-2 border-l-primary-500" /> Normal</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-orange-100 border-l-2 border-l-orange-500" /> Alta</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-100 border-l-2 border-l-red-500" /> Urgente</span>
          <span className="flex items-center gap-1.5"><Repeat className="w-3 h-3" /> OS recorrente</span>
        </div>
      </div>
    </div>
  );
}
