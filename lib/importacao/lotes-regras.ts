/**
 * Lotes de importação (Implantação, leva 5) — a parte pura: o que cada cadastro é no lote, a ordem de apagar,
 * quem pode desfazer, os nomes dos vínculos e o ponto fixo de "o que pode ser apagado".
 *
 * Regra do desfazer:
 *  - apaga SÓ o que o lote CRIOU e que não tem nenhum vínculo fora do que o próprio desfazer apaga (OS, orçamento,
 *    contrato, movimentação, QR, foto…) e que não foi alterado depois da importação;
 *  - o que o lote só ATUALIZOU nunca é desfeito: só é listado;
 *  - o que fica sempre diz por quê.
 */
import type { Requisito } from "@/lib/cadastros/registro";
import { CADASTROS } from "@/lib/cadastros/registro";
import type { Acao } from "@/lib/permissoes";

export interface CadastroDoLote {
  /** Delegate do Prisma */
  delegate: string;
  /** Nome do model no schema (para as relações) */
  model: string;
  singular: string;
  plural: string;
  /** Apagar antes (filhos) → depois (pais) */
  ordem: number;
  /** Quem pode apagar um registro deste cadastro pelo desfazer */
  permissao: Requisito;
  /** Módulo da empresa (desligado = não apaga por aqui) */
  modulo?: string;
  /** O que falta, no motivo do "fica" ("você não tem permissão para …"); padrão: "excluir <plural>" */
  falta?: string;
  /**
   * Relações que a PRÓPRIA importação cria junto e que saem em cascata com o registro (ex.: as unidades cobertas
   * pelo contrato, o histórico "importado suspenso"): não contam como uso. Uma edição pela tela depois disso
   * marca o registro como "alterado depois desta importação" e ele fica.
   */
  ignorar?: string[];
}

export const CADASTROS_DO_LOTE: Record<string, CadastroDoLote> = {
  equipamentos: { delegate: "equipamento", model: "Equipamento", singular: "equipamento", plural: "equipamentos", ordem: 1, permissao: [["equipamentos", "excluir"]], modulo: "equipamentos" },
  veiculos: { delegate: "veiculo", model: "Veiculo", singular: "veículo", plural: "veículos", ordem: 1, permissao: [["veiculos", "excluir"]], modulo: "veiculos" },
  produtos: { delegate: "produto", model: "Produto", singular: "produto", plural: "produtos", ordem: 1, permissao: CADASTROS.produtos.permissoes.inativar, falta: "inativar produtos" },
  servicos: { delegate: "servico", model: "Servico", singular: "serviço", plural: "serviços", ordem: 1, permissao: CADASTROS.servicos.permissoes.inativar, falta: "inativar serviços" },
  fornecedores: { delegate: "fornecedor", model: "Fornecedor", singular: "fornecedor", plural: "fornecedores", ordem: 1, permissao: CADASTROS.fornecedores.permissoes.inativar, falta: "inativar fornecedores" },
  contatos: { delegate: "contatoCliente", model: "ContatoCliente", singular: "contato", plural: "contatos", ordem: 2, permissao: [["clientes", "excluir"]], falta: "excluir clientes" },
  unidades: { delegate: "unidade", model: "Unidade", singular: "unidade", plural: "unidades", ordem: 2, permissao: [["clientes", "excluir"]], falta: "excluir clientes" },
  colaboradores: { delegate: "tecnico", model: "Tecnico", singular: "colaborador", plural: "colaboradores", ordem: 2, permissao: [["equipes", "excluir"]] },
  tiposEquipamento: { delegate: "tipoEquipamentoCustom", model: "TipoEquipamentoCustom", singular: "tipo de equipamento", plural: "tipos de equipamento", ordem: 3, permissao: [["configuracoes", "gerenciar"]], falta: "gerenciar as configurações" },
  clientes: { delegate: "cliente", model: "Cliente", singular: "cliente", plural: "clientes", ordem: 3, permissao: [["clientes", "excluir"]] },
  cargos: { delegate: "cargo", model: "Cargo", singular: "cargo", plural: "cargos", ordem: 3, permissao: [["configuracoes", "gerenciar"]], falta: "gerenciar as configurações" },
  // Leva 6. Contrato: pela tela, "excluir" encerra (Contratos › Editar); aqui só sai o que o lote criou e ninguém usou
  contratos: { delegate: "contrato", model: "Contrato", singular: "contrato", plural: "contratos", ordem: 1, permissao: [["contratos", "editar"]], modulo: "contratos", falta: "editar contratos", ignorar: ["unidades", "historicoStatus"] },
  pmocs: { delegate: "pmoc", model: "Pmoc", singular: "plano PMOC", plural: "planos PMOC", ordem: 1, permissao: [["pmoc", "excluir"]], modulo: "pmoc", falta: "excluir planos PMOC", ignorar: ["equipamentos", "historico"] },
};

/** Tolerância entre o fim da gravação e o registro do lote (o lote é criado logo depois de gravar tudo) */
export const TOLERANCIA_ALTERADO_MS = 2000;

/** Nome de cada vínculo, no motivo do "fica". O que não está aqui vira o nome do campo em palavras. */
export const NOMES_VINCULO: Record<string, string> = {
  // COM-1: regra de comissão por serviço ou por cargo
  comissaoRegras: "regras de comissão",
  unidades: "unidades", contratos: "contratos", documentacaoEnvios: "envios de documentação", ordensServico: "ordens de serviço",
  anexos: "anexos", contatosCliente: "contatos", comunicacaoPreferencias: "preferências de comunicação", interacoes: "interações",
  orcamentos: "orçamentos", medicoes: "medições", contasReceber: "contas a receber", notasFiscais: "notas fiscais", pmocs: "PMOC",
  equipamentos: "equipamentos", ordensAbertas: "OS abertas pelo contato", orcamentosAc: "orçamentos", aceitesConfirmados: "aceites de OS",
  qrcode: "QR Code", atividades: "atividades de OS", respostasFormulario: "formulários respondidos", checklistRespostas: "checklists",
  fotosAtendimento: "fotos de atendimento", servicosAdicionais: "serviços adicionais", anexosOs: "anexos de OS",
  pmocCronogramas: "cronograma de PMOC", pmocExecucoes: "execuções de PMOC", pmocOcorrencias: "ocorrências de PMOC",
  desempenhoPenalidades: "penalidades de desempenho", contasPagar: "contas a pagar", recorrenciasPagar: "despesas recorrentes",
  notasCompra: "notas de compra", deParas: "vínculos com fornecedor", pedidosCompra: "pedidos de compra",
  orcamentoItens: "itens de orçamento", medicaoItens: "itens de medição", tabelaItens: "tabelas de preço", contratosPadrao: "contratos",
  notasFiscaisItens: "notas fiscais", osItens: "itens de OS", materiais: "materiais do serviço", pedidoItens: "pedidos de compra",
  movimentacoes: "movimentações de estoque", notaItens: "notas de compra", kitItens: "kits de material",
  servicoMateriais: "materiais padrão de serviço", orcamentoMateriais: "materiais de orçamento", osMateriais: "materiais de OS",
  colaboradores: "colaboradores", manutencoes: "manutenções", documentos: "documentos", checklists: "checklists",
  checklistsDiarios: "checklists diários", colaboradoresPadrao: "colaboradores com este veículo padrão", atividadesOs: "atividades de OS",
  clientesResponsavel: "clientes (responsável técnico)", contratosResponsavel: "contratos (responsável técnico)",
  atividadesEquipe: "atividades de OS", contratosRecorrencia: "contratos (técnico da recorrência)", orcamentosResponsavel: "orçamentos",
  empresasResponsavel: "responsável técnico da empresa", competencias: "competências", equipesLideradas: "equipes que lidera",
  equipesMembro: "equipes", veiculosResponsavel: "veículos sob responsabilidade", checklistsPreenchidos: "checklists",
  equipamentosMarcados: "equipamentos atendidos", respostasEquipamento: "formulários respondidos", folha: "custo de pessoal",
  posicao: "localização no mapa", pmocsResponsavel: "PMOC", desempenhoParticipante: "desempenho",
  desempenhoFechamentoLinhas: "fechamentos de desempenho", admissoes: "admissão digital", documentosEmitidos: "documentos emitidos",
  documentacaoItens: "envios de documentação", dependentes: "dependentes", formTypeMappings: "formulários do tipo",
  checklistItens: "itens de checklist do tipo", materiaisCampo: "materiais usados em campo", despesasCampo: "despesas de campo",
  relatorios: "relatórios", reajustes: "reajustes", historicoStatus: "histórico de situação", recorrenciasLocais: "recorrências por local",
  prazosAtendimento: "prazos de atendimento", execucoesFaturamento: "faturamentos do contrato", cronograma: "cronograma do PMOC",
  execucoes: "execuções do PMOC", historico: "histórico", ocorrencias: "ocorrências do PMOC", avisos: "avisos enviados",
};

export const nomeVinculo = (campo: string) =>
  NOMES_VINCULO[campo] ?? campo.replace(/([A-Z])/g, " $1").toLowerCase().trim();

/** "ordens de serviço: 3" / "QR Code" (o número depois do nome: sem errar o plural de "1") */
export const motivoVinculo = (campo: string, n: number | null) => (n == null ? nomeVinculo(campo) : `${nomeVinculo(campo)}: ${n}`);

/** Itens candidatos ao desfazer, na ordem de apagar (filhos antes dos pais; dentro do mesmo nível, como foram criados) */
export function ordemDeApagar<T extends { entidade: string }>(itens: T[]): T[] {
  return [...itens].sort((a, b) => (CADASTROS_DO_LOTE[a.entidade]?.ordem ?? 9) - (CADASTROS_DO_LOTE[b.entidade]?.ordem ?? 9));
}

/**
 * Ponto fixo do "pode apagar": começa com todos os candidatos e tira, a cada volta, os que têm motivo para ficar
 * considerando que só o que AINDA é candidato será apagado (ex.: a unidade em uso fica → o cliente dela também fica).
 * `motivos(candidatos)` devolve, por chave "entidade:id", os motivos de quem não pode sair.
 */
export async function pontoFixo(
  candidatos: string[], motivos: (restantes: Set<string>) => Promise<Map<string, string[]>>, maxVoltas = 10,
): Promise<{ apagar: Set<string>; ficam: Map<string, string[]> }> {
  let restantes = new Set(candidatos);
  const ficam = new Map<string, string[]>();
  for (let v = 0; v < maxVoltas; v++) {
    const m = await motivos(restantes);
    let mudou = false;
    for (const [k, ms] of m) {
      if (restantes.has(k) && ms.length) { restantes.delete(k); ficam.set(k, ms); mudou = true; }
    }
    if (!mudou) break;
    restantes = new Set(restantes);
  }
  return { apagar: restantes, ficam };
}

export const semPermissao = (entidade: string) => {
  const c = CADASTROS_DO_LOTE[entidade];
  return `você não tem permissão para ${c?.falta ?? `excluir ${c?.plural ?? entidade}`}`;
};

export const podeDesfazerCadastro = (entidade: string, pode: (m: string, a: Acao) => boolean) => {
  const req = CADASTROS_DO_LOTE[entidade]?.permissao;
  return !!req && req.some(([m, a]) => pode(m, a));
};

/** O mínimo de um lote que a lista precisa para dizer a situação */
export interface LoteSituacao { criados: number; atualizados: number; pendentes: number; apagados: number; desfeitoEm: string | null }

export type Situacao = "ativo" | "desfeito" | "parcial" | "so-atualizou";

/**
 * Situação do lote na lista:
 *  - "so-atualizou": não criou nada (só há o que listar, nada a desfazer);
 *  - "desfeito": já foi desfeito e nada do que ele criou sobrou por ele;
 *  - "parcial": foi desfeito, mas parte do que ele criou ficou (em uso) — dá para tentar de novo;
 *  - "ativo": nunca foi desfeito.
 */
export function situacaoDoLote(l: LoteSituacao): Situacao {
  if (l.criados === 0) return "so-atualizou";
  if (!l.desfeitoEm) return "ativo";
  return l.pendentes > 0 ? "parcial" : "desfeito";
}

export const ROTULO_SITUACAO: Record<Situacao, string> = {
  ativo: "", desfeito: "Desfeita", parcial: "Desfeita em parte", "so-atualizou": "Só atualizou",
};

/** "3 criados · 2 atualizados · 1 com erro · 4 avisos" (o que é zero não aparece, exceto quando tudo é zero) */
export function resumoContagens(l: { criados: number; atualizados: number; comErro: number; avisos: number }): string {
  const p = [
    l.criados ? `${l.criados} ${l.criados === 1 ? "criado" : "criados"}` : "",
    l.atualizados ? `${l.atualizados} ${l.atualizados === 1 ? "atualizado" : "atualizados"}` : "",
    l.comErro ? `${l.comErro} com erro` : "",
    l.avisos ? `${l.avisos} ${l.avisos === 1 ? "aviso" : "avisos"}` : "",
  ].filter(Boolean);
  return p.length ? p.join(" · ") : "nada gravado";
}
