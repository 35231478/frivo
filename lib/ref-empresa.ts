import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Isolamento multi-tenant dos VÍNCULOS recebidos no corpo das requisições: todo id que aponta
 * para outro cadastro (cargo, perfil, tipo de OS, tabela de preço, catálogo…) precisa ser da
 * empresa da sessão. Id de outra empresa (ou inexistente) é recusado com 400, sem dizer se ele
 * existe em outro lugar.
 *
 *   await validarRefEmpresa("cargo", body.cargoId, empresaId, "Cargo");
 *   await validarRefsEmpresa("tipoOs", body.competenciaIds, empresaId, "Competência");
 *
 * Vazio/null/undefined = "sem vínculo" (passa). Não exige `ativo`: um vínculo antigo com um
 * cadastro inativado continua valendo (inativo não pode quebrar o passado).
 */

/** Modelos com `empresaId` que aparecem como vínculo em requisições. */
export type ModeloRef =
  | "cliente" | "cargo" | "perfilAcesso" | "tipoOs" | "tabelaPreco" | "servico" | "produto"
  | "checklistTemplate" | "unidade" | "tecnico" | "equipe" | "veiculo" | "formularioTemplate"
  | "prazoTemplate" | "tipoEquipamentoCustom" | "categoriaFinanceira" | "fornecedor";

export class ErroRefEmpresa extends Error {}

type Delegate = { count: (args: { where: Record<string, unknown> }) => Promise<number> };
const delegate = (modelo: ModeloRef) => (prisma as unknown as Record<ModeloRef, Delegate>)[modelo];

/**
 * `opts.novoAtivo`: escolha NOVA precisa estar ativa (mesma regra do SeletorCadastro). Os ids em
 * `opts.manter` (o que o registro já usa) continuam aceitos mesmo inativos.
 */
export interface OpcoesRef { novoAtivo?: boolean; manter?: readonly (string | null | undefined)[] }

const limpos = (ids: readonly (string | null | undefined)[] | null | undefined) =>
  [...new Set((ids ?? []).filter((x): x is string => typeof x === "string" && x.length > 0))];

export async function validarRefsEmpresa(
  modelo: ModeloRef, ids: readonly (string | null | undefined)[] | null | undefined, empresaId: string, rotulo: string, opts: OpcoesRef = {},
) {
  const unicos = limpos(ids);
  if (!unicos.length) return;
  const n = await delegate(modelo).count({ where: { id: { in: unicos }, empresaId } });
  if (n !== unicos.length) throw new ErroRefEmpresa(`${rotulo} inválido(a).`);
  if (opts.novoAtivo) {
    const manter = new Set(limpos(opts.manter));
    const novos = unicos.filter((i) => !manter.has(i));
    if (novos.length && (await delegate(modelo).count({ where: { id: { in: novos }, empresaId, ativo: true } })) !== novos.length)
      throw new ErroRefEmpresa(`${rotulo} inativo(a): escolha um(a) ativo(a).`);
  }
}

export async function validarRefEmpresa(modelo: ModeloRef, id: string | null | undefined, empresaId: string, rotulo: string, opts: OpcoesRef = {}) {
  return validarRefsEmpresa(modelo, [id], empresaId, rotulo, opts);
}

/**
 * Categoria financeira de uma conta (a receber / a pagar) — o vínculo é o ID (Leva 5.1).
 * `undefined` = não mexe; vazio/null = sem categoria. Senão: categoria da empresa; escolha NOVA
 * precisa estar ativa (manter a `atual`, mesmo inativa, é aceito). Devolve o que gravar, com o nome
 * da categoria (cópia só como histórico/fallback — a tela mostra o nome da categoria ligada).
 */
export async function categoriaParaGravar(categoriaId: string | null | undefined, empresaId: string, atual?: string | null):
  Promise<{ categoriaId?: string | null; nome?: string | null }> {
  if (categoriaId === undefined) return {};
  if (!categoriaId) return { categoriaId: null, nome: null };
  await validarRefEmpresa("categoriaFinanceira", categoriaId, empresaId, "Categoria financeira", { novoAtivo: true, manter: [atual] });
  const c = await prisma.categoriaFinanceira.findFirst({ where: { id: categoriaId, empresaId }, select: { nome: true } });
  return { categoriaId, nome: c?.nome ?? null };
}

/**
 * Fornecedor da conta a pagar — o vínculo é o ID (Leva 5.2). `undefined` = não mexe; senão: fornecedor
 * da empresa; escolha NOVA precisa estar ativa (manter o `atual`, mesmo inativo, é aceito). Devolve o
 * que gravar, com nome e documento do cadastro (cópia só como histórico/fallback em texto).
 */
export async function fornecedorParaGravar(fornecedorId: string | null | undefined, empresaId: string, atual?: string | null):
  Promise<{ fornecedorId?: string; nome?: string; documento?: string | null }> {
  if (fornecedorId === undefined || fornecedorId === null || fornecedorId === "") return {};
  await validarRefEmpresa("fornecedor", fornecedorId, empresaId, "Fornecedor", { novoAtivo: true, manter: [atual] });
  const f = await prisma.fornecedor.findFirst({ where: { id: fornecedorId, empresaId }, select: { nome: true, documento: true } });
  return { fornecedorId, nome: f?.nome ?? "", documento: f?.documento ?? null };
}

/** Converte o erro em resposta 400 (ou devolve null se não for erro de vínculo). */
export function respostaRefEmpresa(e: unknown) {
  return e instanceof ErroRefEmpresa ? NextResponse.json({ erro: e.message }, { status: 400 }) : null;
}
