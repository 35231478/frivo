import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { whereOrdens } from "@/lib/listas/filtros";
import { OrdensListaClient } from "@/components/ordens/ordens-lista-client";
import { SelecaoMassaProvider } from "@/components/acoes-massa/selecao";
import { BarraAcoesMassa } from "@/components/acoes-massa/barra";

export const metadata: Metadata = { title: "Ordens de Serviço" };

type SP = {
  busca?: string; status?: string; prioridade?: string; origem?: string;
  clienteId?: string; responsavelId?: string; tipoOsId?: string; contratoId?: string;
  numero?: string; dataInicio?: string; dataFim?: string; data?: string;
  sort?: string; dir?: string; view?: string;
};

const SORT_MAP: Record<string, (dir: "asc" | "desc") => any> = {
  numero: (dir) => ({ numero: dir }),
  cliente: (dir) => ({ cliente: { nome: dir } }),
  criadoEm: (dir) => ({ criadoEm: dir }),
  previsaoConclusao: (dir) => ({ previsaoConclusao: dir }),
  status: (dir) => ({ status: dir }),
  prioridade: (dir) => ({ prioridade: dir }),
};

const TAKE = 100;

export default async function OrdensPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const sort = sp.sort && SORT_MAP[sp.sort] ? sp.sort : "criadoEm";
  const dir: "asc" | "desc" = sp.dir === "asc" ? "asc" : "desc";

  const where = whereOrdens(empresaId, sp);

  const [ordens, total, clientes, usuarios, tiposOs, contratos] = await Promise.all([
    prisma.ordemServico.findMany({
      where,
      include: {
        cliente: { select: { id: true, nome: true, nomeFantasia: true, logo: true } },
        unidade: { select: { nome: true } },
        responsavel: { select: { nome: true } },
        atividades: { select: {
          tecnico: { select: { id: true, nome: true, avatar: true } },
          tecnicosEquipe: { select: { tecnico: { select: { id: true, nome: true, avatar: true } } } },
        } },
      },
      orderBy: SORT_MAP[sort](dir),
      take: TAKE,
    }),
    prisma.ordemServico.count({ where }),
    prisma.cliente.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true, nomeFantasia: true }, orderBy: { nome: "asc" } }),
    prisma.usuario.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
    prisma.tipoOs.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
    prisma.contrato.findMany({ where: { empresaId }, select: { id: true, numero: true }, orderBy: { numero: "asc" } }),
  ]);

  const ordensView = ordens.map((o) => {
    // Técnicos das atividades, deduplicados por id e ordenados por nome (pt-BR)
    const tecnicos = Array.from(
      // responsáveis + membros das equipes das atividades
      new Map(o.atividades.flatMap((a) => [a.tecnico, ...a.tecnicosEquipe.map((t) => t.tecnico)]).filter(Boolean).map((t) => [t!.id, t!])).values(),
    ).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

    return {
      id: o.id,
      numero: o.numero,
      chamadoNumero: o.chamadoNumero,
      origem: o.origem,
      cliente: o.cliente.nomeFantasia ?? o.cliente.nome,
      clienteLogo: o.cliente.logo ?? null,
      unidade: o.unidade?.nome ?? null,
      responsavel: o.responsavel?.nome ?? null,
      atividades: o.atividades.length,
      tecnicos: tecnicos.map((t) => ({ id: t.id, nome: t.nome, avatar: t.avatar ?? null })),
      status: o.status,
      prioridade: o.prioridade,
      criadoEm: o.criadoEm.toISOString(),
      previsaoConclusao: o.previsaoConclusao ? o.previsaoConclusao.toISOString() : null,
    };
  });

  return (
    <SelecaoMassaProvider entidade="ordens" idsPagina={ordens.map((o) => o.id)} total={total}>
    <OrdensListaClient
      ordens={ordensView}
      total={total}
      exibindo={ordens.length}
      opcoes={{
        clientes: clientes.map((c) => ({ value: c.id, label: c.nomeFantasia ?? c.nome })),
        usuarios: usuarios.map((u) => ({ value: u.id, label: u.nome })),
        tiposOs: tiposOs.map((t) => ({ value: t.id, label: t.nome })),
        contratos: contratos.map((c) => ({ value: c.id, label: c.numero })),
      }}
    />
    <BarraAcoesMassa />
    </SelecaoMassaProvider>
  );
}
