import { chaveDiaBR } from "@/lib/fuso";

/**
 * Prazos da OS (previsão geral) e das atividades (prazo próprio). Os dois são DIAS civis: o
 * banco guarda o dia (meia-noite UTC — `@db.Date` ou "AAAA-MM-DD" do campo de data). A regra
 * de fuso é a da operação: atrasa quando o DIA DE HOJE EM BRASÍLIA já passou do dia do prazo.
 *
 * O erro clássico que isto evita: comparar `prazo < new Date()` (às 21h de Brasília já é o dia
 * seguinte em UTC) ou formatar o dia no fuso do navegador (28/10 00:00 UTC aparece como 27/10).
 */

/**
 * "AAAA-MM-DD" de um dia civil gravado. Gravado como dia (meia-noite UTC): lê as partes UTC — o
 * dia não tem fuso. Gravado com hora (ex.: OS criada pelo calendário com a hora da visita): é um
 * instante, e vale o dia dele em Brasília.
 */
export function chaveDiaCivil(d: Date | string): string {
  const x = new Date(d);
  if (x.getUTCHours() || x.getUTCMinutes() || x.getUTCSeconds() || x.getUTCMilliseconds()) return chaveDiaBR(x);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}-${String(x.getUTCDate()).padStart(2, "0")}`;
}

/** "dd/mm/aaaa" de um dia civil — igual em qualquer fuso de navegador. */
export function formatarDiaCivil(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const [a, m, dia] = chaveDiaCivil(d).split("-");
  return `${dia}/${m}/${a}`;
}

const diasEntre = (de: string, ate: string) =>
  Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);

export type SituacaoPrazo = "SEM_PRAZO" | "NO_PRAZO" | "VENCE_HOJE" | "ATRASADO" | "CUMPRIDO";

/**
 * Situação de um prazo (dia civil) em relação a hoje em Brasília.
 * `encerrado` = a coisa já terminou (atividade concluída/cancelada, OS concluída) — não atrasa mais.
 */
export function situacaoPrazo(prazo: Date | string | null | undefined, encerrado: boolean, agora: Date = new Date()):
  { situacao: SituacaoPrazo; diasAtraso: number; diasRestantes: number } {
  if (!prazo) return { situacao: "SEM_PRAZO", diasAtraso: 0, diasRestantes: 0 };
  if (encerrado) return { situacao: "CUMPRIDO", diasAtraso: 0, diasRestantes: 0 };
  const dif = diasEntre(chaveDiaBR(agora), chaveDiaCivil(prazo)); // >0 = falta; <0 = passou
  if (dif < 0) return { situacao: "ATRASADO", diasAtraso: -dif, diasRestantes: 0 };
  if (dif === 0) return { situacao: "VENCE_HOJE", diasAtraso: 0, diasRestantes: 0 };
  return { situacao: "NO_PRAZO", diasAtraso: 0, diasRestantes: dif };
}

/** Texto curto da situação ("Atrasada 2 dias", "Vence hoje", "Faltam 5 dias"). */
export function textoPrazo(s: ReturnType<typeof situacaoPrazo>, feminino = true): string {
  switch (s.situacao) {
    case "ATRASADO": return `${feminino ? "Atrasada" : "Atrasado"} ${s.diasAtraso} dia${s.diasAtraso > 1 ? "s" : ""}`;
    case "VENCE_HOJE": return "Vence hoje";
    case "NO_PRAZO": return s.diasRestantes === 1 ? "Vence amanhã" : `Faltam ${s.diasRestantes} dias`;
    case "CUMPRIDO": return "Encerrada";
    default: return "Sem prazo";
  }
}

/** Prazo (dia civil) já vencido hoje em Brasília — para listas e calendário. */
export const prazoVencido = (prazo: Date | string | null | undefined, agora: Date = new Date()) =>
  situacaoPrazo(prazo, false, agora).situacao === "ATRASADO";

/** Atividade encerrada para fins de prazo. */
export const atividadeEncerrada = (status: string) => status === "CONCLUIDA" || status === "CANCELADA";
