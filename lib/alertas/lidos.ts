/**
 * O SINO — o que a pessoa já LEU. Regra pura, a mesma no servidor (/api/alertas), na tela e nos testes.
 *
 * Antes, tocar num aviso do sino só abria a tela: o número continuava igual (a maioria dos avisos é uma
 * situação — "3 etapas vencidas" — que só some quando alguém resolve). Agora o toque marca o aviso como
 * LIDO e o número do sino cai na hora; o aviso continua na lista, apagado, até sumir de verdade.
 *
 * Um jeito só para todos os avisos: o lido vale enquanto o aviso for o MESMO (a assinatura: a contagem e o
 * registro mais recente, quando há) e só no DIA em que foi lido (fuso de Brasília). Chegou um novo (a
 * contagem ou o registro mudou) ou virou o dia com o aviso ainda de pé: volta a contar.
 *
 * Guardado por usuário em preferencias_usuario (chave `sino:lidos`): vale em qualquer aparelho.
 */
import { z } from "zod";

export const CHAVE_SINO_LIDOS = "sino:lidos";

/**
 * Os avisos que fazem o NÚMERO do sino e, quando há, o campo com o registro mais recente (entra na
 * assinatura: um registro novo com a mesma contagem também volta a contar). As contas do dia não
 * entram (só o painel de pendências as mostra), nem a revisão chegando (só o painel de veículos).
 */
export const AVISOS_DO_NUMERO = {
  prazosVencidos: null, etapasVencendoHoje: null, atendimentosAtraso: null, chamadosPortal: null, pedidosPendentes: null,
  atendimentoVencendo: null, atendimentoEstourado: null,
  checklistPendente: null, checklistsComAlertas: null, checklistNaoVaiUsar: null, documentosVencendo: null, veiculosManutencao: null,
  boletosPagos: null, orcamentosRespondidos: "orcamentoRespondidoId", leadsSite: null, nfPedidos: "nfPedidoId",
  nfseAutorizadas: "nfseAutorizadaMedicaoId", nfseRejeitadas: "nfseRejeitadaMedicaoId", nfseAguardando: "nfseAguardandoMedicaoId",
  faturamentoContratos: null, reajustesContrato: null, separacoesPendentes: null, devolucoesPendentes: null,
  pmocsVencendo: null, pmocsExpirados: null,
  aceitesRessalva: "aceiteRessalvaOsId", aceitesConfirmados: "aceiteConfirmadoOsId", avaliacoesBaixas: "avaliacaoBaixaOsId",
  admissoesAssinadas: "admissaoAssinadaId", estoqueNegativoCampo: null, atividadesEsquecidas: "atividadeEsquecidaOsId",
  comentariosCampo: "comentarioCampoOsId", despesasCampo: null, osSemTecnico: "osSemTecnicoId", orcamentosVencendo: "orcamentoVencendoId",
  pedidosAtrasados: "pedidoAtrasadoOsId",
} as const;

export type AvisoDoNumero = keyof typeof AVISOS_DO_NUMERO;
export const ehAvisoDoNumero = (campo: string): campo is AvisoDoNumero => Object.prototype.hasOwnProperty.call(AVISOS_DO_NUMERO, campo);

/** A contagem do sino como a regra a lê: os números e os ids dos registros mais recentes */
export type DadosDoSino = Partial<Record<string, unknown>>;

const valorDe = (d: DadosDoSino, campo: AvisoDoNumero) => Math.max(0, Number(d[campo]) || 0);

/** A assinatura do aviso: muda quando chega um novo (outra contagem ou outro registro mais recente) */
export function assinaturaDoAviso(d: DadosDoSino, campo: AvisoDoNumero): string {
  const id = AVISOS_DO_NUMERO[campo];
  return `${valorDe(d, campo)}:${id ? String(d[id] ?? "") : ""}`;
}

/** O que foi lido: aviso → assinatura e dia (AAAA-MM-DD, Brasília) */
export type LidosDoSino = Partial<Record<AvisoDoNumero, { assinatura: string; dia: string }>>;

const entradaSchema = z.object({ assinatura: z.string().max(200), dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

/** Lê o guardado (JSON de preferencias_usuario) ficando só com o que é de HOJE; o resto é descartado */
export function lerLidos(guardado: unknown, hoje: string): LidosDoSino {
  if (!guardado || typeof guardado !== "object" || Array.isArray(guardado)) return {};
  const lidos: LidosDoSino = {};
  for (const [campo, v] of Object.entries(guardado)) {
    const e = entradaSchema.safeParse(v);
    if (ehAvisoDoNumero(campo) && e.success && e.data.dia === hoje) lidos[campo] = e.data;
  }
  return lidos;
}

export const estaLido = (lidos: LidosDoSino, d: DadosDoSino, campo: AvisoDoNumero, hoje: string) => {
  const e = lidos[campo];
  return !!e && e.dia === hoje && e.assinatura === assinaturaDoAviso(d, campo);
};

/** Marca o aviso como lido hoje (devolve o novo guardado, já sem o de outros dias) */
export function marcarLido(lidos: LidosDoSino, campo: AvisoDoNumero, assinatura: string, hoje: string): LidosDoSino {
  return { ...lerLidos(lidos, hoje), [campo]: { assinatura, dia: hoje } };
}

/** Todos os avisos do número (lidos ou não): decide se o sino mostra a lista ou "Nenhum alerta" */
export const totalDoSino = (d: DadosDoSino) => (Object.keys(AVISOS_DO_NUMERO) as AvisoDoNumero[]).reduce((s, c) => s + valorDe(d, c), 0);

/** O NÚMERO do sino: só o que ainda não foi lido */
export const numeroDoSino = (d: DadosDoSino, lidos: LidosDoSino, hoje: string) =>
  (Object.keys(AVISOS_DO_NUMERO) as AvisoDoNumero[]).reduce((s, c) => s + (estaLido(lidos, d, c, hoje) ? 0 : valorDe(d, c)), 0);

/** Os avisos lidos hoje que continuam valendo (a tela os mostra apagados) */
export const avisosLidos = (d: DadosDoSino, lidos: LidosDoSino, hoje: string) =>
  (Object.keys(lidos) as AvisoDoNumero[]).filter((c) => valorDe(d, c) > 0 && estaLido(lidos, d, c, hoje));
