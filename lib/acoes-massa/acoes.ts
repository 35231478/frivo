import { pode, type Acao, type Permissoes } from "@/lib/permissoes";

/**
 * Ações em massa — definição PURA (tela e servidor): quais ações cada lista oferece e qual
 * permissão cada uma exige. A permissão é a MESMA da ação individual (RBAC do C4); o servidor
 * confere de novo, por item, em /api/acoes-massa.
 *
 * Só ações reversíveis e seguras: inativar/reativar (soft-delete), exportar e gerar QR.
 * Exclusão definitiva em massa não existe de propósito.
 */

export const ENTIDADES = [
  "ordens", "equipamentos", "clientes", "orcamentos", "contratos", "veiculos", "colaboradores",
  // Cadastros padronizados (lib/cadastros/registro.ts)
  "produtos", "servicos", "cargos", "categorias-financeiras", "perfis-acesso", "modelos-encargos",
] as const;
export type Entidade = (typeof ENTIDADES)[number];

export const ACOES_ITEM = ["inativar", "reativar", "gerar-qr"] as const;
export type AcaoItem = (typeof ACOES_ITEM)[number];

/** Por requisição: acima disso o servidor recusa (evita timeout). A tela manda em partes menores. */
export const MAX_POR_REQUISICAO = 500;
/** Seleção máxima na tela (selecionar todos do filtro); o envio é dividido em partes. */
export const MAX_SELECAO = 2000;
/** Tamanho de cada parte enviada pela tela (para a barra de progresso andar). */
export const TAMANHO_PARTE = 50;
/** A partir daqui a confirmação pede para digitar a quantidade. */
export const LIMITE_CONFIRMACAO_REFORCADA = 50;

type Requisito = [modulo: string, acao: Acao];

export interface DefAcao {
  rotulo: string;
  /** Verbo no particípio para o resultado ("12 inativados") */
  feito: string;
  /** Basta UMA das permissões (igual à rota individual) */
  permissao: Requisito[];
  /** O que acontece, para o modal de confirmação */
  impacto: string;
  perigo?: boolean;
  /** Pede motivo (só onde ele é gravado: histórico da OS/contrato, observações de veículo/colaborador) */
  comMotivo?: boolean;
}

export interface DefEntidade {
  modulo: string;
  singular: string;
  plural: string;
  acoes: Partial<Record<AcaoItem, DefAcao>>;
}

export const ENTIDADE: Record<Entidade, DefEntidade> = {
  ordens: {
    modulo: "ordens", singular: "OS", plural: "OS",
    acoes: {
      inativar: {
        rotulo: "Cancelar (inativar)", feito: "canceladas", permissao: [["ordens", "excluir"]], perigo: true, comMotivo: true,
        impacto: "As OS viram CANCELADAS e saem da lista padrão (histórico, atividades e anexos ficam guardados). OS que já entraram no financeiro (medição) não são canceladas e aparecem no resultado com o motivo.",
      },
    },
  },
  equipamentos: {
    modulo: "equipamentos", singular: "equipamento", plural: "equipamentos",
    acoes: {
      inativar: { rotulo: "Inativar", feito: "inativados", permissao: [["equipamentos", "excluir"]], perigo: true, impacto: "Os equipamentos saem das listas e seletores. O histórico de atendimentos fica guardado e dá para reativar depois." },
      reativar: { rotulo: "Reativar", feito: "reativados", permissao: [["equipamentos", "editar"]], impacto: "Os equipamentos voltam às listas e seletores." },
      "gerar-qr": { rotulo: "Gerar QR Code", feito: "com QR", permissao: [["equipamentos", "editar"], ["equipamentos", "criar"]], impacto: "Cada equipamento sem QR ganha um QR novo já vinculado. Quem já tem QR fica como está. No fim, dá para imprimir as etiquetas." },
    },
  },
  clientes: {
    modulo: "clientes", singular: "cliente", plural: "clientes",
    acoes: {
      inativar: { rotulo: "Inativar", feito: "inativados", permissao: [["clientes", "excluir"]], perigo: true, impacto: "Os clientes saem da lista padrão e dos seletores. Nada é apagado (OS, contratos e financeiro ficam) e dá para reativar depois." },
      reativar: { rotulo: "Reativar", feito: "reativados", permissao: [["clientes", "editar"]], impacto: "Os clientes voltam à lista e aos seletores." },
    },
  },
  orcamentos: {
    modulo: "orcamentos", singular: "orçamento", plural: "orçamentos",
    acoes: {
      inativar: {
        rotulo: "Cancelar (inativar)", feito: "cancelados", permissao: [["orcamentos", "excluir"]], perigo: true,
        impacto: "Os orçamentos viram CANCELADOS (o link público mostra \"cancelado\" e os lembretes param). Orçamentos convertidos em contrato, no financeiro ou aprovados em execução não são cancelados e aparecem no resultado com o motivo.",
      },
      reativar: { rotulo: "Reabrir", feito: "reabertos", permissao: [["orcamentos", "editar"]], impacto: "Orçamentos cancelados voltam para RASCUNHO (editáveis). Os que não estão cancelados ficam como estão." },
    },
  },
  contratos: {
    modulo: "contratos", singular: "contrato", plural: "contratos",
    acoes: {
      inativar: {
        rotulo: "Suspender", feito: "suspensos", permissao: [["contratos", "editar"]], perigo: true, comMotivo: true,
        impacto: "Os contratos ficam SUSPENSOS (a mudança entra no histórico de status de cada um). Encerrados e cancelados não mudam. Dá para reativar depois.",
      },
      reativar: { rotulo: "Reativar", feito: "reativados", permissao: [["contratos", "editar"]], impacto: "Contratos SUSPENSOS voltam para ATIVO (com registro no histórico). Encerrados ou cancelados só pela tela do contrato." },
    },
  },
  veiculos: {
    modulo: "veiculos", singular: "veículo", plural: "veículos",
    acoes: {
      inativar: { rotulo: "Inativar", feito: "inativados", permissao: [["veiculos", "excluir"]], perigo: true, comMotivo: true, impacto: "Os veículos saem das listas e do checklist. Checklists, manutenções e documentos ficam guardados (a inativação é anotada nas observações)." },
      reativar: { rotulo: "Reativar", feito: "reativados", permissao: [["veiculos", "gerenciar"]], impacto: "Os veículos voltam às listas e ao checklist." },
    },
  },
  colaboradores: {
    modulo: "equipes", singular: "colaborador", plural: "colaboradores",
    acoes: {
      inativar: { rotulo: "Inativar", feito: "inativados", permissao: [["equipes", "excluir"]], perigo: true, comMotivo: true, impacto: "Os colaboradores saem das listas e dos seletores de técnico. Atividades, OS e equipes ficam como estão (reatribua o que estiver em aberto). Não bloqueia o login de quem também é usuário." },
      reativar: { rotulo: "Reativar", feito: "reativados", permissao: [["equipes", "gerenciar"]], impacto: "Os colaboradores voltam às listas e seletores." },
    },
  },
  // Cadastros padronizados: inativar/reativar com a permissão do registro (lib/cadastros/registro.ts)
  produtos: acoesCadastro("produto", "produtos"),
  servicos: acoesCadastro("serviço", "serviços"),
  cargos: acoesCadastro("cargo", "cargos"),
  "categorias-financeiras": acoesCadastro("categoria", "categorias", true),
  // Travas de cada um (perfil padrão, o próprio perfil, modelo padrão) valem por item no lote
  "perfis-acesso": acoesCadastro("perfil de acesso", "perfis de acesso"),
  "modelos-encargos": acoesCadastro("modelo de encargos", "modelos de encargos", false, ["financeiro", "folha"]),
};

/** Ações em massa de um cadastro padronizado: inativar/reativar com a permissão do registro. */
function acoesCadastro(singular: string, plural: string, feminino = false, requisito: Requisito = ["configuracoes", "gerenciar"]): DefEntidade {
  const o = feminino ? "as" : "os";
  return {
    modulo: requisito[0], singular, plural,
    acoes: {
      inativar: {
        rotulo: "Inativar", feito: `inativad${o}`, permissao: [requisito], perigo: true,
        impacto: `${feminino ? "As" : "Os"} ${plural} saem das listas e dos seletores para novas escolhas. Nada é apagado: os registros que já ${feminino ? "as" : "os"} usam continuam iguais e dá para reativar depois.`,
      },
      reativar: { rotulo: "Reativar", feito: `reativad${o}`, permissao: [requisito], impacto: `${feminino ? "As" : "Os"} ${plural} voltam às listas e aos seletores.` },
    },
  };
}

/** Exportar: ver a lista + "Relatórios › Exportar". */
export function requisitosExportar(entidade: Entidade): Requisito[][] {
  return [[[ENTIDADE[entidade].modulo, "visualizar"]], [["relatorios", "exportar"]]];
}

export function podeAcao(permissoes: Permissoes | null | undefined, role: string | undefined, entidade: Entidade, acao: AcaoItem) {
  const def = ENTIDADE[entidade].acoes[acao];
  return !!def && def.permissao.some(([m, a]) => pode(permissoes, m, a, role));
}

export function podeExportar(permissoes: Permissoes | null | undefined, role: string | undefined, entidade: Entidade) {
  return requisitosExportar(entidade).every((grupo) => grupo.some(([m, a]) => pode(permissoes, m, a, role)));
}

export function podeVerLista(permissoes: Permissoes | null | undefined, role: string | undefined, entidade: Entidade) {
  return pode(permissoes, ENTIDADE[entidade].modulo, "visualizar", role);
}

/** O perfil tem alguma ação em massa nesta lista? (sem nenhuma, a lista não mostra checkboxes) */
export function temAcaoMassa(permissoes: Permissoes | null | undefined, role: string | undefined, entidade: Entidade) {
  return podeExportar(permissoes, role, entidade) || ACOES_ITEM.some((a) => podeAcao(permissoes, role, entidade, a));
}
