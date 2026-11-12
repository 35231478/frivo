import { NextRequest, NextResponse } from "next/server";
import { exigirAlgumaPermissao } from "@/lib/permissoes-server";
import { atorDaSessao, carregarContexto } from "@/lib/execucao/contexto";
import { carregarConfigApp } from "@/lib/tecnico/config-app-server";
import { MSG_CADASTRO_DESLIGADO } from "@/lib/tecnico/cadastro-equipamento";
import { equipamentosComSerie } from "@/lib/execucao/cadastro-campo";
import { ambienteEquipamento, descricaoEquipamento, fabricanteModelo } from "@/lib/equipamento-descricao";

type Params = { params: Promise<{ atividadeId: string }> };

/**
 * GET /api/tecnico/atividades/<id>/serie?numero=XYZ[&ignorar=<id>]
 * Cadastro em campo: a conferência COMPLETA do nº de série contra a empresa (só com sinal). Serve só
 * para AVISAR — não bloqueia nada.
 *
 * Privacidade: o técnico só enxerga o cliente da OS dele. Equipamento com a mesma série…
 *  - …do MESMO cliente da OS: volta com descrição e ambiente (e a unidade, se a empresa deixa o app
 *    exibir dados do cliente);
 *  - …de OUTRO cliente: só entra na contagem `outrosClientes` — nome de cliente/unidade nunca sai.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const guard = await exigirAlgumaPermissao([["ordens", "editar"], ["ordens", "concluir"]]);
  if (guard.erro) return guard.resposta;
  const { atividadeId } = await params;
  const ctx = await carregarContexto(atorDaSessao(guard.session), atividadeId);
  if (!ctx.ok) return ctx.resposta;
  const config = await carregarConfigApp(ctx.empresaId);
  if (!config.cadastrarEquipamento) return NextResponse.json({ erro: MSG_CADASTRO_DESLIGADO }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const achados = await equipamentosComSerie(ctx.empresaId, searchParams.get("numero") ?? "", searchParams.get("ignorar") ?? "");
  const clienteDaOs = ctx.atividade.ordemServico.clienteId;
  const doCliente = achados.filter((e) => e.unidade.clienteId === clienteDaOs);

  return NextResponse.json({
    doCliente: doCliente.map((e) => {
      const amb = ambienteEquipamento(e, null);
      return {
        id: e.id,
        titulo: (e.nome ?? "").trim() || descricaoEquipamento(e),
        fabricante: fabricanteModelo(e),
        local: [config.exibirDadosCliente ? e.unidade.nome : null, amb.principal, amb.complemento].filter(Boolean).join(" › ") || null,
        ativo: e.ativo,
      };
    }),
    outrosClientes: achados.length - doCliente.length,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
