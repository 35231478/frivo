import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { OrdensListaClient } from "@/components/ordens/ordens-lista-client";

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

  const statusList = (sp.status ?? "").split(",").filter(Boolean);
  const prioridadeList = (sp.prioridade ?? "").split(",").filter(Boolean);
  const sort = sp.sort && SORT_MAP[sp.sort] ? sp.sort : "criadoEm";
  const dir: "asc" | "desc" = sp.dir === "asc" ? "asc" : "desc";

  const where: any = { empresaId };
  if (statusList.length) where.status = { in: statusList };
  if (prioridadeList.length) where.prioridade = { in: prioridadeList };
  if (sp.origem) where.origem = sp.origem;
  if (sp.clienteId) where.clienteId = sp.clienteId;
  if (sp.responsavelId) where.responsavelId = sp.responsavelId;
  if (sp.contratoId) where.contratoId = sp.contratoId;
  if (sp.tipoOsId) where.atividades = { some: { tipoOsId: sp.tipoOsId } };
  if (sp.numero) where.numero = { contains: sp.numero, mode: "insensitive" };
  if (sp.data) {
    // Navegação por dia: filtra a abertura para o dia selecionado (limites em horário local).
    const [y, m, d] = sp.data.split("-").map(Number);
    if (y && m && d) {
      where.criadoEm = { gte: new Date(y, m - 1, d, 0, 0, 0, 0), lte: new Date(y, m - 1, d, 23, 59, 59, 999) };
    }
  } else if (sp.dataInicio || sp.dataFim) {
    where.criadoEm = {};
    if (sp.dataInicio) where.criadoEm.gte = new Date(sp.dataInicio);
    if (sp.dataFim) { const f = new Date(sp.dataFim); f.setHours(23, 59, 59, 999); where.criadoEm.lte = f; }
  }
  if (sp.busca) {
    where.OR = [
      { numero: { contains: sp.busca, mode: "insensitive" } },
      { chamadoNumero: { contains: sp.busca, mode: "insensitive" } },
      { descricao: { contains: sp.busca, mode: "insensitive" } },
      { cliente: { nome: { contains: sp.busca, mode: "insensitive" } } },
    ];
  }

  const [ordens, total, clientes, usuarios, tiposOs, contratos] = await Promise.all([
    prisma.ordemServico.findMany({
      where,
      include: {
        cliente: { select: { id: true, nome: true, nomeFantasia: true } },
        unidade: { select: { nome: true } },
        responsavel: { select: { nome: true } },
        _count: { select: { atividades: true } },
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

  const ordensView = ordens.map((o) => ({
    id: o.id,
    numero: o.numero,
    chamadoNumero: o.chamadoNumero,
    origem: o.origem,
    cliente: o.cliente.nomeFantasia ?? o.cliente.nome,
    unidade: o.unidade?.nome ?? null,
    responsavel: o.responsavel?.nome ?? null,
    atividades: o._count.atividades,
    status: o.status,
    prioridade: o.prioridade,
    criadoEm: o.criadoEm.toISOString(),
    previsaoConclusao: o.previsaoConclusao ? o.previsaoConclusao.toISOString() : null,
  }));

  return (
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
  );
}
