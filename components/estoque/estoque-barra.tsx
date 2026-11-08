"use client";

import { BarraFiltros } from "@/components/listagem/barra-filtros";
import { BuscaUrl, FiltroCheckUrl, FiltroSelectUrl, useListaUrl } from "@/components/listagem/lista-url";
import { BarraPeriodo, type PeriodoTela } from "@/components/listagem/periodo-cards";
import { CampoBusca, type Opcao } from "@/components/listagem/listagem-ui";

/** A barra enxuta da tela Estoque (padrão da casa): busca por produto + "Mais filtros" (situação, inativos). */
export function BarraEstoque({ situacoes }: { situacoes: Opcao[] }) {
  const { navegar } = useListaUrl();
  return (
    <BarraFiltros
      busca={<BuscaUrl lista="estoque" placeholder="Pesquisar produto" rotulo="Pesquisar produtos no estoque" />}
      paramBusca="busca" navegar={navegar}
      filtros={[
        { id: "situacao", label: "Situação", params: ["situacao"], render: () => <FiltroSelectUrl param="situacao" vazio="Todas as situações" opcoes={situacoes} rotulo="Situação" className="w-full" /> },
        { id: "inativos", label: "Inativos", params: ["inativos"], render: () => <FiltroCheckUrl param="inativos" rotulo="Mostrar inativos" /> },
      ]}
    />
  );
}

/** O período do extrato (pela DATA da movimentação; padrão: todo o período) + os filtros de tipo/origem. */
export function BarraExtrato({ periodo, tipos, origens }: { periodo: PeriodoTela; tipos: Opcao[]; origens: Opcao[] }) {
  const { navegar, busca, setBusca, pendente } = useListaUrl();
  return (
    <BarraFiltros
      periodo={<BarraPeriodo rotulo="Movimentação" periodo={periodo} navegar={navegar} permitirTodos dica="Pela data em que a movimentação foi lançada." />}
      busca={<CampoBusca valor={busca} onChange={setBusca} placeholder="Pesquisar na observação (NF, motivo…)" rotulo="Pesquisar movimentações" carregando={pendente} />}
      paramBusca="busca" navegar={navegar}
      filtros={[
        { id: "tipo", label: "Tipo", params: ["tipo"], render: () => <FiltroSelectUrl param="tipo" vazio="Todos os tipos" opcoes={tipos} rotulo="Tipo" className="w-full" /> },
        { id: "origem", label: "Origem", params: ["origem"], render: () => <FiltroSelectUrl param="origem" vazio="Todas as origens" opcoes={origens} rotulo="Origem" className="w-full" /> },
      ]}
    />
  );
}
