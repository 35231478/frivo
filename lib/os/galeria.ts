/**
 * Fotos & Anexos do serviço (aba "Relatórios & Anexos" da OS) — regras PURAS, as mesmas no
 * servidor, na tela e nos testes. Junta num lugar só as fotos da EXECUÇÃO (checklist/antes/depois,
 * já ligadas ao equipamento), as fotos dos SERVIÇOS ADICIONAIS e as fotos enviadas pelas equipes
 * (escritório e app do técnico), e organiza POR EQUIPAMENTO + "Geral da OS". Arquivo que não é
 * imagem (PDF, planilha...) é DOCUMENTO: seção à parte, sem equipamento.
 */

export type OrigemFoto = "EXECUCAO" | "ADICIONAL" | "ANEXO";

/** "Geral da OS": a foto não é de um equipamento específico */
export const REFERENCIA_GERAL = "GERAL";
export const LEGENDA_MIN = 2;
export const LEGENDA_MAX = 200;
export const MSG_REFERENCIA = "Escolha a que a foto se refere: um equipamento da OS ou “Geral da OS”.";
export const MSG_LEGENDA = `Escreva uma legenda para a foto (de ${LEGENDA_MIN} a ${LEGENDA_MAX} caracteres).`;
export const MSG_EQUIPAMENTO_FORA = "Este equipamento não é desta OS: escolha um dos equipamentos da OS ou “Geral da OS”.";

export interface EquipamentoGaleria { id: string; titulo: string; detalhe: string | null }
export interface FotoGaleria {
  /** Única na galeria (o id sozinho pode repetir entre origens) */
  chave: string;
  origem: OrigemFoto;
  id: string;
  /** Onde a imagem é servida (miniatura e lightbox) */
  src: string;
  /** Para baixar (mesmo endereço; anexo baixa como arquivo) */
  baixar: string;
  legenda: string;
  equipamentoId: string | null;
  atividade: { id: string; titulo: string; aberta: boolean } | null;
  /** Item do checklist da foto (execução) */
  item: string | null;
  momento: "ANTES" | "DEPOIS" | null;
  enviadoPor: string | null;
  enviadoEm: string;
  /** Anexo antigo, enviado antes de existir a referência (sem equipamento e sem legenda) */
  semReferencia?: boolean;
  /** A legenda automática da foto (legendaDoSistema), para "Restaurar legenda do sistema"; null/ausente: não tem */
  legendaSistema?: string | null;
}
export interface DocumentoGaleria {
  id: string; nome: string; tipo: string; tamanho: number; legenda: string | null;
  enviadoPor: string | null; enviadoEm: string; src: string; baixar: string;
}
export interface Galeria {
  equipamentos: EquipamentoGaleria[];
  fotos: FotoGaleria[];
  documentos: DocumentoGaleria[];
}
export interface SecaoGaleria {
  /** id do equipamento, ou REFERENCIA_GERAL */
  chave: string;
  titulo: string;
  detalhe: string | null;
  geral: boolean;
  fotos: FotoGaleria[];
}

/** Legenda de uma foto da execução, que não tem legenda digitada: diz de onde ela é. */
export function legendaExecucao(f: { momento: "ANTES" | "DEPOIS" | null; item: string | null }): string {
  if (f.item) return `Checklist: ${f.item}`;
  if (f.momento === "ANTES") return "Antes do serviço";
  if (f.momento === "DEPOIS") return "Depois do serviço";
  return "Foto do atendimento";
}

/**
 * A LEGENDA DO SISTEMA de uma foto: a automática, que vale enquanto ninguém escreve outra — a da
 * execução que diz de onde a foto é (item do checklist, antes/depois) e a do serviço adicional (a
 * descrição do serviço). Foto da execução sem momento nem item ("Foto do atendimento") e foto
 * enviada (anexo: a legenda é a que foi escrita no envio) não têm: null.
 */
export function legendaDoSistema(f: { origem: OrigemFoto; momento?: "ANTES" | "DEPOIS" | null; item?: string | null; servico?: string | null }): string | null {
  if (f.origem === "EXECUCAO") return f.item || f.momento ? legendaExecucao({ momento: f.momento ?? null, item: f.item ?? null }) : null;
  if (f.origem === "ADICIONAL") return f.servico ? legendaAdicional(f.servico) : null;
  return null;
}

/** O botão "Restaurar legenda do sistema" aparece só quando há uma legenda do sistema para voltar. */
export const podeRestaurarLegenda = (f: Pick<FotoGaleria, "legenda" | "legendaSistema">) => !!f.legendaSistema && f.legenda !== f.legendaSistema;
export const MSG_SEM_LEGENDA_SISTEMA = "Esta foto não tem legenda do sistema para restaurar.";

/** Foto enviada à OS sem legenda (anexo antigo) */
export const LEGENDA_ANEXO_SEM = "Foto enviada (sem legenda)";

export const legendaAdicional = (descricao: string) => `Serviço adicional: ${descricao}`;

/** A foto (imagem) ou documento? Pelo tipo conferido no upload. */
export const ehImagem = (tipo: string) => tipo.startsWith("image/");

/**
 * QUEM EDITA A LEGENDA de uma foto da OS (aba Relatórios; no app, as fotos do serviço):
 *  - o escritório, com "OS › Editar": sempre (também com a OS concluída: a legenda é o texto do relatório);
 *  - o técnico (modo técnico, só as atividades dele): enquanto a OS não estiver concluída ou cancelada.
 */
export const MSG_LEGENDA_OS_ENCERRADA = "A OS já foi encerrada: a legenda agora só pode ser mudada pelo escritório.";
export const MSG_LEGENDA_SEM_PERMISSAO = "Sem permissão para editar a OS.";
export function motivoSemEditarLegenda(q: { restrito: boolean; podeEditarOs: boolean; osEncerrada: boolean }): string | null {
  if (q.restrito) return q.osEncerrada ? MSG_LEGENDA_OS_ENCERRADA : null;
  return q.podeEditarOs ? null : MSG_LEGENDA_SEM_PERMISSAO;
}

/** Legenda digitada: sem espaços sobrando; null se inválida. */
export function limparLegenda(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t.length >= LEGENDA_MIN && t.length <= LEGENDA_MAX ? t : null;
}

/**
 * Uma seção por equipamento da OS (na ordem da OS, todos — o vazio mostra que falta foto dele) e
 * "Geral da OS" por último. Foto de um equipamento que não está mais na lista (desvinculado) ganha
 * a seção dele mesmo assim: a foto nunca some. Dentro da seção, da mais antiga para a mais nova.
 */
export function agruparGaleria(g: Pick<Galeria, "equipamentos" | "fotos">): SecaoGaleria[] {
  const ordenadas = [...g.fotos].sort((a, b) => a.enviadoEm.localeCompare(b.enviadoEm) || a.chave.localeCompare(b.chave));
  const secoes = new Map<string, SecaoGaleria>();
  for (const e of g.equipamentos) secoes.set(e.id, { chave: e.id, titulo: e.titulo, detalhe: e.detalhe, geral: false, fotos: [] });
  const geral: SecaoGaleria = { chave: REFERENCIA_GERAL, titulo: "Geral da OS", detalhe: "Fotos que não são de um equipamento específico", geral: true, fotos: [] };
  for (const f of ordenadas) {
    if (!f.equipamentoId) { geral.fotos.push(f); continue; }
    let s = secoes.get(f.equipamentoId);
    if (!s) {
      s = { chave: f.equipamentoId, titulo: "Equipamento fora da OS", detalhe: "Não está mais vinculado a esta OS", geral: false, fotos: [] };
      secoes.set(f.equipamentoId, s);
    }
    s.fotos.push(f);
  }
  return [...secoes.values(), geral];
}

/** Nome de arquivo para baixar a foto, a partir da legenda. */
export function nomeArquivoFoto(legenda: string, id: string): string {
  const base = legenda.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 60);
  return `${base || "foto"}-${id.slice(-6)}.jpg`;
}
