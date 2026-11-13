/**
 * DESEMPENHO — do que foi medido no mês para o que as telas mostram: o ranking por perfil, a ficha
 * do colaborador e o resumo por equipe. Sem banco: recebe a medição e as regras e devolve a visão.
 *
 * VALORES EM REAIS: o bônus projetado e o valor das faixas só saem daqui quando `comValores` é
 * verdadeiro (a gestão, ou o colaborador vendo a própria ficha). O modo TV usa `paraTv`, que monta
 * a resposta campo a campo — o valor de ninguém passa por ele.
 */
import {
  calcularEscore, entradaDaGestao, entradaDoColaborador, mediaDaEquipe, ranquear,
  type AtividadeMedida, type Escore, type Faixa, type LinhaComposicao, type OsAvaliadaMedida, type PenalidadesQueContam, type Regra, type TipoPerfil,
} from "./regras";

export interface RegraDoMes extends Regra { vigenteDesde: string }
export interface PerfilDoMes { id: string; nome: string; tipo: TipoPerfil; ordem: number; regra: RegraDoMes | null }
export interface ParticipanteDoMes { tecnicoId: string; nome: string; perfilId: string }
export interface EquipeDoMes { id: string; nome: string; cor: string; liderId: string | null; lider: string | null; membros: string[] }

export interface Medicao {
  atividades: AtividadeMedida[];
  avaliacoes: Map<string, { media: number; avaliacoes: number }>;
  avaliadas: OsAvaliadaMedida[];
  penalidades: Map<string, PenalidadesQueContam>;
}

export interface LinhaRanking {
  tecnicoId: string; nome: string; posicao: number | null;
  escore: number | null; base: number | null; desconto: number;
  atingiuMeta: boolean; faixa: string | null;
  composicao: LinhaComposicao[];
  penalidades: Escore["penalidades"];
  /** Bônus projetado em reais; null = quem está vendo não pode ver valores */
  bonus: number | null;
}

export interface RegraNoPainel extends Omit<RegraDoMes, "faixas"> { faixas: { nome: string; minimo: number; valor: number | null }[] }
export interface GrupoRanking {
  perfil: { id: string; nome: string; tipo: TipoPerfil };
  /** null = o perfil não tem regra em vigor neste mês (ninguém é medido por ele) */
  regra: RegraNoPainel | null;
  linhas: LinhaRanking[];
}
export interface EquipeNoPainel { id: string; nome: string; cor: string; lider: string | null; escore: number | null; participantes: number; medidos: number }
export interface Painel { competencia: string; grupos: GrupoRanking[]; equipes: EquipeNoPainel[] }

const semEscore = (p: ParticipanteDoMes): Omit<LinhaRanking, "posicao"> => ({
  tecnicoId: p.tecnicoId, nome: p.nome, escore: null, base: null, desconto: 0, atingiuMeta: false, faixa: null, composicao: [],
  penalidades: { retornos: 0, reclamacoes: 0, pontosRetorno: 0, pontosReclamacao: 0 }, bonus: null,
});

const faixasVisiveis = (faixas: Faixa[], comValores: boolean) => faixas.map((f) => ({ nome: f.nome, minimo: f.minimo, valor: comValores ? f.valor : null }));

export function montarPainel(
  d: { competencia: string; perfis: PerfilDoMes[]; participantes: ParticipanteDoMes[]; equipes: EquipeDoMes[]; medicao: Medicao },
  comValores: boolean,
): Painel {
  const { medicao } = d;
  const escores = new Map<string, number | null>();
  const grupos: GrupoRanking[] = [...d.perfis].sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, "pt-BR")).map((perfil) => {
    const doPerfil = d.participantes.filter((p) => p.perfilId === perfil.id);
    const { regra } = perfil;
    const linhas = doPerfil.map((p): Omit<LinhaRanking, "posicao"> => {
      if (!regra) return semEscore(p);
      const penalidades = medicao.penalidades.get(p.tecnicoId);
      const entrada = perfil.tipo === "GESTAO"
        ? entradaDaGestao(lideradasPor(p.tecnicoId, d.equipes), medicao.atividades, medicao.avaliadas, penalidades, regra.exigirFotoAntesDepois)
        : entradaDoColaborador(p.tecnicoId, medicao.atividades, medicao.avaliacoes.get(p.tecnicoId), penalidades, regra.exigirFotoAntesDepois);
      const e = calcularEscore(regra, entrada);
      return {
        tecnicoId: p.tecnicoId, nome: p.nome, escore: e.escore, base: e.base, desconto: e.desconto, atingiuMeta: e.atingiuMeta,
        faixa: e.faixa?.nome ?? null, composicao: e.composicao, penalidades: e.penalidades, bonus: comValores ? e.bonus : null,
      };
    });
    for (const l of linhas) escores.set(l.tecnicoId, l.escore);
    return {
      perfil: { id: perfil.id, nome: perfil.nome, tipo: perfil.tipo },
      regra: regra ? { ...regra, faixas: faixasVisiveis(regra.faixas, comValores) } : null,
      linhas: ranquear(linhas),
    };
  });

  // Equipe = resumo dos escores individuais dos membros que participam (a base é sempre a pessoa)
  const equipes = d.equipes.map((e): EquipeNoPainel => {
    const participantes = e.membros.filter((id) => escores.has(id));
    const medidos = participantes.map((id) => escores.get(id)!).filter((x): x is number => x !== null);
    return { id: e.id, nome: e.nome, cor: e.cor, lider: e.lider, escore: mediaDaEquipe(medidos), participantes: participantes.length, medidos: medidos.length };
  }).sort((a, b) => (b.escore ?? -1) - (a.escore ?? -1) || a.nome.localeCompare(b.nome, "pt-BR"));

  return { competencia: d.competencia, grupos, equipes };
}

/** As equipes que o encarregado lidera e todos os membros delas. */
export function lideradasPor(tecnicoId: string, equipes: EquipeDoMes[]): { equipeIds: string[]; membros: string[] } {
  const minhas = equipes.filter((e) => e.liderId === tecnicoId);
  return { equipeIds: minhas.map((e) => e.id), membros: [...new Set(minhas.flatMap((e) => e.membros))] };
}

/** A linha de um colaborador no painel, com o perfil e a regra dele. */
export function linhaDoColaborador(painel: Painel, tecnicoId: string): { grupo: GrupoRanking; linha: LinhaRanking; participantes: number } | null {
  for (const grupo of painel.grupos) {
    const linha = grupo.linhas.find((l) => l.tecnicoId === tecnicoId);
    if (linha) return { grupo, linha, participantes: grupo.linhas.length };
  }
  return null;
}

/* ───────── modo TV ───────── */

export interface PremiacaoNaTela { id: string; titulo: string; descricao: string | null; perfil: string | null; temImagem: boolean }
export interface PainelTv {
  empresa: string;
  competencia: string;
  grupos: { perfil: string; linhas: { posicao: number | null; nome: string; escore: number | null; faixa: string | null }[] }[];
  premiacoes: PremiacaoNaTela[];
  atualizadoEm: string;
}

/**
 * O que a TV mostra: posição, nome, escore e faixa — e o prêmio em disputa. Montado campo a campo de
 * propósito: bônus, valor de faixa, composição e penalidades NÃO existem nesta resposta.
 */
export function paraTv(painel: Painel, extras: { empresa: string; premiacoes: PremiacaoNaTela[]; agora: Date }): PainelTv {
  return {
    empresa: extras.empresa,
    competencia: painel.competencia,
    grupos: painel.grupos.filter((g) => g.linhas.length > 0).map((g) => ({
      perfil: g.perfil.nome,
      linhas: g.linhas.map((l) => ({ posicao: l.posicao, nome: l.nome, escore: l.escore, faixa: l.faixa })),
    })),
    premiacoes: extras.premiacoes.map((p) => ({ id: p.id, titulo: p.titulo, descricao: p.descricao, perfil: p.perfil, temImagem: p.temImagem })),
    atualizadoEm: extras.agora.toISOString(),
  };
}
