/**
 * PRAZO DE EXECUÇÃO da OS — até que dia ela precisa estar concluída. Regras puras (sem banco).
 *
 * A OS tem DUAS datas que não se confundem:
 *   • `previsaoConclusao` = a DATA PREVISTA: quando o serviço está marcado (agenda). É ela que
 *     posiciona a OS no calendário quando ainda não há atividade agendada, que o arrasto muda e que
 *     diz o mês em "a faturar".
 *   • `prazoExecucao` = o PRAZO: o compromisso. É o "Prazo para finalizar" da tela, e é por ele que a
 *     OS fica "atrasada" (calendário, dashboard, sino, central da OS, desempenho).
 *
 * A ligação entre as duas é UMA regra, e fica só aqui: OS sem prazo próprio vale o dia previsto —
 * quem marcou o serviço para o dia 20 e não disse outra coisa espera vê-lo feito no dia 20. É o que o
 * sistema sempre fez, então nenhuma OS antiga muda de "no prazo" para "atrasada" (nem o contrário).
 */
import { z } from "zod";
import { chaveDiaBR, chaveDiaCivil, chaveHojeBR, diaCivilDeChave, hojeDiaCivil, inicioHojeBR } from "@/lib/fuso";
import { situacaoPrazo, textoPrazo } from "@/lib/os/prazos";
import { competenciaCurta, competenciaDe, concluidaNoPrazo, diaDeReferencia } from "@/lib/desempenho/regras";
import { pode, type Permissoes } from "@/lib/permissoes";

export interface DatasDaOs {
  prazoExecucao?: Date | string | null;
  previsaoConclusao?: Date | string | null;
}

/** OS que não atrasa mais: terminou ou foi cancelada */
export const STATUS_FINAIS_OS = ["CONCLUIDA", "CANCELADA"] as const;
export const osEncerrada = (status: string) => (STATUS_FINAIS_OS as readonly string[]).includes(status);

/** A OS tem prazo digitado (ou preenchido pelo tipo)? Sem ele, o prazo que vale é o dia previsto. */
export const temPrazoProprio = (os: DatasDaOs) => !!os.prazoExecucao;

/**
 * O prazo de execução QUE VALE, como dia civil (meia-noite UTC): o próprio ou, sem ele, o dia
 * previsto. null = OS sem prazo e sem data prevista (não atrasa).
 */
export function prazoEfetivo(os: DatasDaOs): Date | null {
  const base = os.prazoExecucao ?? os.previsaoConclusao;
  return base ? diaCivilDeChave(chaveDiaCivil(base)) : null;
}

/** Situação do prazo de execução hoje (em Brasília): no prazo, vence hoje, atrasada… */
export const situacaoPrazoExecucao = (os: DatasDaOs & { status: string }, agora: Date = new Date()) =>
  situacaoPrazo(prazoEfetivo(os), osEncerrada(os.status), agora);

/** A regra única de "OS atrasada": aberta e com o dia do prazo já passado em Brasília. */
export const osAtrasada = (os: DatasDaOs & { status: string }, agora: Date = new Date()) =>
  situacaoPrazoExecucao(os, agora).situacao === "ATRASADO";

/**
 * A MESMA regra como filtro do banco (dashboard, sino, lista): OS aberta com o prazo vencido — o
 * próprio ou, sem ele, a data prevista. Junte com `empresaId`.
 */
export function whereOsAtrasada(agora: Date = new Date()) {
  const hoje = hojeDiaCivil(agora);
  return {
    status: { notIn: [...STATUS_FINAIS_OS] },
    OR: [
      { prazoExecucao: { lt: hoje } },
      { prazoExecucao: null, previsaoConclusao: previstaAntesDe(agora) },
    ],
  };
}

/**
 * A data prevista é gravada de dois jeitos: como DIA (meia-noite UTC) ou com HORA (um instante, que
 * vale o dia dele em Brasília). "Antes de hoje" precisa cobrir os dois: o dia gravado antes de hoje,
 * e o instante antes do começo de hoje em Brasília — a OS marcada para ontem às 22h (que em UTC já é
 * hoje) também passou. O valor exatamente igual a hoje é o DIA de hoje: não passou.
 */
function previstaAntesDe(agora: Date) {
  return { lt: inicioHojeBR(agora), not: hojeDiaCivil(agora) };
}

/** Filtro do banco: OS aberta cujo prazo (o próprio ou, sem ele, o dia previsto) é HOJE em Brasília. */
export function whereOsVenceHoje(agora: Date = new Date()) {
  const hoje = hojeDiaCivil(agora);
  // o dia previsto é hoje: gravado como o dia de hoje, ou um instante dentro do dia de Brasília
  // (o valor igual a amanhã é o DIA de amanhã, não um instante de hoje)
  const previstaHoje = [
    { previsaoConclusao: hoje },
    { previsaoConclusao: { gte: inicioHojeBR(agora), lt: inicioHojeBR(agora, 1), not: hojeDiaCivil(agora, 1) } },
  ];
  return {
    status: { notIn: [...STATUS_FINAIS_OS] },
    OR: [{ prazoExecucao: hoje }, ...previstaHoje.map((p) => ({ prazoExecucao: null, ...p }))],
  };
}

/* ───────── o filtro "Prazo" da lista de OS ───────── */

export const FILTROS_PRAZO = ["atrasadas", "hoje", "justificadas"] as const;
export type FiltroPrazo = (typeof FILTROS_PRAZO)[number];
export const ROTULO_FILTRO_PRAZO: Record<FiltroPrazo, string> = {
  atrasadas: "Atrasadas",
  hoje: "Vencem hoje",
  justificadas: "Com atraso justificado",
};
export const ehFiltroPrazo = (v: unknown): v is FiltroPrazo => (FILTROS_PRAZO as readonly unknown[]).includes(v);

/** O filtro "Prazo" como condição do banco (para entrar num AND). null = sem filtro (ou valor desconhecido). */
export function wherePrazo(filtro: string | null | undefined, agora: Date = new Date()) {
  if (filtro === "atrasadas") return whereOsAtrasada(agora);
  if (filtro === "hoje") return whereOsVenceHoje(agora);
  if (filtro === "justificadas") return { atrasoJustificadoMotivo: { not: null } };
  return null;
}

/* ───────── o prazo padrão do tipo de OS ───────── */

export const PRAZO_DIAS_MAX = 365;
/** O campo "prazo padrão" do tipo de OS: vazio = sem padrão; 0 = o próprio dia agendado */
export const prazoDiasSchema = z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  z.number({ invalid_type_error: "Prazo padrão: informe um número de dias." }).int("Prazo padrão: use dias inteiros.")
    .min(0, "Prazo padrão: não pode ser negativo.").max(PRAZO_DIAS_MAX, `Prazo padrão: no máximo ${PRAZO_DIAS_MAX} dias.`).nullable(),
);

/**
 * O prazo que o tipo de OS sugere: o dia agendado (em Brasília) + N dias. null quando o tipo não
 * tem padrão ou ainda não há dia agendado — aí o campo fica vazio e vale a regra do dia previsto.
 */
export function prazoPadrao(dataAgendada: Date | string | null | undefined, diasDoTipo: number | null | undefined): Date | null {
  if (!dataAgendada || diasDoTipo == null || !Number.isInteger(diasDoTipo) || diasDoTipo < 0) return null;
  const dia = diaCivilDeChave(chaveDiaCivil(dataAgendada));
  return dia ? new Date(dia.getTime() + diasDoTipo * 864e5) : null;
}

/**
 * Reagendamento feito pelo SISTEMA (o cronograma do PMOC mudou a data da OS): o prazo próprio anda
 * junto, a mesma quantidade de dias. Sem prazo próprio não há o que mover (vale o novo dia previsto).
 * O arrasto no calendário NÃO passa por aqui: ali quem decide se o prazo muda é a pessoa.
 */
export function deslocarPrazo(prazo: Date | string | null | undefined, de: Date | string, para: Date | string): Date | null {
  const atual = prazo ? diaCivilDeChave(chaveDiaCivil(prazo)) : null;
  const a = diaCivilDeChave(chaveDiaCivil(de)), b = diaCivilDeChave(chaveDiaCivil(para));
  if (!atual || !a || !b) return atual;
  return new Date(atual.getTime() + (b.getTime() - a.getTime()));
}

/**
 * "AAAA-MM-DD" (ou ISO) digitado → o dia civil gravado. null = vazio; undefined = inválido. O dia
 * precisa EXISTIR: "2026-02-31" e "2026-13-45" são recusados (o Date os "ajustaria" para outro dia,
 * e a OS ganharia um prazo que ninguém digitou).
 */
export function lerPrazoDigitado(valor: string | null | undefined): Date | null | undefined {
  if (valor == null || valor === "") return null;
  const dia = diaCivilDeChave(valor);
  if (!dia || Number.isNaN(dia.getTime())) return undefined;
  return chaveDiaCivil(dia) === valor.slice(0, 10) ? dia : undefined;
}

/**
 * O prazo a gravar quando a OS nasce: o que a pessoa digitou vence; sem nada digitado, o padrão do
 * tipo (se houver); senão vazio.
 */
export function prazoAoCriar(o: { digitado?: Date | null; dataAgendada?: Date | string | null; diasDoTipo?: number | null }): Date | null {
  return o.digitado ?? prazoPadrao(o.dataAgendada, o.diasDoTipo);
}

/* ───────── atraso justificado ───────── */

export const MOTIVOS_ATRASO = ["CLIENTE_AUSENTE", "PECA_FALTANDO", "ACESSO_NEGADO", "CLIMA", "OUTRO"] as const;
export type MotivoAtraso = (typeof MOTIVOS_ATRASO)[number];
export const ROTULO_MOTIVO_ATRASO: Record<MotivoAtraso, string> = {
  CLIENTE_AUSENTE: "Cliente ausente",
  PECA_FALTANDO: "Peça faltando",
  ACESSO_NEGADO: "Acesso ao local negado",
  CLIMA: "Chuva ou clima",
  OUTRO: "Outro motivo",
};
/**
 * DE QUEM FOI A CAUSA do atraso. É marcação EXPLÍCITA do gestor: o motivo acima sugere, mas quem
 * decide é ele, e o que vale é o que fica gravado — nunca o texto livre, nunca um palpite do código.
 *
 * Só serve ao RELATÓRIO DE CUMPRIMENTO DE PRAZOS (o documento que vai ao cliente): atraso por causa
 * do cliente pausa o SLA e sai do percentual; causa interna ou força maior continuam descumpridos,
 * porque não se esconde do cliente o que foi nosso. No desempenho do colaborador nada muda: lá o
 * atraso justificado já sai da métrica, seja qual for a causa.
 */
export const RESPONSABILIDADES_ATRASO = ["CLIENTE", "INTERNA", "TERCEIROS"] as const;
export type ResponsabilidadeAtraso = (typeof RESPONSABILIDADES_ATRASO)[number];
export const ROTULO_RESPONSABILIDADE_ATRASO: Record<ResponsabilidadeAtraso, string> = {
  CLIENTE: "Causa do cliente",
  INTERNA: "Causa interna",
  TERCEIROS: "Força maior ou terceiros",
};
/** O que cada uma quer dizer, na gaveta — sem jargão de SLA para quem só quer registrar o que houve */
export const AJUDA_RESPONSABILIDADE_ATRASO: Record<ResponsabilidadeAtraso, string> = {
  CLIENTE: "Falta de acesso, ausência do responsável, recusa ou pendência do cliente.",
  INTERNA: "Foi a nossa equipe (agenda, deslocamento, material, retrabalho).",
  TERCEIROS: "Fora do alcance dos dois: clima, fornecedor, concessionária, acidente.",
};
/**
 * A sugestão que a tela pré-seleciona a partir do motivo — um atalho, não uma decisão: o gestor
 * confirma (e pode trocar), e é a escolha dele que é gravada. Motivo ambíguo não sugere nada:
 * "peça faltando" tanto pode ser falha nossa de estoque quanto peça que o cliente ia comprar.
 */
export const RESPONSABILIDADE_SUGERIDA: Record<MotivoAtraso, ResponsabilidadeAtraso | null> = {
  CLIENTE_AUSENTE: "CLIENTE",
  ACESSO_NEGADO: "CLIENTE",
  CLIMA: "TERCEIROS",
  PECA_FALTANDO: null,
  OUTRO: null,
};
export const rotuloResponsabilidadeAtraso = (r: string | null | undefined) =>
  (r && (ROTULO_RESPONSABILIDADE_ATRASO as Record<string, string>)[r]) || "";
/** O atraso desta OS foi classificado como causa do CLIENTE? (é o que pausa o SLA no relatório) */
export const atrasoPorCausaDoCliente = (os: { atrasoJustificadoMotivo?: string | null; atrasoResponsavel?: string | null }) =>
  !!os.atrasoJustificadoMotivo && os.atrasoResponsavel === "CLIENTE";

/** "Razão é razão": em "Outro" a explicação precisa dizer alguma coisa (não vale um "x") */
export const EXPLICACAO_MIN = 5;
export const MSG_ATRASO_OUTRO = `Explique o motivo do atraso (pelo menos ${EXPLICACAO_MIN} caracteres).`;
export const explicacaoDoAtrasoValida = (motivo: string, observacao: string | null | undefined) =>
  motivo !== "OUTRO" || (observacao ?? "").trim().length >= EXPLICACAO_MIN;
export const MSG_ATRASO_NAO_ATRASADA = "Esta OS não está atrasada: não há atraso para justificar.";

export const MSG_ATRASO_SEM_RESPONSAVEL = "Diga de quem foi a causa do atraso.";

/** O que o gestor informa ao justificar: o motivo, de quem foi a causa e, em "Outro", a explicação. */
export const atrasoJustificadoSchema = z.object({
  motivo: z.enum(MOTIVOS_ATRASO, { errorMap: () => ({ message: "Escolha o motivo do atraso." }) }),
  responsavel: z.enum(RESPONSABILIDADES_ATRASO, { errorMap: () => ({ message: MSG_ATRASO_SEM_RESPONSAVEL }) }),
  observacao: z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().max(500, "Explicação com no máximo 500 caracteres.").optional().default("")),
}).superRefine((d, ctx) => {
  if (!explicacaoDoAtrasoValida(d.motivo, d.observacao)) ctx.addIssue({ code: "custom", path: ["observacao"], message: MSG_ATRASO_OUTRO });
});

/** O atraso desta OS foi justificado? (não pesa no desempenho de quem executou) */
export const atrasoJustificado = (os: { atrasoJustificadoMotivo?: string | null }) => !!os.atrasoJustificadoMotivo;
export const rotuloMotivoAtraso = (motivo: string | null | undefined) =>
  (motivo && (ROTULO_MOTIVO_ATRASO as Record<string, string>)[motivo]) || "";

/* ───────── o que há de atraso numa OS (para justificar) ───────── */

export interface AtividadeParaAtraso {
  status: string;
  prazo?: Date | string | null;
  dataAgendada?: Date | string | null;
  concluidaEm?: Date | string | null;
}
export interface OsParaAtraso extends DatasDaOs {
  status: string;
  dataConclusao?: Date | string | null;
  atividades?: AtividadeParaAtraso[];
}

/**
 * A atividade está (ou ficou) atrasada? A atividade CONCLUÍDA é julgada pela regra única do
 * desempenho (`concluidaNoPrazo`, lib/desempenho/regras): o que aqui se pode justificar é exatamente o
 * que lá conta como atraso. Ainda aberta, atrasou se o dia de referência (o prazo próprio ou, sem
 * ele, o dia agendado) já passou em Brasília. Cancelada não atrasa.
 */
export function atividadeAtrasou(a: AtividadeParaAtraso, agora: Date = new Date()): boolean {
  if (a.status === "CANCELADA") return false;
  const datas = { prazo: a.prazo ?? null, dataAgendada: a.dataAgendada ?? null };
  if (a.status === "CONCLUIDA") return concluidaNoPrazo({ ...datas, concluidaEm: a.concluidaEm ?? null }) === false;
  const referencia = diaDeReferencia(datas);
  return !!referencia && chaveHojeBR(0, agora) > referencia;
}

/**
 * O que há de atraso nesta OS: a própria OS (aberta com o prazo vencido, ou concluída depois dele) e
 * quantas atividades atrasaram. OS cancelada não tem atraso.
 */
export function atrasosDaOs(os: OsParaAtraso, agora: Date = new Date()): { os: boolean; atividades: number } {
  if (os.status === "CANCELADA") return { os: false, atividades: 0 };
  const prazo = prazoEfetivo(os);
  const daOs = os.status === "CONCLUIDA"
    ? !!prazo && !!os.dataConclusao && chaveDiaBR(os.dataConclusao) > chaveDiaCivil(prazo)
    : osAtrasada(os, agora);
  return { os: daOs, atividades: (os.atividades ?? []).filter((a) => atividadeAtrasou(a, agora)).length };
}

/**
 * O prazo de execução desta OS foi cumprido? A MESMA regra de `atrasosDaOs` vista pelo outro lado,
 * para quem precisa dizer "cumprido" e não só "atrasada" (o relatório de cumprimento de prazos):
 *
 *   false = descumprido — é exatamente o que `atrasosDaOs(os).os` chama de atraso da OS;
 *   true  = cumprido — concluída até o dia do prazo;
 *   null  = não há o que medir — sem prazo, cancelada, ainda dentro do prazo, ou concluída sem a
 *           data da conclusão (OS antiga, de antes de o sistema guardar a data).
 */
export function execucaoNoPrazo(os: OsParaAtraso, agora: Date = new Date()): boolean | null {
  if (!prazoEfetivo(os)) return null; // não houve promessa: nada a medir
  if (atrasosDaOs(os, agora).os) return false; // a MESMA conta da lista (cancelada nunca atrasa)
  if (os.status !== "CONCLUIDA") return null; // ainda correndo, reaberta ou cancelada: a conta não fechou
  return os.dataConclusao ? true : null; // concluída sem a data (OS antiga): não há o que medir
}

/** Há atraso para justificar? (sem atraso, justificar não faz sentido — e a rota recusa) */
export function haAtrasoParaJustificar(os: OsParaAtraso, agora: Date = new Date()): boolean {
  const a = atrasosDaOs(os, agora);
  return a.os || a.atividades > 0;
}

/* ───────── a justificativa e o desempenho ───────── */

/**
 * Os meses do desempenho ("AAAA-MM", Brasília) em que a justificativa desta OS faz diferença: os das
 * atividades CONCLUÍDAS com atraso (é o mês da conclusão que mede a atividade). Em ordem, sem repetir.
 */
export function competenciasDosAtrasos(os: { status?: string; atividades?: AtividadeParaAtraso[] }): string[] {
  if (os.status === "CANCELADA") return [];
  const meses = (os.atividades ?? [])
    .filter((a) => a.status === "CONCLUIDA" && !!a.concluidaEm && atividadeAtrasou(a))
    .map((a) => competenciaDe(a.concluidaEm!));
  return [...new Set(meses)].sort();
}

/**
 * MÊS FECHADO NÃO MUDA: justificar (ou desfazer) depois que o desempenho do mês fechou não mexe no
 * escore nem no bônus daquele mês — só reabrindo o mês. O aviso para quem justifica ("" = nada a avisar).
 */
export function avisoMesFechado(competencias: string[] | null | undefined): string {
  const meses = (competencias ?? []).map(competenciaCurta);
  if (!meses.length) return "";
  const lista = meses.length === 1 ? meses[0] : `${meses.slice(0, -1).join(", ")} e ${meses[meses.length - 1]}`;
  return meses.length === 1
    ? `O desempenho de ${lista} já está fechado: a justificativa não muda o escore desse mês. Para ela valer, reabra o mês em Desempenho › Fechamento.`
    : `O desempenho de ${lista} já está fechado: a justificativa não muda o escore desses meses. Para ela valer, reabra cada mês em Desempenho › Fechamento.`;
}

/**
 * QUEM justifica um atraso: quem tem "Desempenho › Revisar" — a mesma pessoa que decide o que conta
 * e o que não conta no desempenho da equipe (a justificativa tira o atraso do escore). O técnico e
 * quem só opera as OS não justificam: senão a válvula vira desculpa fácil. Administrador sempre pode.
 */
export const podeJustificarAtraso = (permissoes: Permissoes | null | undefined, role?: string) =>
  pode(permissoes, "desempenho", "revisar", role);
export const MSG_SEM_PERMISSAO_JUSTIFICAR = "Só quem revisa o desempenho da equipe pode justificar um atraso.";

/* ───────── o prazo que o técnico vê no app ───────── */

/**
 * O prazo DEFINIDO para uma atividade ("AAAA-MM-DD"): o da própria atividade ou o da OS — o mais
 * próximo dos dois. null quando ninguém definiu prazo: aí o "prazo" seria o próprio dia agendado, que
 * o cartão do técnico já mostra (e um selo em todo cartão seria ruído).
 */
export function prazoDefinido(o: { prazoAtividade?: Date | string | null; prazoOs?: Date | string | null }): string | null {
  const dias = [o.prazoAtividade, o.prazoOs].filter(Boolean).map((d) => chaveDiaCivil(d as Date | string)).sort();
  return dias[0] ?? null;
}

/**
 * O selo de prazo do cartão do técnico, calculado NA HORA de mostrar (o cartão fica guardado no
 * aparelho para o modo offline: "vence hoje" de ontem não pode aparecer hoje). Atividade encerrada
 * não mostra prazo.
 */
export function prazoParaOTecnico(
  o: { statusAtividade: string; prazo?: string | null }, agora: Date = new Date(),
): { dia: string; situacao: "NO_PRAZO" | "VENCE_HOJE" | "ATRASADO"; texto: string } | null {
  if (!o.prazo || o.statusAtividade === "CONCLUIDA" || o.statusAtividade === "CANCELADA") return null;
  const s = situacaoPrazo(diaCivilDeChave(o.prazo), false, agora);
  if (s.situacao !== "NO_PRAZO" && s.situacao !== "VENCE_HOJE" && s.situacao !== "ATRASADO") return null;
  return { dia: o.prazo, situacao: s.situacao, texto: textoPrazo(s, true) };
}
