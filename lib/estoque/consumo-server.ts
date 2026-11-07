import { prisma } from "@/lib/prisma";
import { movimentar } from "@/lib/estoque/servidor";
import { arred, formatarQtd } from "@/lib/estoque/regras";
import { medicaoValida } from "@/lib/os/status";
import { sincronizarStatusOs } from "@/lib/os/sincronizar-status";
import { planoConsumo, planoDesfazerConsumo } from "@/lib/estoque/separacao";
import { ErroSeparacao, paraSeparavel, separacaoDaOs, type SeparacaoDaOs } from "@/lib/estoque/separacao-server";

/**
 * Estoque E4.2 — consumo de material da OS, lado do banco: informar o consumo (baixa definitiva no razão da E1, sem
 * contar duas vezes a reserva da E4.1) e desfazer (estorno), tudo na MESMA transação com a linha do produto
 * trancada (`movimentar`). A regra é a pura (lib/estoque/separacao). Empresa sempre da sessão.
 */

export interface ResultadoConsumo { separacao: SeparacaoDaOs; avisos: string[]; movimentos: number; /** Status da OS depois (a conclusão automática pode destravar) */ status: string | null }

const SELECT = { id: true, produtoId: true, descricao: true, unidade: true, quantidade: true, quantidadeSeparada: true, quantidadeConsumida: true, estadoSeparacao: true } as const;

/**
 * Para cada material, baixa o consumido: estorno da RESERVA da parte que já estava separada (+) e SAIDA do consumido
 * inteiro (−) — líquido zero para o que já saiu na separação, e só o excedente baixa a mais (com aviso se o saldo não
 * cobre). A sobra continua reservada (pendente de devolução). Material de outra OS/empresa = recusado. null = OS não é
 * da empresa. Depois, o status automático da OS é recalculado (o Portão 1 pode destravar a conclusão).
 */
export async function consumirMateriais(empresaId: string, osId: string, usuarioId: string, alvos: { id: string; quantidade: number }[]): Promise<ResultadoConsumo | null> {
  const ids = alvos.map((a) => a.id);
  if (new Set(ids).size !== ids.length) throw new ErroSeparacao("Material repetido no pedido.");
  const feito = await prisma.$transaction(async (tx) => {
    const os = await tx.ordemServico.findFirst({ where: { id: osId, empresaId }, select: { id: true, numero: true, chamadoNumero: true, status: true } });
    if (!os) return null;
    if (os.status === "CANCELADA") throw new ErroSeparacao("OS cancelada: não há consumo a informar.");
    const materiais = await tx.osMaterial.findMany({ where: { id: { in: ids }, ordemServicoId: osId }, select: SELECT });
    if (materiais.length !== ids.length) throw new ErroSeparacao("Material não pertence a esta OS.");
    const alvoDe = new Map(alvos.map((a) => [a.id, a.quantidade]));
    const avisos: string[] = [];
    const feitos: string[] = [];
    let movimentos = 0;
    const agora = new Date();
    const numero = os.chamadoNumero ?? os.numero;
    // Ordem fixa (produto, id): sem deadlock entre dois consumos com os mesmos produtos
    for (const m of [...materiais].sort((a, b) => (a.produtoId ?? "").localeCompare(b.produtoId ?? "") || a.id.localeCompare(b.id))) {
      const plano = planoConsumo(paraSeparavel(m), alvoDe.get(m.id)!);
      if (!plano.ok) throw new ErroSeparacao(`${m.descricao}: ${plano.erro}`);
      if (plano.estorno > 0) {
        await movimentar({ empresaId, produtoId: m.produtoId!, operacao: "ESTORNO_RESERVA", valor: plano.estorno, usuarioId, refId: osId, observacao: `Consumo — OS ${numero} · ${m.descricao} (reserva convertida em saída)` }, tx);
        movimentos++;
      }
      if (plano.saida > 0) {
        const r = await movimentar({ empresaId, produtoId: m.produtoId!, operacao: "SAIDA", valor: plano.saida, usuarioId, refId: osId, observacao: `Consumo — OS ${numero} · ${m.descricao}` }, tx);
        movimentos++;
        if (r.aviso) avisos.push(`${m.descricao}: ${r.aviso}`);
      }
      await tx.osMaterial.update({ where: { id: m.id }, data: { quantidadeConsumida: plano.quantidadeConsumida, estadoSeparacao: "CONSUMIDO", consumidoEm: agora, consumidoPorId: usuarioId } });
      feitos.push(`${m.descricao}: ${formatarQtd(plano.quantidadeConsumida)} ${m.unidade}${plano.pendenteDevolucao > 0 ? ` (sobra ${formatarQtd(plano.pendenteDevolucao)} ${m.unidade} pendente de devolução)` : ""}`);
    }
    await tx.osHistorico.create({ data: { ordemServicoId: osId, usuarioId, acao: "Consumo de material informado", detalhes: feitos.join("; ").slice(0, 1000) } });
    return { avisos, movimentos };
  });
  if (!feito) return null;
  // O Portão 1 pode ter sido a única coisa segurando a conclusão automática
  const status = await sincronizarStatusOs(osId, empresaId, usuarioId);
  const separacao = (await separacaoDaOs(empresaId, osId))!;
  return { separacao, ...feito, status };
}

/** OS finalizada (concluída, cancelada ou já numa medição/fatura viva): o consumo não se desfaz mais. */
export async function osFinalizada(osId: string): Promise<boolean> {
  const os = await prisma.ordemServico.findUnique({ where: { id: osId }, select: { status: true, medicaoItens: { select: { medicao: { select: { status: true } } } } } });
  if (!os) return true;
  return os.status === "CONCLUIDA" || os.status === "CANCELADA" || os.medicaoItens.some((mi) => medicaoValida(mi.medicao));
}

/** Desfaz o consumo de UM material: SAIDA + (estorno da baixa) e RESERVA − (volta à reserva o que estava separado); estado volta a SEPARADO. */
export async function desfazerConsumo(empresaId: string, osId: string, usuarioId: string, materialId: string): Promise<ResultadoConsumo | null> {
  const feito = await prisma.$transaction(async (tx) => {
    const os = await tx.ordemServico.findFirst({ where: { id: osId, empresaId }, select: { id: true, numero: true, chamadoNumero: true } });
    if (!os) return null;
    if (await osFinalizada(osId)) throw new ErroSeparacao("OS finalizada: o consumo não pode mais ser desfeito.");
    const m = await tx.osMaterial.findFirst({ where: { id: materialId, ordemServicoId: osId }, select: SELECT });
    if (!m) throw new ErroSeparacao("Material não pertence a esta OS.");
    const plano = planoDesfazerConsumo(paraSeparavel(m));
    if (!plano.ok) throw new ErroSeparacao(`${m.descricao}: ${plano.erro}`);
    const numero = os.chamadoNumero ?? os.numero;
    const avisos: string[] = [];
    let movimentos = 0;
    if (plano.estornoSaida > 0) { await movimentar({ empresaId, produtoId: m.produtoId!, operacao: "ESTORNO_SAIDA", valor: plano.estornoSaida, usuarioId, refId: osId, observacao: `Consumo desfeito — OS ${numero} · ${m.descricao}` }, tx); movimentos++; }
    if (plano.reserva > 0) {
      const r = await movimentar({ empresaId, produtoId: m.produtoId!, operacao: "RESERVA", valor: plano.reserva, usuarioId, refId: osId, observacao: `Consumo desfeito — OS ${numero} · ${m.descricao} (volta à reserva)` }, tx);
      movimentos++;
      if (r.aviso) avisos.push(`${m.descricao}: ${r.aviso}`);
    }
    await tx.osMaterial.update({ where: { id: m.id }, data: { quantidadeConsumida: 0, estadoSeparacao: plano.estado, consumidoEm: null, consumidoPorId: null } });
    await tx.osHistorico.create({ data: { ordemServicoId: osId, usuarioId, acao: "Consumo de material desfeito", detalhes: `${m.descricao}: ${formatarQtd(arred(Number(m.quantidadeConsumida)))} ${m.unidade}` } });
    return { avisos, movimentos };
  });
  if (!feito) return null;
  const status = await sincronizarStatusOs(osId, empresaId, usuarioId);
  const separacao = (await separacaoDaOs(empresaId, osId))!;
  return { separacao, ...feito, status };
}
