import { SelecaoMassaProvider } from "@/components/acoes-massa/selecao";
import { BarraAcoesMassa } from "@/components/acoes-massa/barra";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  FUNCOES_TECNICAS, LABELS_FUNCAO, WHERE_SEM_EQUIPE, datasAvisoColaborador, lerFiltrosColaboradores,
  montarOrderByColaboradores, montarWhereColaboradores, whereAvisoColaborador,
} from "@/lib/colaborador-listagem";
import { ColaboradoresListaClient, type ColaboradorLinha } from "./colaboradores-lista-client";

export const metadata: Metadata = { title: "Colaboradores" };

const selectLinha = {
  id: true, nome: true, tipo: true, telefone: true, email: true, crea: true, ativo: true, statusColaborador: true,
  especialidades: true, dataAdmissao: true, atualizadoEm: true,
  cargo: { select: { nome: true } },
  equipesMembro: { where: { status: "ATIVA" as const }, select: { id: true, nome: true, cor: true }, orderBy: { nome: "asc" as const } },
  equipesLideradas: { where: { status: "ATIVA" as const }, select: { id: true, nome: true, cor: true } },
  _count: { select: { atividadesOs: true } },
} as const;

export default async function ColaboradoresPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth();
  const empresaId = session!.user!.empresaId;
  const f = lerFiltrosColaboradores(await searchParams);
  const where = montarWhereColaboradores(empresaId, f);
  const { inicioHoje, limite } = datasAvisoColaborador();

  // ── Página atual (paginação no servidor; o avatar em base64 NÃO vem aqui) ──
  const [linhas, total] = await Promise.all([
    prisma.tecnico.findMany({ where, select: selectLinha, orderBy: montarOrderByColaboradores(f), skip: (f.pagina - 1) * f.porPagina, take: f.porPagina }),
    prisma.tecnico.count({ where }),
  ]);
  const ids = linhas.map((l) => l.id);
  const [comFotoRows, docs] = await Promise.all([
    ids.length ? prisma.$queryRaw<{ id: string }[]>`SELECT id FROM tecnicos WHERE id = ANY(${ids}) AND avatar IS NOT NULL AND avatar <> ''` : Promise.resolve([]),
    ids.length
      ? prisma.colaboradorDocumento.findMany({
          where: { colaboradorId: { in: ids }, dataVencimento: { not: null, lt: limite } },
          select: { colaboradorId: true, nome: true, dataVencimento: true }, orderBy: { dataVencimento: "asc" },
        })
      : Promise.resolve([]),
  ]);
  const comFoto = new Set(comFotoRows.map((r) => r.id));
  const docProximo = new Map<string, { nome: string; data: Date }>();
  for (const d of docs) if (!docProximo.has(d.colaboradorId)) docProximo.set(d.colaboradorId, { nome: d.nome, data: d.dataVencimento! });

  // ── Opções dos filtros ──
  const [cargos, equipes] = await Promise.all([
    prisma.cargo.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
    prisma.equipe.findMany({ where: { empresaId, status: "ATIVA" }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
  ]);

  // ── Indicadores (chips): no escopo de função/cargo/equipe, sem o próprio status/aviso ──
  const escopo = montarWhereColaboradores(empresaId, { ...f, q: "" }, { status: true, aviso: true });
  const ativosW = { AND: [escopo, { ativo: true }] };
  const contar = (extra: object | null) => prisma.tecnico.count({ where: { AND: [ativosW, extra ?? {}] } });
  const [ativos, inativos, tecnicos, semEquipe, ausentes, docVencido, docVencendo] = await Promise.all([
    prisma.tecnico.count({ where: ativosW }),
    prisma.tecnico.count({ where: { AND: [escopo, { ativo: false }] } }),
    contar({ tipo: { in: FUNCOES_TECNICAS as any } }),
    contar(WHERE_SEM_EQUIPE),
    contar(whereAvisoColaborador("ausente")),
    contar(whereAvisoColaborador("doc_vencido")),
    contar(whereAvisoColaborador("doc_vencendo")),
  ]);

  const itens: ColaboradorLinha[] = linhas.map((c) => {
    const doc = docProximo.get(c.id);
    return {
      id: c.id,
      nome: c.nome,
      funcao: c.tipo,
      funcaoLabel: LABELS_FUNCAO[c.tipo] ?? c.tipo,
      cargo: c.cargo?.nome ?? null,
      telefone: c.telefone,
      email: c.email,
      ativo: c.ativo,
      status: c.ativo ? c.statusColaborador : "INATIVO",
      especialidades: c.especialidades,
      // Foto servida sob demanda (?v= renova quando o cadastro muda)
      foto: comFoto.has(c.id) ? `/api/tecnicos/${c.id}/avatar?v=${c.atualizadoEm.getTime()}` : null,
      // Equipes que lidera (primeiro) + equipes em que é membro
      equipes: [...new Map([...c.equipesLideradas, ...c.equipesMembro].map((e) => [e.id, { id: e.id, nome: e.nome, cor: e.cor }])).values()],
      lider: c.equipesLideradas.length > 0,
      semEquipe: c.ativo && c.equipesMembro.length === 0 && c.equipesLideradas.length === 0,
      atividades: c._count.atividadesOs,
      documento: doc ? { nome: doc.nome, data: doc.data.toISOString(), vencido: doc.data < inicioHoje } : null,
    };
  });

  return (
    <SelecaoMassaProvider entidade="colaboradores" idsPagina={itens.map((i) => i.id)} total={total}>
    <ColaboradoresListaClient
      itens={itens}
      total={total}
      filtros={f}
      opcoes={{
        funcoes: Object.entries(LABELS_FUNCAO).map(([value, label]) => ({ value, label })),
        cargos: cargos.map((c) => ({ value: c.id, label: c.nome })),
        equipes: equipes.map((e) => ({ value: e.id, label: e.nome })),
      }}
      resumo={{ ativos, inativos, tecnicos, semEquipe, ausentes, docVencido, docVencendo }}
    />
    <BarraAcoesMassa />
    </SelecaoMassaProvider>
  );
}
