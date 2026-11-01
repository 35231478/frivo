/**
 * Rotina de faturamento automático dos contratos — regras PURAS (sem banco).
 * Etapas: MEDICAO → APROVACAO → (NFSE → BOLETO, no PR3-B) → CONCLUIDA.
 * D7: 3 tentativas por etapa (1 por dia); na 3ª falha a execução fica em FALHA e avisa no sino.
 */
import { contratoCobraNaCompetencia, diaFaturamentoDe, passoCobranca } from "@/lib/financeiro/contrato-previsao";

export const MAX_TENTATIVAS = 3;
/** Intervalo entre tentativas: a rotina roda 1×/dia; 23h garante que a próxima rodada diária pega */
export const INTERVALO_TENTATIVA_MS = 23 * 60 * 60 * 1000;
/** Quanto tempo uma rodada "segura" a execução (outra rodada simultânea pula) */
export const LEASE_MS = 10 * 60 * 1000;

export const ROTULO_ETAPA: Record<string, string> = {
  MEDICAO: "Medição", APROVACAO: "Aprovação", NFSE: "NFS-e", BOLETO: "Boleto", CONCLUIDA: "Concluída",
};
export const ROTULO_SITUACAO: Record<string, string> = {
  PENDENTE: "Na fila", AGUARDANDO: "Aguardando", PENDENCIA: "Pendência", FALHA: "Falhou", CONCLUIDA: "Concluída", CANCELADA: "Cancelada",
};

type ContratoDaRotina = {
  dataInicio: Date; dataFim: Date | null; periodicidade?: string | null;
  diaFaturamento: number | null; diaFixoMes: number | null; diaVencimento: number | null;
};

const ultimoDia = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();

/** O dia (no mês) em que a cobrança da competência sai: D2 (contrato → cliente → 1), limitado ao fim do mês */
export const diaDeFaturar = (c: ContratoDaRotina, ano: number, mes: number, diaCliente?: number | null) =>
  Math.min(Math.max(diaFaturamentoDe(c, diaCliente), 1), ultimoDia(ano, mes));

/**
 * A competência que a rotina fatura HOJE para o contrato (ou null). Só a do mês corrente: o contrato
 * cobra neste mês (vigência + periodicidade) e o dia de faturamento já chegou. Mês passado nunca
 * nasce sozinho (ligar a chave no meio do mês não fatura o mês anterior).
 */
export function competenciaDevida(c: ContratoDaRotina, hoje: { ano: number; mes: number; dia: number }, diaCliente?: number | null) {
  if (!contratoCobraNaCompetencia(c.dataInicio, c.dataFim, hoje.ano, hoje.mes, passoCobranca(c.periodicidade))) return null;
  if (hoje.dia < diaDeFaturar(c, hoje.ano, hoje.mes, diaCliente)) return null;
  return { ano: hoje.ano, mes: hoje.mes };
}

/** Depois de uma falha: conta a tentativa; na 3ª vira FALHA (sino), senão volta para a fila amanhã */
export function aposFalha(tentativas: number, agora: Date) {
  const n = tentativas + 1;
  return n >= MAX_TENTATIVAS
    ? { tentativas: n, situacao: "FALHA" as const, proximaTentativa: null }
    : { tentativas: n, situacao: "PENDENTE" as const, proximaTentativa: new Date(agora.getTime() + INTERVALO_TENTATIVA_MS) };
}

/** Status da medição já aprovada (a aprovação ficou para trás) */
export const MEDICAO_APROVADA = ["APROVADA", "AGUARDANDO_PC", "PC_RECEBIDO", "NF_EMITIDA", "BOLETO_GERADO", "PAGO"] as const;
export const medicaoJaAprovada = (status: string) => (MEDICAO_APROVADA as readonly string[]).includes(status);

/**
 * O erro que a tela e o sino mostram: curto e legível. O erro do banco (Prisma) vem com a consulta
 * inteira; fica só a mensagem do banco ("Message: `…`") ou a última linha.
 */
export function mensagemDeErro(e: unknown): string {
  const msg = ((e as Error)?.message || "").trim();
  if (!msg) return "Erro inesperado.";
  const doBanco = msg.match(/Message: `([^`]+)`/)?.[1] ?? msg.match(/ERROR: ([^\n]+)/)?.[1];
  const linhas = msg.split("\n").map((l) => l.trim()).filter(Boolean);
  return (doBanco ?? linhas[linhas.length - 1] ?? msg).slice(0, 300);
}

