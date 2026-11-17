/**
 * MODELOS-EXEMPLO DE PARTIDA — um texto por tipo, para a empresa não começar de uma folha em branco.
 *
 * Por que isto existe: escrever do zero uma ficha de entrega de EPI ou um termo de responsabilidade
 * é o atrito que faz a empresa desistir do recurso e continuar no papel. O exemplo dá a forma — os
 * campos entre chaves já no lugar certo, a ordem que o RH espera — e a empresa edita o que quiser.
 *
 * O que o Frivo NÃO faz: validar cláusula. O sistema preenche os campos que conhece; o texto é da
 * empresa, e a responsabilidade pelo conteúdo é dela. Por isso todo exemplo vem com o AVISO abaixo,
 * dito na tela, e nenhum deles é aplicado sozinho: a pessoa escolhe usar.
 *
 * Os campos usados aqui são os mesmos de lib/documentos/modelos.ts (automáticos + os do tipo) — o
 * guard em tests/unit/documentos-exemplos.test.ts não deixa um exemplo citar campo que não existe.
 */

import type { TipoDocumento } from "@/lib/documentos/modelos";

/** O aviso que acompanha todo exemplo, na tela e no PR. Texto curto: a tela não é um contrato. */
export const AVISO_EXEMPLO =
  "Texto de partida, para editar. Revise com o seu contador ou advogado: o sistema preenche os "
  + "campos, não confere o conteúdo.";

export interface ModeloExemplo {
  tipo: TipoDocumento;
  /** O nome sugerido do modelo, se a pessoa ainda não escreveu um. */
  nome: string;
  texto: string;
}

const EPI = `{{empresa}}, inscrita no CNPJ {{empresaCnpj}}, entrega a {{nome}}, CPF {{cpf}}, cargo {{cargo}}, os equipamentos de proteção individual relacionados abaixo, em {{entregaEm}}.

Declaro ter recebido os equipamentos listados, em perfeito estado de uso e conservação, e ter sido treinado quanto ao uso correto, à guarda e à conservação de cada um deles.

Comprometo-me a usá-los durante toda a jornada de trabalho, a comunicar imediatamente qualquer dano, extravio ou alteração que os torne impróprios para uso, e a devolvê-los ao fim do contrato de trabalho.

Estou ciente de que o uso é obrigatório e de que a recusa injustificada constitui ato faltoso, nos termos da NR-6 e do artigo 158 da CLT.

{{cidade}}, {{data}}.`;

const TERMO = `{{empresa}}, inscrita no CNPJ {{empresaCnpj}}, entrega a {{nome}}, CPF {{cpf}}, cargo {{cargo}}, o material relacionado abaixo, em {{entregaEm}}, para uso exclusivo no trabalho.

Declaro ter recebido o material em perfeito estado de funcionamento e assumo a sua guarda e conservação enquanto estiver sob a minha responsabilidade.

Comprometo-me a usá-lo apenas para as atividades da função, a não emprestá-lo a terceiros e a comunicar imediatamente qualquer dano, defeito, furto ou extravio.

Devolverei o material em {{devolucaoEm}} ou no encerramento do contrato de trabalho, o que acontecer primeiro, nas mesmas condições em que o recebi, ressalvado o desgaste natural do uso.

{{cidade}}, {{data}}.`;

const ADVERTENCIA = `{{empresa}}, inscrita no CNPJ {{empresaCnpj}}, aplica a {{nome}}, CPF {{cpf}}, cargo {{cargo}}, a seguinte medida disciplinar: {{medida}}.

Motivo: {{motivo}}

Fato ocorrido em {{ocorridoEm}}.

Esta medida tem caráter pedagógico e visa corrigir a conduta descrita. A reincidência poderá levar a penalidade mais grave, nos termos da CLT.

Uma via deste documento fica arquivada no seu prontuário e outra é entregue ao colaborador.

{{cidade}}, {{data}}.`;

const ADITIVO = `Aditivo ao contrato de trabalho firmado entre {{empresa}}, CNPJ {{empresaCnpj}}, e {{nome}}, CPF {{cpf}}, CTPS {{ctps}}, admitido em {{admissao}}.

As partes acordam a seguinte alteração: {{alteracao}}.

Como era: {{valorAnterior}}
Como fica: {{valorNovo}}

A alteração vale a partir de {{vigenciaEm}}. As demais cláusulas do contrato permanecem inalteradas.

{{cidade}}, {{data}}.`;

const OUTRO = `{{empresa}}, inscrita no CNPJ {{empresaCnpj}}, declara, para os devidos fins, que {{nome}}, CPF {{cpf}}, exerce o cargo de {{cargo}} nesta empresa desde {{admissao}}, com jornada de {{jornada}}.

Declaração emitida a pedido do interessado.

{{cidade}}, {{data}}.`;

/** Um exemplo por tipo. A ordem é a de lib/documentos/modelos.ts. */
export const EXEMPLOS: ModeloExemplo[] = [
  { tipo: "EPI", nome: "Ficha de entrega de EPI", texto: EPI },
  { tipo: "TERMO", nome: "Termo de responsabilidade", texto: TERMO },
  { tipo: "ADVERTENCIA", nome: "Advertência escrita", texto: ADVERTENCIA },
  { tipo: "ADITIVO", nome: "Aditivo de contrato", texto: ADITIVO },
  { tipo: "OUTRO", nome: "Declaração de vínculo", texto: OUTRO },
];

export const exemploDoTipo = (tipo: string | null | undefined): ModeloExemplo | undefined =>
  EXEMPLOS.find((e) => e.tipo === tipo);
