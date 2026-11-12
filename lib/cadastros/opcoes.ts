/**
 * Opções de um seletor de cadastro (regra única, usada pelo SeletorCadastro e pelas listas de
 * múltipla escolha):
 *  - para NOVA escolha só aparecem os ATIVOS;
 *  - o valor que o registro JÁ usa continua aparecendo mesmo inativo, marcado "(inativo)" —
 *    editar um registro antigo nunca mostra o campo vazio nem troca o valor sozinho;
 *  - valor gravado que não existe mais no cadastro (texto antigo) aparece como "(não cadastrado)";
 *  - produto e serviço com código aparecem "15 · Gás R410A" / "LIMP01 · Limpeza" (acha rápido).
 */
import { rotuloComCodigo } from "@/lib/cadastros/codigos";

export interface ItemCadastro { id: string; nome: string; ativo?: boolean | null; [k: string]: unknown }

export interface OpcaoCadastro<T extends ItemCadastro = ItemCadastro> {
  valor: string;
  rotulo: string;
  item: T | null;
  /** Inativo, mas é o valor atual do registro */
  inativo: boolean;
  /** Valor atual que não está no cadastro */
  avulso: boolean;
}

export function opcoesCadastro<T extends ItemCadastro>(
  itens: readonly T[], atuais: readonly (string | null | undefined)[], chave: "id" | "nome" = "id", opts: { feminino?: boolean } = {},
): OpcaoCadastro<T>[] {
  const marca = opts.feminino ? "(inativa)" : "(inativo)";
  const valorDe = (t: T) => String(t[chave]);
  const atual = new Set(atuais.filter((v): v is string => !!v));
  const ops: OpcaoCadastro<T>[] = [];
  for (const t of itens) {
    const ativo = t.ativo !== false;
    if (!ativo && !atual.has(valorDe(t))) continue; // inativo só fica se for o valor atual
    const nome = rotuloComCodigo(t.codigo as string | number | null | undefined, t.nome);
    ops.push({ valor: valorDe(t), rotulo: ativo ? nome : `${nome} ${marca}`, item: t, inativo: !ativo, avulso: false });
  }
  const conhecidos = new Set(ops.map((o) => o.valor));
  for (const v of atual) {
    if (!conhecidos.has(v) && !itens.some((t) => valorDe(t) === v)) {
      ops.push({ valor: v, rotulo: chave === "nome" ? `${v} (não cadastrada)` : "(cadastro removido)", item: null, inativo: false, avulso: true });
    }
  }
  return ops;
}
