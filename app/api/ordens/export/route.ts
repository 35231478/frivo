import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatarData, LABELS_STATUS_OS, LABELS_PRIORIDADE } from "@/lib/utils";

const SORT_MAP: Record<string, (dir: "asc" | "desc") => any> = {
  numero: (dir) => ({ numero: dir }),
  cliente: (dir) => ({ cliente: { nome: dir } }),
  criadoEm: (dir) => ({ criadoEm: dir }),
  previsaoConclusao: (dir) => ({ previsaoConclusao: dir }),
  status: (dir) => ({ status: dir }),
  prioridade: (dir) => ({ prioridade: dir }),
};

function csvCampo(v: string | null | undefined): string {
  const s = (v ?? "").replace(/"/g, '""');
  return `"${s}"`;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return new Response("Não autorizado", { status: 401 });
  const empresaId = session.user!.empresaId;
  const sp = req.nextUrl.searchParams;

  const statusList = (sp.get("status") ?? "").split(",").filter(Boolean);
  const prioridadeList = (sp.get("prioridade") ?? "").split(",").filter(Boolean);
  const sort = sp.get("sort") && SORT_MAP[sp.get("sort")!] ? sp.get("sort")! : "criadoEm";
  const dir: "asc" | "desc" = sp.get("dir") === "asc" ? "asc" : "desc";

  const where: any = { empresaId };
  if (statusList.length) where.status = { in: statusList };
  if (prioridadeList.length) where.prioridade = { in: prioridadeList };
  if (sp.get("origem")) where.origem = sp.get("origem");
  if (sp.get("clienteId")) where.clienteId = sp.get("clienteId");
  if (sp.get("responsavelId")) where.responsavelId = sp.get("responsavelId");
  if (sp.get("contratoId")) where.contratoId = sp.get("contratoId");
  if (sp.get("tipoOsId")) where.atividades = { some: { tipoOsId: sp.get("tipoOsId") } };
  if (sp.get("numero")) where.numero = { contains: sp.get("numero")!, mode: "insensitive" };
  if (sp.get("dataInicio") || sp.get("dataFim")) {
    where.criadoEm = {};
    if (sp.get("dataInicio")) where.criadoEm.gte = new Date(sp.get("dataInicio")!);
    if (sp.get("dataFim")) { const f = new Date(sp.get("dataFim")!); f.setHours(23, 59, 59, 999); where.criadoEm.lte = f; }
  }
  if (sp.get("busca")) {
    const b = sp.get("busca")!;
    where.OR = [
      { numero: { contains: b, mode: "insensitive" } },
      { chamadoNumero: { contains: b, mode: "insensitive" } },
      { descricao: { contains: b, mode: "insensitive" } },
      { cliente: { nome: { contains: b, mode: "insensitive" } } },
    ];
  }

  const ordens = await prisma.ordemServico.findMany({
    where,
    include: {
      cliente: { select: { nome: true, nomeFantasia: true } },
      responsavel: { select: { nome: true } },
      atividades: { select: { tipoOs: { select: { nome: true } } } },
    },
    orderBy: SORT_MAP[sort](dir),
    take: 5000,
  });

  const cabecalho = ["Número", "Cliente", "Tipo", "Status", "Prioridade", "Técnico", "Data abertura", "Previsão", "Conclusão"];
  const linhas = ordens.map((o) => {
    const tipos = [...new Set(o.atividades.map((a) => a.tipoOs?.nome).filter(Boolean))].join(" / ");
    return [
      o.chamadoNumero ?? o.numero,
      o.cliente.nomeFantasia ?? o.cliente.nome,
      tipos || "—",
      LABELS_STATUS_OS[o.status] ?? o.status,
      LABELS_PRIORIDADE[o.prioridade] ?? o.prioridade,
      o.responsavel?.nome ?? "—",
      formatarData(o.criadoEm),
      o.previsaoConclusao ? formatarData(o.previsaoConclusao) : "—",
      o.dataConclusao ? formatarData(o.dataConclusao) : "—",
    ].map(csvCampo).join(";");
  });

  // BOM + separador ";" para abrir corretamente no Excel pt-BR
  const csv = "﻿" + [cabecalho.map(csvCampo).join(";"), ...linhas].join("\r\n");
  const dataArquivo = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ordens-servico-${dataArquivo}.csv"`,
    },
  });
}
