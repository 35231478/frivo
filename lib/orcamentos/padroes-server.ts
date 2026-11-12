import { prisma } from "@/lib/prisma";
import { ErroRefEmpresa } from "@/lib/ref-empresa";
import { chaveHojeBR, diaCivilDeChave } from "@/lib/fuso";
import { validadePadrao } from "@/lib/orcamentos/calculo";
import { diasValidadeValidos } from "@/lib/orcamentos/proposta";

/**
 * Padrões do orçamento NOVO (Configurações › Orçamento + RT padrão do cadastro da empresa). A tela
 * já abre com eles preenchidos; o servidor usa os mesmos quando um campo não vem no corpo. Cada
 * orçamento grava os seus valores: mudar o padrão depois não mexe nos orçamentos que já existem.
 */
export async function padroesOrcamento(empresaId: string) {
  const [cfg, empresa] = await Promise.all([
    prisma.configuracao.findUnique({
      where: { empresaId },
      select: {
        orcamentoValidadeDias: true, orcamentoGarantiaServico: true, orcamentoGarantiaPecas: true,
        orcamentoNaoIncluso: true, orcamentoNormas: true,
      },
    }),
    prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { responsavelTecnico: { select: { id: true, ativo: true, tipo: true, empresaId: true } } },
    }),
  ]);
  const rt = empresa?.responsavelTecnico;
  return {
    validadeDias: diasValidadeValidos(cfg?.orcamentoValidadeDias),
    garantiaServico: cfg ? cfg.orcamentoGarantiaServico : "90 dias",
    garantiaPecas: cfg ? cfg.orcamentoGarantiaPecas : "Conforme garantia do fabricante",
    naoIncluso: cfg?.orcamentoNaoIncluso ?? null,
    normas: cfg?.orcamentoNormas ?? [],
    // RT padrão só vale se ainda for um responsável técnico ativo da empresa
    responsavelTecnicoId: rt && rt.ativo && rt.tipo === "RESPONSAVEL_TECNICO" && rt.empresaId === empresaId ? rt.id : null,
  };
}

export type PadroesOrcamento = Awaited<ReturnType<typeof padroesOrcamento>>;

/** Validade do orçamento novo: hoje (Brasília) + os dias do padrão, gravada como dia civil (como a tela manda). */
export function validadeDoPadrao(dias: number): Date {
  return diaCivilDeChave(validadePadrao(chaveHojeBR(), dias))!;
}

/**
 * Destinatário do orçamento ("Para:"): a unidade e o contato A/C precisam ser DO CLIENTE do
 * orçamento (e da empresa da sessão). Id de outro cliente/empresa = 400, sem dizer se existe.
 */
export async function validarDestinatario(
  empresaId: string, clienteId: string, unidadeId: string | null | undefined, contatoClienteId: string | null | undefined,
) {
  const [u, c] = await Promise.all([
    unidadeId ? prisma.unidade.count({ where: { id: unidadeId, empresaId, clienteId } }) : Promise.resolve(1),
    contatoClienteId ? prisma.contatoCliente.count({ where: { id: contatoClienteId, empresaId, clienteId } }) : Promise.resolve(1),
  ]);
  if (!u) throw new ErroRefEmpresa("Unidade inválida: escolha uma unidade deste cliente.");
  if (!c) throw new ErroRefEmpresa("Contato inválido: escolha um contato deste cliente.");
}

/**
 * Destinatário sugerido para o orçamento novo quando a tela não mandou: a unidade da OS de origem
 * (se as OS vinculadas forem de uma unidade só) e o contato principal ativo do cliente.
 */
export async function destinatarioSugerido(empresaId: string, clienteId: string, ordensIds: readonly string[]) {
  const [ordens, contato] = await Promise.all([
    ordensIds.length
      ? prisma.ordemServico.findMany({ where: { id: { in: [...ordensIds] }, empresaId, clienteId }, select: { unidadeId: true } })
      : Promise.resolve([]),
    prisma.contatoCliente.findFirst({
      where: { empresaId, clienteId, ativo: true },
      orderBy: [{ principal: "desc" }, { criadoEm: "asc" }],
      select: { id: true },
    }),
  ]);
  const unidades = [...new Set(ordens.map((o) => o.unidadeId).filter((x): x is string => !!x))];
  return { unidadeId: unidades.length === 1 ? unidades[0] : null, contatoClienteId: contato?.id ?? null };
}
