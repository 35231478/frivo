/**
 * Implantação — as contagens reais da empresa da sessão (lib/implantacao/etapas faz o resto).
 * Só conta: nada aqui grava.
 */
import { prisma } from "@/lib/prisma";
import { empresaTemModulo } from "@/lib/modulos/catalogo";
import { modulosDesligados } from "@/lib/modulos/servidor";
import { montarEtapas, progresso, type Contagens } from "@/lib/implantacao/etapas";

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

/** Etapas e progresso da empresa, com os módulos que ela tem ligados. */
export async function carregarImplantacao(empresaId: string) {
  const [c, desligados] = await Promise.all([contarImplantacao(empresaId), modulosDesligados(empresaId)]);
  const etapas = montarEtapas(c, (m) => empresaTemModulo(desligados, m));
  return { etapas, progresso: progresso(etapas) };
}
