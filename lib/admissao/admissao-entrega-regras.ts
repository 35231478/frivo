/**
 * A REGRA de quando a entrega ao contador existe — pura, para a tela e o servidor lerem a mesma
 * coisa. A tela nunca oferece um download que a rota recusaria.
 *
 * Fica fora de `admissao-entrega-server` de propósito: aquele módulo puxa o Prisma e o pdf-lib, e
 * um componente de tela não pode arrastar isso para o navegador.
 */

import type { SituacaoAdmissao } from "@/lib/admissao/admissao";

/**
 * De ASSINADO em diante. Antes disso a ficha sairia pela metade, e meia ficha no contador é pior
 * do que nenhuma.
 *
 * Marcar "Enviado ao contador" é o registro de que o RH mandou — não é o que destrava o download,
 * senão ele teria de marcar como enviado ANTES de conseguir baixar o que vai enviar.
 */
export const SITUACOES_COM_ENTREGA: readonly SituacaoAdmissao[] = ["ASSINADO", "ENVIADO_CONTADOR", "ADMITIDO"];

export const temEntrega = (situacao: string): boolean =>
  SITUACOES_COM_ENTREGA.includes(situacao as SituacaoAdmissao);
