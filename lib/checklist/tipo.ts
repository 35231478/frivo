/**
 * Checklist do tipo de equipamento — regras de edição (puras, testáveis).
 * A tela manda a LISTA inteira, na ordem: o servidor atualiza os itens que já existem, cria os
 * novos e INATIVA os que saíram (nunca apaga: as respostas antigas continuam apontando para eles).
 */
import { z } from "zod";

export const MAX_ITENS_CHECKLIST = 100;

export const itemChecklistSchema = z.object({
  id: z.string().min(1).optional(),
  texto: z.string().trim().min(2, "Escreva o texto do item.").max(300, "Texto do item com no máximo 300 caracteres."),
  tipoResposta: z.literal("OK_ATENCAO_NA").default("OK_ATENCAO_NA"),
  pedirFoto: z.boolean().default(false),
  pedirObservacao: z.boolean().default(false),
}).strict();

export const checklistSchema = z.object({
  itens: z.array(itemChecklistSchema).max(MAX_ITENS_CHECKLIST, `No máximo ${MAX_ITENS_CHECKLIST} itens por checklist.`),
}).strict();

export type ItemChecklistEntrada = z.infer<typeof itemChecklistSchema>;
export interface ItemChecklistAtual { id: string; texto: string; pedirFoto: boolean; pedirObservacao: boolean; ordem: number }

export interface PlanoChecklist {
  atualizar: { id: string; texto: string; pedirFoto: boolean; pedirObservacao: boolean; ordem: number }[];
  criar: { texto: string; pedirFoto: boolean; pedirObservacao: boolean; ordem: number }[];
  inativar: string[];
}

const chaveTexto = (t: string) => t.trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");

/**
 * Plano de gravação. `atuais` = itens ATIVOS do tipo. Item com `id` que não é dele (de outro tipo,
 * inativo ou inexistente) é recusado; texto repetido na lista também.
 * Só entra em `atualizar` o item que mudou (texto, foto, observação ou posição).
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
    const valores = { texto, pedirFoto: it.pedirFoto, pedirObservacao: it.pedirObservacao, ordem };
    if (it.id) {
      const atual = porId.get(it.id);
      if (!atual || usados.has(it.id)) return { ok: false, erro: "Item do checklist não encontrado neste tipo: recarregue a tela." };
      usados.add(it.id);
      const mudou = atual.texto !== texto || atual.pedirFoto !== it.pedirFoto || atual.pedirObservacao !== it.pedirObservacao || atual.ordem !== ordem;
      if (mudou) plano.atualizar.push({ id: it.id, ...valores });
    } else {
      plano.criar.push(valores);
    }
  }
  plano.inativar = atuais.filter((a) => !usados.has(a.id)).map((a) => a.id);
  return { ok: true, plano };
}
