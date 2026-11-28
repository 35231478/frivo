/**
 * EDITAR A LEGENDA de uma foto da OS — uma ação só, para a aba Relatórios (escritório, PATCH
 * /api/ordens/[id]/fotos/[fotoId]) e para o app do técnico (operação `fotoOsLegenda` da sincronização).
 *
 * As três origens da galeria (lib/os/galeria): EXECUCAO (checklist, antes/depois), ADICIONAL (serviço
 * adicional) e ANEXO (enviada à OS, pelo escritório ou pelo app). Quem pode: lib/os/galeria ›
 * motivoSemEditarLegenda. No modo técnico, a foto tem de ser de uma atividade dele.
 * Fica no histórico da OS: quem mudou, a legenda de antes e a nova.
 *
 * RESTAURAR A LEGENDA DO SISTEMA (restaurarLegendaFoto): apaga a legenda escrita e a foto volta à
 * automática (lib/os/galeria › legendaDoSistema). Mesmas permissões e a mesma trilha da edição.
 */
import { prisma } from "@/lib/prisma";
import { carregarContexto, type Ator } from "@/lib/execucao/contexto";
import type { ResultadoAcao } from "@/lib/execucao/acoes";
import { osEncerrada } from "@/lib/os/prazo-execucao";
import {
  LEGENDA_ANEXO_SEM, MSG_LEGENDA, MSG_SEM_LEGENDA_SISTEMA, legendaDoSistema, limparLegenda, motivoSemEditarLegenda, type OrigemFoto,
} from "@/lib/os/galeria";

export interface PedidoLegenda {
  origem: OrigemFoto;
  /** O id da foto, ou o id gerado no aparelho (foto do app ainda sem id do servidor) */
  fotoId?: string;
  clientId?: string;
  legenda: unknown;
  /** Só as fotos desta atividade (a operação do app vem de uma atividade) */
  atividadeId?: string;
}

/** O mesmo formato das ações da execução (lib/execucao/acoes): a sincronização do app usa direto */
type Resultado = ResultadoAcao<{ legenda: string; mudou: boolean }>;
const falha = (status: number, erro: string): Resultado => ({ ok: false, status, erro });

interface FotoAchada {
  atividadeId: string | null;
  legendaAtual: string;
  /** A automática (null: não tem — anexo, ou execução sem momento nem item) */
  legendaSistema: string | null;
  /** A escrita (null: está na automática) */
  gravada: string | null;
  atualizar: (legenda: string | null) => Promise<unknown>;
}

async function acharFoto(empresaId: string, osId: string, p: PedidoLegenda): Promise<FotoAchada | null> {
  const qual = p.fotoId ? { id: p.fotoId } : { clientId: p.clientId };
  const daAtividade = p.atividadeId ? { atividadeId: p.atividadeId } : {};
  if (p.origem === "EXECUCAO") {
    const f = await prisma.fotoAtendimento.findFirst({
      where: { ...qual, ...daAtividade, empresaId, atividade: { ordemServicoId: osId } },
      select: { id: true, atividadeId: true, legenda: true, momento: true, item: { select: { texto: true } } },
    });
    if (!f) return null;
    const sistema = legendaDoSistema({ origem: "EXECUCAO", momento: f.momento ?? null, item: f.item?.texto ?? null });
    return {
      atividadeId: f.atividadeId, legendaAtual: f.legenda ?? sistema ?? "Foto do atendimento", legendaSistema: sistema, gravada: f.legenda,
      atualizar: (legenda) => prisma.fotoAtendimento.update({ where: { id: f.id }, data: { legenda } }),
    };
  }
  if (p.origem === "ADICIONAL") {
    const f = await prisma.servicoAdicionalFoto.findFirst({
      where: { ...qual, empresaId, servico: { ordemServicoId: osId, ...daAtividade } },
      select: { id: true, legenda: true, servico: { select: { atividadeId: true, descricao: true } } },
    });
    if (!f) return null;
    const sistema = legendaDoSistema({ origem: "ADICIONAL", servico: f.servico.descricao });
    return {
      atividadeId: f.servico.atividadeId, legendaAtual: f.legenda ?? sistema ?? "", legendaSistema: sistema, gravada: f.legenda,
      atualizar: (legenda) => prisma.servicoAdicionalFoto.update({ where: { id: f.id }, data: { legenda } }),
    };
  }
  const a = await prisma.osAnexo.findFirst({
    where: { ...qual, ...daAtividade, ordemServicoId: osId, tipo: { startsWith: "image/" } },
    select: { id: true, atividadeId: true, legenda: true, nome: true },
  });
  return a && {
    atividadeId: a.atividadeId, legendaAtual: a.legenda ?? LEGENDA_ANEXO_SEM, legendaSistema: null, gravada: a.legenda,
    atualizar: (legenda) => prisma.osAnexo.update({ where: { id: a.id }, data: { legenda } }),
  };
}

/** Quem pode, a OS e a foto: as mesmas conferências para editar e para restaurar. */
async function conferir(ator: Ator & { podeEditarOs: boolean }, osId: string, p: PedidoLegenda): Promise<{ ok: true; foto: FotoAchada } | Resultado> {
  const os = await prisma.ordemServico.findFirst({ where: { id: osId, empresaId: ator.empresaId }, select: { status: true } });
  if (!os) return falha(404, "OS não encontrada");
  const motivo = motivoSemEditarLegenda({ restrito: ator.escopo.restrito, podeEditarOs: ator.podeEditarOs, osEncerrada: osEncerrada(os.status) });
  if (motivo) return falha(403, motivo);

  const foto = await acharFoto(ator.empresaId, osId, p);
  if (!foto) return falha(404, "Foto não encontrada");
  // Modo técnico: só a foto de uma atividade dele (a enviada pelo escritório não tem atividade)
  if (ator.escopo.restrito) {
    if (!foto.atividadeId) return falha(403, "Esta foto foi enviada pelo escritório.");
    const ctx = await carregarContexto(ator, foto.atividadeId, { osId, permitirBloqueada: true });
    if (!ctx.ok) return falha(ctx.status, ctx.erro);
  }
  return { ok: true, foto };
}

const registrar = (ator: Ator, osId: string, acao: string, detalhes: string) =>
  prisma.osHistorico.create({
    data: { ordemServicoId: osId, usuarioId: ator.usuarioId, acao, detalhes: `${detalhes}${ator.escopo.restrito ? " (app do técnico)" : ""}` },
  });

export async function editarLegendaFoto(ator: Ator & { podeEditarOs: boolean }, osId: string, p: PedidoLegenda): Promise<Resultado> {
  if (!p.fotoId && !p.clientId) return falha(400, "Diga qual foto.");
  const legenda = limparLegenda(p.legenda);
  if (!legenda) return falha(400, MSG_LEGENDA);
  const c = await conferir(ator, osId, p);
  if (!("foto" in c)) return c;
  const { foto } = c;
  if (legenda === foto.legendaAtual) return { ok: true, status: 200, dados: { legenda, mudou: false } };

  await foto.atualizar(legenda);
  await registrar(ator, osId, "Legenda da foto alterada", `“${foto.legendaAtual}” → “${legenda}”`);
  return { ok: true, status: 200, dados: { legenda, mudou: true } };
}

/** Volta a foto à legenda do sistema (apaga a escrita). Já na automática: nada muda e nada vai para o histórico. */
export async function restaurarLegendaFoto(ator: Ator & { podeEditarOs: boolean }, osId: string, p: Omit<PedidoLegenda, "legenda">): Promise<Resultado> {
  if (!p.fotoId && !p.clientId) return falha(400, "Diga qual foto.");
  const c = await conferir(ator, osId, { ...p, legenda: null });
  if (!("foto" in c)) return c;
  const { foto } = c;
  if (!foto.legendaSistema) return falha(400, MSG_SEM_LEGENDA_SISTEMA);
  if (foto.gravada === null) return { ok: true, status: 200, dados: { legenda: foto.legendaSistema, mudou: false } };

  await foto.atualizar(null);
  await registrar(ator, osId, "Legenda do sistema restaurada", `“${foto.legendaAtual}” → “${foto.legendaSistema}”`);
  return { ok: true, status: 200, dados: { legenda: foto.legendaSistema, mudou: true } };
}
