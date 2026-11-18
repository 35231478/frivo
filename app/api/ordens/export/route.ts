import { NextRequest } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { formatarData, LABELS_STATUS_OS, LABELS_PRIORIDADE } from "@/lib/utils";
import { chaveHojeBR } from "@/lib/fuso";
import { whereOrdens } from "@/lib/listas/filtros";
import { atrasoJustificado, prazoEfetivo, rotuloMotivoAtraso, situacaoPrazoExecucao } from "@/lib/os/prazo-execucao";
import { formatarDiaCivil, textoPrazo } from "@/lib/os/prazos";

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
  const guard = await exigirPermissao("ordens", "visualizar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const sp = req.nextUrl.searchParams;

  const sort = sp.get("sort") && SORT_MAP[sp.get("sort")!] ? sp.get("sort")! : "criadoEm";
  const dir: "asc" | "desc" = sp.get("dir") === "asc" ? "asc" : "desc";

  // O MESMO filtro da lista (lib/listas/filtros.ts): o arquivo traz o que a tela está mostrando —
  // período, busca, status, prazo (atrasadas, vencem hoje, justificadas) e os demais.
  const agora = new Date();
  const where = whereOrdens(empresaId, Object.fromEntries(sp), agora);

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

  const cabecalho = ["Número", "Cliente", "Tipo", "Status", "Prioridade", "Técnico", "Data abertura", "Data prevista", "Prazo", "Situação do prazo", "Atraso justificado", "Conclusão"];
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
      o.previsaoConclusao ? formatarDiaCivil(o.previsaoConclusao) : "—",
      // o prazo de execução que vale (o próprio ou, sem ele, o dia previsto) e a situação dele hoje
      formatarDiaCivil(prazoEfetivo(o)),
      prazoEfetivo(o) ? textoPrazo(situacaoPrazoExecucao(o, agora), true) : "—",
      atrasoJustificado(o) ? [rotuloMotivoAtraso(o.atrasoJustificadoMotivo), o.atrasoJustificadoObs].filter(Boolean).join(": ") : "—",
      o.dataConclusao ? formatarData(o.dataConclusao) : "—",
    ].map(csvCampo).join(";");
  });

  // BOM + separador ";" para abrir corretamente no Excel pt-BR
  const csv = "﻿" + [cabecalho.map(csvCampo).join(";"), ...linhas].join("\r\n");
  const dataArquivo = chaveHojeBR();

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ordens-servico-${dataArquivo}.csv"`,
    },
  });
}
