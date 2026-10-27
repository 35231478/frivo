import { prisma } from "@/lib/prisma";
import { contextoDaOsParaNome, contextoOsSelect } from "@/lib/orcamentos/nome-server";
import { destinatarioSugerido, padroesOrcamento } from "@/lib/orcamentos/padroes-server";

/**
 * Tudo o que o construtor de orçamento (components/forms/orcamento-form.tsx) precisa para abrir em
 * modo "novo": clientes, catálogo, responsáveis técnicos e modelos de termo. UMA fonte para a
 * página /orcamentos/novo e para a gaveta "Criar orçamento" da OS — o mesmo fluxo, sem duplicar.
 * A OS (quando vem) é sempre da empresa da sessão.
 */
export async function dadosNovoOrcamento(empresaId: string, { clienteId, osId }: { clienteId?: string | null; osId?: string | null } = {}) {
  const [clientes, servicos, produtos, osInicial, tecnicos, termoTemplates, cfg] = await Promise.all([
    prisma.cliente.findMany({
      where: { empresaId, ativo: true },
      select: { id: true, nome: true, nomeFantasia: true },
      orderBy: { nome: "asc" },
    }),
    prisma.servico.findMany({
      where: { empresaId, ativo: true },
      select: { id: true, codigo: true, nome: true, descricao: true, unidade: true, valorPadrao: true },
      orderBy: { nome: "asc" },
    }),
    prisma.produto.findMany({
      where: { empresaId, ativo: true },
      select: { id: true, codigo: true, nome: true, descricao: true, unidade: true, valorPadrao: true },
      orderBy: { nome: "asc" },
    }),
    osId
      ? prisma.ordemServico.findFirst({
          where: { id: osId, empresaId },
          select: { id: true, numero: true, descricao: true, status: true, clienteId: true, ...contextoOsSelect },
        })
      : Promise.resolve(null),
    prisma.tecnico.findMany({
      where: { empresaId, ativo: true, tipo: "RESPONSAVEL_TECNICO" },
      select: { id: true, nome: true, crea: true },
      orderBy: { nome: "asc" },
    }),
    prisma.termoReferenciaTemplate.findMany({
      where: { empresaId, ativo: true },
      select: { id: true, nome: true, conteudo: true },
      orderBy: { nome: "asc" },
    }),
    prisma.configuracao.findUnique({ where: { empresaId }, select: { issAliquota: true } }),
  ]);

  const clienteInicial = osInicial?.clienteId ?? clienteId ?? null;
  const [padroes, destinatarioInicial] = await Promise.all([
    padroesOrcamento(empresaId),
    clienteInicial && clientes.some((c) => c.id === clienteInicial)
      ? destinatarioSugerido(empresaId, clienteInicial, osInicial ? [osInicial.id] : [])
      : Promise.resolve(undefined),
  ]);

  return {
    clientes,
    catalogoServicos: servicos.map((s) => ({ ...s, valorPadrao: s.valorPadrao ? Number(s.valorPadrao) : null })),
    catalogoProdutos: produtos.map((p) => ({ ...p, valorPadrao: p.valorPadrao ? Number(p.valorPadrao) : null })),
    tecnicos,
    termoTemplates,
    clienteIdInicial: osInicial?.clienteId ?? clienteId ?? undefined,
    osInicialId: osInicial?.id,
    osInicial: osInicial ? { id: osInicial.id, numero: osInicial.numero, descricao: osInicial.descricao, status: osInicial.status } : undefined,
    /** Tipo da OS, unidade e equipamento principal: a prévia do nome automático (mesma regra do servidor) */
    contextoNome: contextoDaOsParaNome(osInicial),
    /** Alíquota de ISS da empresa hoje (%): o orçamento novo nasce com ela */
    issAliquota: Number(cfg?.issAliquota ?? 0),
    /** Padrões de Configurações › Orçamentos: validade, garantias, não incluso, normas e RT padrão */
    padroes,
    /** "Para:" sugerido: unidade da OS de origem e contato principal do cliente */
    destinatarioInicial,
    /** Botão "Gerar descrição (IA)" ativo? (sem a chave fica desabilitado com aviso) */
    iaDisponivel: !!process.env.ANTHROPIC_API_KEY,
  };
}

export type DadosNovoOrcamento = Awaited<ReturnType<typeof dadosNovoOrcamento>>;
