/**
 * Importação por planilha — lado do servidor: permissões, contexto (o que já existe NA EMPRESA DA
 * SESSÃO) e gravação em lotes. Só cria e atualiza: nunca apaga, nunca inativa, nunca reativa.
 */
import { prisma } from "@/lib/prisma";
import { pode, type Permissoes } from "@/lib/permissoes";
import { CADASTROS, type Requisito } from "@/lib/cadastros/registro";
import { ErroRefEmpresa, validarRefEmpresa } from "@/lib/ref-empresa";
import { chaveNome, type Analise, type ContextoImportacao, type LinhaAnalisada, type OpcaoRef } from "@/lib/importacao/motor";
import type { EntidadeImportacao } from "@/lib/importacao/entidades";

/** Criar = importar; editar = poder ATUALIZAR os duplicados. Mesmas permissões das telas. */
export const PERMISSOES_IMPORTACAO: Record<EntidadeImportacao, { criar: Requisito; editar: Requisito }> = {
  clientes: { criar: [["clientes", "criar"]], editar: [["clientes", "editar"]] },
  fornecedores: { criar: CADASTROS.fornecedores.permissoes.criar, editar: CADASTROS.fornecedores.permissoes.editar },
  servicos: { criar: CADASTROS.servicos.permissoes.criar, editar: CADASTROS.servicos.permissoes.editar },
  produtos: { criar: CADASTROS.produtos.permissoes.criar, editar: CADASTROS.produtos.permissoes.editar },
};

export function temRequisito(req: Requisito, permissoes: Permissoes, role?: string) {
  return !req || req.some(([m, a]) => pode(permissoes, m, a, role));
}

/** O que já existe na empresa (chaves de dedup → id) e as opções dos campos referenciados. */
export async function carregarContexto(entidade: EntidadeImportacao, empresaId: string, podeAtualizar: boolean): Promise<ContextoImportacao> {
  const existentes = new Map<string, string>();
  const refs: Record<string, OpcaoRef[]> = {};
  const porNome = (rs: { id: string; nome: string }[]) => { for (const r of rs) { const k = `nome:${chaveNome(r.nome)}`; if (!existentes.has(k)) existentes.set(k, r.id); } };
  switch (entidade) {
    case "clientes": {
      const [cs, tabelas] = await Promise.all([
        prisma.cliente.findMany({ where: { empresaId }, select: { id: true, cpfCnpj: true } }),
        prisma.tabelaPreco.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
      ]);
      // O cadastro guarda o documento formatado: a dedup compara só os dígitos
      for (const c of cs) existentes.set(`doc:${c.cpfCnpj.replace(/\D/g, "")}`, c.id);
      refs.tabela_preco = tabelas.map((t) => ({ valor: t.id, rotulo: t.nome }));
      break;
    }
    case "fornecedores": {
      const fs = await prisma.fornecedor.findMany({ where: { empresaId }, select: { id: true, nome: true, documento: true } });
      for (const f of fs) if (f.documento) existentes.set(`doc:${f.documento}`, f.id);
      porNome(fs);
      break;
    }
    case "servicos": porNome(await prisma.servico.findMany({ where: { empresaId }, select: { id: true, nome: true } })); break;
    case "produtos": porNome(await prisma.produto.findMany({ where: { empresaId }, select: { id: true, nome: true } })); break;
  }
  return { existentes, refs, podeAtualizar };
}

type Delegate = {
  create: (a: { data: Record<string, unknown> }) => Promise<unknown>;
  updateMany: (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>;
};
const MODELO: Record<EntidadeImportacao, string> = { clientes: "cliente", fornecedores: "fornecedor", servicos: "servico", produtos: "produto" };
const tabela = (e: EntidadeImportacao) => (prisma as unknown as Record<string, Delegate>)[MODELO[e]];
const semIndefinidos = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** Uma linha: cria (com os padrões do cadastro) ou atualiza só o que veio preenchido. */
async function gravarLinha(entidade: EntidadeImportacao, l: LinhaAnalisada, empresaId: string): Promise<"criado" | "atualizado"> {
  const dados = semIndefinidos(l.dados ?? {});
  // Vínculo citado na planilha: conferido de novo contra a empresa da sessão (e ativo, se novo)
  if (entidade === "clientes" && dados.tabelaPrecoId)
    await validarRefEmpresa("tabelaPreco", dados.tabelaPrecoId as string, empresaId, "Tabela de preço", { novoAtivo: true });
  // Nunca deixa a planilha escolher empresa, id ou situação
  delete dados.empresaId; delete dados.id; delete dados.ativo;
  if (l.status === "criar") {
    const base = entidade === "clientes" ? dados : (CADASTROS[entidade].schemaCriar.parse(dados) as Record<string, unknown>);
    await tabela(entidade).create({ data: { ...base, empresaId, ativo: true } });
    return "criado";
  }
  // Casou pelo nome: o nome é a chave — "gas r410a" na planilha não renomeia o "Gás R410A" do cadastro
  if (l.chave?.startsWith("nome:")) delete dados.nome;
  const r = await tabela(entidade).updateMany({ where: { id: l.existenteId, empresaId }, data: dados });
  if (r.count !== 1) throw new Error("O registro a atualizar não foi encontrado na sua empresa.");
  return "atualizado";
}

export const TAMANHO_LOTE = 50;

export interface ResultadoImportacao {
  criados: number;
  atualizados: number;
  /** Linhas com erro (da análise e da gravação), com os valores originais para a planilha de erros */
  erros: Pick<LinhaAnalisada, "linha" | "rotulo" | "erros" | "valores">[];
}

/**
 * Grava as linhas válidas em lotes (uma linha que falhar ao gravar vira erro e as outras seguem).
 * Os erros da análise entram no resultado do jeito que estão.
 */
export async function gravarImportacao(entidade: EntidadeImportacao, analise: Analise, empresaId: string): Promise<ResultadoImportacao> {
  const res: ResultadoImportacao = { criados: 0, atualizados: 0, erros: analise.linhas.filter((l) => l.status === "erro") };
  const gravar = analise.linhas.filter((l) => l.status !== "erro");
  for (let i = 0; i < gravar.length; i += TAMANHO_LOTE) {
    const lote = gravar.slice(i, i + TAMANHO_LOTE);
    const feitos = await Promise.allSettled(lote.map((l) => gravarLinha(entidade, l, empresaId)));
    feitos.forEach((f, k) => {
      if (f.status === "fulfilled") { if (f.value === "criado") res.criados++; else res.atualizados++; return; }
      const e = f.reason as { code?: string; message?: string };
      const motivo = e instanceof ErroRefEmpresa ? e.message
        : e?.code === "P2002" ? "Já existe um registro com este documento (cadastrado enquanto você importava). Gere a prévia de novo."
        : e?.message?.includes("não foi encontrado") ? e.message
        : "Não foi possível gravar esta linha.";
      res.erros.push({ ...lote[k], erros: [motivo] });
    });
  }
  res.erros.sort((a, b) => a.linha - b.linha);
  return res;
}
