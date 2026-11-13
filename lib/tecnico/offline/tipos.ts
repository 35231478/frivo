/**
 * App do técnico (offline-first) — tipos do lado do APARELHO. O retrato da atividade vem do servidor
 * (GET /api/tecnico/atividades/:id) e fica guardado no IndexedDB; cada gravação do técnico vira uma
 * OPERAÇÃO na fila (com id próprio). A tela mostra: retrato + operações ainda não confirmadas.
 */
import type { DispensaEquipamento, ItemExecucao, RespostaItem, ResultadoConclusao, FaltasEquipamento, FormularioExecucao } from "@/lib/execucao/pendencias";
import type { Operacao } from "@/lib/tecnico/sync";
import type { CadastroCampo } from "@/lib/tecnico/cadastro-equipamento";
import type { AvisoClienteRetrato, AvisosTela } from "@/lib/tecnico/aviso-cliente";
import type { AceiteRetrato } from "@/lib/os/aceite";
import type { MaterialPrevisto } from "@/lib/tecnico/o-que-levar";

export type { Operacao };
export type TipoOperacao = Operacao["tipo"];

export interface CartaoTela {
  atividadeId: string; osId: string; osNumero: string; titulo: string; tipoOs: { nome: string; cor: string } | null;
  status: string; prioridade: string; dataAgendada: string | null; dia: string | null; hora: string | null; duracaoMin: number | null;
  cliente: string; telefone: string | null; unidade: string | null; endereco: string; rota: string | null; descricao: string;
  equipamentos: number; atendidos: number; adicionais: number;
  /** A OS veio de um chamado do cliente: a descrição é o que ele pediu. Ausente em listas antigas */
  chamado?: boolean;
  /** O que o escritório escreveu para a visita (observação da atividade + observações da OS). Ausente em listas antigas */
  orientacao?: string;
  /** "A caminho" / "Cheguei" de hoje, como a lista baixou. Ausente em listas antigas */
  avisos?: AvisosTela;
  /** OS dividida em visitas diárias: qual é esta ("Visita 3 de 12"). Ausente = atividade comum */
  visita?: { numero: number; total: number };
  /** "O que levar": materiais previstos da OS. Ausente = opção da empresa desligada (ou lista antiga) */
  materiais?: MaterialPrevisto[];
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
  /** O escritório já avaliou a cobrança: o app trava a edição. A decisão em si (e o preço) não vem para o app */
  cobrancaDecidida?: boolean;
  /** Só em retratos antigos guardados no aparelho (o servidor não manda mais a decisão) */
  statusCobranca?: "A_AVALIAR" | "COBRAR" | "NAO_COBRAR";
  fotos: { id: string | null; clientId: string | null; local?: string }[];
  criadoPor: string | null;
  pendente?: boolean;
}
/** Foto do serviço (galeria da OS): equipamento da OS ou Geral (null) + legenda */
export interface FotoServicoTela {
  id: string | null; clientId: string | null; equipamentoId: string | null; legenda: string | null;
  /** Imagem guardada no aparelho (ainda não enviada) */
  local?: string;
  pendente?: boolean;
}
export interface ExecucaoTela {
  atividade: { id: string; titulo: string; status: string; tipoOs: { id: string; nome: string; cor: string } | null };
  os: { id: string; numero: string; status: string; clienteId: string; unidadeId: string | null };
  bloqueada: boolean;
  equipamentos: EquipamentoTela[];
  adicionais: AdicionalTela[];
  /** Fotos do serviço tiradas nesta atividade; ausente em retratos antigos */
  fotosServico?: FotoServicoTela[];
  conclusao: ResultadoConclusao;
  /** Saída da exigência de equipamento (tipo, recorrente, justificada); ausente em retratos antigos */
  dispensaEquipamento?: DispensaEquipamento | null;
  /** "A caminho" / "Cheguei" registrados hoje nesta atividade; ausente em retratos antigos */
  avisos?: AvisosTela;
  /** Aceite do cliente colhido NESTE aparelho (ainda na fila ou já enviado) */
  aceiteLocal?: { nome: string; em: string };
}

/** O que o servidor manda (e o aparelho guarda) de uma atividade */
export interface RetratoAtividade {
  cartao: CartaoTela;
  execucao: ExecucaoTela;
  equipamentosUnidade: EquipamentoUnidade[];
  checklistsPorTipo: Record<string, ItemTela[]>;
  /** Cadastro de equipamento em campo: null = permissão desligada; ausente em retratos antigos */
  cadastro?: CadastroCampo | null;
  /** Aviso ao cliente ("A caminho" / "Cheguei"): null = permissão desligada; ausente em retratos antigos */
  avisoCliente?: AvisoClienteRetrato | null;
  /** Aceite do cliente na conclusão da OS: null = não se aplica a quem está logado; ausente em retratos antigos */
  aceite?: AceiteRetrato | null;
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
