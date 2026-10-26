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

export interface LinhaBanco { rotulo: string; valor: string }

const t = (v: string | null | undefined) => (v ?? "").trim();

export function linhasDadosBancarios(e: EmpresaBanco, formatarDoc: (d: string) => string = (d) => d): LinhaBanco[] | null {
  const temConta = !!(t(e.bancoNome) && t(e.bancoConta));
  const temPix = !!t(e.pixChave);
  if (!temConta && !temPix) return null;
  const linhas: LinhaBanco[] = [];
  if (temConta) {
    linhas.push({ rotulo: "Banco", valor: t(e.bancoNome) });
    if (t(e.bancoAgencia)) linhas.push({ rotulo: "Agência", valor: t(e.bancoAgencia) });
    linhas.push({ rotulo: t(e.bancoTipoConta) ? `Conta ${t(e.bancoTipoConta).toLowerCase()}` : "Conta", valor: t(e.bancoConta) });
  }
  linhas.push({ rotulo: "Titular", valor: `${t(e.bancoTitular) || e.nome} — CNPJ ${formatarDoc(e.cnpj)}` });
  if (temPix) linhas.push({ rotulo: "Chave PIX", valor: t(e.pixChave) });
  return linhas;
}
