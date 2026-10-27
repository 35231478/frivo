import { SelecaoMassaProvider, CheckboxLinha, CheckboxPagina } from "@/components/acoes-massa/selecao";
import { BarraAcoesMassa } from "@/components/acoes-massa/barra";
import { temAcaoMassa } from "@/lib/acoes-massa/acoes";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { whereOrcamentos } from "@/lib/listas/filtros";
import { cn, formatarData, formatarMoeda, LABELS_TIPO_ORCAMENTO, CLASSE_TIPO_ORCAMENTO } from "@/lib/utils";
import { LABELS_ETAPA, bloqueioEnvio, dataDaEtapa, etapaCiclo } from "@/lib/orcamentos/ciclo";
import { AcoesLinhaOrcamento } from "@/components/orcamento/acoes-linha-orcamento";
import { pode } from "@/lib/permissoes";
import { PilulaEtapa } from "@/components/orcamento/ciclo-orcamento";
import Link from "next/link";
import { Calculator, Plus, X } from "lucide-react";
import { AvatarCliente } from "@/components/ui/avatar-cliente";
import { InativarRegistro } from "@/components/ui/inativar-registro";
import type { Prisma } from "@prisma/client";
import { janela, lerOrdem, lerPaginacao, ordemPrisma, paginaValida } from "@/lib/listagem";
import { ORDEM_ORCAMENTOS, ORDEM_PADRAO_ORCAMENTOS } from "@/lib/listas/ordenacao";
import { BuscaUrl, ConteudoUrl, FiltroCheckUrl, FiltroDataUrl, FiltroSelectUrl, LimparBuscaUrl, ListaUrl, PaginacaoUrl, ThOrdUrl } from "@/components/listagem/lista-url";

export const metadata: Metadata = { title: "Orçamentos" };

export default async function OrcamentosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { busca = "", status = "", tipo = "", clienteId = "", dataInicio = "", dataFim = "", inativos = "", resposta = "" } = sp;
  const session = await auth();
  const empresaId = session!.user!.empresaId;
  const massa = temAcaoMassa(session!.user!.permissoes, session!.user!.role, "orcamentos");
  // Enviar (e-mail/WhatsApp) exige editar orçamentos, como a rota de envio; baixar o PDF basta ver
  const podeEnviar = pode(session!.user!.permissoes, "orcamentos", "editar", session!.user!.role);
  const { pagina: paginaPedida, porPagina } = lerPaginacao(sp);
  const orderBy = ordemPrisma(lerOrdem(sp, ORDEM_ORCAMENTOS), ORDEM_ORCAMENTOS, ORDEM_PADRAO_ORCAMENTOS) as Prisma.OrcamentoOrderByWithRelationInput[];

  const where = whereOrcamentos(empresaId, { busca, status, tipo, clienteId, dataInicio, dataFim, inativos, resposta });
  const agora = new Date();

  const [total, clientes] = await Promise.all([
    prisma.orcamento.count({ where }),
    prisma.cliente.findMany({
      where: { empresaId, ativo: true },
      select: { id: true, nome: true, nomeFantasia: true },
      orderBy: { nome: "asc" },
    }),
  ]);
  const pagina = paginaValida(paginaPedida, porPagina, total);
  const orcamentos = total ? await prisma.orcamento.findMany({
    where,
    include: {
      cliente: { select: { id: true, nome: true, nomeFantasia: true, logo: true } },
      _count: { select: { ordensServico: true } },
    },
    orderBy,
    ...janela(pagina, porPagina),
  }) : [];

  return (
    <SelecaoMassaProvider entidade="orcamentos" idsPagina={orcamentos.map((o) => o.id)} total={total}>
    <ListaUrl chave="orcamentos" paramBusca="busca" qAtual={busca}>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-lg">
            <Calculator className="w-5 h-5 text-primary-600" />
          </div>
          <h1 className="page-title">Orçamentos</h1>
          <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">{total}</span>
        </div>
        <Link
          href="/orcamentos/novo"
          className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm hover:shadow"
        >
          <Plus className="w-4 h-4" /> Novo Orçamento
        </Link>
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-surface-border bg-surface-alt/40">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[220px]">
              <BuscaUrl lista="orcamentos" placeholder="Buscar por código, nome ou cliente…" rotulo="Buscar orçamentos" />
            </div>
            <FiltroSelectUrl param="tipo" vazio="Todos os tipos" opcoes={Object.entries(LABELS_TIPO_ORCAMENTO).map(([value, label]) => ({ value, label }))} />
            <FiltroSelectUrl param="status" vazio="Todos status" opcoes={Object.entries(LABELS_ETAPA).map(([value, label]) => ({ value, label }))} />
            <FiltroSelectUrl param="clienteId" vazio="Todos clientes" opcoes={clientes.map((c) => ({ value: c.id, label: c.nomeFantasia ?? c.nome }))} />
            <FiltroDataUrl param="dataInicio" titulo="Data inicial" />
            <FiltroDataUrl param="dataFim" titulo="Data final" />
            <FiltroCheckUrl param="inativos" rotulo="Mostrar cancelados" />
            {resposta === "nova" && (
              <Link href="/orcamentos" className="inline-flex items-center gap-1.5 rounded-full bg-acento-claro text-acento text-xs font-semibold px-3 py-1.5" data-filtro-resposta>
                Respostas novas do cliente <X className="w-3.5 h-3.5" aria-hidden /><span className="sr-only">Limpar filtro</span>
              </Link>
            )}
          </div>
        </div>

        <ConteudoUrl>
        {orcamentos.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center" data-lista-vazia>
            <p className="text-sm font-medium text-ink">Nenhum orçamento encontrado</p>
            {busca && <p className="text-xs text-ink-muted">Nada combina com “{busca}”.</p>}
            <LimparBuscaUrl />
          </div>
        ) : (
        <>
        {/* Celular: um cartão por orçamento */}
        <ul className="md:hidden divide-y divide-surface-border" data-cartoes>
          {orcamentos.map((o) => (
            <li key={o.id} data-cartao={o.id} className="flex items-start gap-3 px-4 py-3">
              {massa && <span className="pt-0.5"><CheckboxLinha id={o.id} rotulo={o.codigo} /></span>}
              <Link href={`/orcamentos/${o.id}`} className="min-w-0 flex-1">
                <p className="text-sm font-mono font-semibold text-primary-600">{o.codigo}</p>
                <p className="text-sm text-ink font-medium truncate" title={o.nome} data-nome-orcamento>{o.nome}</p>
                <p className="text-xs text-ink-muted truncate">{o.cliente.nomeFantasia ?? o.cliente.nome} · {formatarData(o.criadoEm)}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <PilulaEtapa etapa={etapaCiclo(o, agora)} desde={dataDaEtapa(o, agora)} />
                  <span className="text-sm font-semibold text-ink ml-auto">{formatarMoeda(Number(o.totalGeral))}</span>
                </div>
              </Link>
              <div className="shrink-0 -mr-2">
                <AcoesLinhaOrcamento orcamentoId={o.id} codigo={o.codigo} tokenPublico={o.tokenPublico} podeEnviar={podeEnviar} bloqueio={bloqueioEnvio(o, agora)} />
              </div>
            </li>
          ))}
        </ul>
        <div className="overflow-x-auto hidden md:block">
          <table className="w-full text-sm">
            <thead className="bg-surface-alt border-b border-surface-border">
              <tr>
                {massa && <th className="w-px pl-4 pr-1 py-3"><CheckboxPagina /></th>}
                <ThOrdUrl label="Código" k="codigo" className="px-3 py-3 text-ink-muted text-xs tracking-wider" />
                <ThOrdUrl label="Nome" k="nome" className="px-3 py-3 text-ink-muted text-xs tracking-wider" />
                <ThOrdUrl label="Cliente" k="cliente" className="px-3 py-3 text-ink-muted text-xs tracking-wider" />
                <th className="text-left px-3 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden 2xl:table-cell">Tipo</th>
                <ThOrdUrl label="Status" k="status" className="px-3 py-3 text-ink-muted text-xs tracking-wider" />
                <ThOrdUrl label="Total" k="valor" className="px-3 py-3 text-ink-muted text-xs tracking-wider" />
                <th className="text-center px-3 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden 2xl:table-cell">OS</th>
                <ThOrdUrl label="Criado" k="criado" padrao="criado" className="px-3 py-3 text-ink-muted text-xs tracking-wider hidden lg:table-cell" />
                <th className="px-2 py-3"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {orcamentos.map((o, idx) => (
                  <tr
                    key={o.id}
                    className={cn(
                      "border-b border-surface-border hover:bg-primary-50/40 transition-colors",
                      idx % 2 === 1 && "bg-surface-alt/30",
                    )}
                  >
                    {massa && <td className="w-px pl-4 pr-1 py-3"><CheckboxLinha id={o.id} rotulo={o.codigo} /></td>}
                    <td className="px-3 py-3 whitespace-nowrap">
                      <Link href={`/orcamentos/${o.id}`} className="font-mono font-semibold text-primary-600 hover:underline">
                        {o.codigo}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-ink font-medium max-w-[15rem]">
                      {/* Uma linha só: o nome inteiro aparece no hover */}
                      <span className="block truncate" title={o.nome} data-nome-orcamento>{o.nome}</span>
                    </td>
                    <td className="px-3 py-3 text-ink-muted max-w-[13rem]">
                      <div className="flex items-center gap-2 min-w-0">
                        <AvatarCliente nome={o.cliente.nomeFantasia ?? o.cliente.nome} logoUrl={o.cliente.logo} size={28} />
                        <span className="truncate" title={o.cliente.nomeFantasia ?? o.cliente.nome}>{o.cliente.nomeFantasia ?? o.cliente.nome}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 hidden 2xl:table-cell">
                      <span className={CLASSE_TIPO_ORCAMENTO[o.tipo]}>
                        {LABELS_TIPO_ORCAMENTO[o.tipo]}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <PilulaEtapa etapa={etapaCiclo(o, agora)} desde={dataDaEtapa(o, agora)} />
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-ink whitespace-nowrap">
                      {formatarMoeda(Number(o.totalGeral))}
                    </td>
                    <td className="px-3 py-3 text-center text-ink-muted hidden 2xl:table-cell">
                      {o._count.ordensServico}
                    </td>
                    <td className="px-3 py-3 text-ink-muted hidden lg:table-cell whitespace-nowrap">
                      {formatarData(o.criadoEm)}
                    </td>
                    <td className="px-2 py-3 text-right">
                      <div className="flex items-center justify-end gap-0.5">
                      <AcoesLinhaOrcamento orcamentoId={o.id} codigo={o.codigo} tokenPublico={o.tokenPublico} podeEnviar={podeEnviar} bloqueio={bloqueioEnvio(o, agora)} />
                      <InativarRegistro
                        url={`/api/orcamentos/${o.id}`} modulo="orcamentos" acaoReativar="editar"
                        ativo={o.status !== "CANCELADO"} nome={o.codigo} entidade="orçamento"
                        rotuloInativar="Cancelar" rotuloReativar="Reabrir" comMotivo={false}
                        textoInativar="Tem certeza? O orçamento passa para Cancelado e sai da lista padrão. Nada é apagado: itens, vínculos e o link público ficam preservados, e ele pode ser reaberto (volta para Rascunho)."
                        textoReativar="O orçamento volta para Rascunho (editável) e reaparece na lista."
                      />
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        </>
        )}
        </ConteudoUrl>
        <div className="px-4 py-3 border-t border-surface-border">
          <PaginacaoUrl total={total} pagina={pagina} porPagina={porPagina} rotulo="orçamentos" />
        </div>
      </div>
    </div>
    </ListaUrl>
    <BarraAcoesMassa />
    </SelecaoMassaProvider>
  );
}
