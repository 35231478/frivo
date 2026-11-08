import { z } from "zod";
import { arred, formatarQtd, numeroBr, temAteTresCasas } from "@/lib/estoque/regras";

/**
 * Estoque E4.1/E4.2 — separação e consumo de material para a OS: regras PURAS (sem banco).
 *
 * Cada material da OS (snapshot os_materiais) guarda quanto já foi SEPARADO (= reservado no razão, movimentações
 * RESERVA com ref_id = OS), quanto foi CONSUMIDO (= saiu de verdade: SAIDA no razão) e o estado: null (nada separado),
 * SEPARADO (prestação de contas pendente: consumo ainda não informado), CONSUMIDO (consumo informado; a sobra
 * separada − consumida continua reservada, "pendente de devolução" até a E4.3), DEVOLVIDO (E4.3).
 *
 * Separação: dita pelo ALVO (quanto, no total, fica separado): subir gera RESERVA (−), baixar gera o estorno
 * (RESERVA +), alvo 0 desfaz. Separar menos do que o necessário é permitido (faltou no estoque); a OS continua na fila
 * "A separar" enquanto faltar algo.
 * Consumo (E4.2): dito pela quantidade consumida de verdade. A RESERVA já tirou do saldo na separação: no consumo a
 * reserva da parte consumida vira SAIDA (estorno RESERVA + e SAIDA −: líquido zero), e o que passou do separado é
 * SAIDA a mais (baixa adicional). Nada baixa duas vezes. Desfazer o consumo estorna a SAIDA e volta à reserva.
 */

export type EstadoSeparacao = "SEPARADO" | "CONSUMIDO" | "DEVOLVIDO";
export const LABEL_ESTADO_SEPARACAO: Record<EstadoSeparacao, string> = { SEPARADO: "Separado", CONSUMIDO: "Consumido", DEVOLVIDO: "Devolvido" };

export interface MaterialSeparavel {
  id: string;
  /** null = o produto saiu do cadastro: não dá para separar (aparece como "sem produto") */
  produtoId: string | null;
  descricao: string;
  unidade: string;
  /** Quantidade necessária (do snapshot) */
  quantidade: number;
  quantidadeSeparada: number;
  /** E4.2: quanto saiu de verdade (vale com estado CONSUMIDO); ausente = 0 */
  quantidadeConsumida?: number;
  estadoSeparacao: EstadoSeparacao | null;
}

const fechado = (m: Pick<MaterialSeparavel, "estadoSeparacao">) => m.estadoSeparacao === "CONSUMIDO" || m.estadoSeparacao === "DEVOLVIDO";
const consumida = (m: MaterialSeparavel) => m.quantidadeConsumida ?? 0;

/** Quanto ainda falta separar (0 quando não dá: sem produto, já consumido/devolvido, ou tudo separado). */
export function faltaSeparar(m: MaterialSeparavel): number {
  if (!m.produtoId || fechado(m)) return 0;
  return Math.max(0, arred(m.quantidade - m.quantidadeSeparada));
}
/** O material ainda tem o que separar (é isto que põe a OS na fila "A separar"). */
export const precisaSeparar = (m: MaterialSeparavel) => faltaSeparar(m) > 0;

/** E4.2: a sobra separada que ainda não voltou ao estoque (separado − consumido, com o consumo já informado). A E4.3 devolve. */
export function pendenteDevolucao(m: MaterialSeparavel): number {
  if (m.estadoSeparacao !== "CONSUMIDO") return 0;
  return Math.max(0, arred(m.quantidadeSeparada - consumida(m)));
}

export type SituacaoMaterial = "sem-produto" | "pendente" | "parcial" | "separado" | "consumido" | "devolvido";
export const LABEL_SITUACAO_MATERIAL: Record<SituacaoMaterial, string> = {
  "sem-produto": "Sem produto no cadastro", pendente: "A separar", parcial: "Separado em parte", separado: "Separado", consumido: "Consumido", devolvido: "Devolvido",
};
export function situacaoDoMaterial(m: MaterialSeparavel): SituacaoMaterial {
  if (m.estadoSeparacao === "CONSUMIDO") return "consumido";
  if (m.estadoSeparacao === "DEVOLVIDO") return "devolvido";
  if (!m.produtoId) return "sem-produto";
  if (m.quantidadeSeparada <= 0) return "pendente";
  return m.quantidadeSeparada < m.quantidade ? "parcial" : "separado";
}

export type SituacaoSeparacao = "sem-material" | "pendente" | "parcial" | "completa";
export const LABEL_SITUACAO_SEPARACAO: Record<SituacaoSeparacao, string> = {
  "sem-material": "Sem material", pendente: "A separar", parcial: "Separação parcial", completa: "Tudo separado",
};
export interface ResumoSeparacao {
  /** Materiais físicos (quantidade > 0, com produto) */
  total: number;
  /** Ainda com algo a separar (pendentes + parciais) */
  aSeparar: number;
  pendentes: number;
  parciais: number;
  separados: number;
  semProduto: number;
  situacao: SituacaoSeparacao;
  /** E4.2: separados cujo consumo ainda não foi informado (o Portão 1 olha isto) */
  consumoPendente: number;
  /** E4.2: consumo informado */
  consumidos: number;
  /** E4.2: com sobra separada ainda reservada (a E4.3 devolve) */
  pendentesDevolucao: number;
  /** Há material separado sem consumo informado, ou sobra sem devolução — o gancho das amarras (E4.2/E4.3) */
  prestacaoPendente: boolean;
}
/** Material separado (de verdade) cujo consumo ainda não foi informado. */
export const semConsumoInformado = (materiais: MaterialSeparavel[]) =>
  materiais.filter((m) => m.quantidade > 0 && !!m.produtoId && m.estadoSeparacao === "SEPARADO" && m.quantidadeSeparada > 0);

export function resumoSeparacao(materiais: MaterialSeparavel[]): ResumoSeparacao {
  const fisicos = materiais.filter((m) => m.quantidade > 0);
  const comProduto = fisicos.filter((m) => m.produtoId);
  const sit = comProduto.map(situacaoDoMaterial);
  const pendentes = sit.filter((s) => s === "pendente").length;
  const parciais = sit.filter((s) => s === "parcial").length;
  const separados = sit.filter((s) => s === "separado").length;
  const aSeparar = comProduto.filter(precisaSeparar).length;
  const situacao: SituacaoSeparacao = comProduto.length === 0 ? "sem-material" : aSeparar === 0 ? "completa" : aSeparar < comProduto.length || parciais > 0 ? "parcial" : "pendente";
  const consumoPendente = semConsumoInformado(materiais).length;
  const pendentesDevolucao = materiais.filter((m) => pendenteDevolucao(m) > 0).length;
  return {
    total: comProduto.length, aSeparar, pendentes, parciais, separados, semProduto: fisicos.length - comProduto.length, situacao,
    consumoPendente, consumidos: sit.filter((s) => s === "consumido").length, pendentesDevolucao,
    prestacaoPendente: consumoPendente > 0 || pendentesDevolucao > 0,
  };
}

export type PlanoSeparacao =
  | { ok: true; /** Lançamento no razão: − separa, + estorna, 0 nada */ delta: number; quantidadeSeparada: number; estado: EstadoSeparacao | null }
  | { ok: false; erro: string };

/** Como levar a quantidade separada do material ao alvo (0 = desfazer; no máximo o necessário). */
export function planoSeparacao(m: MaterialSeparavel, alvo: number): PlanoSeparacao {
  if (!m.produtoId) return { ok: false, erro: "Material sem produto no cadastro: não dá para separar." };
  if (fechado(m)) return { ok: false, erro: `Material já ${LABEL_ESTADO_SEPARACAO[m.estadoSeparacao!].toLowerCase()}: a separação não muda mais.` };
  if (!Number.isFinite(alvo) || alvo < 0) return { ok: false, erro: "A quantidade separada não pode ser negativa." };
  if (!temAteTresCasas(alvo)) return { ok: false, erro: "Use no máximo 3 casas decimais." };
  const a = arred(alvo);
  if (a > arred(m.quantidade)) return { ok: false, erro: `Não dá para separar mais do que o necessário (${formatarQtd(m.quantidade)} ${m.unidade}).` };
  const delta = arred(a - m.quantidadeSeparada);
  return { ok: true, delta: delta === 0 ? 0 : -delta, quantidadeSeparada: a, estado: a > 0 ? "SEPARADO" : null };
}

/* ───────── E4.2: consumo ───────── */
export type PlanoConsumo =
  | { ok: true; /** Reserva convertida em saída (RESERVA +): a parte consumida que já estava separada */ estorno: number; /** SAIDA − do consumido inteiro (o que passou do separado é baixa a mais) */ saida: number; quantidadeConsumida: number; pendenteDevolucao: number }
  | { ok: false; erro: string };

/**
 * Como baixar o consumo informado, sem contar duas vezes: a parte já separada vira SAIDA pelo estorno da reserva
 * (líquido zero no saldo); o que passou do separado é SAIDA a mais. O que sobrou fica reservado (pendente de devolução).
 */
export function planoConsumo(m: MaterialSeparavel, consumido: number): PlanoConsumo {
  if (!m.produtoId) return { ok: false, erro: "Material sem produto no cadastro: não dá para baixar." };
  if (m.estadoSeparacao === "CONSUMIDO") return { ok: false, erro: "Consumo já informado: desfaça para informar de novo." };
  if (m.estadoSeparacao === "DEVOLVIDO") return { ok: false, erro: "Material já devolvido." };
  if (!Number.isFinite(consumido) || consumido < 0) return { ok: false, erro: "A quantidade consumida não pode ser negativa." };
  if (!temAteTresCasas(consumido)) return { ok: false, erro: "Use no máximo 3 casas decimais." };
  const c = arred(consumido);
  if (c === 0 && m.quantidadeSeparada <= 0) return { ok: false, erro: "Nada a baixar: material não separado e consumo zero." };
  const estorno = arred(Math.min(c, m.quantidadeSeparada));
  return { ok: true, estorno, saida: c, quantidadeConsumida: c, pendenteDevolucao: arred(m.quantidadeSeparada - estorno) };
}

export type PlanoDesfazerConsumo =
  | { ok: true; /** SAIDA + (estorno da baixa) */ estornoSaida: number; /** RESERVA − (volta à reserva a parte que estava separada) */ reserva: number; estado: EstadoSeparacao | null }
  | { ok: false; erro: string };

/** Desfazer o consumo: estorna a SAIDA inteira e volta à reserva a parte que estava separada; estado volta a SEPARADO. */
export function planoDesfazerConsumo(m: MaterialSeparavel): PlanoDesfazerConsumo {
  if (m.estadoSeparacao !== "CONSUMIDO") return { ok: false, erro: "Consumo não informado: nada a desfazer." };
  const c = consumida(m);
  return { ok: true, estornoSaida: c, reserva: arred(Math.min(c, m.quantidadeSeparada)), estado: m.quantidadeSeparada > 0 ? "SEPARADO" : null };
}

/** Portão 1 (E4.2): o texto do que falta quando há material separado sem consumo informado; null = nada falta. */
export function textoPortaoConsumo(materiais: MaterialSeparavel[]): string | null {
  const l = semConsumoInformado(materiais);
  if (!l.length) return null;
  return `informar o consumo do material separado (${l.map((m) => `${m.descricao} ${formatarQtd(m.quantidadeSeparada)} ${m.unidade}`).join(", ")}) — aba Materiais & Compras`;
}

/** Aviso (não trava) quando o saldo disponível não cobre o que vai ser separado agora. */
export function avisoSaldoSeparacao(saldo: number, separarAgora: number, unidade: string): string | null {
  if (!(separarAgora > 0) || saldo >= separarAgora) return null;
  const un = unidade ? ` ${unidade}` : "";
  return saldo <= 0
    ? `Sem saldo disponível (${formatarQtd(saldo)}${un}): faltam ${formatarQtd(arred(separarAgora - saldo))}${un}.`
    : `Saldo disponível (${formatarQtd(saldo)}${un}) não cobre: faltam ${formatarQtd(arred(separarAgora - saldo))}${un}.`;
}

/* ───────── Corpos dos POSTs ───────── */
const corpoAlvos = (msgQuantidade: string) => z.object({
  materiais: z.array(z.object({
    id: z.string().trim().min(1, "Material inválido.").max(40, "Material inválido."),
    quantidade: numeroBr(msgQuantidade),
  }).strict()).min(1, "Informe ao menos um material.").max(200, "Materiais demais de uma vez."),
}).strict();
/** POST /api/ordens/[id]/separacao — alvo por material: quanto fica separado no total (0 = desfazer) */
export const separacaoSchema = corpoAlvos("Informe a quantidade separada.");
export type CorpoSeparacao = z.infer<typeof separacaoSchema>;
/** POST /api/ordens/[id]/consumo — por material, quanto foi consumido de verdade */
export const consumoSchema = corpoAlvos("Informe a quantidade consumida.");
export type CorpoConsumo = z.infer<typeof consumoSchema>;

export function mensagemSeparacao(e: z.ZodError) {
  const i = e.issues[0];
  if (!i) return "Dados inválidos.";
  if (i.code === "unrecognized_keys") return `Campo não permitido: ${i.keys.join(", ")}.`;
  return i.message;
}
