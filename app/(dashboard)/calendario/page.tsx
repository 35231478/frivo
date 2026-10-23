import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cn, nomeMes, formatarData } from "@/lib/utils";
import { GerarOsRecorrentes } from "@/components/calendario/gerar-os-recorrentes";
import { CalendarioPainel } from "@/components/calendario/calendario-painel";
import type { CelulaDia, CardOs } from "@/components/calendario/calendario-grid";
import { SOLICITACAO_PENDENTE } from "@/lib/solicitacoes";
import { pode } from "@/lib/permissoes";
import { prazoVencido } from "@/lib/os/prazos";
import { chaveDiaBR, chaveDiaCivil, diaCivilUTC, ehDiaCivil, horaBR, inicioDiaBR, partesBR } from "@/lib/fuso";
import { SolicitacoesGaveta } from "@/components/calendario/solicitacoes-gaveta";
import { CalendarDays, ChevronLeft, ChevronRight, Repeat } from "lucide-react";

export const metadata: Metadata = { title: "Calendário" };

const FINALIZADAS = ["CONCLUIDA", "CANCELADA"];

/** Chave "AAAA-MM-DD" de um dia do grid (dia civil, meia-noite UTC). */
function chave(d: Date) {
  return chaveDiaCivil(d);
}

export default async function CalendarioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  // O calendário inteiro no relógio de Brasília (o servidor roda em UTC): "hoje", os dias do grid,
  // a hora e o dia de cada card — o mesmo que o app do técnico mostra
  const hoje = new Date();
  const hojeBR = partesBR(hoje);
  const mes = Number(sp.mes) || hojeBR.mes + 1;
  const ano = Number(sp.ano) || hojeBR.ano;
  const view = sp.view === "semanal" ? "semanal" : "mensal";

  // Intervalo visível
  let gridInicio: Date;
  let gridFim: Date;
  const dias: Date[] = [];

  // Dias do grid como dias civis (meia-noite UTC); limites de busca em instantes de Brasília
  if (view === "semanal") {
    const diaRef = Number(sp.dia) || (hojeBR.mes + 1 === mes && hojeBR.ano === ano ? hojeBR.dia : 1);
    const ref = diaCivilUTC(ano, mes - 1, diaRef);
    const domingo = ref.getUTCDate() - ref.getUTCDay();
    for (let i = 0; i < 7; i++) dias.push(diaCivilUTC(ref.getUTCFullYear(), ref.getUTCMonth(), domingo + i));
  } else {
    const primeiro = diaCivilUTC(ano, mes - 1, 1);
    // 6 semanas cobrem qualquer mês (começando no domingo)
    for (let i = 0; i < 42; i++) dias.push(diaCivilUTC(ano, mes - 1, 1 - primeiro.getUTCDay() + i));
  }
  const primeiroDia = dias[0], ultimoDia = dias[dias.length - 1];
  gridInicio = inicioDiaBR(primeiroDia.getUTCFullYear(), primeiroDia.getUTCMonth(), primeiroDia.getUTCDate());
  gridFim = new Date(inicioDiaBR(ultimoDia.getUTCFullYear(), ultimoDia.getUTCMonth(), ultimoDia.getUTCDate() + 1).getTime() - 1);
  const chavesGrid = new Set(dias.map(chave));

  // Atividade agendada = instante (dia de Brasília); previsão = dia civil (ou instante, se tem hora)
  const periodo = { gte: gridInicio, lte: gridFim };
  const periodoDia = { gte: primeiroDia, lt: diaCivilUTC(ultimoDia.getUTCFullYear(), ultimoDia.getUTCMonth(), ultimoDia.getUTCDate() + 1) };

  // Carrega TODAS as OS do período. Os filtros do painel são aplicados no cliente
  // (esmaecendo os cards que não correspondem, sem removê-los do calendário).
  const where: any = {
    empresaId,
    // OS inativadas (CANCELADA) saem do calendário
    status: { not: "CANCELADA" },
    // Solicitação de cliente pendente (portal/QR, aguardando atendimento) não é
    // agendamento: só entra no calendário depois de aceita (vira AGENDADA)
    NOT: { ...SOLICITACAO_PENDENTE },
    OR: [
      { previsaoConclusao: periodo },
      { previsaoConclusao: periodoDia },
      { atividades: { some: { dataAgendada: periodo } } },
    ],
  };

  const { permissoes, role } = session!.user!;
  const veSolicitacoes = pode(permissoes, "ordens", "editar", role) || pode(permissoes, "ordens", "excluir", role);

  const [ordens, tecnicos, tiposOs, clientes, solicitacoesPendentes] = await Promise.all([
    prisma.ordemServico.findMany({
      where,
      select: {
        id: true, numero: true, status: true, prioridade: true, origem: true, previsaoConclusao: true,
        cliente: { select: { id: true, nome: true, nomeFantasia: true } },
        unidade: { select: { nome: true } },
        atividades: {
          where: { dataAgendada: periodo },
          select: {
            id: true,
            dataAgendada: true,
            tipoOs: { select: { id: true, nome: true } },
            tecnico: { select: { id: true, nome: true, avatar: true } },
            equipe: { select: { nome: true, cor: true } },
            tecnicosEquipe: { select: { tecnico: { select: { id: true, nome: true, avatar: true } } }, orderBy: { criadoEm: "asc" } },
            veiculo: { select: { placa: true, modelo: true } },
          },
          orderBy: { dataAgendada: "asc" },
        },
      },
      orderBy: { previsaoConclusao: "asc" },
      // Sem limite: um corte aqui fazia OS sumirem do calendário em meses cheios
    }),
    prisma.tecnico.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true, avatar: true }, orderBy: { nome: "asc" } }),
    prisma.tipoOs.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
    prisma.cliente.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true, nomeFantasia: true }, orderBy: { nome: "asc" } }),
    veSolicitacoes ? prisma.ordemServico.count({ where: { empresaId, ...SOLICITACAO_PENDENTE } }) : Promise.resolve(0),
  ]);

  // Monta os cards e os posiciona por dia (preferindo a atividade agendada; senão a previsão)
  const eventosPorDia: Record<string, CardOs[]> = {};
  for (const os of ordens) {
    // Um card por DIA em que a OS tem atividade agendada (antes só a 1ª atividade
    // aparecia e as visitas seguintes sumiam do calendário). Sem atividade no
    // período, o card fica na previsão de conclusão.
    const porDia = new Map<string, { data: Date; ativ: (typeof os.atividades)[number] | null }>();
    for (const at of os.atividades) {
      if (!at.dataAgendada) continue;
      const d = new Date(at.dataAgendada);
      const k = chaveDiaBR(d);
      if (!chavesGrid.has(k)) continue;
      if (!porDia.has(k)) porDia.set(k, { data: d, ativ: at });
    }
    if (porDia.size === 0 && os.previsaoConclusao) {
      const d = new Date(os.previsaoConclusao);
      const k = chaveDiaCivil(d);
      if (chavesGrid.has(k)) porDia.set(k, { data: d, ativ: null });
    }

    const atrasada = prazoVencido(os.previsaoConclusao, hoje) && !FINALIZADAS.includes(os.status);
    for (const [k, { data: posData, ativ }] of porDia) {
      const card: CardOs = {
        chave: `${os.id}:${k}`,
        id: os.id,
        numero: os.numero,
        origem: os.origem,
        atividadeId: ativ?.id ?? null,
        clienteId: os.cliente.id,
        tecnicoId: ativ?.tecnico?.id ?? null,
        tipoOsId: ativ?.tipoOs?.id ?? null,
        clienteCurto: os.cliente.nomeFantasia ?? os.cliente.nome,
        clienteCompleto: os.cliente.nome,
        unidade: os.unidade?.nome ?? null,
        tipoOs: ativ?.tipoOs?.nome ?? null,
        // Hora de Brasília; previsão só de dia (sem hora) não inventa "00:00"
        hora: ativ || !ehDiaCivil(posData) ? horaBR(posData) : null,
        dataFmt: formatarData(posData, "dd/MM/yyyy"),
        tecnicoNome: ativ?.tecnico?.nome ?? null,
        tecnicoAvatar: ativ?.tecnico?.avatar ?? null,
        // Equipe/membros da atividade (o responsável continua sendo tecnicoId)
        tecnicoIds: [ativ?.tecnico?.id, ...(ativ?.tecnicosEquipe ?? []).map((t) => t.tecnico.id)].filter(Boolean) as string[],
        membros: (ativ?.tecnicosEquipe ?? []).map((t) => ({ nome: t.tecnico.nome, avatar: t.tecnico.avatar })),
        equipeNome: ativ?.equipe?.nome ?? null,
        equipeCor: ativ?.equipe?.cor ?? null,
        veiculo: ativ?.veiculo ? `${ativ.veiculo.placa} — ${ativ.veiculo.modelo}` : null,
        status: os.status,
        prioridade: os.prioridade,
        atrasada,
      };
      (eventosPorDia[k] ??= []).push(card);
    }
  }

  // Ordena os cards de cada dia pela hora
  for (const k of Object.keys(eventosPorDia)) {
    eventosPorDia[k].sort((a, b) => (a.hora ?? "99").localeCompare(b.hora ?? "99"));
  }

  // Células para o grid client
  const celulas: CelulaDia[] = dias.map((d, idx) => {
    const inMonth = view === "semanal" ? true : d.getUTCMonth() === mes - 1;
    return { dateKey: chave(d), dayNum: d.getUTCDate(), inMonth, isToday: chaveDiaBR(hoje) === chave(d), rowIndex: Math.floor(idx / 7) };
  });

  // Total de OS posicionadas nas células do mês (ou da semana, na visão semanal)
  const totalMes = celulas.reduce((acc, c) => acc + (c.inMonth ? (eventosPorDia[c.dateKey]?.length ?? 0) : 0), 0);

  // Navegação de mês/semana mantendo todos os filtros já presentes na URL
  const baseParams = (extra: Record<string, string | number>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v) p.set(k, String(v));
    const overrides: Record<string, string | number> = { mes, ano, view, ...extra };
    for (const [k, v] of Object.entries(overrides)) if (v !== "" && v != null) p.set(k, String(v));
    return `?${p.toString()}`;
  };
  const mesAnterior = mes === 1 ? { mes: 12, ano: ano - 1 } : { mes: mes - 1, ano };
  const mesSeguinte = mes === 12 ? { mes: 1, ano: ano + 1 } : { mes: mes + 1, ano };

  return (
    <SolicitacoesGaveta totalInicial={solicitacoesPendentes}>
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-lg"><CalendarDays className="w-5 h-5 text-primary-600" /></div>
          <h1 className="page-title">Calendário</h1>
        </div>
        <GerarOsRecorrentes mes={mes} ano={ano} />
      </div>

      <div className="card overflow-visible">
        {/* Barra de controle */}
        <div className="p-4 border-b border-surface-border bg-surface-alt/40 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Link href={baseParams(mesAnterior)} className="p-2 rounded-lg border border-surface-border hover:bg-surface-alt"><ChevronLeft className="w-4 h-4" /></Link>
            <Link href={baseParams(mesSeguinte)} className="p-2 rounded-lg border border-surface-border hover:bg-surface-alt"><ChevronRight className="w-4 h-4" /></Link>
            <div className="ml-1 text-lg font-bold text-ink leading-tight capitalize">{nomeMes(mes)} {ano}</div>
            <Link href={baseParams({ mes: hojeBR.mes + 1, ano: hojeBR.ano, dia: hojeBR.dia })}
              className="ml-2 inline-flex items-center px-3 py-1.5 rounded-lg border border-primary-500 text-primary-600 text-xs font-semibold hover:bg-primary-50 transition-colors">
              Hoje
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-surface-border overflow-hidden text-sm">
              <Link href={baseParams({ view: "mensal" })} className={cn("px-3 py-1.5", view === "mensal" ? "bg-primary-500 text-white" : "bg-white text-ink-muted hover:bg-surface-alt")}>Mês</Link>
              <Link href={baseParams({ view: "semanal" })} className={cn("px-3 py-1.5", view === "semanal" ? "bg-primary-500 text-white" : "bg-white text-ink-muted hover:bg-surface-alt")}>Semana</Link>
            </div>
          </div>
        </div>

        {/* Painel de filtros + grade */}
        <CalendarioPainel
          celulas={celulas}
          eventosPorDia={eventosPorDia}
          totalMes={totalMes}
          opcoes={{
            clientes: clientes.map((c) => ({ value: c.id, label: c.nomeFantasia ?? c.nome })),
            tiposOs: tiposOs.map((t) => ({ value: t.id, label: t.nome })),
            tecnicos: tecnicos.map((t) => ({ value: t.id, label: t.nome, avatar: t.avatar })),
          }}
        />

        {/* Legenda */}
        <div className="px-4 py-3 border-t border-surface-border flex flex-wrap items-center gap-4 text-xs text-ink-muted">
          <span className="font-semibold text-ink-subtle uppercase tracking-wider">Prioridade:</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-slate-200" /> Baixa</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-primary-100" /> Normal</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-orange-100" /> Alta</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-100" /> Urgente</span>
          <span className="font-semibold text-ink-subtle uppercase tracking-wider ml-2">Status (borda):</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm border-l-2 border-l-blue-500 bg-surface-alt" /> Aberta</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm border-l-2 border-l-amber-500 bg-surface-alt" /> Em andamento</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm border-l-2 border-l-green-500 bg-surface-alt" /> Concluída</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm border-l-2 border-l-red-500 bg-surface-alt" /> Atrasada</span>
          <span className="flex items-center gap-1.5"><Repeat className="w-3 h-3" /> OS recorrente</span>
        </div>
      </div>
    </div>
    </SolicitacoesGaveta>
  );
}
