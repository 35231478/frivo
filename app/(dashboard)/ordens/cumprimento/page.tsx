import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { lerPeriodo, periodoTela, PARAMS_PERIODO } from "@/lib/periodo";
import { PageHeader } from "@/components/ui/page-header";
import { ListaUrl } from "@/components/listagem/lista-url";
import { CumprimentoClient } from "@/components/prazos/cumprimento-client";
import { relatorioCumprimento } from "@/lib/prazos/cumprimento-server";
import { comparaNatural } from "@/lib/utils";

export const metadata: Metadata = { title: "Cumprimento de prazos" };

const AJUDA =
  "Como andou o cumprimento do que foi prometido no período: o prazo de atendimento do contrato (comparecer e resolver) e o prazo de execução da OS. O período olha a abertura do chamado — sem chamado, a abertura da OS.";

type SP = { clienteId?: string; contratoId?: string; periodo?: string; mes?: string; de?: string; ate?: string; ref?: string };

/**
 * RELATÓRIO DE CUMPRIMENTO DE PRAZOS (Operações › Cumprimento de prazos).
 *
 * Permissão: Relatórios › Visualizar abre a tela; Relatórios › Exportar libera o PDF do cliente.
 * Sem a primeira, nem a página existe — quem chega pelo endereço volta para a lista de OS.
 */
export default async function CumprimentoPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const session = await auth();
  const u = session!.user!;
  if (!pode(u.permissoes, "relatorios", "visualizar", u.role)) redirect("/ordens");
  const empresaId = u.empresaId;

  const agora = new Date();
  const periodo = lerPeriodo(sp, agora, { permitirTodos: true, padrao: "mes" });
  const clienteId = sp.clienteId || null;
  const contratoId = sp.contratoId || null;

  const [relatorio, clientes, contratos] = await Promise.all([
    relatorioCumprimento(empresaId, { gte: periodo.gte ?? undefined, lt: periodo.lt ?? undefined, clienteId, contratoId }, agora),
    prisma.cliente.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true, nomeFantasia: true } }),
    prisma.contrato.findMany({ where: { empresaId }, select: { id: true, numero: true }, orderBy: { numero: "desc" }, take: 300 }),
  ]);

  // O PDF é o retrato desta tela: os mesmos parâmetros, na mesma ordem
  const params = new URLSearchParams();
  for (const k of Object.keys(PARAMS_PERIODO)) { const v = (sp as Record<string, string | undefined>)[k]; if (v) params.set(k, v); }
  if (clienteId) params.set("clienteId", clienteId);
  if (contratoId) params.set("contratoId", contratoId);

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader title="Cumprimento de prazos" description="O que foi prometido e o que foi cumprido" dica={AJUDA} backHref="/ordens" />
      <ListaUrl chave="cumprimento-prazos" qAtual="">
        <CumprimentoClient
          periodo={periodoTela(periodo)}
          resumo={relatorio.resumo}
          linhas={relatorio.linhas}
          semPrazo={relatorio.semPrazo}
          opcoes={{
            clientes: clientes
              .map((c) => ({ value: c.id, label: c.nomeFantasia || c.nome }))
              .sort((a, b) => comparaNatural(a.label, b.label)),
            contratos: contratos.map((c) => ({ value: c.id, label: c.numero })),
          }}
          podeExportar={pode(u.permissoes, "relatorios", "exportar", u.role)}
          urlPdf={`/api/relatorios/cumprimento-prazos${params.toString() ? `?${params}` : ""}`}
        />
      </ListaUrl>
    </div>
  );
}
