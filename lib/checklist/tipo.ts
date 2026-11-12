/**
 * Checklist do tipo de equipamento — regras de edição (puras, testáveis).
 * A tela manda a LISTA inteira, na ordem: o servidor atualiza os itens que já existem, cria os
 * novos e INATIVA os que saíram (nunca apaga: as respostas antigas continuam apontando para eles).
 * Item de MEDIÇÃO: o técnico captura número + unidade (a unidade padrão vem daqui). Mudar o TIPO de
 * resposta de um item existente = item novo (o antigo é inativado com as respostas dele intactas).
 */
import { z } from "zod";

export const MAX_ITENS_CHECKLIST = 100;

export const TIPOS_RESPOSTA = ["OK_ATENCAO_NA", "MEDICAO"] as const;
export type TipoRespostaItem = (typeof TIPOS_RESPOSTA)[number];
/** Unidades sugeridas na tela (a empresa pode escrever outra) */
export const UNIDADES_SUGERIDAS = ["psi", "bar", "kgf/cm²", "°C", "A", "V", "Hz", "%", "m³/h", "Pa", "mm", "kW"];

export const itemChecklistSchema = z.object({
  id: z.string().min(1).optional(),
  texto: z.string().trim().min(2, "Escreva o texto do item.").max(300, "Texto do item com no máximo 300 caracteres."),
  tipoResposta: z.enum(TIPOS_RESPOSTA).default("OK_ATENCAO_NA"),
  unidade: z.string().trim().max(20, "Unidade com no máximo 20 caracteres.").nullable().optional(),
  pedirFoto: z.boolean().default(false),
  pedirObservacao: z.boolean().default(false),
}).strict().refine((i) => i.tipoResposta !== "MEDICAO" || !!i.unidade?.trim(), { message: "Informe a unidade da medição (ex.: psi, °C, A).", path: ["unidade"] });

export const checklistSchema = z.object({
  itens: z.array(itemChecklistSchema).max(MAX_ITENS_CHECKLIST, `No máximo ${MAX_ITENS_CHECKLIST} itens por checklist.`),
}).strict();

export type ItemChecklistEntrada = z.infer<typeof itemChecklistSchema>;
export interface ItemChecklistAtual { id: string; texto: string; pedirFoto: boolean; pedirObservacao: boolean; ordem: number; tipoResposta: TipoRespostaItem; unidade: string | null }

type ValoresItem = { texto: string; pedirFoto: boolean; pedirObservacao: boolean; ordem: number; tipoResposta: TipoRespostaItem; unidade: string | null };
export interface PlanoChecklist {
  atualizar: ({ id: string } & ValoresItem)[];
  criar: ValoresItem[];
  inativar: string[];
}

const chaveTexto = (t: string) => t.trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");

/**
 * Plano de gravação. `atuais` = itens ATIVOS do tipo. Item com `id` que não é dele (de outro tipo,
 * inativo ou inexistente) é recusado; texto repetido na lista também.
 * Só entra em `atualizar` o item que mudou (texto, foto, observação, unidade ou posição).
 */
export function planejarChecklist(atuais: ItemChecklistAtual[], itens: ItemChecklistEntrada[]):
  { ok: true; plano: PlanoChecklist } | { ok: false; erro: string } {
  const porId = new Map(atuais.map((a) => [a.id, a]));
  const vistos = new Set<string>();
  const usados = new Set<string>();
  const plano: PlanoChecklist = { atualizar: [], criar: [], inativar: [] };
  for (const [i, it] of itens.entries()) {
    const texto = it.texto.trim().replace(/\s+/g, " ");
    const chave = chaveTexto(texto);
    if (vistos.has(chave)) return { ok: false, erro: `Item repetido no checklist: “${texto}”.` };
    vistos.add(chave);
    const ordem = i + 1;
    const unidade = it.tipoResposta === "MEDICAO" ? it.unidade?.trim() || null : null;
    const valores: ValoresItem = { texto, pedirFoto: it.pedirFoto, pedirObservacao: it.pedirObservacao, ordem, tipoResposta: it.tipoResposta, unidade };
    if (it.id) {
      const atual = porId.get(it.id);
      if (!atual || usados.has(it.id)) return { ok: false, erro: "Item do checklist não encontrado neste tipo: recarregue a tela." };
      // Mudou o tipo de resposta: vira item novo; o antigo sai (inativado) com as respostas dele
      if (atual.tipoResposta !== it.tipoResposta) { plano.criar.push(valores); continue; }
      usados.add(it.id);
      const mudou = atual.texto !== texto || atual.pedirFoto !== it.pedirFoto || atual.pedirObservacao !== it.pedirObservacao || atual.ordem !== ordem
        || (atual.unidade ?? null) !== unidade;
      if (mudou) plano.atualizar.push({ id: it.id, ...valores });
    } else {
      plano.criar.push(valores);
    }
  }
  plano.inativar = atuais.filter((a) => !usados.has(a.id)).map((a) => a.id);
  return { ok: true, plano };
}
