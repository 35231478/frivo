/**
 * Implantação — as contagens reais da empresa da sessão (lib/implantacao/etapas faz o resto).
 * Só conta: nada aqui grava.
 */
import { prisma } from "@/lib/prisma";
import { empresaTemModulo } from "@/lib/modulos/catalogo";
import { modulosDesligados } from "@/lib/modulos/servidor";
import { ETAPAS_IDS, montarEtapas, progresso, type Contagens, type EtapaId } from "@/lib/implantacao/etapas";

const preenchido = (s: string | null | undefined) => !!s && s.trim() !== "";

export async function contarImplantacao(empresaId: string): Promise<Contagens> {
  const [empresa, tiposOs, usuarios, clientes, unidades, contatos, equipamentos, produtosEstoque, produtosComSaldo, colaboradores, veiculos, contratos, pmocs] = await Promise.all([
    prisma.empresa.findUnique({ where: { id: empresaId }, select: { nome: true, cnpj: true, endereco: true, cidade: true, logo: true } }),
    prisma.tipoOs.count({ where: { empresaId, ativo: true } }),
    prisma.usuario.count({ where: { empresaId, ativo: true } }),
    prisma.cliente.count({ where: { empresaId, ativo: true } }),
    prisma.unidade.count({ where: { empresaId, ativo: true } }),
    prisma.contatoCliente.count({ where: { empresaId } }),
    prisma.equipamento.count({ where: { empresaId, ativo: true } }),
    prisma.produto.count({ where: { empresaId, ativo: true, controlaEstoque: true } }),
    prisma.produto.count({ where: { empresaId, ativo: true, controlaEstoque: true, movimentacoes: { some: {} } } }),
    prisma.tecnico.count({ where: { empresaId, ativo: true } }),
    prisma.veiculo.count({ where: { empresaId } }),
    prisma.contrato.count({ where: { empresaId } }),
    prisma.pmoc.count({ where: { empresaId } }),
  ]);
  return {
    dadosEmpresa: !!empresa && preenchido(empresa.nome) && preenchido(empresa.cnpj) && preenchido(empresa.endereco) && preenchido(empresa.cidade),
    logo: preenchido(empresa?.logo),
    tiposOs, usuarios, clientes, unidades, contatos, equipamentos, produtosEstoque, produtosComSaldo, colaboradores, veiculos, contratos, pmocs,
  };
}

/** As etapas marcadas "Não se aplica / fazer depois" (só ids conhecidos; lixo na coluna é ignorado). */
export async function etapasDispensadas(empresaId: string): Promise<EtapaId[]> {
  const cfg = await prisma.configuracao.findUnique({ where: { empresaId }, select: { implantacaoDispensadas: true } });
  return (cfg?.implantacaoDispensadas ?? []).filter((x): x is EtapaId => (ETAPAS_IDS as string[]).includes(x));
}

/** Marca ou reabre uma etapa ("Não se aplica / fazer depois"). Cria a linha de configuração da empresa se faltar. */
export async function marcarEtapa(empresaId: string, etapa: EtapaId, dispensada: boolean): Promise<EtapaId[]> {
  return prisma.$transaction(async (tx) => {
    const cfg = await tx.configuracao.upsert({ where: { empresaId }, create: { empresaId }, update: {}, select: { implantacaoDispensadas: true } });
    const atual = new Set(cfg.implantacaoDispensadas);
    if (dispensada) atual.add(etapa); else atual.delete(etapa);
    // Sempre na ordem das etapas (e só ids conhecidos)
    const lista = ETAPAS_IDS.filter((id) => atual.has(id));
    await tx.configuracao.update({ where: { empresaId }, data: { implantacaoDispensadas: lista } });
    return lista;
  });
}

/** Etapas e progresso da empresa, com os módulos que ela tem ligados e as etapas marcadas. */
export async function carregarImplantacao(empresaId: string) {
  const [c, desligados, dispensadas] = await Promise.all([contarImplantacao(empresaId), modulosDesligados(empresaId), etapasDispensadas(empresaId)]);
  const etapas = montarEtapas(c, (m) => empresaTemModulo(desligados, m), dispensadas);
  return { etapas, progresso: progresso(etapas) };
}
