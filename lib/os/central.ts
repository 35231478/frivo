import { statusVisualReceber } from "@/lib/financeiro-status";
import { atividadeEncerrada, situacaoPrazo, textoPrazo } from "@/lib/os/prazos";
import { medicaoValida, resumoStatus, type EstagioOs } from "@/lib/os/status";

/**
 * A "central de controle" da OS em dados: tudo o que o cabeçalho e o Resumo mostram para
 * atender o cliente batendo o olho — status, o que falta, prazo e valor. Função pura sobre o que
 * a página já carrega (testável sem tela nem banco).
 */
export interface AtividadeCentral {
  id: string; titulo: string; status: string;
  dataAgendada: Date | string | null; prazo: Date | string | null;
  tecnico?: { nome: string } | null; equipe?: { nome: string } | null; tecnicosEquipe?: unknown[];
  equipamentos?: { feito: boolean }[];
}
export interface OsCentralEntrada {
  status: string; statusManual: boolean; previsaoConclusao: Date | string | null;
  atividades: AtividadeCentral[];
  medicoes: { status: string; valorTotal: unknown; contasReceber?: { status: string; dataVencimento: Date | string | null; valor?: unknown }[] }[];
  itensOrcamento: { valorTotal: unknown }[];
  orcamentos: { orcamento: { status: string; totalGeral: unknown } }[];
  servicosAdicionais?: { statusCobranca: string }[];
  prazosSla?: { status: string }[];
}

export type SituacaoPagamento = "SEM_COBRANCA" | "PREVISTO" | "A_RECEBER" | "VENCIDO" | "PAGO";
export const ROTULO_PAGAMENTO: Record<SituacaoPagamento, string> = {
  SEM_COBRANCA: "Sem cobrança", PREVISTO: "Previsto", A_RECEBER: "A receber", VENCIDO: "Vencido", PAGO: "Pago",
};

export interface Pendencia { chave: string; texto: string; aba: string; nivel: "alerta" | "acao" }

const num = (v: unknown) => Number(v ?? 0) || 0;

/**
 * Situação do pagamento da OS pelas contas a receber das medições em que ela entrou:
 * tudo pago → Pago; alguma vencida → Vencido; alguma liberada → A receber; só previsões →
 * Previsto. Sem medição: "Previsto" se há valor orçado, senão "Sem cobrança".
 */
export function situacaoPagamento(os: OsCentralEntrada, orcado: number): SituacaoPagamento {
  const contas = os.medicoes.filter(medicaoValida).flatMap((m) => m.contasReceber ?? []).filter((c) => c.status !== "CANCELADO");
  if (!contas.length) return orcado > 0 || os.medicoes.some(medicaoValida) ? "PREVISTO" : "SEM_COBRANCA";
  const vis = contas.map((c) => statusVisualReceber(c.status, c.dataVencimento).chave);
  if (vis.every((v) => v === "PAGO")) return "PAGO";
  if (vis.some((v) => v === "VENCIDO")) return "VENCIDO";
  if (vis.some((v) => v === "A_VENCER" || v === "VENCE_HOJE")) return "A_RECEBER";
  return "PREVISTO";
}

export function centralDaOs(os: OsCentralEntrada, agora: Date = new Date()) {
  const status = resumoStatus({ status: os.status, statusManual: os.statusManual, atividades: os.atividades, medicoes: os.medicoes });
  const encerrada = status.exibido === "CONCLUIDA" || status.exibido === "FATURADA" || status.exibido === "CANCELADA";

  const ativas = os.atividades.filter((a) => a.status !== "CANCELADA");
  const concluidas = ativas.filter((a) => a.status === "CONCLUIDA").length;
  const equipamentosAtendidos = ativas.reduce((n, a) => n + (a.equipamentos ?? []).filter((e) => e.feito).length, 0);

  // Valor: orçado = itens da OS + orçamentos vinculados APROVADOS; medido = medições válidas
  const orcado = os.itensOrcamento.reduce((s, i) => s + num(i.valorTotal), 0)
    + os.orcamentos.filter((o) => o.orcamento.status === "APROVADO").reduce((s, o) => s + num(o.orcamento.totalGeral), 0);
  const medido = os.medicoes.filter(medicaoValida).reduce((s, m) => s + num(m.valorTotal), 0);
  const pagamento = situacaoPagamento(os, orcado);

  const prazoOs = situacaoPrazo(os.previsaoConclusao, encerrada, agora);
  const prazosAtividades = ativas.map((a) => ({ id: a.id, ...situacaoPrazo(a.prazo, atividadeEncerrada(a.status), agora) }));
  const atividadesAtrasadas = prazosAtividades.filter((p) => p.situacao === "ATRASADO").length;

  // O que falta — do mais urgente ao mais burocrático; cada item leva à aba onde se resolve
  const falta: Pendencia[] = [];
  if (status.exibido !== "CANCELADA") {
    if (!ativas.length) falta.push({ chave: "sem-atividade", texto: "Criar a primeira atividade (quem executa e quando)", aba: "atividades", nivel: "acao" });
    const semExecutor = ativas.filter((a) => !atividadeEncerrada(a.status) && !a.tecnico && !a.equipe && !(a.tecnicosEquipe ?? []).length).length;
    if (semExecutor) falta.push({ chave: "sem-executor", texto: `${semExecutor} atividade${semExecutor > 1 ? "s" : ""} sem quem execute`, aba: "atividades", nivel: "alerta" });
    const semData = ativas.filter((a) => a.status === "AGENDADA" && !a.dataAgendada).length;
    if (semData) falta.push({ chave: "sem-data", texto: `Agendar ${semData} atividade${semData > 1 ? "s" : ""} sem data`, aba: "atividades", nivel: "acao" });
    if (atividadesAtrasadas) falta.push({ chave: "atividade-atrasada", texto: `${atividadesAtrasadas} atividade${atividadesAtrasadas > 1 ? "s" : ""} fora do prazo`, aba: "atividades", nivel: "alerta" });
    if (prazoOs.situacao === "ATRASADO") falta.push({ chave: "os-atrasada", texto: `Previsão da OS vencida (${textoPrazo(prazoOs, false).toLowerCase()})`, aba: "resumo", nivel: "alerta" });
    const slaAtrasado = (os.prazosSla ?? []).filter((p) => p.status === "ATRASADO").length;
    if (slaAtrasado) falta.push({ chave: "sla-atrasado", texto: `${slaAtrasado} prazo${slaAtrasado > 1 ? "s" : ""} de SLA atrasado${slaAtrasado > 1 ? "s" : ""}`, aba: "atividades", nivel: "alerta" });
    const aAvaliar = (os.servicosAdicionais ?? []).filter((s) => s.statusCobranca === "A_AVALIAR").length;
    if (aAvaliar) falta.push({ chave: "adicional", texto: `Decidir a cobrança de ${aAvaliar} serviço${aAvaliar > 1 ? "s" : ""} adicional${aAvaliar > 1 ? "is" : ""}`, aba: "resumo", nivel: "acao" });
    const aguardando = os.orcamentos.filter((o) => o.orcamento.status === "ENVIADO").length;
    if (aguardando) falta.push({ chave: "orcamento-enviado", texto: `${aguardando} orçamento${aguardando > 1 ? "s" : ""} aguardando aprovação do cliente`, aba: "comercial", nivel: "acao" });
    if (status.exibido === "CONCLUIDA") falta.push({ chave: "faturar", texto: "Gerar a medição para faturar a OS", aba: "financeiro", nivel: "acao" });
    if (pagamento === "VENCIDO") falta.push({ chave: "cobranca-vencida", texto: "Cobrança vencida — acompanhar o recebimento", aba: "financeiro", nivel: "alerta" });
  }

  return {
    status,
    atividades: { total: ativas.length, concluidas },
    equipamentosAtendidos,
    valor: { orcado, medido },
    pagamento,
    prazoOs,
    prazosAtividades,
    falta,
  };
}

export type CentralOs = ReturnType<typeof centralDaOs>;
export type { EstagioOs };
