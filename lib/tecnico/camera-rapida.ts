/**
 * CÂMERA RÁPIDA do app do técnico (fase 1 — sem IA): o técnico tira fotos à vontade, sem escrever
 * nada, e o app organiza. Este módulo é PURO: as regras que decidem, de forma determinística,
 *  1. como as fotos viram GRUPOS (janelas de tempo);
 *  2. de qual equipamento é cada grupo — só pelo QR fotografado; sem QR, NÃO se chuta: o grupo fica
 *     "a identificar" e espera o técnico;
 *  3. que gravações (as de sempre: vincular, foto antes/depois, foto do serviço) o grupo vira.
 * Tudo acontece no aparelho, sem rede.
 */
import type { NovaOperacao } from "@/lib/tecnico/offline/tipos";

/**
 * Intervalo que separa dois grupos. Fotos em rajada no mesmo equipamento saem com poucos segundos
 * entre uma e outra; passou disto sem foto, o técnico provavelmente foi para outra máquina — começa
 * outro grupo. É conservador de propósito: uma pausa longa na MESMA máquina só cria um grupo a mais
 * para confirmar; o erro que importa evitar é o contrário (juntar duas máquinas num grupo só).
 * Máquinas lado a lado, fotografadas sem pausa: o botão "Próximo equipamento" corta o grupo na hora.
 */
export const INTERVALO_GRUPO_MS = 30_000;

export type Momento = "ANTES" | "DEPOIS";
export const ROTULO_MOMENTO: Record<Momento, string> = { ANTES: "antes", DEPOIS: "depois" };

/** Uma foto tirada na câmera rápida, ainda no aparelho (a imagem fica guardada à parte, pelo `id`) */
export interface FotoRapida {
  /** Id gerado no aparelho — é o `clientId` da gravação: reenviar a mesma foto não duplica */
  id: string;
  /** Instante do disparo (ms) */
  em: number;
  momento: Momento;
  /** O QR lido NESTA foto (valor como está na etiqueta); null = a foto não mostra QR legível */
  qr: string | null;
  /** O técnico mandou começar outro grupo aqui ("Próximo equipamento", ou "Separar" na conferência) */
  corte?: boolean;
}

/** Para onde vai um grupo */
export type Destino =
  | { tipo: "equipamento"; equipamentoId: string; /** Quem disse: o QR fotografado ou o técnico */ por: "qr" | "tecnico" }
  | { tipo: "geral" };

/** Um grupo já gravado (as imagens saíram da guarda; fica o resumo para a conferência mostrar o ✓) */
export interface GrupoSalvo { id: string; destino: Destino; fotoIds: string[]; antes: number; depois: number; em: number }

/** O que o aparelho guarda da câmera rápida de UMA atividade */
export interface SessaoRapida { fotos: FotoRapida[]; salvos: GrupoSalvo[] }
export const SESSAO_VAZIA: SessaoRapida = { fotos: [], salvos: [] };

export interface GrupoRapido {
  /** O id da primeira foto (estável enquanto ela for a primeira) */
  id: string;
  fotos: FotoRapida[];
  inicio: number;
  fim: number;
  /** Os QR diferentes vistos no grupo, na ordem em que apareceram */
  qrs: string[];
}

/* ───────── 1. grupos por janela de tempo ───────── */

/**
 * Fotos em ordem de disparo; começa um grupo novo quando: é a primeira, ou o técnico cortou ali, ou
 * passou mais que `intervalo` desde a foto anterior.
 */
export function agrupar(fotos: FotoRapida[], intervalo: number = INTERVALO_GRUPO_MS): GrupoRapido[] {
  const emOrdem = fotos.map((f, i) => ({ f, i })).sort((a, b) => a.f.em - b.f.em || a.i - b.i).map((x) => x.f);
  const grupos: GrupoRapido[] = [];
  for (const f of emOrdem) {
    const atual = grupos[grupos.length - 1];
    if (!atual || f.corte || f.em - atual.fim > intervalo) grupos.push({ id: f.id, fotos: [f], inicio: f.em, fim: f.em, qrs: f.qr ? [f.qr] : [] });
    else {
      atual.fotos.push(f); atual.fim = f.em;
      if (f.qr && !atual.qrs.includes(f.qr)) atual.qrs.push(f.qr);
    }
  }
  return grupos;
}

/* ───────── 2. identidade: só pelo QR ───────── */

/** O valor lido parece uma etiqueta do sistema (link …/qr/<token> ou código QR-…)? */
export function pareceEtiqueta(valor: string): boolean {
  const v = valor.trim();
  return /\/qr\/[^/?#\s]+/.test(v) || /^QR-[\w-]+$/i.test(v);
}

export type Identidade =
  | { estado: "identificado"; equipamentoId: string }
  | {
    estado: "a-identificar";
    /** sem-qr: nenhuma etiqueta legível · etiqueta-desconhecida: etiqueta do sistema que não é de um
     *  equipamento daqui (avulsa, ainda sem equipamento) · dois-equipamentos: mais de uma etiqueta no grupo */
    motivo: "sem-qr" | "etiqueta-desconhecida" | "dois-equipamentos";
    /** A etiqueta avulsa fotografada (para etiquetar o equipamento novo com ela) */
    etiqueta?: string;
  };

/**
 * De quem é o grupo? Só há resposta quando as fotos mostram a etiqueta de UM equipamento conhecido
 * (`resolver` devolve o id do equipamento daquele QR, ou null). Qualquer dúvida — nenhuma etiqueta,
 * etiqueta que não é daqui, duas etiquetas — fica "a identificar". QR que não é etiqueta do sistema
 * (o da placa do fabricante, um link qualquer) é ignorado: não identifica nem atrapalha.
 */
export function identificar(grupo: Pick<GrupoRapido, "qrs">, resolver: (qr: string) => string | null): Identidade {
  const conhecidos = new Set<string>();
  const desconhecidas: string[] = [];
  for (const qr of grupo.qrs) {
    const id = resolver(qr);
    if (id) conhecidos.add(id);
    else if (pareceEtiqueta(qr)) desconhecidas.push(qr);
  }
  if (conhecidos.size === 1 && desconhecidas.length === 0) return { estado: "identificado", equipamentoId: [...conhecidos][0] };
  if (conhecidos.size + desconhecidas.length > 1) return { estado: "a-identificar", motivo: "dois-equipamentos" };
  if (desconhecidas.length === 1) return { estado: "a-identificar", motivo: "etiqueta-desconhecida", etiqueta: desconhecidas[0] };
  return { estado: "a-identificar", motivo: "sem-qr" };
}

export const MOTIVO_A_IDENTIFICAR: Record<Extract<Identidade, { estado: "a-identificar" }>["motivo"], string> = {
  "sem-qr": "Sem QR legível nas fotos.",
  "etiqueta-desconhecida": "A etiqueta fotografada ainda não é de um equipamento daqui.",
  "dois-equipamentos": "Duas etiquetas no mesmo grupo: separe na primeira foto do outro equipamento.",
};

/* ───────── 3. o que o grupo vira ───────── */

export const contarMomentos = (fotos: { momento: Momento }[]) => ({
  antes: fotos.filter((f) => f.momento === "ANTES").length,
  depois: fotos.filter((f) => f.momento === "DEPOIS").length,
});

/** "3 antes · 2 depois" (só o que houver) */
export function resumoMomentos(c: { antes: number; depois: number }): string {
  return [c.antes && `${c.antes} antes`, c.depois && `${c.depois} depois`].filter(Boolean).join(" · ");
}

/** A legenda que o técnico NÃO precisa escrever: equipamento + antes/depois */
export const legendaAutomatica = (equipamento: string, momento: Momento) => `${equipamento.trim() || "Equipamento"} — ${ROTULO_MOMENTO[momento]}`;
/** Foto que não é de um equipamento: vai para "Fotos do serviço", como Geral da OS */
export const legendaGeral = (momento: Momento) => `Câmera rápida — ${ROTULO_MOMENTO[momento]}`;

/**
 * As gravações de um grupo, nas operações que o app já tem (mesma fila, mesmas regras do servidor):
 *  - equipamento: `vincular` (só se ele ainda não está na OS) + uma `foto` por imagem, com antes/depois;
 *  - geral: uma `fotoOs` por imagem, sem equipamento, com a legenda automática.
 * O `clientId` de cada foto é o id dela no aparelho: reenviar não duplica.
 */
export function operacoesDoGrupo(
  atividadeId: string, fotos: { id: string; momento: Momento; dataUrl: string }[], destino: Destino, jaNaOs: boolean,
): NovaOperacao[] {
  if (!fotos.length) return [];
  if (destino.tipo === "geral") {
    return fotos.map((f) => ({ tipo: "fotoOs", atividadeId, dados: { dataUrl: f.dataUrl, equipamentoId: null, legenda: legendaGeral(f.momento), clientId: f.id } }));
  }
  const { equipamentoId } = destino;
  return [
    ...(jaNaOs ? [] : [{ tipo: "vincular" as const, atividadeId, equipamentoIds: [equipamentoId] }]),
    ...fotos.map((f) => ({ tipo: "foto" as const, atividadeId, equipamentoId, dados: { dataUrl: f.dataUrl, momento: f.momento, clientId: f.id } })),
  ];
}

/* ───────── a sessão guardada ───────── */

/** Corta o grupo: a foto `fotoId` passa a começar um grupo novo. */
export function separarEm(sessao: SessaoRapida, fotoId: string): SessaoRapida {
  return { ...sessao, fotos: sessao.fotos.map((f) => (f.id === fotoId ? { ...f, corte: true } : f)) };
}

/** Tira fotos da sessão (descartadas, ou já gravadas). O corte de uma foto retirada passa para a seguinte do grupo. */
export function semFotos(sessao: SessaoRapida, ids: string[]): SessaoRapida {
  const fora = new Set(ids);
  const grupos = agrupar(sessao.fotos);
  const fotos: FotoRapida[] = [];
  for (const g of grupos) {
    const restam = g.fotos.filter((f) => !fora.has(f.id));
    // O grupo continua separado do anterior mesmo que a primeira foto dele tenha saído
    restam.forEach((f, i) => fotos.push(i === 0 && grupos.indexOf(g) > 0 ? { ...f, corte: true } : f));
  }
  return { ...sessao, fotos };
}

/** O grupo foi gravado: as fotos saem da guarda e fica o resumo. */
export function comGrupoSalvo(sessao: SessaoRapida, grupo: GrupoRapido, destino: Destino, agora: number = Date.now()): SessaoRapida {
  const ids = grupo.fotos.map((f) => f.id);
  const salvo: GrupoSalvo = { id: grupo.id, destino, fotoIds: ids, ...contarMomentos(grupo.fotos), em: agora };
  return { ...semFotos(sessao, ids), salvos: [...sessao.salvos.filter((s) => s.id !== grupo.id), salvo] };
}
