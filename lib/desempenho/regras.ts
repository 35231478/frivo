/**
 * DESEMPENHO (manutenção) — as regras, sem banco e sem tela.
 *
 * O escore é um ÍNDICE DE QUALIDADE de 0 a 100%, por colaborador e por mês. Não mede volume: mede
 * quanto do que a pessoa fez saiu no prazo, com relatório completo e bem avaliado pelo cliente.
 *
 *   base    = média ponderada das métricas QUE TÊM MEDIÇÃO no mês (os pesos do perfil);
 *   escore  = base − pontos das penalidades que alguém marcou "conta" (nunca abaixo de zero).
 *
 * Métrica sem dado no mês não vira zero: sai da conta e o peso dela é repartido entre as outras.
 * Sem nenhuma métrica medida, não há escore ("sem medição"). Penalidade só pesa depois da revisão.
 */
import { z } from "zod";
import { chaveDiaBR, chaveDiaCivil, inicioDiaBR } from "@/lib/fuso";

/* ───────── vocabulário ───────── */

export const TIPOS_PERFIL = ["TECNICO", "GESTAO"] as const;
export type TipoPerfil = (typeof TIPOS_PERFIL)[number];
export const ROTULO_TIPO_PERFIL: Record<TipoPerfil, string> = { TECNICO: "Colaborador de campo", GESTAO: "Encarregado (gestão)" };
export const AJUDA_TIPO_PERFIL: Record<TipoPerfil, string> = {
  TECNICO: "Mede as atividades que o próprio colaborador executou.",
  GESTAO: "Mede as atividades e as avaliações das equipes que ele lidera.",
};

export const METRICAS = ["prazo", "relatorio", "avaliacao"] as const;
export type Metrica = (typeof METRICAS)[number];
export const ROTULO_METRICA: Record<TipoPerfil, Record<Metrica, string>> = {
  TECNICO: { prazo: "Concluídas no prazo", relatorio: "Relatórios completos", avaliacao: "Avaliação do cliente" },
  GESTAO: { prazo: "Equipe no prazo", relatorio: "Relatórios completos da equipe", avaliacao: "Satisfação da equipe" },
};

export const TIPOS_PENALIDADE = ["RETORNO", "RESSALVA", "NOTA_BAIXA", "RECLAMACAO"] as const;
export type TipoPenalidade = (typeof TIPOS_PENALIDADE)[number];
export const ROTULO_PENALIDADE: Record<TipoPenalidade, string> = {
  RETORNO: "Retorno", RESSALVA: "Ressalva do cliente", NOTA_BAIXA: "Nota baixa", RECLAMACAO: "Reclamação",
};

export const SITUACOES_PENALIDADE = ["A_REVISAR", "CONTA", "NAO_CONTA"] as const;
export type SituacaoPenalidade = (typeof SITUACOES_PENALIDADE)[number];
export const ROTULO_SITUACAO: Record<SituacaoPenalidade, string> = { A_REVISAR: "A revisar", CONTA: "Conta", NAO_CONTA: "Não conta" };

/** Perfis que a empresa recebe ao abrir o Desempenho (editáveis; as regras de cada um ficam por definir). */
export const PERFIS_INICIAIS: { nome: string; tipo: TipoPerfil }[] = [
  { nome: "Preventiva", tipo: "TECNICO" }, { nome: "Corretiva", tipo: "TECNICO" },
  { nome: "Instalação", tipo: "TECNICO" }, { nome: "Encarregado", tipo: "GESTAO" },
];

/* ───────── competência ("AAAA-MM", mês de Brasília) ───────── */

export const COMPETENCIA_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const ehCompetencia = (v: unknown): v is string => typeof v === "string" && COMPETENCIA_RE.test(v);

/** O mês (em Brasília) de um instante. */
export const competenciaDe = (d: Date | string | number): string => chaveDiaBR(d).slice(0, 7);
export const competenciaAtual = (agora: Date = new Date()): string => competenciaDe(agora);

/** Soma meses a uma competência ("2026-12" + 1 = "2027-01"). */
export function somarMeses(competencia: string, meses: number): string {
  const [ano, mes] = competencia.split("-").map(Number);
  const total = ano * 12 + (mes - 1) + meses;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}
export const competenciaSeguinte = (c: string) => somarMeses(c, 1);
export const competenciaAnterior = (c: string) => somarMeses(c, -1);

/** Os instantes em que o mês começa e termina em Brasília (`ate` é o início do mês seguinte). */
export function periodoDaCompetencia(competencia: string): { de: Date; ate: Date } {
  const [ano, mes] = competencia.split("-").map(Number);
  return { de: inicioDiaBR(ano, mes - 1, 1), ate: inicioDiaBR(ano, mes, 1) };
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
/** "novembro de 2026" */
export function rotuloCompetencia(competencia: string): string {
  const [ano, mes] = competencia.split("-").map(Number);
  return `${MESES[mes - 1]} de ${ano}`;
}
/** "11/2026" */
export const competenciaCurta = (competencia: string) => `${competencia.slice(5, 7)}/${competencia.slice(0, 4)}`;

/* ───────── a regra do perfil (pesos, meta, faixas, penalidades) ───────── */

export interface Faixa { nome: string; minimo: number; valor: number }

export interface Regra {
  pesoPrazo: number; pesoRelatorio: number; pesoAvaliacao: number;
  exigirFotoAntesDepois: boolean;
  penalidadeRetorno: number; penalidadeReclamacao: number;
  metaMinima: number;
  faixas: Faixa[];
}

export const MAX_FAIXAS = 6;
export const MSG_PESOS = "Os pesos precisam somar 100.";
export const MSG_FAIXA_REPETIDA = "Duas faixas não podem ter o mesmo nome.";
export const MSG_FAIXA_MINIMO_REPETIDO = "Duas faixas não podem começar no mesmo escore.";
export const MSG_FAIXA_ABAIXO_DA_META = "Nenhuma faixa pode começar abaixo da meta mínima.";

const inteiro = (min: number, max: number, nome: string) =>
  z.number({ invalid_type_error: `${nome}: informe um número.`, required_error: `${nome}: informe um número.` }).int(`${nome}: use um número inteiro.`)
    .min(min, `${nome}: mínimo ${min}.`).max(max, `${nome}: máximo ${max}.`);

export const faixaSchema = z.object({
  nome: z.string().trim().min(1, "Dê um nome à faixa.").max(30, "Nome da faixa com no máximo 30 caracteres."),
  minimo: inteiro(0, 100, "Escore mínimo da faixa"),
  valor: z.number({ invalid_type_error: "Valor da faixa: informe um número." }).min(0, "O valor da faixa não pode ser negativo.").max(1_000_000, "Valor da faixa alto demais.")
    .transform((v) => Math.round(v * 100) / 100),
}).strict();

/** A regra como a tela manda: valida a soma dos pesos e as faixas, e devolve as faixas em ordem. */
export const regraSchema = z.object({
  pesoPrazo: inteiro(0, 100, "Peso do prazo"),
  pesoRelatorio: inteiro(0, 100, "Peso do relatório"),
  pesoAvaliacao: inteiro(0, 100, "Peso da avaliação"),
  exigirFotoAntesDepois: z.boolean(),
  penalidadeRetorno: inteiro(0, 100, "Pontos por retorno"),
  penalidadeReclamacao: inteiro(0, 100, "Pontos por reclamação"),
  metaMinima: inteiro(0, 100, "Meta mínima"),
  faixas: z.array(faixaSchema).min(1, "Cadastre pelo menos uma faixa.").max(MAX_FAIXAS, `No máximo ${MAX_FAIXAS} faixas.`),
}).strict().superRefine((r, ctx) => {
  if (r.pesoPrazo + r.pesoRelatorio + r.pesoAvaliacao !== 100) ctx.addIssue({ code: "custom", message: MSG_PESOS, path: ["pesoPrazo"] });
  const nomes = r.faixas.map((f) => f.nome.toLocaleLowerCase("pt-BR"));
  if (new Set(nomes).size !== nomes.length) ctx.addIssue({ code: "custom", message: MSG_FAIXA_REPETIDA, path: ["faixas"] });
  if (new Set(r.faixas.map((f) => f.minimo)).size !== r.faixas.length) ctx.addIssue({ code: "custom", message: MSG_FAIXA_MINIMO_REPETIDO, path: ["faixas"] });
  if (r.faixas.some((f) => f.minimo < r.metaMinima)) ctx.addIssue({ code: "custom", message: MSG_FAIXA_ABAIXO_DA_META, path: ["faixas"] });
}).transform((r): Regra => ({ ...r, faixas: [...r.faixas].sort((a, b) => a.minimo - b.minimo) }));

/**
 * Ponto de partida do formulário de um perfil SEM regra: pesos e faixas usuais, valores em branco
 * (zero). Nada disto vale enquanto a gestão não salvar — não existe regra "de fábrica" em vigor.
 */
export const REGRA_SUGERIDA: Regra = {
  pesoPrazo: 40, pesoRelatorio: 30, pesoAvaliacao: 30, exigirFotoAntesDepois: true,
  penalidadeRetorno: 5, penalidadeReclamacao: 5, metaMinima: 70,
  faixas: [{ nome: "Bronze", minimo: 70, valor: 0 }, { nome: "Prata", minimo: 80, valor: 0 }, { nome: "Ouro", minimo: 90, valor: 0 }],
};

/** As faixas como foram gravadas (JSON): só o que tem a forma certa, em ordem de escore. */
export function lerFaixas(json: unknown): Faixa[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter((f): f is Faixa => !!f && typeof f === "object" && typeof (f as Faixa).nome === "string" && Number.isFinite((f as Faixa).minimo) && Number.isFinite((f as Faixa).valor))
    .map((f) => ({ nome: f.nome, minimo: Number(f.minimo), valor: Number(f.valor) }))
    .sort((a, b) => a.minimo - b.minimo);
}

/* ───────── vigência: a regra é travada no mês ───────── */

/** A regra que vale na competência: a mais recente que já começou. Nenhuma = perfil sem regra no mês. */
export function regraVigente<T extends { vigenteDesde: string }>(regras: T[], competencia: string): T | null {
  let melhor: T | null = null;
  for (const r of regras) if (r.vigenteDesde <= competencia && (!melhor || r.vigenteDesde > melhor.vigenteDesde)) melhor = r;
  return melhor;
}

/** A mudança já gravada para depois do mês corrente (a mais próxima), se houver. */
export function regraAgendada<T extends { vigenteDesde: string }>(regras: T[], atual: string): T | null {
  let melhor: T | null = null;
  for (const r of regras) if (r.vigenteDesde > atual && (!melhor || r.vigenteDesde < melhor.vigenteDesde)) melhor = r;
  return melhor;
}

/**
 * A partir de que mês vale o que está sendo salvo agora: a PRIMEIRA regra do perfil vale já no mês
 * corrente; qualquer mudança depois só vale no mês seguinte (a regra do mês não muda no meio do jogo).
 */
export function vigenciaDaMudanca(regras: { vigenteDesde: string }[], atual: string): string {
  return regraVigente(regras, atual) ? competenciaSeguinte(atual) : atual;
}

/* ───────── as métricas ───────── */

/** Uma métrica de proporção: quantos deram certo, de quantos medidos. */
export interface Medida { certos: number; total: number }
export const SEM_MEDIDA: Medida = { certos: 0, total: 0 };

const arredondar1 = (n: number) => Math.round(n * 10) / 10;

/** "% de acerto" com 1 casa; null = nada medido (não é zero). */
export const percentual = (m: Medida): number | null => (m.total > 0 ? arredondar1((m.certos / m.total) * 100) : null);

export const NOTA_MAXIMA = 5;
/** A média das estrelas (1 a 5) na escala do escore: 5 estrelas = 100%, 4 = 80%. */
export const notaEmPercentual = (media: number): number => arredondar1((media / NOTA_MAXIMA) * 100);

/** O dia de referência do prazo da atividade: o prazo próprio ou, sem ele, o dia agendado. */
export function diaDeReferencia(a: { prazo: Date | string | null; dataAgendada: Date | string | null }): string | null {
  if (a.prazo) return chaveDiaCivil(a.prazo);
  return a.dataAgendada ? chaveDiaBR(a.dataAgendada) : null;
}

/**
 * A atividade foi concluída no prazo? Sim quando o DIA da conclusão (em Brasília) não passa do dia de
 * referência. null = não dá para medir: sem data de conclusão (concluída antes de o sistema guardar
 * a data) ou sem prazo nem agendamento.
 */
export function concluidaNoPrazo(a: { concluidaEm: Date | string | null; prazo: Date | string | null; dataAgendada: Date | string | null }): boolean | null {
  const referencia = diaDeReferencia(a);
  if (!a.concluidaEm || !referencia) return null;
  return chaveDiaBR(a.concluidaEm) <= referencia;
}

/** O equipamento tem ao menos uma foto "antes" e uma "depois"? */
export function temAntesEDepois(fotos: { momento: string | null }[]): boolean {
  return fotos.some((f) => f.momento === "ANTES") && fotos.some((f) => f.momento === "DEPOIS");
}

/**
 * O relatório da atividade está completo? Vale por equipamento ATENDIDO: a regra que o app já usa
 * para deixar concluir (checklist respondido, medições com valor, foto e observação que o item pede,
 * formulário obrigatório) e, quando o perfil exige, foto antes e depois. Sem equipamento atendido
 * não há relatório para medir (null).
 */
export function relatorioCompleto(equipamentos: { completo: boolean; antesEDepois: boolean }[], exigirFotoAntesDepois: boolean): boolean | null {
  if (!equipamentos.length) return null;
  return equipamentos.every((e) => e.completo && (!exigirFotoAntesDepois || e.antesEDepois));
}

/* ───────── o escore ───────── */

export interface EntradaEscore {
  prazo: Medida;
  relatorio: Medida;
  /** Média das notas (1 a 5) e quantas avaliações; sem avaliação = média null */
  avaliacao: { media: number | null; avaliacoes: number };
  /** Penalidades que a revisão marcou "conta" no mês */
  retornos: number;
  reclamacoes: number;
}

export interface LinhaComposicao {
  metrica: Metrica;
  peso: number;
  /** 0 a 100, ou null quando não houve medição no mês */
  valor: number | null;
  /** Quanto esta métrica somou ao escore (as linhas medidas somam a base) */
  pontos: number | null;
  /** Os números por trás: "18 de 20" / "média 4,5 em 12 avaliações" */
  detalhe: string;
}

export interface Escore {
  /** 0 a 100 (1 casa) ou null = sem medição no mês */
  escore: number | null;
  /** A média ponderada, antes das penalidades */
  base: number | null;
  /** Pontos descontados pelas penalidades que contam */
  desconto: number;
  composicao: LinhaComposicao[];
  penalidades: { retornos: number; reclamacoes: number; pontosRetorno: number; pontosReclamacao: number };
  atingiuMeta: boolean;
  faixa: Faixa | null;
  /** Bônus projetado: o valor da faixa atingida (zero sem faixa) */
  bonus: number;
}

const virgula = (n: number, casas = 1) => n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
/** "87,5%" — o escore como aparece na tela; "—" quando não há medição. */
export const formatarEscore = (n: number | null | undefined): string => (n === null || n === undefined ? "—" : `${virgula(n)}%`);

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** A faixa do escore: a mais alta que ele alcança — e só para quem passou da meta mínima. */
export function faixaDoEscore(faixas: Faixa[], escore: number | null, metaMinima: number): Faixa | null {
  if (escore === null || escore < metaMinima) return null;
  let melhor: Faixa | null = null;
  for (const f of faixas) if (escore >= f.minimo && (!melhor || f.minimo > melhor.minimo)) melhor = f;
  return melhor;
}

export function calcularEscore(regra: Regra, e: EntradaEscore): Escore {
  const medidas: { metrica: Metrica; peso: number; valor: number | null; detalhe: string }[] = [
    { metrica: "prazo", peso: regra.pesoPrazo, valor: percentual(e.prazo), detalhe: e.prazo.total ? `${e.prazo.certos} de ${plural(e.prazo.total, "atividade", "atividades")}` : "sem medição no mês" },
    { metrica: "relatorio", peso: regra.pesoRelatorio, valor: percentual(e.relatorio), detalhe: e.relatorio.total ? `${e.relatorio.certos} de ${plural(e.relatorio.total, "relatório", "relatórios")}` : "sem medição no mês" },
    {
      metrica: "avaliacao", peso: regra.pesoAvaliacao, valor: e.avaliacao.media === null ? null : notaEmPercentual(e.avaliacao.media),
      detalhe: e.avaliacao.media === null ? "sem avaliação no mês" : `média ${virgula(e.avaliacao.media)} em ${plural(e.avaliacao.avaliacoes, "avaliação", "avaliações")}`,
    },
  ];
  const pesoMedido = medidas.reduce((s, m) => s + (m.valor !== null ? m.peso : 0), 0);
  const composicao: LinhaComposicao[] = medidas.map((m) => ({
    ...m, pontos: m.valor !== null && pesoMedido > 0 ? arredondar1((m.peso * m.valor) / pesoMedido) : null,
  }));
  const pontosRetorno = e.retornos * regra.penalidadeRetorno;
  const pontosReclamacao = e.reclamacoes * regra.penalidadeReclamacao;
  const desconto = pontosRetorno + pontosReclamacao;
  const penalidades = { retornos: e.retornos, reclamacoes: e.reclamacoes, pontosRetorno, pontosReclamacao };
  if (pesoMedido <= 0) return { escore: null, base: null, desconto, composicao, penalidades, atingiuMeta: false, faixa: null, bonus: 0 };

  const base = arredondar1(medidas.reduce((s, m) => s + (m.valor !== null ? m.peso * m.valor : 0), 0) / pesoMedido);
  const escore = arredondar1(Math.min(100, Math.max(0, base - desconto)));
  const faixa = faixaDoEscore(regra.faixas, escore, regra.metaMinima);
  return { escore, base, desconto, composicao, penalidades, atingiuMeta: escore >= regra.metaMinima, faixa, bonus: faixa?.valor ?? 0 };
}

/** A penalidade pesa pelos pontos de retorno ou pelos de reclamação (ressalva, nota baixa e reclamação). */
export const ehRetorno = (tipo: string) => tipo === "RETORNO";

/* ───────── ranking e equipe ───────── */

/**
 * Posição no ranking: maior escore primeiro; empate divide a posição (1º, 1º, 3º). Quem não tem
 * medição fica no fim, sem posição. Desempate da ordem na tela: o nome.
 */
export function ranquear<T extends { escore: number | null; nome: string }>(linhas: T[]): (T & { posicao: number | null })[] {
  const ordem = [...linhas].sort((a, b) => (b.escore ?? -1) - (a.escore ?? -1) || a.nome.localeCompare(b.nome, "pt-BR"));
  let posicao = 0;
  return ordem.map((l, i) => {
    if (l.escore === null) return { ...l, posicao: null };
    if (i === 0 || ordem[i - 1].escore !== l.escore) posicao = i + 1;
    return { ...l, posicao };
  });
}

/** O escore da equipe: a média simples dos escores de quem tem medição (o individual é a base). */
export function mediaDaEquipe(escores: (number | null)[]): number | null {
  const medidos = escores.filter((e): e is number => e !== null);
  return medidos.length ? arredondar1(medidos.reduce((s, e) => s + e, 0) / medidos.length) : null;
}

/* ───────── retorno ───────── */

export interface ServicoNoEquipamento { atividadeId: string; ordemServicoId: string; feitoEm: Date }

/**
 * De qual serviço este retorno "volta": o ÚLTIMO serviço feito no equipamento antes da abertura da
 * OS corretiva, em outra OS, e dentro do prazo de N dias. Fora do prazo (ou sem serviço antes) não
 * é retorno. Só o último conta — um retorno não se espalha por todos os serviços anteriores.
 */
export function origemDoRetorno(servicos: ServicoNoEquipamento[], retorno: { ordemServicoId: string; abertaEm: Date }, dias: number): ServicoNoEquipamento | null {
  const limite = retorno.abertaEm.getTime() - dias * 86_400_000;
  let ultimo: ServicoNoEquipamento | null = null;
  for (const s of servicos) {
    if (s.ordemServicoId === retorno.ordemServicoId) continue;
    const t = s.feitoEm.getTime();
    if (t >= retorno.abertaEm.getTime()) continue;
    if (!ultimo || t > ultimo.feitoEm.getTime()) ultimo = s;
  }
  return ultimo && ultimo.feitoEm.getTime() >= limite ? ultimo : null;
}

/* ───────── o que a tela manda ───────── */

export const NOME_PERFIL_MAX = 40;
export const perfilSchema = z.object({
  nome: z.string().trim().min(2, "Dê um nome ao perfil (mínimo 2 caracteres).").max(NOME_PERFIL_MAX, `Nome com no máximo ${NOME_PERFIL_MAX} caracteres.`),
  tipo: z.enum(TIPOS_PERFIL, { errorMap: () => ({ message: "Escolha o tipo do perfil." }) }),
}).strict();

export const RETORNO_DIAS_MAX = 365;
export const ajustesSchema = z.object({
  retornoDias: inteiro(1, RETORNO_DIAS_MAX, "Prazo do retorno (dias)"),
  notaBaixaAte: inteiro(1, 4, "Nota baixa"),
  tiposRetorno: z.array(z.string().min(1).max(64)).max(200),
}).strict();

export const participanteSchema = z.object({ tecnicoId: z.string().min(1).max(64), perfilId: z.string().min(1).max(64) }).strict();

export const MOTIVO_MIN = 5;
export const MOTIVO_MAX = 500;
export const MSG_MOTIVO = `Explique o motivo da decisão (mínimo ${MOTIVO_MIN} caracteres).`;
/** A decisão da revisão: "conta" e "não conta" exigem motivo; voltar para "a revisar" limpa a decisão. */
export const decisaoSchema = z.object({
  situacao: z.enum(SITUACOES_PENALIDADE),
  motivo: z.string().trim().max(MOTIVO_MAX, `Motivo com no máximo ${MOTIVO_MAX} caracteres.`).nullish(),
}).strict().superRefine((d, ctx) => {
  if (d.situacao !== "A_REVISAR" && (d.motivo ?? "").length < MOTIVO_MIN) ctx.addIssue({ code: "custom", message: MSG_MOTIVO, path: ["motivo"] });
}).transform((d) => ({ situacao: d.situacao, motivo: d.situacao === "A_REVISAR" ? null : d.motivo!.trim() }));

export const DESCRICAO_MIN = 10;
export const DESCRICAO_MAX = 1000;
/** Reclamação registrada à mão (telefone, WhatsApp): quem, quando, o que foi e, se houver, a OS. */
export const reclamacaoSchema = z.object({
  tecnicoId: z.string().min(1, "Escolha o colaborador.").max(64),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data da reclamação."),
  descricao: z.string().trim().min(DESCRICAO_MIN, `Descreva a reclamação (mínimo ${DESCRICAO_MIN} caracteres).`).max(DESCRICAO_MAX, `Descrição com no máximo ${DESCRICAO_MAX} caracteres.`),
  osNumero: z.string().trim().max(40).nullish().transform((v) => v || null),
}).strict();

export const IMAGEM_MAX = 600_000;
export const MSG_IMAGEM = "A imagem do brinde precisa ser JPG, PNG ou WebP.";
export const MSG_IMAGEM_GRANDE = "Imagem grande demais. Escolha outra ou reduza o tamanho.";
const IMAGEM_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
export const premiacaoSchema = z.object({
  competencia: z.string().regex(COMPETENCIA_RE, "Informe o mês da premiação."),
  titulo: z.string().trim().min(2, "Dê um título à premiação.").max(80, "Título com no máximo 80 caracteres."),
  descricao: z.string().trim().max(600, "Descrição com no máximo 600 caracteres.").nullish().transform((v) => v || null),
  perfilId: z.string().max(64).nullish().transform((v) => v || null),
  /** undefined = não mexe na imagem; null = tira; texto = a imagem nova (data URL) */
  imagem: z.string().max(IMAGEM_MAX, MSG_IMAGEM_GRANDE).regex(IMAGEM_RE, MSG_IMAGEM).nullable().optional(),
}).strict();

/** O texto que identifica o fato na lista "a revisar". */
export function resumoDaPenalidade(p: { tipo: string; descricao: string | null }): string {
  return p.descricao?.trim() || ROTULO_PENALIDADE[p.tipo as TipoPenalidade] || p.tipo;
}

/* ───────── da medição do mês para a entrada do escore ───────── */

/** Uma atividade concluída no mês, já medida: quem executou, se foi no prazo e o relatório por equipamento atendido. */
export interface AtividadeMedida {
  id: string; ordemServicoId: string; equipeId: string | null;
  /** O responsável e a equipe da atividade, sem repetir — todos levam o resultado, uma vez cada */
  executores: string[];
  noPrazo: boolean | null;
  equipamentos: { completo: boolean; antesEDepois: boolean }[];
}

/** Uma OS avaliada pelo cliente no mês: a nota, quem executou e as equipes das atividades concluídas. */
export interface OsAvaliadaMedida { ordemServicoId: string; avaliacao: number; executores: string[]; equipeIds: string[] }

export interface PenalidadesQueContam { retornos: number; reclamacoes: number }

function medirAtividades(atividades: AtividadeMedida[], exigirFotoAntesDepois: boolean): { prazo: Medida; relatorio: Medida } {
  const prazo = { certos: 0, total: 0 };
  const relatorio = { certos: 0, total: 0 };
  for (const a of atividades) {
    if (a.noPrazo !== null) { prazo.total++; if (a.noPrazo) prazo.certos++; }
    const completo = relatorioCompleto(a.equipamentos, exigirFotoAntesDepois);
    if (completo !== null) { relatorio.total++; if (completo) relatorio.certos++; }
  }
  return { prazo, relatorio };
}

const mediaDasNotas = (notas: number[]) => (notas.length ? Math.round((notas.reduce((s, n) => s + n, 0) / notas.length) * 100) / 100 : null);

/** A entrada do escore de um colaborador de campo: só as atividades em que ele foi executor. */
export function entradaDoColaborador(
  tecnicoId: string, atividades: AtividadeMedida[], avaliacao: { media: number; avaliacoes: number } | undefined,
  penalidades: PenalidadesQueContam | undefined, exigirFotoAntesDepois: boolean,
): EntradaEscore {
  return {
    ...medirAtividades(atividades.filter((a) => a.executores.includes(tecnicoId)), exigirFotoAntesDepois),
    avaliacao: avaliacao ? { media: avaliacao.media, avaliacoes: avaliacao.avaliacoes } : { media: null, avaliacoes: 0 },
    retornos: penalidades?.retornos ?? 0, reclamacoes: penalidades?.reclamacoes ?? 0,
  };
}

/**
 * A entrada do escore de um encarregado: as atividades das equipes que ele lidera (a atividade é da
 * equipe ou tem um membro dela entre os executores) e a satisfação dessas mesmas OS. Cada atividade e
 * cada OS avaliada conta uma vez, mesmo com vários membros nela. As penalidades são só as dele.
 */
export function entradaDaGestao(
  lideradas: { equipeIds: string[]; membros: string[] }, atividades: AtividadeMedida[], avaliadas: OsAvaliadaMedida[],
  penalidades: PenalidadesQueContam | undefined, exigirFotoAntesDepois: boolean,
): EntradaEscore {
  const equipes = new Set(lideradas.equipeIds);
  const membros = new Set(lideradas.membros);
  const daEquipe = (x: { equipeId?: string | null; equipeIds?: string[]; executores: string[] }) =>
    (!!x.equipeId && equipes.has(x.equipeId)) || !!x.equipeIds?.some((id) => equipes.has(id)) || x.executores.some((t) => membros.has(t));
  const notas = avaliadas.filter(daEquipe).map((o) => o.avaliacao);
  return {
    ...medirAtividades(atividades.filter(daEquipe), exigirFotoAntesDepois),
    avaliacao: { media: mediaDasNotas(notas), avaliacoes: notas.length },
    retornos: penalidades?.retornos ?? 0, reclamacoes: penalidades?.reclamacoes ?? 0,
  };
}
