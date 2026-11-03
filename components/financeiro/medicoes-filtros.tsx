"use client";

import { BarraPeriodo, type PeriodoTela } from "@/components/listagem/periodo-cards";
import { BarraFiltros } from "@/components/listagem/barra-filtros";
import { BuscaUrl, FiltroSelectUrl, useListaUrl } from "@/components/listagem/lista-url";
import type { Opcao } from "@/components/listagem/listagem-ui";

/**
 * Medições (Faturas) na barra enxuta do padrão da casa: período pela DATA DE CRIAÇÃO (por padrão
 * todo o período), busca e "Mais filtros" (status, tipo, cliente). A lista é do servidor: isto só
 * mexe na URL.
 */
export function FiltrosMedicoes({ periodo, opcoes }: { periodo: PeriodoTela; opcoes: { status: Opcao[]; tipos: Opcao[]; clientes: Opcao[] } }) {
  const { navegar } = useListaUrl();
  return (
    <BarraFiltros
      periodo={<BarraPeriodo rotulo="Criação" periodo={periodo} navegar={navegar} permitirTodos dica="Pela data de criação da medição." />}
      busca={<BuscaUrl lista="medicoes" placeholder="Pesquisar" rotulo="Buscar medições" />}
      paramBusca="busca" navegar={navegar}
      filtros={[
        { id: "status", label: "Status", params: ["status"], render: () => <FiltroSelectUrl param="status" vazio="Todos status" opcoes={opcoes.status} rotulo="Status" className="w-full" /> },
        { id: "tipo", label: "Tipo", params: ["tipo"], render: () => <FiltroSelectUrl param="tipo" vazio="Todos tipos" opcoes={opcoes.tipos} rotulo="Tipo" className="w-full" /> },
        { id: "clienteId", label: "Cliente", params: ["clienteId"], render: () => <FiltroSelectUrl param="clienteId" vazio="Todos clientes" opcoes={opcoes.clientes} rotulo="Cliente" className="w-full" /> },
      ]}
    />
  );
}
