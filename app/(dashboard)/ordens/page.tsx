import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { carregarListaOs, type SPOrdens } from "@/lib/os/lista-server";
import { OrdensListaClient } from "@/components/ordens/ordens-lista-client";
import { SelecaoMassaProvider } from "@/components/acoes-massa/selecao";
import { BarraAcoesMassa } from "@/components/acoes-massa/barra";
import { AcaoMassaPedido } from "@/components/pedido-cliente/acao-massa-pedido";

export const metadata: Metadata = { title: "Ordens de serviço" };

/** A lista de OS: o carregamento (duas ondas de consultas em paralelo) está em lib/os/lista-server. */
export default async function OrdensPage({ searchParams }: { searchParams: Promise<SPOrdens> }) {
  const sp = await searchParams;
  const session = await auth();
  const { total, pagina, porPagina, periodo, linhas, opcoes, resumoPedido, semAgendamento } = await carregarListaOs(session!.user!.empresaId, sp);

  return (
    <SelecaoMassaProvider entidade="ordens" idsPagina={linhas.map((o) => o.id)} total={total}>
    <OrdensListaClient ordens={linhas} total={total} pagina={pagina} porPagina={porPagina} periodo={periodo} opcoes={opcoes} resumoPedido={resumoPedido} semAgendamento={semAgendamento} />
    <BarraAcoesMassa extra={resumoPedido ? <AcaoMassaPedido /> : null} />
    </SelecaoMassaProvider>
  );
}
