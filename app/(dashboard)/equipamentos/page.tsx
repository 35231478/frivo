import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LABELS_TIPO_EQUIPAMENTO } from "@/lib/utils";
import { lerFiltros, montarWhere, montarOrderBy } from "@/lib/equipamento-listagem";
import { ultimosAtendimentos } from "@/lib/equipamento-indicadores";
import { DIAS_AVISO_GARANTIA } from "@/lib/equipamento-garantia";
import { EquipamentosListaClient, type EquipLinha } from "./equipamentos-lista-client";

export const metadata: Metadata = { title: "Equipamentos" };

const selectLinha = {
  id: true, nome: true, marca: true, modelo: true, numeroSerie: true, patrimonio: true,
  tipo: true, capacidade: true, setor: true, localizacao: true, garantiaAte: true, ativo: true,
  atualizadoEm: true,
  tipoEquipamento: { select: { nome: true } },
  qrcode: { select: { id: true } },
  unidade: { select: { id: true, nome: true, cliente: { select: { id: true, nome: true, nomeFantasia: true } } } },
} as const;

export default async function EquipamentosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  const empresaId = session!.user!.empresaId;
  const f = lerFiltros(await searchParams);
  const where = montarWhere(empresaId, f);
  const skip = (f.pagina - 1) * f.porPagina;

  // ── Página atual ──
  let total: number;
  let linhas: Awaited<ReturnType<typeof buscarPagina>>;
  let ultimos: Map<string, Date>;

  async function buscarPagina(ids?: string[]) {
    return prisma.equipamento.findMany({
      where: ids ? { id: { in: ids } } : where,
      select: selectLinha,
      ...(ids ? {} : { orderBy: montarOrderBy(f), skip, take: f.porPagina }),
    });
  }

  if (f.ordem === "ultimo") {
    // "Último atendimento" é derivado (OS + atividades): ordena os ids filtrados em memória
    // e busca só a página. Leve mesmo com milhares (só ids + 2 agregações).
    const todos = await prisma.equipamento.findMany({ where, select: { id: true } });
    total = todos.length;
    ultimos = await ultimosAtendimentos(empresaId, todos.map((t) => t.id));
    const sinal = f.dir === "asc" ? 1 : -1;
    const ordenados = todos.map((t) => t.id).sort((a, b) => {
      const da = ultimos.get(a)?.getTime(), db = ultimos.get(b)?.getTime();
      if (da === undefined && db === undefined) return 0;
      if (da === undefined) return 1; // sem atendimento sempre por último
      if (db === undefined) return -1;
      return (da - db) * sinal;
    });
    const ids = ordenados.slice(skip, skip + f.porPagina);
    const pagina = await buscarPagina(ids);
    const pos = new Map(ids.map((id, i) => [id, i]));
    linhas = pagina.sort((a, b) => pos.get(a.id)! - pos.get(b.id)!);
  } else {
    [linhas, total] = await Promise.all([buscarPagina(), prisma.equipamento.count({ where })]);
    ultimos = await ultimosAtendimentos(empresaId, linhas.map((l) => l.id));
  }

  // Quais itens da página têm foto (sem trafegar as imagens, que são base64)
  const comFoto = new Set(
    linhas.length
      ? (await prisma.$queryRaw<{ id: string }[]>`
          SELECT id FROM equipamentos WHERE id = ANY(${linhas.map((l) => l.id)}) AND cardinality(fotos) > 0
        `).map((r) => r.id)
      : [],
  );

  // ── Opções dos filtros ──
  const escopoLocal = {
    empresaId,
    ...(f.cliente ? { unidade: { clienteId: f.cliente } } : {}),
    ...(f.unidade ? { unidadeId: f.unidade } : {}),
  };
  const [clientes, unidades, setores, fluidos] = await Promise.all([
    prisma.cliente.findMany({
      where: { empresaId, unidades: { some: { equipamentos: { some: {} } } } },
      select: { id: true, nome: true, nomeFantasia: true },
      orderBy: { nome: "asc" },
    }),
    f.cliente
      ? prisma.unidade.findMany({
          where: { empresaId, clienteId: f.cliente, equipamentos: { some: {} } },
          select: { id: true, nome: true, cidade: true },
          orderBy: { nome: "asc" },
        })
      : Promise.resolve([]),
    prisma.equipamento.findMany({
      where: { ...escopoLocal, setor: { not: null } },
      distinct: ["setor"], select: { setor: true }, orderBy: { setor: "asc" }, take: 300,
    }),
    prisma.equipamento.findMany({
      where: { empresaId, fluido: { not: null } },
      distinct: ["fluido"], select: { fluido: true }, orderBy: { fluido: "asc" }, take: 50,
    }),
  ]);

  // ── Resumo (chips clicáveis): parque ativo no escopo de cliente/local ──
  const hoje = new Date();
  const limite = new Date(hoje.getTime() + DIAS_AVISO_GARANTIA * 86_400_000);
  const baseResumo = { ...escopoLocal, ativo: true };
  const [ativos, vencendo, vencidas, semQr] = await Promise.all([
    prisma.equipamento.count({ where: baseResumo }),
    prisma.equipamento.count({ where: { ...baseResumo, garantiaAte: { gte: hoje, lte: limite } } }),
    prisma.equipamento.count({ where: { ...baseResumo, garantiaAte: { lt: hoje } } }),
    prisma.equipamento.count({ where: { ...baseResumo, qrcode: { is: null } } }),
  ]);

  const itens: EquipLinha[] = linhas.map((e) => ({
    id: e.id,
    nome: e.nome || `${e.marca} ${e.modelo}`,
    temNome: !!e.nome,
    marca: e.marca,
    modelo: e.modelo,
    numeroSerie: e.numeroSerie,
    patrimonio: e.patrimonio,
    tipo: e.tipo,
    tipoLabel: e.tipoEquipamento?.nome ?? LABELS_TIPO_EQUIPAMENTO[e.tipo] ?? e.tipo,
    capacidade: e.capacidade,
    setor: e.setor,
    ambiente: e.localizacao,
    garantiaAte: e.garantiaAte?.toISOString() ?? null,
    ativo: e.ativo,
    qrcodeId: e.qrcode?.id ?? null,
    // Miniatura servida sob demanda (?v= invalida o cache quando o equipamento muda)
    foto: comFoto.has(e.id) ? `/api/equipamentos/${e.id}/foto?v=${e.atualizadoEm.getTime()}` : null,
    clienteId: e.unidade.cliente.id,
    cliente: e.unidade.cliente.nomeFantasia ?? e.unidade.cliente.nome,
    unidadeId: e.unidade.id,
    unidade: e.unidade.nome,
    ultimoAtendimento: ultimos.get(e.id)?.toISOString() ?? null,
  }));

  return (
    <EquipamentosListaClient
      itens={itens}
      total={total}
      filtros={f}
      opcoes={{
        clientes: clientes.map((c) => ({ value: c.id, label: c.nomeFantasia ?? c.nome })),
        unidades: unidades.map((u) => ({ value: u.id, label: u.cidade ? `${u.nome} — ${u.cidade}` : u.nome })),
        setores: setores.map((s) => s.setor!).filter(Boolean),
        fluidos: fluidos.map((x) => x.fluido!).filter(Boolean),
        tipos: Object.entries(LABELS_TIPO_EQUIPAMENTO).map(([value, label]) => ({ value, label })),
      }}
      resumo={{ ativos, vencendo, vencidas, semQr }}
    />
  );
}
