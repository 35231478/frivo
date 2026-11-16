import { NextRequest } from "next/server";
import { admissoesDaEmpresa, criarAdmissao } from "@/lib/admissao/admissao-server";
import { corpo, guardaDoRh, responderAdmissao } from "@/lib/admissao/admissao-rotas";

/** A lista de admissões da empresa (busca por nome ou CPF, filtro por situação). */
export async function GET(req: NextRequest) {
  const { ator, resposta } = await guardaDoRh();
  if (!ator) return resposta;
  const { searchParams } = new URL(req.url);
  return responderAdmissao(() => admissoesDaEmpresa(ator.empresaId, {
    situacao: searchParams.get("situacao"),
    busca: searchParams.get("busca"),
  }));
}

/**
 * Gera o convite. Com `colaboradorId`, da ficha de quem já existe; sem ele, pré-cadastra o
 * colaborador (nome + CPF + cargo + salário) e cria o convite para ele. O link não é enviado aqui:
 * quem manda é POST /api/admissoes/[id]/reenviar (o mesmo caminho do reenvio).
 */
export async function POST(req: NextRequest) {
  const { ator, resposta } = await guardaDoRh();
  if (!ator) return resposta;
  const b = await corpo(req);
  return responderAdmissao(() => criarAdmissao(ator, {
    colaboradorId: typeof b.colaboradorId === "string" ? b.colaboradorId : null,
    nome: typeof b.nome === "string" ? b.nome : "",
    cpf: typeof b.cpf === "string" ? b.cpf : "",
    telefone: typeof b.telefone === "string" ? b.telefone : "",
    email: typeof b.email === "string" ? b.email : "",
    cargoId: typeof b.cargoId === "string" ? b.cargoId : null,
    salario: typeof b.salario === "number" ? b.salario : null,
    dataAdmissao: typeof b.dataAdmissao === "string" ? b.dataAdmissao : null,
    validadeDias: typeof b.validadeDias === "number" ? b.validadeDias : null,
  }), 201);
}
