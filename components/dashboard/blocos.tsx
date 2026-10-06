import Link from "next/link";
import {
  AlertTriangle, CalendarClock, CalendarDays, CheckCircle2, ClipboardCheck, ClipboardList, Clock, FileSignature,
  FileText, Headset, HardHat, Inbox, PlayCircle, ShieldCheck, ShoppingCart, Thermometer, Timer, TrendingUp,
  Truck, Wallet, Wrench, QrCode, Banknote, CalendarRange,
} from "lucide-react";
import { cn, LABELS_PRIORIDADE } from "@/lib/utils";
import { chaveDiaBR, horaBR, partesBR } from "@/lib/fuso";
import { URL_SOLICITACOES } from "@/lib/solicitacoes";
import type { DadosBloco } from "@/lib/dashboard/dados";
import { Bloco, GradeKpi, Kpi, Vazio } from "@/components/dashboard/ui";

/** Blocos do dashboard (Server Components). Cada um recebe só os agregados do seu bloco. */

const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const plural = (n: number, um: string, varios: string) => `${n.toLocaleString("pt-BR")} ${n === 1 ? um : varios}`;

function dataCurta(iso: string) {
  const d = new Date(iso);
  const { mes, dia } = partesBR(d);
  const hoje = chaveDiaBR(new Date());
  const amanha = chaveDiaBR(new Date(Date.now() + 864e5));
  const chave = chaveDiaBR(d);
  const rotulo = chave === hoje ? "Hoje" : chave === amanha ? "Amanhã" : `${String(dia).padStart(2, "0")} ${MESES[mes]}`;
  return `${rotulo}, ${horaBR(d)}`;
}

export function BlocoOperacional({ d }: { d: DadosBloco["operacional"] }) {
  return (
    <Bloco id="operacional" titulo="Operacional" icone={ClipboardList} href="/ordens" link="Ver OS">
      <GradeKpi>
        <Kpi rotulo="OS abertas" valor={d.abertas} icone={ClipboardList} tom="info" href="/ordens"
          detalhe={d.emAndamento ? plural(d.emAndamento, "em andamento", "em andamento") : "nenhuma em andamento"} />
        <Kpi rotulo="Agendadas hoje" valor={d.agendadasHoje} icone={CalendarClock} tom="info" href="/calendario?view=semanal" detalhe="com atividade hoje" />
        <Kpi rotulo="Atrasadas" valor={d.atrasadas} icone={AlertTriangle} tom={d.atrasadas ? "critico" : "ok"} href="/ordens"
          detalhe={d.atrasadas ? "previsão de conclusão vencida" : "nenhuma atrasada"} />
        <Kpi rotulo="Concluídas no mês" valor={d.concluidasMes} icone={CheckCircle2} tom="ok" href="/ordens?status=CONCLUIDA" />
      </GradeKpi>
    </Bloco>
  );
}

export function BlocoOsDoDia({ d }: { d: DadosBloco["os-do-dia"] }) {
  return (
    <Bloco id="os-do-dia" titulo="OS do dia por técnico" icone={HardHat} href="/calendario?view=semanal" link="Agenda">
      {d.total === 0 ? <Vazio>Nenhuma atividade agendada para hoje.</Vazio> : (
        <ul className="divide-y divide-surface-border -my-1">
          {d.linhas.map((l) => {
            const pct = l.total ? Math.round((l.concluidas / l.total) * 100) : 0;
            return (
              <li key={l.chave} className="py-2.5 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm font-medium truncate", l.chave === "sem-tecnico" ? "text-amber-700" : "text-ink")}>{l.nome}</p>
                  <p className="text-xs text-ink-subtle truncate">
                    {l.equipe ? `Equipe ${l.equipe} · ` : ""}{plural(l.concluidas, "concluída", "concluídas")}
                    {l.emAndamento ? ` · ${l.emAndamento} em andamento` : ""}
                  </p>
                </div>
                <div className="w-24 sm:w-32 shrink-0" title={`${l.concluidas} de ${l.total} concluídas`}>
                  <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden" role="meter" aria-valuemin={0} aria-valuemax={l.total} aria-valuenow={l.concluidas} aria-label={`${l.nome}: ${l.concluidas} de ${l.total} concluídas`}>
                    <div className="h-full rounded-full bg-primary-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <span className="text-sm font-semibold text-ink tabular-nums w-10 text-right">{l.concluidas}/{l.total}</span>
              </li>
            );
          })}
          {d.outros > 0 && <li className="pt-2 text-xs text-ink-subtle">+ {plural(d.outros, "técnico", "técnicos")} com atividades hoje</li>}
        </ul>
      )}
    </Bloco>
  );
}

export function BlocoSolicitacoes({ d }: { d: DadosBloco["solicitacoes"] }) {
  return (
    <Bloco id="solicitacoes" titulo="Solicitações pendentes" icone={Headset} href={URL_SOLICITACOES} link={d.total ? `Ver ${d.total}` : "Ver"}>
      {d.total === 0 ? <Vazio>Nenhuma solicitação aguardando atendimento.</Vazio> : (
        <ul className="divide-y divide-surface-border -my-1">
          {d.recentes.map((s) => (
            <li key={s.id}>
              <Link href={`/ordens/${s.id}`} className="py-2.5 flex items-start gap-3 hover:bg-surface-alt -mx-2 px-2 rounded-lg">
                <Inbox className="w-4 h-4 text-cyan-600 mt-0.5 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink truncate"><span className="font-mono text-xs font-semibold text-primary-600 mr-1.5">{s.numero}</span>{s.cliente}</p>
                  <p className="text-xs text-ink-subtle truncate">{s.resumo}</p>
                </div>
                {s.prioridade !== "NORMAL" && s.prioridade !== "BAIXA" && (
                  <span className="text-[11px] font-semibold text-red-700 bg-red-50 rounded px-1.5 py-0.5 shrink-0 inline-flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" aria-hidden />{LABELS_PRIORIDADE[s.prioridade] ?? s.prioridade}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Bloco>
  );
}

/** Faixa de 14 dias: mais atividades = tom mais escuro (um só tom). Número e dia sempre escritos. */
function corDia(total: number, max: number) {
  if (!total) return "bg-surface-alt text-ink-subtle border-surface-border";
  const r = total / Math.max(max, 1);
  if (r > 0.75) return "bg-primary-700 text-white border-primary-700";
  if (r > 0.5) return "bg-primary-500 text-white border-primary-500";
  if (r > 0.25) return "bg-primary-200 text-primary-900 border-primary-200";
  return "bg-primary-50 text-primary-800 border-primary-100";
}

export function BlocoAgenda({ d }: { d: DadosBloco["agenda"] }) {
  const max = Math.max(...d.dias.map((x) => x.total), 0);
  const total = d.dias.reduce((s, x) => s + x.total, 0);
  return (
    <Bloco id="agenda" titulo="Agenda — próximos 14 dias" icone={CalendarDays} href="/calendario" link="Calendário">
      <div>
        <ol className="grid grid-cols-7 gap-1 sm:gap-1.5" aria-label={`${total} atividades nos próximos 14 dias`}>
          {d.dias.map((dia, i) => {
            const { ano, mes, dia: n } = partesBR(new Date(dia.inicio));
            const semana = new Date(Date.UTC(ano, mes, n)).getUTCDay();
            return (
              <li key={dia.chave}>
                <Link href={`/calendario?view=semanal&ano=${ano}&mes=${mes + 1}&dia=${n}`}
                  title={`${DIAS_SEMANA[semana]} ${n}/${mes + 1}: ${plural(dia.total, "atividade", "atividades")}`}
                  className={cn("flex flex-col items-center rounded-lg border py-1.5 transition-transform hover:-translate-y-0.5", corDia(dia.total, max), i === 0 && "ring-2 ring-offset-1 ring-primary-300")}>
                  <span className="text-[9px] sm:text-[10px] uppercase tracking-wide opacity-80">{i === 0 ? "hoje" : DIAS_SEMANA[semana]}</span>
                  <span className="text-sm font-semibold leading-tight">{n}</span>
                  <span className="text-[11px] tabular-nums font-medium">{dia.total || "–"}</span>
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
      <p className="label-uppercase mt-4 mb-2">Próximas atividades</p>
      {d.proximas.length === 0 ? <Vazio>Nada agendado nos próximos 14 dias.</Vazio> : (
        <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          {d.proximas.map((a) => (
            <li key={a.id} className="border-b border-surface-border min-w-0">
              <Link href={`/ordens/${a.osId}`} className="py-2 flex items-center gap-3 hover:bg-surface-alt -mx-2 px-2 rounded-lg">
                <span className="text-xs font-semibold text-ink-muted w-20 sm:w-24 shrink-0 tabular-nums">{dataCurta(a.quando)}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink truncate"><span className="font-mono text-xs font-semibold text-primary-600 mr-1.5">{a.numero}</span>{a.cliente}</p>
                  <p className="text-xs text-ink-subtle truncate">{a.titulo}{a.tecnico ? ` · ${a.tecnico}` : " · sem técnico"}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Bloco>
  );
}

export function BlocoComercial({ d }: { d: DadosBloco["comercial"] }) {
  return (
    <Bloco id="comercial" titulo="Comercial" icone={FileSignature}>
      <GradeKpi colunas={2} valores>
        {d.contratosAtivos !== null && <Kpi rotulo="Contratos ativos" valor={d.contratosAtivos} icone={FileText} tom="info" href="/contratos" />}
        {d.contratosVencendo !== null && (
          <Kpi rotulo="Vencendo em 60 dias" valor={d.contratosVencendo} icone={CalendarRange} tom={d.contratosVencendo ? "atencao" : "ok"}
            href="/contratos/relatorio" detalhe={d.contratosVencendo ? "renovar ou encerrar" : "nenhum vencendo"} />
        )}
        {d.orcamentosAbertos !== null && <Kpi rotulo="Orçamentos em aberto" valor={d.orcamentosAbertos} icone={ClipboardList} tom="info" href="/orcamentos" detalhe="rascunho ou enviado" />}
        {d.orcamentosEnviados && (
          <Kpi rotulo="Aguardando cliente" valor={d.orcamentosEnviados.valor} moeda icone={TrendingUp} tom="neutro" href="/orcamentos?status=ENVIADO"
            detalhe={plural(d.orcamentosEnviados.quantidade, "orçamento enviado", "orçamentos enviados")} />
        )}
      </GradeKpi>
    </Bloco>
  );
}

export function BlocoFinanceiro({ d }: { d: DadosBloco["financeiro"] }) {
  return (
    <Bloco id="financeiro" titulo="Financeiro" icone={Wallet} href="/financeiro/contas-receber" link="Contas a receber">
      <GradeKpi colunas={2} valores>
        <Kpi rotulo="Faturado no mês" valor={d.faturadoMes} moeda icone={TrendingUp} tom="info" href="/financeiro/contas-receber"
          detalhe={`recebido: ${d.recebidoMes.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`} />
        <Kpi rotulo="A receber" valor={d.aReceber.valor} moeda icone={Banknote} tom="neutro" href="/financeiro/contas-receber"
          detalhe={plural(d.aReceber.quantidade, "título em aberto", "títulos em aberto")} />
        <Kpi rotulo="Vencidos" valor={d.vencidos.valor} moeda icone={AlertTriangle} tom={d.vencidos.quantidade ? "critico" : "ok"} href="/financeiro/contas-receber"
          detalhe={d.vencidos.quantidade ? `${plural(d.vencidos.quantidade, "título", "títulos")} · ${plural(d.vencidos.clientes, "cliente", "clientes")}` : "nenhum vencido"} />
        <Kpi rotulo="Próximos 7 dias" valor={d.proximos7.valor} moeda icone={Clock} tom={d.proximos7.quantidade ? "atencao" : "neutro"} href="/financeiro/contas-receber"
          detalhe={plural(d.proximos7.quantidade, "título a vencer", "títulos a vencer")} />
      </GradeKpi>
    </Bloco>
  );
}

export function BlocoEquipamentos({ d }: { d: DadosBloco["equipamentos"] }) {
  return (
    <Bloco id="equipamentos" titulo="Equipamentos" icone={Thermometer} href="/equipamentos" link="Ver equipamentos">
      <GradeKpi colunas={2}>
        <Kpi rotulo="Cadastrados" valor={d.total} icone={Thermometer} tom="info" href="/equipamentos" />
        <Kpi rotulo="Garantia vencendo" valor={d.garantiaVencendo} icone={ShieldCheck} tom={d.garantiaVencendo ? "atencao" : "ok"} href="/equipamentos"
          detalhe={d.garantiaVencendo ? "nos próximos 60 dias" : `${d.garantiaVigente} em garantia`} />
        <Kpi rotulo="Sem QR Code" valor={d.semQr} icone={QrCode} tom={d.semQr ? "atencao" : "ok"} href="/qrcodes" detalhe="sem etiqueta vinculada" />
      </GradeKpi>
    </Bloco>
  );
}

export function BlocoFrota({ d }: { d: DadosBloco["frota"] }) {
  return (
    <Bloco id="frota" titulo="Frota" icone={Truck} href="/veiculos" link="Ver veículos">
      <GradeKpi colunas={2}>
        <Kpi rotulo="Em manutenção" valor={d.veiculosManutencao} icone={Wrench} tom={d.veiculosManutencao ? "atencao" : "ok"} href="/veiculos" />
        <Kpi rotulo="Checklist pendente" valor={d.checklistPendente} icone={ClipboardCheck} tom={d.checklistPendente ? "atencao" : "ok"} href="/veiculos/checklist" detalhe="hoje" />
        <Kpi rotulo="Documentos vencendo" valor={d.documentosVencendo} icone={AlertTriangle} tom={d.documentosVencendo ? "critico" : "ok"} href="/veiculos" detalhe="próximos 30 dias" />
        <Kpi rotulo="Revisões chegando" valor={d.revisaoChegando} icone={PlayCircle} tom={d.revisaoChegando ? "atencao" : "ok"} href="/veiculos" detalhe="próximos 30 dias" />
      </GradeKpi>
    </Bloco>
  );
}

export function BlocoPrazos({ d }: { d: DadosBloco["prazos"] }) {
  return (
    <Bloco id="prazos" titulo="Prazos e SLA" icone={Timer} href="/prazos" link="Ver prazos">
      <GradeKpi colunas={d.pedidosPendentes === null ? 2 : 3}>
        <Kpi rotulo="Prazos vencidos" valor={d.prazosVencidos} icone={AlertTriangle} tom={d.prazosVencidos ? "critico" : "ok"} href="/prazos?status=ATRASADO" />
        <Kpi rotulo="Vencendo hoje" valor={d.etapasVencendoHoje} icone={Clock} tom={d.etapasVencendoHoje ? "atencao" : "ok"} href="/prazos?status=ATIVO" />
        {d.pedidosPendentes !== null && <Kpi rotulo="Compras pendentes" valor={d.pedidosPendentes} icone={ShoppingCart} tom={d.pedidosPendentes ? "atencao" : "ok"} href="/compras/pedidos" />}
      </GradeKpi>
    </Bloco>
  );
}
