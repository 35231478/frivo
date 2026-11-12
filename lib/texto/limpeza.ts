/**
 * Limpeza única da digitação dos dados ANTIGOS — a mesma padronização de lib/texto/normalizar.ts
 * aplicada de uma vez aos registros que já existem. Dois modos:
 *   - PRÉVIA (planejar): só LISTA o que mudaria (de → para), sem gravar;
 *   - APLICAR: grava só os campos que mudam.
 * Multiempresa (sempre filtra por empresaId, nunca cruza), idempotente (rodar de novo não acha nada)
 * e por registro (um update com só os campos alterados). O chamador (a rota) confere a permissão.
 */
import { prisma } from "@/lib/prisma";
import { padronizarNome, padronizarEmail, apararTextoLivre, type TipoTexto } from "@/lib/texto/normalizar";

type CampoAlvo = { campo: string; tipo: TipoTexto };
type Alvo = { entidade: string; rotulo: string; model: string; campos: CampoAlvo[] };

/** O que a limpeza percorre. `livre` só apara (não muda o casing); o resto vira Nome Próprio/e-mail. */
const ALVOS: Alvo[] = [
  { entidade: "clientes", rotulo: "Clientes", model: "cliente", campos: [
    { campo: "nome", tipo: "nome" }, { campo: "nomeFantasia", tipo: "nome" }, { campo: "email", tipo: "email" },
    { campo: "contato", tipo: "nome" }, { campo: "endereco", tipo: "endereco" }, { campo: "complemento", tipo: "endereco" },
    { campo: "bairro", tipo: "endereco" }, { campo: "cidade", tipo: "cidade" }, { campo: "observacoes", tipo: "livre" }] },
  { entidade: "unidades", rotulo: "Endereços dos clientes", model: "unidade", campos: [
    { campo: "nome", tipo: "nome" }, { campo: "logradouro", tipo: "endereco" }, { campo: "complemento", tipo: "endereco" },
    { campo: "bairro", tipo: "endereco" }, { campo: "cidade", tipo: "cidade" }, { campo: "observacoes", tipo: "livre" }] },
  { entidade: "colaboradores", rotulo: "Colaboradores", model: "tecnico", campos: [
    { campo: "nome", tipo: "nome" }, { campo: "email", tipo: "email" }, { campo: "endereco", tipo: "endereco" },
    { campo: "complemento", tipo: "endereco" }, { campo: "bairro", tipo: "endereco" }, { campo: "cidade", tipo: "cidade" },
    { campo: "observacoes", tipo: "livre" }] },
  { entidade: "fornecedores", rotulo: "Fornecedores", model: "fornecedor", campos: [
    { campo: "nome", tipo: "nome" }, { campo: "email", tipo: "email" }, { campo: "observacoes", tipo: "livre" }] },
  { entidade: "contatos", rotulo: "Contatos", model: "contatoCliente", campos: [
    { campo: "nome", tipo: "nome" }, { campo: "cargo", tipo: "nome" }, { campo: "email", tipo: "email" }] },
  { entidade: "equipes", rotulo: "Equipes", model: "equipe", campos: [
    { campo: "nome", tipo: "nome" }, { campo: "observacoes", tipo: "livre" }] },
  // Usuário: só o nome. O e-mail é a identidade de login — não é mexido aqui.
  { entidade: "usuarios", rotulo: "Usuários", model: "usuario", campos: [
    { campo: "nome", tipo: "nome" }] },
];

/** Aplica a regra certa a um valor conforme a natureza do campo. */
export function normalizarPorTipo(valor: string, tipo: TipoTexto): string {
  if (tipo === "email") return padronizarEmail(valor);
  if (tipo === "livre") return apararTextoLivre(valor);
  return padronizarNome(valor); // nome / cidade / endereco
}

export type MudancaLimpeza = {
  entidade: string; rotulo: string; id: string; nome: string; campo: string; de: string; para: string;
};
export type ResumoEntidade = { entidade: string; rotulo: string; registros: number; campos: number };
export type PlanoLimpeza = {
  amostra: MudancaLimpeza[]; // as primeiras mudanças (prévia legível), limitada
  amostraLimitada: boolean;
  porEntidade: ResumoEntidade[];
  totalRegistros: number;
  totalCampos: number;
};

/** Quantas mudanças a prévia detalha (de → para). Os totais contam tudo. */
export const LIMITE_AMOSTRA = 300;

type Linha = { id: string; nome?: string | null } & Record<string, unknown>;

/** Percorre um alvo e devolve as mudanças por registro (campo atual != normalizado). */
function mudancasDoRegistro(alvo: Alvo, r: Linha): { campo: string; de: string; para: string }[] {
  const out: { campo: string; de: string; para: string }[] = [];
  for (const c of alvo.campos) {
    const atual = r[c.campo];
    if (typeof atual !== "string" || atual === "") continue;
    const novo = normalizarPorTipo(atual, c.tipo);
    if (novo !== atual) out.push({ campo: c.campo, de: atual, para: novo });
  }
  return out;
}

async function lerAlvo(alvo: Alvo, empresaId: string): Promise<Linha[]> {
  const select: Record<string, boolean> = { id: true, nome: true };
  for (const c of alvo.campos) select[c.campo] = true;
  // acesso dinâmico ao modelo (utilitário de manutenção; sempre filtra por empresa)
  return (prisma as unknown as Record<string, { findMany: (a: unknown) => Promise<Linha[]> }>)[alvo.model]
    .findMany({ where: { empresaId }, select });
}

/** PRÉVIA: lista o que mudaria, sem gravar nada. */
export async function planejarLimpezaCaixa(empresaId: string): Promise<PlanoLimpeza> {
  const amostra: MudancaLimpeza[] = [];
  const porEntidade: ResumoEntidade[] = [];
  let totalRegistros = 0, totalCampos = 0;
  for (const alvo of ALVOS) {
    const registros = await lerAlvo(alvo, empresaId);
    let regs = 0, cps = 0;
    for (const r of registros) {
      const muda = mudancasDoRegistro(alvo, r);
      if (!muda.length) continue;
      regs++; cps += muda.length;
      for (const m of muda) {
        if (amostra.length < LIMITE_AMOSTRA)
          amostra.push({ entidade: alvo.entidade, rotulo: alvo.rotulo, id: r.id, nome: (r.nome ?? "") as string, ...m });
      }
    }
    if (regs > 0) porEntidade.push({ entidade: alvo.entidade, rotulo: alvo.rotulo, registros: regs, campos: cps });
    totalRegistros += regs; totalCampos += cps;
  }
  return { amostra, amostraLimitada: totalCampos > amostra.length, porEntidade, totalRegistros, totalCampos };
}

export type ResultadoLimpeza = { porEntidade: ResumoEntidade[]; totalRegistros: number; totalCampos: number };

/** APLICAR: grava só os campos que mudam, um update por registro. Devolve e loga o resumo. */
export async function aplicarLimpezaCaixa(empresaId: string): Promise<ResultadoLimpeza> {
  const porEntidade: ResumoEntidade[] = [];
  let totalRegistros = 0, totalCampos = 0;
  for (const alvo of ALVOS) {
    const registros = await lerAlvo(alvo, empresaId);
    const modelo = (prisma as unknown as Record<string, { update: (a: unknown) => Promise<unknown> }>)[alvo.model];
    let regs = 0, cps = 0;
    for (const r of registros) {
      const muda = mudancasDoRegistro(alvo, r);
      if (!muda.length) continue;
      const data: Record<string, string> = {};
      for (const m of muda) data[m.campo] = m.para;
      // id veio de um findMany já filtrado por empresaId: pertence à empresa
      await modelo.update({ where: { id: r.id }, data });
      regs++; cps += muda.length;
    }
    if (regs > 0) porEntidade.push({ entidade: alvo.entidade, rotulo: alvo.rotulo, registros: regs, campos: cps });
    totalRegistros += regs; totalCampos += cps;
  }
  // Log do que foi alterado (sem dado pessoal: só contagens por entidade)
  console.info("[padronizacao] limpeza aplicada", { empresaId, totalRegistros, totalCampos, porEntidade });
  return { porEntidade, totalRegistros, totalCampos };
}
