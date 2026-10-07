import { LABELS_TIPO_EQUIPAMENTO } from "@/lib/utils";
import { opcoesCadastro } from "@/lib/cadastros/opcoes";

/** Valor do seletor para um tipo personalizado (sem chave do enum): "custom:<id>". */
export const PREFIXO_TIPO_CUSTOM = "custom:";

export interface TipoEquipamentoCadastro { id: string; nome: string; chaveEnum: string | null; ativo: boolean }
export interface OpcaoTipoEquipamento { value: string; label: string; descricao?: string }

/**
 * Opções do seletor de tipo de equipamento — a MESMA regra do SeletorCadastro (opcoesCadastro):
 * só tipos ATIVOS para nova escolha; o tipo atual do equipamento continua na lista mesmo inativo,
 * marcado “(inativo)” (antes a edição abria com o tipo vazio).
 * Os tipos padrão vêm do enum (valor = chave do enum); se a empresa já tem o cadastro dele, valem o
 * nome e o `ativo` do cadastro. Os personalizados usam "custom:<id>".
 */
export function opcoesTipoEquipamento(tipos: readonly TipoEquipamentoCadastro[], atual?: string | null): OpcaoTipoEquipamento[] {
  const porChave = new Map(tipos.filter((t) => t.chaveEnum).map((t) => [t.chaveEnum as string, t]));
  const itens = [
    ...Object.entries(LABELS_TIPO_EQUIPAMENTO).map(([chave, label]) => {
      const t = porChave.get(chave);
      return { id: chave, nome: t?.nome ?? label, ativo: t?.ativo ?? true, personalizado: false };
    }),
    ...tipos.filter((t) => !t.chaveEnum).map((t) => ({ id: `${PREFIXO_TIPO_CUSTOM}${t.id}`, nome: t.nome, ativo: t.ativo, personalizado: true })),
  ];
  return opcoesCadastro(itens, [atual]).map((o) => ({
    value: o.valor, label: o.rotulo, ...(o.item?.personalizado && { descricao: "personalizado" }),
  }));
}
