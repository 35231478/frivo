import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  cn, formatarData, formatarMoeda, nomeMes,
  LABELS_STATUS_MEDICAO, CLASSE_STATUS_MEDICAO, LABELS_TIPO_MEDICAO,
} from "@/lib/utils";
import Link from "next/link";
import { FileBarChart, Plus } from "lucide-react";
import { GerarMedicoesMes } from "@/components/medicao/gerar-medicoes-mes";
import { janela, lerPaginacao, paginaValida } from "@/lib/listagem";
import { ConteudoUrl, ListaUrl, PaginacaoUrl, TabelaProUrl } from "@/components/listagem/lista-url";
import { PLANILHA, valorSemMoeda } from "@/lib/planilha";
import { AvatarCliente } from "@/components/ui/avatar-cliente";
import { numeroFatura, rotuloStatusMedicao } from "@/lib/faturamento/fatura";

import { lerPeriodo, periodoTela } from "@/lib/periodo";
import { FiltrosMedicoes } from "@/components/financeiro/medicoes-filtros";

export const metadata: Metadata = { title: "Medições" };

export default async function MedicoesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { busca = "", status = "", clienteId = "", tipo = "" } = sp;
  const session = await auth();
  if (!pode(session!.user!.permissoes, "financeiro", "medicoes", session!.user!.role)) redirect("/sem-permissao");
  const empresaId = session!.user!.empresaId;

  const where: any = { empresaId };
  if (status) where.status = status;
  if (clienteId) where.clienteId = clienteId;
  if (tipo) where.tipo = tipo;
  // Período (pela data de criação): o seletor da lista; por padrão todo o período (como sempre foi).
  // Links antigos com dataInicio/dataFim valem como período personalizado.
  const periodo = lerPeriodo({ ...sp, de: sp.de ?? sp.dataInicio, ate: sp.ate ?? sp.dataFim }, new Date(), { permitirTodos: true, padrao: "todos" });
  if (periodo.gte || periodo.lt) where.criadoEm = { ...(periodo.gte && { gte: periodo.gte }), ...(periodo.lt && { lt: periodo.lt }) };
  if (busca) {
    where.OR = [
      { numero: { contains: busca, mode: "insensitive" } },
      { descricao: { contains: busca, mode: "insensitive" } },
      { cliente: { nome: { contains: busca, mode: "insensitive" } } },
    ];
  }

  // UX-4 (Y4): Medições no padrão das listas — paginação de servidor (sem o corte fixo de 100)
  const { pagina: paginaPedida, porPagina } = lerPaginacao(sp);
  const [total, clientes] = await Promise.all([
    prisma.medicao.count({ where }),
    prisma.cliente.findMany({
      where: { empresaId, ativo: true },
      select: { id: true, nome: true, nomeFantasia: true },
      orderBy: { nome: "asc" },
    }),
  ]);
  const pagina = paginaValida(paginaPedida, porPagina, total);
  const medicoes = total
    ? await prisma.medicao.findMany({
        where,
        include: { cliente: { select: { id: true, nome: true, nomeFantasia: true, logo: true } } },
        orderBy: [{ criadoEm: "desc" }, { id: "asc" }],
        ...janela(pagina, porPagina),
      })
    : [];

  return (
    <ListaUrl chave="medicoes" paramBusca="busca" qAtual={busca}>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-lg">
            <FileBarChart className="w-5 h-5 text-primary-600" />
          </div>
          <h1 className="page-title">Medições</h1>
          <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">{total}</span>
        </div>
        <div className="flex items-center gap-2 relative">
          <GerarMedicoesMes />
          <Link
            href="/financeiro/medicoes/nova"
            className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm hover:shadow"
          >
            <Plus className="w-4 h-4" /> Nova Medição
          </Link>
        </div>
      </div>

      <FiltrosMedicoes
        periodo={periodoTela(periodo)}
        opcoes={{
          status: Object.entries(LABELS_STATUS_MEDICAO).map(([value, label]) => ({ value, label })),
          tipos: Object.entries(LABELS_TIPO_MEDICAO).map(([value, label]) => ({ value, label })),
          clientes: clientes.map((c) => ({ value: c.id, label: c.nomeFantasia ?? c.nome })),
        }}
      />

      <div className="card overflow-hidden">
        <ConteudoUrl>
          {medicoes.length === 0 ? (
            <p className="text-center text-ink-subtle py-12" data-lista-vazia>Nenhuma medição encontrada</p>
          ) : (
            <TabelaProUrl
              tela="medicoes"
              cartoes={
                <ul className="divide-y divide-surface-border" data-cartoes>
                  {medicoes.map((m) => {
                    const cliente = m.cliente.nomeFantasia ?? m.cliente.nome;
                    return (
                      <li key={m.id} data-cartao={m.id} className="px-4 py-3">
                        <Link href={m.avulsa ? `/financeiro/faturas/${m.id}` : `/financeiro/medicoes/${m.id}`} className="block min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className={cn(PLANILHA.codigo, "text-primary-600")}>{m.avulsa ? `Fatura ${numeroFatura(m.numero)}` : m.numero}</p>
                            <p className="font-semibold text-ink tabular-nums shrink-0">{formatarMoeda(Number(m.valorLiquido))}</p>
                          </div>
                          <div className="flex items-center gap-2 mt-1 min-w-0">
                            <AvatarCliente nome={cliente} logoUrl={m.cliente.logo} size={24} />
                            <p className="text-sm text-ink font-medium truncate">{cliente}</p>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-xs text-ink-muted">
                            <span className={CLASSE_STATUS_MEDICAO[m.status]}>{rotuloStatusMedicao(m, LABELS_STATUS_MEDICAO)}</span>
                            <span>{m.avulsa ? "Avulsa" : LABELS_TIPO_MEDICAO[m.tipo]}</span>
                            <span>· {m.mes ? `${nomeMes(m.mes)}/${m.ano}` : formatarData(m.criadoEm)}</span>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              }
              colunas={[
                { id: "numero", titulo: "Número", largura: 136, obrigatoria: true },
                { id: "cliente", titulo: "Cliente", obrigatoria: true },
                { id: "tipo", titulo: "Tipo", largura: 128 },
                { id: "referencia", titulo: "Referência", largura: 120 },
                { id: "status", titulo: "Status", largura: 144 },
                { id: "valor", titulo: "Valor (R$)", alinhar: "direita", largura: 120, obrigatoria: true },
              ]}
              linhas={medicoes.map((m) => {
                const cliente = m.cliente.nomeFantasia ?? m.cliente.nome;
                return {
                  id: m.id,
                  atributos: { "data-linha-medicao": m.id },
                  titulos: { cliente },
                  celulas: {
                    numero: <Link href={m.avulsa ? `/financeiro/faturas/${m.id}` : `/financeiro/medicoes/${m.id}`} className={cn(PLANILHA.codigo, "text-primary-600 hover:underline")}>{m.avulsa ? `Fatura ${numeroFatura(m.numero)}` : m.numero}</Link>,
                    cliente: (
                      <div className="flex items-center gap-2 min-w-0">
                        <AvatarCliente nome={cliente} logoUrl={m.cliente.logo} size={24} />
                        <span className={cn(PLANILHA.nome, "truncate")}>{cliente}</span>
                      </div>
                    ),
                    tipo: <span className={PLANILHA.apagado}>{m.avulsa ? "Avulsa" : LABELS_TIPO_MEDICAO[m.tipo]}</span>,
                    referencia: <span className={cn(PLANILHA.data, PLANILHA.apagado)}>{m.mes ? `${nomeMes(m.mes)}/${m.ano}` : formatarData(m.criadoEm)}</span>,
                    status: <span className={CLASSE_STATUS_MEDICAO[m.status]}>{rotuloStatusMedicao(m, LABELS_STATUS_MEDICAO)}</span>,
                    valor: <span className={cn(PLANILHA.numero, "font-semibold text-ink")} data-valor>{valorSemMoeda(Number(m.valorLiquido))}</span>,
                  },
                };
              })}
            />
          )}
        </ConteudoUrl>
        <div className="px-4 py-3 border-t border-surface-border bg-surface-alt/40">
          <PaginacaoUrl total={total} pagina={pagina} porPagina={porPagina} rotulo="medições" />
        </div>
      </div>
    </div>
    </ListaUrl>
  );
}
