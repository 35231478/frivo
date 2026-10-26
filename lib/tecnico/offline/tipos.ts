/**
 * App do técnico (offline-first) — tipos do lado do APARELHO. O retrato da atividade vem do servidor
 * (GET /api/tecnico/atividades/:id) e fica guardado no IndexedDB; cada gravação do técnico vira uma
 * OPERAÇÃO na fila (com id próprio). A tela mostra: retrato + operações ainda não confirmadas.
 */
import type { DispensaEquipamento, ItemExecucao, RespostaItem, ResultadoConclusao, FaltasEquipamento, FormularioExecucao } from "@/lib/execucao/pendencias";
import type { Operacao } from "@/lib/tecnico/sync";

export type { Operacao };
export type TipoOperacao = Operacao["tipo"];

export interface CartaoTela {
  atividadeId: string; osId: string; osNumero: string; titulo: string; tipoOs: { nome: string; cor: string } | null;
  status: string; prioridade: string; dataAgendada: string | null; dia: string | null; hora: string | null; duracaoMin: number | null;
  cliente: string; telefone: string | null; unidade: string | null; endereco: string; rota: string | null; descricao: string;
  equipamentos: number; atendidos: number; adicionais: number;
}

export interface EquipamentoInfo {
  id: string; titulo: string; descricao: string; fabricante: string; tag: string | null; numeroSerie: string | null;
  local: string | null; unidade: string | null; ativo: boolean; tipo: { id: string; nome: string } | null;
}
export interface EquipamentoUnidade extends EquipamentoInfo {
  tipoEquipamentoId: string | null;
  qr: { tokenPublico: string; codigo: string } | null;
}

export type ItemTela = ItemExecucao & { ordem: number };
export interface CampoFormularioTela { id: string; label: string; tipo: string; obrigatorio: boolean; ordem: number; opcoes: unknown; ativo: boolean }
export type RespostaTela = RespostaItem & { audioId: string | null; /** áudio gravado no aparelho, ainda não enviado */ audioLocal?: string | null };
export interface FotoTela {
  id: string | null; clientId: string | null; itemId: string | null; momento: "ANTES" | "DEPOIS" | null;
  /** Imagem guardada no aparelho (ainda não enviada) */
  local?: string;
  pendente?: boolean;
}
export interface EquipamentoTela {
  vinculoId: string | null;
  feito: boolean;
  observacao: string | null;
  equipamento: EquipamentoInfo;
  itens: ItemTela[];
  respostas: Record<string, RespostaTela>;
  fotos: FotoTela[];
  formulario: (Omit<FormularioExecucao, "campos"> & { campos: CampoFormularioTela[] }) | null;
  faltas: FaltasEquipamento;
  completo: boolean;
  /** Vinculado no aparelho, ainda não confirmado */
  pendente?: boolean;
}
export interface AdicionalTela {
  id: string | null; clientId: string | null; descricao: string; equipamentoId: string | null;
  statusCobranca: "A_AVALIAR" | "COBRAR" | "NAO_COBRAR";
  fotos: { id: string | null; clientId: string | null; local?: string }[];
  criadoPor: string | null;
  pendente?: boolean;
}
export interface ExecucaoTela {
  atividade: { id: string; titulo: string; status: string; tipoOs: { id: string; nome: string; cor: string } | null };
  os: { id: string; numero: string; status: string; clienteId: string; unidadeId: string | null };
  bloqueada: boolean;
  equipamentos: EquipamentoTela[];
  adicionais: AdicionalTela[];
  conclusao: ResultadoConclusao;
  /** Saída da exigência de equipamento (tipo, recorrente, justificada); ausente em retratos antigos */
  dispensaEquipamento?: DispensaEquipamento | null;
}

/** O que o servidor manda (e o aparelho guarda) de uma atividade */
export interface RetratoAtividade {
  cartao: CartaoTela;
  execucao: ExecucaoTela;
  equipamentosUnidade: EquipamentoUnidade[];
  checklistsPorTipo: Record<string, ItemTela[]>;
  geradoEm: string;
}

export type EstadoOperacao = "pendente" | "erro" | "enviada";
/** Operação na fila do aparelho */
export type OperacaoFila = Operacao & {
  seq?: number;
  criadoEm: string;
  estado: EstadoOperacao;
  tentativas: number;
  erro?: string | null;
  status?: number | null;
  /** Quando o servidor confirmou (fica aplicada na tela até chegar um retrato mais novo) */
  enviadaEm?: number | null;
};

/** Distribui o Omit pelos membros da união (o Omit comum junta tudo e perde o "tipo"). */
export type SemControle<T> = T extends unknown ? Omit<T, "id" | "em"> : never;
export type NovaOperacao = SemControle<Operacao>;
