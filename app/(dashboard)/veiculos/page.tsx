import { SelecaoMassaProvider } from "@/components/acoes-massa/selecao";
import { BarraAcoesMassa } from "@/components/acoes-massa/barra";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  TIPOS_VEICULO, datasAviso, lerFiltrosVeiculos, montarOrderByVeiculos, montarWhereVeiculos, whereAviso,
} from "@/lib/veiculo-listagem";
import { VeiculosListaClient, type VeiculoLinha } from "./veiculos-lista-client";

export const metadata: Metadata = { title: "Veículos" };

const selectLinha = {
  id: true, placa: true, marca: true, modelo: true, ano: true, anoModelo: true, combustivel: true, cor: true,
  tipo: true, status: true, quilometragemAtual: true, proximaRevisaoKm: true, proximaRevisaoData: true,
  seguroVencimento: true, atualizadoEm: true,
  responsavel: { select: { nome: true } },
  equipe: { select: { nome: true, cor: true } },
} as const;

export default async function VeiculosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth();
  const empresaId = session!.user!.empresaId;
  const f = lerFiltrosVeiculos(await searchParams);
  const where = montarWhereVeiculos(empresaId, f);
  const { inicioHoje, limite } = datasAviso();

  // ── Página atual (paginação no servidor; fotos NÃO vêm aqui — só se existem) ──
  const [linhas, total] = await Promise.all([
    prisma.veiculo.findMany({
      where, select: selectLinha, orderBy: montarOrderByVeiculos(f),
      skip: (f.pagina - 1) * f.porPagina, take: f.porPagina,
    }),
    prisma.veiculo.count({ where }),
  ]);
  const ids = linhas.map((l) => l.id);

  // Para a página: quais têm foto (sem trafegar o base64), documento mais próximo de vencer e checklist de hoje
  const [comFotoRows, docs, checklistsHoje, templatesAtivos] = await Promise.all([
    ids.length
      ? prisma.$queryRaw<{ id: string }[]>`SELECT id FROM veiculos WHERE id = ANY(${ids}) AND cardinality(fotos) > 0`
      : Promise.resolve([]),
    ids.length
      ? prisma.veiculoDocumento.findMany({
          where: { veiculoId: { in: ids }, dataVencimento: { not: null } },
          select: { veiculoId: true, nome: true, dataVencimento: true },
          orderBy: { dataVencimento: "asc" },
        })
      : Promise.resolve([]),
    ids.length
      ? prisma.checklistPreenchido.findMany({
          where: { veiculoId: { in: ids }, criadoEm: { gte: inicioHoje } },
          select: { veiculoId: true, status: true }, orderBy: { criadoEm: "desc" },
        })
      : Promise.resolve([]),
    prisma.checklistTemplate.count({ where: { empresaId, ativo: true } }),
  ]);
  const comFoto = new Set(comFotoRows.map((r) => r.id));
  const docMaisProximo = new Map<string, { nome: string; data: Date }>();
  for (const d of docs) if (!docMaisProximo.has(d.veiculoId)) docMaisProximo.set(d.veiculoId, { nome: d.nome, data: d.dataVencimento! });
  const checklistHoje = new Map<string, string>();
  for (const c of checklistsHoje) if (!checklistHoje.has(c.veiculoId)) checklistHoje.set(c.veiculoId, c.status);

  // ── Indicadores (chips clicáveis): no escopo do filtro de tipo, sem o próprio status/aviso ──
  const escopo = montarWhereVeiculos(empresaId, { ...f, q: "" }, { status: true, aviso: true });
  const emUso = { AND: [escopo, { status: { not: "INATIVO" as const } }] };
  const contar = (extra: object | null) => prisma.veiculo.count({ where: { AND: [emUso, extra ?? {}] } });
  const [ativos, manutencao, inativos, docVencido, docVencendo, revisaoVencida, revisaoProxima, semChecklist] = await Promise.all([
    prisma.veiculo.count({ where: emUso }),
    contar({ status: "MANUTENCAO" }),
    prisma.veiculo.count({ where: { AND: [escopo, { status: "INATIVO" }] } }),
    contar(whereAviso("doc_vencido")),
    contar(whereAviso("doc_vencendo")),
    contar(whereAviso("revisao_vencida")),
    contar(whereAviso("revisao_proxima")),
    templatesAtivos > 0 ? contar(whereAviso("sem_checklist")) : Promise.resolve(null),
  ]);

  const itens: VeiculoLinha[] = linhas.map((v) => {
    // Documento: o que vence primeiro entre os documentos e o seguro
    const doc = docMaisProximo.get(v.id);
    const candidatos = [doc && { nome: doc.nome, data: doc.data }, v.seguroVencimento && { nome: "Seguro", data: v.seguroVencimento }]
      .filter(Boolean) as { nome: string; data: Date }[];
    const primeiro = candidatos.sort((a, b) => a.data.getTime() - b.data.getTime())[0];
    const situacaoDoc = !primeiro ? null : primeiro.data < inicioHoje ? "vencido" : primeiro.data < limite ? "vencendo" : null;
    // Revisão: pela data ou pela quilometragem já alcançada
    const kmVencida = v.proximaRevisaoKm != null && v.quilometragemAtual != null && v.quilometragemAtual >= v.proximaRevisaoKm;
    const situacaoRev = (v.proximaRevisaoData && v.proximaRevisaoData < inicioHoje) || kmVencida
      ? "vencida" : v.proximaRevisaoData && v.proximaRevisaoData < limite ? "proxima" : null;
    return {
      id: v.id,
      placa: v.placa,
      marca: v.marca,
      modelo: v.modelo,
      ano: v.ano,
      anoModelo: v.anoModelo,
      combustivel: v.combustivel,
      cor: v.cor,
      tipo: v.tipo,
      tipoLabel: TIPOS_VEICULO[v.tipo] ?? v.tipo,
      status: v.status,
      km: v.quilometragemAtual,
      // Capa (Frente) servida sob demanda; ?v= invalida o cache quando o veículo muda
      foto: comFoto.has(v.id) ? `/api/veiculos/${v.id}/foto?v=${v.atualizadoEm.getTime()}` : null,
      responsavel: v.responsavel?.nome ?? null,
      equipe: v.equipe ? { nome: v.equipe.nome, cor: v.equipe.cor } : null,
      documento: situacaoDoc ? { situacao: situacaoDoc, nome: primeiro.nome, data: primeiro.data.toISOString() } : null,
      revisao: situacaoRev
        ? { situacao: situacaoRev, data: v.proximaRevisaoData?.toISOString() ?? null, km: kmVencida ? v.proximaRevisaoKm : null }
        : null,
      // null = empresa não usa checklist (sem modelo ativo) ou veículo inativo
      checklistHoje: templatesAtivos > 0 && v.status !== "INATIVO" ? (checklistHoje.get(v.id) ?? "nao") : null,
    };
  });

  return (
    <SelecaoMassaProvider entidade="veiculos" idsPagina={itens.map((i) => i.id)} total={total}>
    <VeiculosListaClient
      itens={itens}
      total={total}
      filtros={f}
      tipos={Object.entries(TIPOS_VEICULO).map(([value, label]) => ({ value, label }))}
      resumo={{ ativos, manutencao, inativos, docVencido, docVencendo, revisaoVencida, revisaoProxima, semChecklist }}
    />
    <BarraAcoesMassa />
    </SelecaoMassaProvider>
  );
}
