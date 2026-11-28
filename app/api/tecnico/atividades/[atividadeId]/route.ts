import { comissaoParaRetrato, sincronizarExecutor } from "@/lib/comissoes/executor-server";
import { motivosDaEmpresa, pausaParaRetrato } from "@/lib/pausas/servidor";
import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { apresentarEquipamento, carregarExecucao, SELECT_EQUIP_EXECUCAO } from "@/lib/execucao/dados";
import { cartaoDaAtividade } from "@/lib/tecnico/dia";
import { MSG_FORA_DO_ESCOPO, escopoDaSessao, filtroEscopo } from "@/lib/tecnico/escopo";
import { aplicarPrivacidade } from "@/lib/tecnico/cartao";
import { carregarConfigApp } from "@/lib/tecnico/config-app-server";
import { temModulo } from "@/lib/modulos/servidor";
import { cadastroParaRetrato } from "@/lib/execucao/cadastro-campo";
import { avisoParaRetrato, avisosDeHoje, whatsappDoCliente } from "@/lib/execucao/aviso-cliente";
import { relatorioParaRetrato } from "@/lib/execucao/relatorio-envio";
import { andamentoParaRetrato } from "@/lib/execucao/andamento-server";
import { comentariosDaOs } from "@/lib/execucao/comentarios";
import { aceiteParaRetrato } from "@/lib/os/aceite-server";
import { pode, type Permissoes } from "@/lib/permissoes";
import { comMateriaisPrevistos } from "@/lib/tecnico/o-que-levar-server";
import { materiaisDaAtividade, separadoDaOsParaUso } from "@/lib/execucao/materiais-campo";

type Params = { params: Promise<{ atividadeId: string }> };

/**
 * Tudo o que o app precisa para executar a atividade SEM sinal (guardado no aparelho): o cartão
 * (cliente, endereço, rota), a execução por equipamento (checklist do tipo, respostas, fotos, o que
 * falta), os serviços adicionais e a lista de equipamentos ativos da unidade (para vincular o que faltou).
 */
export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "visualizar");
  if (guard.erro) return guard.resposta;
  const { atividadeId } = await params;
  const empresaId = guard.session.user.empresaId;
  const escopo = escopoDaSessao(guard.session);
  const cartao = await cartaoDaAtividade(empresaId, atividadeId, filtroEscopo(escopo));
  if (!cartao) {
    const existe = escopo.restrito && await prisma.atividadeOs.findFirst({ where: { id: atividadeId, empresaId }, select: { id: true } });
    return existe
      ? NextResponse.json({ erro: MSG_FORA_DO_ESCOPO }, { status: 403 })
      : NextResponse.json({ erro: "Atividade não encontrada" }, { status: 404 });
  }
  const execucao = await carregarExecucao(empresaId, cartao.osId, atividadeId);
  if (!execucao) return NextResponse.json({ erro: "Atividade não encontrada" }, { status: 404 });
  const { clienteId, unidadeId } = execucao.os;
  const daUnidade = await prisma.equipamento.findMany({
    where: { empresaId, ativo: true, ...(unidadeId ? { unidadeId } : { unidade: { clienteId } }) },
    orderBy: [{ localizacao: "asc" }, { nome: "asc" }],
    take: 300,
    select: { ...SELECT_EQUIP_EXECUCAO, qrcode: { select: { tokenPublico: true, codigo: true } } },
  });
  // Permissões do app (Equipes › App do colaborador): dado do cliente oculto nem sai do servidor
  const config = await carregarConfigApp(empresaId);
  // Cadastro em campo (se a empresa permite): unidade, tipos que já existem e sugestões de local
  const cadastro = await cadastroParaRetrato(empresaId, config.cadastrarEquipamento, { clienteId, unidadeId }, daUnidade);
  // Aviso ao cliente ("A caminho" / "Cheguei"), se a empresa permite: o nome da empresa para a mensagem,
  // o WhatsApp do cliente (só com "Exibir contatos do cliente") e o que já foi registrado hoje
  const [avisoCliente, avisos] = await Promise.all([avisoParaRetrato(empresaId, config, cartao.osId), avisosDeHoje(atividadeId)]);
  // Aceite do cliente na conclusão da OS: só vai para quem pode colher (OS › Editar)
  const { permissoes, role } = guard.session.user;
  const aceite = pode(permissoes as Permissoes, "ordens", "editar", role) ? await aceiteParaRetrato(empresaId, cartao.osId, atividadeId) : null;
  // Checklist de cada tipo da unidade — e, com o cadastro em campo, de cada tipo que dá para escolher:
  // vincular ou cadastrar sem sinal já mostra o checklist do equipamento novo
  const tipoIds = [...new Set([...daUnidade.map((e) => e.tipoEquipamentoId), ...(cadastro?.tipos ?? []).map((t) => t.tipoEquipamentoId)].filter((x): x is string => !!x))];
  const itens = tipoIds.length ? await prisma.checklistTipoItem.findMany({
    where: { tipoEquipamentoId: { in: tipoIds }, empresaId, ativo: true },
    orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }],
    select: { id: true, tipoEquipamentoId: true, texto: true, pedirFoto: true, pedirObservacao: true, ativo: true, ordem: true, tipoResposta: true, unidade: true, grandeza: true, valorMin: true, valorMax: true },
  }) : [];
  // Faixa esperada como número (o app alerta fora dela, também sem sinal)
  const checklistsPorTipo: Record<string, (Omit<(typeof itens)[number], "tipoEquipamentoId" | "valorMin" | "valorMax"> & { valorMin: number | null; valorMax: number | null })[]> = {};
  for (const { tipoEquipamentoId, valorMin, valorMax, ...i } of itens) (checklistsPorTipo[tipoEquipamentoId] ??= []).push({ ...i, valorMin: valorMin?.toNumber() ?? null, valorMax: valorMax?.toNumber() ?? null });
  // O nome da unidade do cliente vem junto de cada equipamento: sem "Exibir dados do cliente", sai também
  const semUnidade = <T extends { unidade: string | null }>(e: T): T => (config.exibirDadosCliente ? e : { ...e, unidade: null });
  // "O que levar": os materiais previstos desta OS (opção da empresa desligada = nada sai)
  const [comMateriais] = await comMateriaisPrevistos(empresaId, [cartao], config.oQueLevar);
  // Materiais usados em campo nesta atividade (sem valores; "meu" = lançado por quem está com o aparelho)
  // Atividade esquecida em andamento (limite, jornada, última gravação) e o WhatsApp do topo da OS (1 toque)
  // D5: o separado desta OS por produto (o app soma ao saldo do catálogo para avisar "vai ficar negativo")
  const [materiais, andamento, whatsapp, comentarios, separado] = await Promise.all([
    materiaisDaAtividade(empresaId, atividadeId, guard.session.user.id), andamentoParaRetrato(empresaId, atividadeId), whatsappDoCliente(empresaId, config, cartao.osId),
    // Comentários da OS (conversa interna com o escritório; o cliente nunca vê)
    comentariosDaOs(empresaId, cartao.osId, guard.session.user.id),
    separadoDaOsParaUso(empresaId, cartao.osId),
  ]);
  return NextResponse.json({
    cartao: aplicarPrivacidade(comMateriais, config),
    execucao: {
      ...execucao,
      equipamentos: execucao.equipamentos.map((q) => ({ ...q, equipamento: semUnidade(q.equipamento) })),
      // Serviço adicional: a decisão de cobrança (e o preço) é do escritório e não vai para o app —
      // só o sinal de que já foi avaliado, para o app travar a edição
      adicionais: execucao.adicionais.map(({ statusCobranca, ...a }) => ({ ...a, cobrancaDecidida: statusCobranca !== "A_AVALIAR" })),
      avisos,
      materiais,
      separado,
      comentarios,
      // D1: a pausa aberta (o app mostra "Pausada — motivo" e Retomar)
      pausa: await pausaParaRetrato(atividadeId),
    },
    // D1: os motivos de pausa da empresa (o técnico pausa sem sinal também)
    motivosPausa: await motivosDaEmpresa(empresaId).then((ms) => ms.map(({ id, nome, tipo, pedeTexto }) => ({ id, nome, tipo, pedeTexto }))),
    equipamentosUnidade: daUnidade.map(({ qrcode, ...e }) => ({ ...semUnidade(apresentarEquipamento(e)), tipoEquipamentoId: e.tipoEquipamentoId, qr: qrcode })),
    checklistsPorTipo,
    cadastro,
    avisoCliente,
    aceite,
    // Campos-ponte do app: sem Equipamentos some o vínculo pela lista; sem QR Codes, a leitura de etiqueta
    andamento,
    whatsapp,
    // O relatório da visita (link com token): o técnico manda ao cliente pelo WhatsApp ao concluir
    relatorio: await relatorioParaRetrato(empresaId, atividadeId),
    modulos: { equipamentos: await temModulo(empresaId, "equipamentos"), qrcodes: await temModulo(empresaId, "qrcodes") },
    // COM-2B: a comissão de quem está com o aparelho, por equipamento (só o valor dele; a conta é do servidor).
    // Antes, a conta desta OS é refeita: o que o app acabou de enviar já volta "Prevista" (confirmada) no retrato.
    comissao: await sincronizarExecutor(empresaId, { osIds: [cartao.osId] })
      .then(() => comissaoParaRetrato(empresaId, atividadeId, guard.session.user.id)).catch(() => null),
    geradoEm: new Date().toISOString(),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
