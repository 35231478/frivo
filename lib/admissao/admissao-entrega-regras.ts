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

/**
 * O `tipo` do contrato assinado nos anexos do colaborador. Começa com "_" de propósito: os
 * documentos que a EMPRESA pede têm ids escolhidos por ela, e este é do sistema — assim ele nunca
 * entra, por acidente, na conta de "documentos entregues" da admissão.
 *
 * Mora aqui, no módulo puro, porque a seção Documentos da ficha precisa dele para não mostrar o
 * contrato duas vezes: o PDF guardado manda, e a linha de "ver o texto" só aparece para quem
 * assinou antes desta leva (e por isso não tem o PDF).
 */
export const TIPO_CONTRATO_ASSINADO = "_contrato_assinado";
