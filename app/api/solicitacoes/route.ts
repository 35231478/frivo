import { NextResponse } from "next/server";
import { exigirAlgumaPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { SOLICITACAO_PENDENTE, separarDescricao } from "@/lib/solicitacoes";

/** Solicitações pendentes dos clientes (chamados do portal/QR ainda não aceitos nem recusados). */
export async function GET() {
  const guard = await exigirAlgumaPermissao([["ordens", "editar"], ["ordens", "excluir"]]);
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;

  const lista = await prisma.ordemServico.findMany({
    where: { empresaId, ...SOLICITACAO_PENDENTE },
    select: {
      id: true, numero: true, chamadoNumero: true, prioridade: true, descricao: true, criadoEm: true,
      cliente: { select: { id: true, nome: true, nomeFantasia: true } },
      unidade: { select: { id: true, nome: true, logradouro: true, numero: true, bairro: true, cidade: true } },
      equipamento: { select: { id: true, nome: true, marca: true, modelo: true } },
      contatoOrigem: { select: { nome: true, email: true, telefone: true, whatsapp: true } },
      _count: { select: { anexos: true } },
    },
    orderBy: { criadoEm: "asc" },
  });

  return NextResponse.json(lista.map((s) => {
    const { texto, contatoQr, viaQr } = separarDescricao(s.descricao);
    const c = s.contatoOrigem;
    return {
      id: s.id,
      numero: s.chamadoNumero ?? s.numero,
      canal: viaQr ? "QR Code" : "Portal do cliente",
      prioridade: s.prioridade,
      descricao: texto,
      criadoEm: s.criadoEm,
      cliente: s.cliente.nomeFantasia ?? s.cliente.nome,
      endereco: s.unidade
        ? [s.unidade.nome, [s.unidade.logradouro, s.unidade.numero].filter(Boolean).join(", "), s.unidade.bairro, s.unidade.cidade].filter(Boolean).join(" — ")
        : null,
      equipamento: s.equipamento ? (s.equipamento.nome ?? `${s.equipamento.marca} ${s.equipamento.modelo}`.trim()) : null,
      contato: c ? [c.nome, c.telefone ?? c.whatsapp, c.email].filter(Boolean).join(" · ") : contatoQr,
      fotos: s._count.anexos,
    };
  }));
}
