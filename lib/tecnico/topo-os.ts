/**
 * O TOPO DA OS no app do técnico — regras PURAS. No topo fica o que fazer: o problema relatado, os equipamentos,
 * o contato (ligar / WhatsApp em 1 toque) e o endereço (rota em 1 toque). O dado de escritório (quem abriu, como a
 * OS chegou, prioridade, orientação…) vai para "Detalhes", recolhido.
 */
import { LABELS_PRIORIDADE } from "@/lib/utils";
import type { CartaoTela } from "@/lib/tecnico/offline/tipos";

/** tel: com só dígitos e "+"; vazio/curto = sem link */
export function linkTelefone(numero: string | null | undefined): string | null {
  const t = (numero ?? "").replace(/[^\d+]/g, "");
  return t.replace(/\D/g, "").length >= 8 ? `tel:${t}` : null;
}

/** wa.me com DDI (Brasil quando vier sem); número curto = sem link. Sem mensagem pronta: o técnico escreve. */
export function linkWhatsapp(numero: string | null | undefined): string | null {
  const d = (numero ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  return `https://wa.me/${d.length >= 12 ? d : `55${d}`}`;
}

const ORIGEM: Record<string, string> = { MANUAL: "Aberta pelo escritório", RECORRENTE: "Recorrente (contrato/PMOC)", PORTAL_CLIENTE: "Chamado do cliente" };
/** As prioridades que pedem destaque também no topo (as outras ficam só em "Detalhes") */
export const PRIORIDADE_DESTAQUE = new Set(["ALTA", "URGENTE", "CRITICO"]);

/** "Detalhes": o dado de escritório, na ordem em que interessa; só o que existe. */
export function detalhesDaOs(c: CartaoTela, op: { titulo?: string | null; verDados: boolean }): { rotulo: string; valor: string }[] {
  const itens: [string, string | null | undefined][] = [
    ["Atividade", op.titulo],
    ["Horário", c.hora ? `${c.hora}${c.duracaoMin ? ` · ${c.duracaoMin} min` : ""}` : null],
    ["Unidade", op.verDados ? c.unidade : null],
    ["Prioridade", LABELS_PRIORIDADE[c.prioridade] ?? c.prioridade],
    ["Origem", c.origem ? ORIGEM[c.origem] ?? c.origem : null],
    ["Aberta por", c.criadoPor],
    ["Visita", c.visita ? `${c.visita.numero} de ${c.visita.total}` : null],
    ["Orientação do escritório", (c.orientacao ?? "").trim() || null],
  ];
  return itens.filter((i): i is [string, string] => !!(i[1] ?? "").trim()).map(([rotulo, valor]) => ({ rotulo, valor }));
}

/** "3 equipamentos · 1 atendido" */
export function resumoEquipamentos(total: number, comecados: number, completos: number): string {
  if (!total) return "Nenhum equipamento";
  return `${total === 1 ? "1 equipamento" : `${total} equipamentos`} · ${andamentoEquipamentos(comecados, completos)}`;
}

/**
 * D14 — "1 começado · 0 completos": começado = tocado (marcado, respondido ou com foto); completo = sem nada faltando.
 * Antes, o começado já contava como "atendido" ("1 de 3 atendidos" com "Faltam 9" no mesmo equipamento).
 */
export function andamentoEquipamentos(comecados: number, completos: number): string {
  return `${comecados === 1 ? "1 começado" : `${comecados} começados`} · ${completos === 1 ? "1 completo" : `${completos} completos`}`;
}
export function contarAndamento(equipamentos: readonly { feito: boolean; completo: boolean; respostas?: Record<string, unknown>; fotos?: readonly unknown[] }[]) {
  let comecados = 0, completos = 0;
  for (const e of equipamentos) {
    const tocado = e.feito || Object.keys(e.respostas ?? {}).length > 0 || (e.fotos?.length ?? 0) > 0;
    if (tocado) comecados++;
    if (tocado && e.completo) completos++;
  }
  return { comecados, completos };
}
