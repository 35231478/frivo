import { z } from "zod";
import { arred, formatarQtd, numeroBr, temAteTresCasas } from "@/lib/estoque/regras";

/**
 * Estoque E4.1 — separação de material para a OS: regras PURAS (sem banco).
 *
 * Cada material da OS (snapshot os_materiais) guarda quanto já foi SEPARADO (= reservado no razão, movimentações
 * RESERVA com ref_id = OS) e o estado: null (nada separado), SEPARADO (prestação de contas pendente: consumo e
 * devolução ainda não lançados — o gancho das amarras da E4.2/E4.3), CONSUMIDO (E4.2), DEVOLVIDO (E4.3).
 *
 * A separação é dita pelo ALVO (quanto, no total, fica separado do material): subir o alvo gera RESERVA (−), baixar
 * gera o estorno (RESERVA +), alvo 0 desfaz. Separar menos do que o necessário é permitido (faltou no estoque:
 * o separador vê e resolve); a OS continua na fila "A separar" enquanto faltar algo.
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
  estadoSeparacao: EstadoSeparacao | null;
}

const fechado = (m: Pick<MaterialSeparavel, "estadoSeparacao">) => m.estadoSeparacao === "CONSUMIDO" || m.estadoSeparacao === "DEVOLVIDO";

/** Quanto ainda falta separar (0 quando não dá: sem produto, já consumido/devolvido, ou tudo separado). */
export function faltaSeparar(m: MaterialSeparavel): number {
  if (!m.produtoId || fechado(m)) return 0;
  return Math.max(0, arred(m.quantidade - m.quantidadeSeparada));
}
/** O material ainda tem o que separar (é isto que põe a OS na fila "A separar"). */
export const precisaSeparar = (m: MaterialSeparavel) => faltaSeparar(m) > 0;

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
  /** Há material SEPARADO sem consumo e devolução lançados — o gancho das amarras da E4.2/E4.3 */
  prestacaoPendente: boolean;
}
export function resumoSeparacao(materiais: MaterialSeparavel[]): ResumoSeparacao {
  const fisicos = materiais.filter((m) => m.quantidade > 0);
  const comProduto = fisicos.filter((m) => m.produtoId);
  const sit = comProduto.map(situacaoDoMaterial);
  const pendentes = sit.filter((s) => s === "pendente").length;
  const parciais = sit.filter((s) => s === "parcial").length;
  const separados = sit.filter((s) => s === "separado").length;
  const aSeparar = comProduto.filter(precisaSeparar).length;
  const situacao: SituacaoSeparacao = comProduto.length === 0 ? "sem-material" : aSeparar === 0 ? "completa" : aSeparar < comProduto.length || parciais > 0 ? "parcial" : "pendente";
  return {
    total: comProduto.length, aSeparar, pendentes, parciais, separados, semProduto: fisicos.length - comProduto.length, situacao,
    prestacaoPendente: materiais.some((m) => m.estadoSeparacao === "SEPARADO"),
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

/** Aviso (não trava) quando o saldo disponível não cobre o que vai ser separado agora. */
export function avisoSaldoSeparacao(saldo: number, separarAgora: number, unidade: string): string | null {
  if (!(separarAgora > 0) || saldo >= separarAgora) return null;
  const un = unidade ? ` ${unidade}` : "";
  return saldo <= 0
    ? `Sem saldo disponível (${formatarQtd(saldo)}${un}): faltam ${formatarQtd(arred(separarAgora - saldo))}${un}.`
    : `Saldo disponível (${formatarQtd(saldo)}${un}) não cobre: faltam ${formatarQtd(arred(separarAgora - saldo))}${un}.`;
}

/* ───────── Corpo do POST /api/ordens/[id]/separacao ───────── */
export const separacaoSchema = z.object({
  /** Alvo por material: quanto fica separado no total (0 = desfazer) */
  materiais: z.array(z.object({
    id: z.string().trim().min(1, "Material inválido.").max(40, "Material inválido."),
    quantidade: numeroBr("Informe a quantidade separada."),
  }).strict()).min(1, "Informe ao menos um material.").max(200, "Materiais demais de uma vez."),
}).strict();
export type CorpoSeparacao = z.infer<typeof separacaoSchema>;

export function mensagemSeparacao(e: z.ZodError) {
  const i = e.issues[0];
  if (!i) return "Dados inválidos.";
  if (i.code === "unrecognized_keys") return `Campo não permitido: ${i.keys.join(", ")}.`;
  return i.message;
}
