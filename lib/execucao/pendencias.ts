/**
 * Execução da OS — o que falta para CONCLUIR (puro: usado pelo servidor para travar e pela tela para
 * mostrar). Regra:
 *  - pelo menos 1 equipamento ATENDIDO (vinculado e marcado como atendido);
 *  - em cada atendido, todo item ATIVO do checklist do tipo com resposta (OK / Atenção / Não se
 *    aplica; item de MEDIÇÃO = o número, ou "Não se aplica"); a foto e a observação que o item pede
 *    (dispensadas em "Não se aplica"); "Atenção" SEMPRE pede foto do item + observação (escrita ou
 *    em áudio) — o adm precisa ver o problema;
 *  - e, se o tipo tem formulário obrigatório para concluir (tipo de OS × tipo de equipamento), todos
 *    os campos ativos dele preenchidos — POR EQUIPAMENTO, contando o valor (não só a linha gravada).
 * Equipamento vinculado e NÃO atendido não trava: sai como "não atendido" no relatório.
 */

export type StatusItem = "OK" | "ATENCAO" | "NAO_SE_APLICA";
export const STATUS_ITEM: StatusItem[] = ["OK", "ATENCAO", "NAO_SE_APLICA"];
export const ROTULO_STATUS: Record<StatusItem, string> = { OK: "OK", ATENCAO: "Atenção", NAO_SE_APLICA: "Não se aplica" };

export type TipoResposta = "OK_ATENCAO_NA" | "MEDICAO";
export interface ItemExecucao {
  id: string; texto: string; pedirFoto: boolean; pedirObservacao: boolean; ativo: boolean;
  /** MEDICAO: o técnico só captura número + unidade (nada de avaliar se está bom ou ruim) */
  tipoResposta: TipoResposta;
  /** Unidade padrão da medição (psi, °C, A…) */
  unidade: string | null;
}
export interface RespostaItem {
  status: StatusItem | null;
  observacao: string | null;
  /** Medição: o número capturado e a unidade */
  valor: number | null;
  unidade: string | null;
  /** Tem observação em áudio (vale como observação) */
  audio: boolean;
}
export interface CampoExecucao { id: string; label: string; tipo: string; ativo: boolean }
export interface FormularioExecucao {
  id: string; nome: string; obrigatorioConcluir: boolean;
  campos: CampoExecucao[];
  respostas: Record<string, { resposta: string | null; arquivoUrl: string | null }>;
}
export interface EquipamentoParaPendencia {
  equipamentoId: string;
  titulo: string;
  feito: boolean;
  itens: ItemExecucao[];
  respostas: Record<string, RespostaItem>;
  /** Fotos por item do checklist (id do item → quantidade) */
  fotosPorItem: Record<string, number>;
  formulario: FormularioExecucao | null;
}

export interface FaltasEquipamento {
  semResposta: string[];
  semFoto: string[];
  semObservacao: string[];
  formulario: { nome: string; campos: string[] } | null;
}
export interface PendenciaEquipamento extends FaltasEquipamento { equipamentoId: string; titulo: string }

const preenchido = (v: string | null | undefined) => !!(v ?? "").trim();

/** O item tem resposta? Medição = tem o número; os demais = OK / Atenção / Não se aplica. */
export function respondido(it: Pick<ItemExecucao, "tipoResposta">, r: RespostaItem | undefined): boolean {
  if (!r) return false;
  if (r.status === "NAO_SE_APLICA") return true;
  return it.tipoResposta === "MEDICAO" ? r.valor !== null && Number.isFinite(r.valor) : !!r.status;
}

/** O que falta neste equipamento (vazio = completo). */
export function faltasEquipamento(e: EquipamentoParaPendencia): FaltasEquipamento {
  const f: FaltasEquipamento = { semResposta: [], semFoto: [], semObservacao: [], formulario: null };
  for (const it of e.itens) {
    if (!it.ativo) continue; // item removido do checklist do tipo não é mais exigido
    const r = e.respostas[it.id];
    if (r?.status === "NAO_SE_APLICA") continue;
    if (!respondido(it, r)) { f.semResposta.push(it.texto); continue; }
    const atencao = r!.status === "ATENCAO";
    if ((it.pedirFoto || atencao) && !(e.fotosPorItem[it.id] > 0)) f.semFoto.push(it.texto);
    if ((it.pedirObservacao || atencao) && !preenchido(r!.observacao) && !r!.audio) f.semObservacao.push(it.texto);
  }
  const form = e.formulario;
  if (form?.obrigatorioConcluir) {
    const campos = form.campos.filter((c) => c.ativo && !preenchido(form.respostas[c.id]?.resposta) && !preenchido(form.respostas[c.id]?.arquivoUrl)).map((c) => c.label);
    if (campos.length) f.formulario = { nome: form.nome, campos };
  }
  return f;
}

export const completo = (f: FaltasEquipamento) => !f.semResposta.length && !f.semFoto.length && !f.semObservacao.length && !f.formulario;

export interface ResultadoConclusao {
  ok: boolean;
  /** Nenhum equipamento atendido */
  semEquipamento: boolean;
  /** Só os atendidos com alguma falta */
  pendencias: PendenciaEquipamento[];
  atendidos: number;
  naoAtendidos: number;
  mensagem: string | null;
}

/** Lista curta: até 3 nomes entre aspas e "mais N". */
export function listaCurta(nomes: string[], max = 3): string {
  const q = nomes.slice(0, max).map((n) => `“${n}”`);
  const resto = nomes.length - q.length;
  return resto > 0 ? `${q.join(", ")} e mais ${resto}` : q.join(", ");
}

/** Texto do que falta num equipamento, numa linha. */
export function textoFaltas(f: FaltasEquipamento): string {
  const partes: string[] = [];
  const n = f.semResposta.length;
  if (n) partes.push(`${n === 1 ? "1 item sem resposta" : `${n} itens sem resposta`} (${listaCurta(f.semResposta)})`);
  if (f.semFoto.length) partes.push(`foto em ${listaCurta(f.semFoto)}`);
  if (f.semObservacao.length) partes.push(`observação em ${listaCurta(f.semObservacao)}`);
  if (f.formulario) partes.push(`formulário “${f.formulario.nome}”: ${listaCurta(f.formulario.campos)}`);
  return partes.join("; ");
}

export const MSG_SEM_EQUIPAMENTO = "Para concluir, vincule pelo menos 1 equipamento atendido (pelo QR Code ou pela lista da unidade) e responda o checklist dele.";

/** Pode concluir? Se não, o que falta — por equipamento, com mensagem pronta. */
export function verificarConclusao(equipamentos: EquipamentoParaPendencia[]): ResultadoConclusao {
  const atendidos = equipamentos.filter((e) => e.feito);
  const naoAtendidos = equipamentos.length - atendidos.length;
  if (!atendidos.length) {
    const extra = naoAtendidos ? ` Há ${naoAtendidos === 1 ? "1 equipamento vinculado" : `${naoAtendidos} equipamentos vinculados`} que ainda não ${naoAtendidos === 1 ? "foi atendido" : "foram atendidos"}.` : "";
    return { ok: false, semEquipamento: true, pendencias: [], atendidos: 0, naoAtendidos, mensagem: MSG_SEM_EQUIPAMENTO + extra };
  }
  const pendencias = atendidos
    .map((e) => ({ equipamentoId: e.equipamentoId, titulo: e.titulo, ...faltasEquipamento(e) }))
    .filter((p) => !completo(p));
  const mensagem = pendencias.length
    ? `Para concluir, falta: ${pendencias.map((p) => `${p.titulo} — ${textoFaltas(p)}`).join(" | ")}.`
    : null;
  return { ok: !pendencias.length, semEquipamento: false, pendencias, atendidos: atendidos.length, naoAtendidos, mensagem };
}

/** "Split Sala 3 (TAG AC-01)" — como o equipamento aparece nas mensagens de pendência. */
export function rotuloCurto(e: { titulo: string; tag: string | null; local?: string | null }) {
  const extra = e.tag ? `TAG ${e.tag}` : e.local;
  return extra ? `${e.titulo} (${extra})` : e.titulo;
}

/** Quantas fotos cada item do checklist tem (as gerais, sem item, não entram). */
export function contarFotosPorItem(fotos: { itemId: string | null }[]): Record<string, number> {
  const r: Record<string, number> = {};
  for (const f of fotos) if (f.itemId) r[f.itemId] = (r[f.itemId] ?? 0) + 1;
  return r;
}

/** Monta a entrada das regras a partir do equipamento como a tela/servidor o carregam. */
export function paraPendencia(x: {
  feito: boolean; equipamento: { id: string; titulo: string; tag: string | null; local: string | null };
  itens: ItemExecucao[]; respostas: Record<string, RespostaItem>; fotos: { itemId: string | null }[]; formulario: FormularioExecucao | null;
}): EquipamentoParaPendencia {
  return {
    equipamentoId: x.equipamento.id, titulo: rotuloCurto(x.equipamento), feito: x.feito, itens: x.itens, respostas: x.respostas,
    fotosPorItem: contarFotosPorItem(x.fotos), formulario: x.formulario,
  };
}
