/**
 * CHAT-1.1 — a FOTO do chat VINCULADA ao equipamento: regras PURAS (servidor, aparelho e testes). Sem IA: só o que a OS,
 * a atividade e o QR code dizem. Toda foto nasce ligada à OS da mensagem (sem OS, não há equipamento); dentro da OS, o
 * equipamento sai NESTA ordem:
 *  1. a OS tem UM equipamento → ele;
 *  2. (app) o técnico tem uma atividade EM ANDAMENTO nesta OS ligada a um equipamento → ele;
 *  3. (app) o QR code Frivo aparece na foto (lido no aparelho, com o leitor que o app já usa) → o equipamento dele, só
 *     se for da MESMA empresa e do MESMO cliente da OS; de outro cliente, fica como SUGESTÃO, sem vincular (de outra
 *     empresa, nem existe para quem busca);
 *  4. a OS tem vários e nada indica → quem envia escolhe (os chips + "Sem equipamento"); sem escolha, fica sem.
 * A escolha explícita de quem envia vale acima das automáticas (é quem está vendo o equipamento). A foto do escritório
 * segue só as regras 1 e 4. Corrigir ou tirar o vínculo depois fica registrado no histórico da OS — a mensagem em si
 * nunca se edita nem se apaga.
 */

export type OrigemEquipamentoFoto = "UNICO" | "ANDAMENTO" | "QR" | "ESCOLHA" | "CORRIGIDO";

/** Um equipamento como a foto mostra (o nome que o resto do sistema usa, e o detalhe que diferencia dois iguais) */
export interface EquipamentoFotoTela { id: string; titulo: string; detalhe?: string | null }

/** O QR lido na foto, já resolvido na empresa de quem envia */
export interface QrDaFoto { equipamentoId: string; mesmoCliente: boolean }

export interface VinculoFoto {
  equipamentoId: string | null;
  origem: OrigemEquipamentoFoto | null;
  /** QR de outro cliente: o equipamento sugerido (NÃO vinculado) */
  sugeridoId: string | null;
  /** A OS tem vários e nada indicou: a escolha fica com a pessoa (agora ou depois, corrigindo) */
  precisaEscolher: boolean;
}

export const SEM_VINCULO: VinculoFoto = { equipamentoId: null, origem: null, sugeridoId: null, precisaEscolher: false };

/**
 * O equipamento da foto. `escolha`: undefined = a pessoa não escolheu; null = escolheu "Sem equipamento"; id = escolheu
 * este. `emAndamento`: o equipamento da atividade em andamento do técnico nesta OS (já resolvido: um só).
 */
export function vinculoDaFoto(a: {
  origem: "APP" | "ESCRITORIO";
  temOs: boolean;
  equipamentosDaOs: readonly string[];
  emAndamento?: string | null;
  qr?: QrDaFoto | null;
  escolha?: string | null;
}): VinculoFoto {
  if (!a.temOs) return SEM_VINCULO;
  const doApp = a.origem === "APP";
  const qr = doApp ? a.qr ?? null : null;
  const sugeridoId = qr && !qr.mesmoCliente ? qr.equipamentoId : null;
  // A escolha explícita: um equipamento da OS (ou o do QR do mesmo cliente), ou "Sem equipamento"
  if (a.escolha !== undefined) {
    if (a.escolha === null) return { ...SEM_VINCULO, sugeridoId };
    const valida = a.equipamentosDaOs.includes(a.escolha) || (!!qr?.mesmoCliente && qr.equipamentoId === a.escolha);
    if (valida) return { equipamentoId: a.escolha, origem: "ESCOLHA", sugeridoId, precisaEscolher: false };
  }
  if (a.equipamentosDaOs.length === 1) return { equipamentoId: a.equipamentosDaOs[0], origem: "UNICO", sugeridoId, precisaEscolher: false };
  if (doApp && a.emAndamento && a.equipamentosDaOs.includes(a.emAndamento)) return { equipamentoId: a.emAndamento, origem: "ANDAMENTO", sugeridoId, precisaEscolher: false };
  if (qr?.mesmoCliente) return { equipamentoId: qr.equipamentoId, origem: "QR", sugeridoId: null, precisaEscolher: false };
  return { equipamentoId: null, origem: null, sugeridoId, precisaEscolher: a.equipamentosDaOs.length > 1 };
}

/** Das atividades em andamento do técnico nesta OS, o equipamento: um só; entre vários, o único ainda não atendido. */
export function equipamentoEmAndamento(vinculos: readonly { equipamentoId: string; feito: boolean }[]): string | null {
  const ids = [...new Set(vinculos.map((v) => v.equipamentoId))];
  if (ids.length === 1) return ids[0];
  const abertos = [...new Set(vinculos.filter((v) => !v.feito).map((v) => v.equipamentoId))];
  return abertos.length === 1 ? abertos[0] : null;
}

/** O "porquê" do vínculo (a dica do equipamento no balão) */
export const MOTIVO_EQUIPAMENTO: Record<OrigemEquipamentoFoto, string> = {
  UNICO: "Vinculada automaticamente: é o único equipamento da OS.",
  ANDAMENTO: "Vinculada automaticamente: o equipamento da atividade em andamento.",
  QR: "Vinculada automaticamente: o QR code do equipamento aparece na foto.",
  ESCOLHA: "Escolhido por quem enviou a foto.",
  CORRIGIDO: "Corrigido depois do envio (registrado no histórico da OS).",
};
export const ROTULO_SEM_EQUIPAMENTO = "Sem equipamento";
export const MSG_EQUIPAMENTO_FORA_DA_OS = "Este equipamento não é desta OS.";
export const MSG_FOTO_SEM_OS = "A foto sem OS não se vincula a equipamento.";
export const MSG_FOTO_NAO_ENCONTRADA = "Foto não encontrada.";

/** O texto do histórico da OS para a correção (de → para). Igual = nada a registrar. */
export function trilhaDaCorrecao(de: { id: string; nome: string } | null, para: { id: string; nome: string } | null): { acao: string; detalhes: string } | null {
  if ((de?.id ?? null) === (para?.id ?? null)) return null;
  if (!de) return { acao: "Foto do chat vinculada ao equipamento", detalhes: `${ROTULO_SEM_EQUIPAMENTO} → ${para!.nome}` };
  if (!para) return { acao: "Vínculo da foto do chat removido", detalhes: `${de.nome} → ${ROTULO_SEM_EQUIPAMENTO}` };
  return { acao: "Equipamento da foto do chat corrigido", detalhes: `${de.nome} → ${para.nome}` };
}
