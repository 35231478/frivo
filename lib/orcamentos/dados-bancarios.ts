/**
 * Dados bancários da empresa para o orçamento do cliente — puxados do cadastro da empresa
 * (Configurações › Dados da empresa), nunca digitados de novo. Sem conta (banco + conta) e sem
 * PIX, não há bloco: o documento não mostra nada (nem campo vazio).
 */
export interface EmpresaBanco {
  nome: string;
  cnpj: string;
  bancoNome?: string | null;
  bancoAgencia?: string | null;
  bancoConta?: string | null;
  bancoTipoConta?: string | null;
  bancoTitular?: string | null;
  pixChave?: string | null;
}

/** "conta" = banco/agência/conta (coluna da esquerda); "favorecido" = titular, CNPJ e PIX (direita) */
export interface LinhaBanco { rotulo: string; valor: string; coluna: "conta" | "favorecido" }

const t = (v: string | null | undefined) => (v ?? "").trim();

export function linhasDadosBancarios(e: EmpresaBanco, formatarDoc: (d: string) => string = (d) => d): LinhaBanco[] | null {
  const temConta = !!(t(e.bancoNome) && t(e.bancoConta));
  const temPix = !!t(e.pixChave);
  if (!temConta && !temPix) return null;
  const linhas: LinhaBanco[] = [];
  if (temConta) {
    linhas.push({ rotulo: "Banco", valor: t(e.bancoNome), coluna: "conta" });
    if (t(e.bancoAgencia)) linhas.push({ rotulo: "Agência", valor: t(e.bancoAgencia), coluna: "conta" });
    linhas.push({ rotulo: t(e.bancoTipoConta) ? `Conta ${t(e.bancoTipoConta).toLowerCase()}` : "Conta", valor: t(e.bancoConta), coluna: "conta" });
  }
  linhas.push({ rotulo: "Titular", valor: t(e.bancoTitular) || e.nome, coluna: "favorecido" });
  linhas.push({ rotulo: "CNPJ", valor: formatarDoc(e.cnpj), coluna: "favorecido" });
  if (temPix) linhas.push({ rotulo: "Chave PIX", valor: t(e.pixChave), coluna: "favorecido" });
  return linhas;
}
