/**
 * AS ABAS DA CENTRAL DA OS e o PAINEL de Atividades — regra pura (sem React).
 *
 * As atividades da OS saíram da aba e viraram um PAINEL sempre visível, ao lado das abas (no
 * desktop) ou logo abaixo delas (no celular): o gestor entende "o dia da OS" de relance — quantas
 * atividades, quando, com quem e em que estado — sem trocar de aba. Sobraram 5 abas.
 *
 * Tudo que apontava para a aba "atividades" (os números-chave do cabeçalho, o "O que falta", os
 * links antigos ?aba=atividades e ?aba=formularios) agora leva ao painel: a tela rola até ele e o
 * destaca. As etapas com prazo (antiga aba "Prazos"), que viviam dentro de Atividades, moram no
 * Resumo. Os links antigos continuam abrindo (viram a aba que os absorveu), como sempre.
 */

export const ABAS_OS = ["resumo", "comercial", "materiais", "financeiro", "relatorios"] as const;
export type AbaOs = (typeof ABAS_OS)[number];

/** O id que, em vez de abrir uma aba, leva ao painel de Atividades */
export const PAINEL_ATIVIDADES = "atividades";

/** Links antigos e ids que mudaram de casa: para onde cada um vai */
const DESTINO_ANTIGO: Record<string, { aba: AbaOs; painel?: boolean }> = {
  geral: { aba: "resumo" }, historico: { aba: "resumo" },
  // a antiga aba Prazos (etapas com prazo) vive no Resumo
  prazos: { aba: "resumo" },
  // atividades e formulários respondidos: o painel
  atividades: { aba: "resumo", painel: true }, formularios: { aba: "resumo", painel: true },
  orcamentos: { aba: "comercial" }, orcamento: { aba: "comercial" },
  compras: { aba: "materiais" },
  anexos: { aba: "relatorios" },
};

export interface DestinoDaAba {
  /** A aba a mostrar (null = a aba atual não muda: o destino é só o painel) */
  aba: AbaOs | null;
  /** Rolar até o painel de Atividades e destacá-lo */
  painel: boolean;
}

/**
 * Para onde um clique na tela (número-chave, pendência, aba) ou um ?aba= do link leva.
 * `aoAbrir`: na carga da página a aba precisa de um valor; num clique, "atividades" não troca a aba.
 */
export function destinoDaAba(id: string | null | undefined, aoAbrir = false): DestinoDaAba {
  if (!id) return { aba: "resumo", painel: false };
  if ((ABAS_OS as readonly string[]).includes(id)) return { aba: id as AbaOs, painel: false };
  const antigo = DESTINO_ANTIGO[id];
  if (!antigo) return { aba: "resumo", painel: false };
  if (antigo.painel && !aoAbrir) return { aba: null, painel: true };
  return { aba: antigo.aba, painel: !!antigo.painel };
}

/** A aba que abre para um ?aba= do link (os antigos caem na que os absorveu) */
export const abaValida = (aba: string | null | undefined): AbaOs => destinoDaAba(aba, true).aba ?? "resumo";
