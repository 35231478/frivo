"use client";

import { BarraPeriodo, type PeriodoTela } from "@/components/listagem/periodo-cards";
import { BarraFiltros, filtroCancelados } from "@/components/listagem/barra-filtros";
import { BuscaUrl, FiltroSelectUrl, useListaUrl } from "@/components/listagem/lista-url";
import { FILTRO_AGUARDANDO_PEDIDO } from "@/lib/pedido-cliente/where";
import { DICA_FILTRO_AGUARDANDO } from "@/lib/pedido-cliente/regra";
import type { Opcao } from "@/components/listagem/listagem-ui";

/**
 * Medições (Faturas) na barra enxuta do padrão da casa: período pela DATA DE CRIAÇÃO (por padrão
 * todo o período), busca e "Mais filtros" (status, tipo, cliente). A lista é do servidor: isto só
 * mexe na URL.
 */
export function FiltrosMedicoes({ periodo, opcoes, resumoPedido = null }: {
  periodo: PeriodoTela; opcoes: { status: Opcao[]; tipos: Opcao[]; clientes: Opcao[] };
  /** O filtro rápido "Aguardando pedido" (contagem e R$); null = a empresa não tem cliente que exige pedido */
  resumoPedido?: { quantidade: number; total: number } | null;
}) {
  const { navegar } = useListaUrl();
  return (
    <BarraFiltros
      periodo={<BarraPeriodo rotulo="Criação" periodo={periodo} navegar={navegar} permitirTodos dica="Pela data de criação da medição." />}
      busca={<BuscaUrl lista="medicoes" placeholder="Pesquisar" rotulo="Pesquisar medições" />}
      paramBusca="busca" navegar={navegar}
      rapidos={resumoPedido ? [{ param: "pedido", valor: FILTRO_AGUARDANDO_PEDIDO, rotulo: "Aguardando pedido", quantidade: resumoPedido.quantidade, total: resumoPedido.total, dica: DICA_FILTRO_AGUARDANDO }] : []}
      filtros={[
        { id: "status", label: "Status", params: ["status"], render: () => <FiltroSelectUrl param="status" vazio="Todos status" opcoes={opcoes.status} rotulo="Status" className="w-full" /> },
        { id: "tipo", label: "Tipo", params: ["tipo"], render: () => <FiltroSelectUrl param="tipo" vazio="Todos tipos" opcoes={opcoes.tipos} rotulo="Tipo" className="w-full" /> },
        { id: "clienteId", label: "Cliente", params: ["clienteId"], render: () => <FiltroSelectUrl param="clienteId" vazio="Todos clientes" opcoes={opcoes.clientes} rotulo="Cliente" className="w-full" /> },
        filtroCancelados(navegar, "Mostrar canceladas"),
      ]}
    />
  );
}
