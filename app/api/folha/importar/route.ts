import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { ErroPlanilha, MAX_BYTES_PLANILHA, lerPlanilha } from "@/lib/folha/planilha";
import { analisarPlanilha, chaveNome, funcaoPeloCargo, type LinhaImportada } from "@/lib/folha/importacao";

/**
 * Importação de colaboradores por planilha (CSV/XLSX) para o MESMO cadastro de colaboradores.
 * - etapa=previa: só analisa e devolve o que vai acontecer (nada é gravado);
 * - etapa=confirmar: analisa o arquivo DE NOVO no servidor e grava as linhas válidas numa transação.
 * Só "Financeiro › Custo de pessoal"; tudo na empresa da sessão (CPF de outra empresa não conta).
 */

export const maxDuration = 60;

function dadosFolha(d: LinhaImportada) {
  // Só o que veio preenchido (ao atualizar, vazio = mantém o que já estava)
  const f: Record<string, unknown> = { regime: d.regime };
  const campos = ["valorDiaria", "diasMes", "horasMes", "adicionalTipo", "adicionalPercent", "adicionalValor", "horasExtrasValor",
    "valeTransporte", "descontaVt", "valeAlimentacao", "planoSaude", "outrosBeneficios", "descontos"] as const;
  for (const c of campos) if (d[c] !== undefined) f[c] = d[c];
  return f;
}

export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("financeiro", "folha");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;

  const form = await req.formData().catch(() => null);
  const arquivo = form?.get("arquivo");
  if (!form || !(arquivo instanceof Blob)) return NextResponse.json({ erro: "Envie o arquivo da planilha (CSV ou .xlsx)." }, { status: 400 });
  if (arquivo.size > MAX_BYTES_PLANILHA) return NextResponse.json({ erro: "Arquivo maior que 2 MB." }, { status: 400 });
  const etapa = form.get("etapa") === "confirmar" ? "confirmar" : "previa";
  const atualizarExistentes = form.get("atualizar") === "1";

  const [existentes, cargos, equipes] = await Promise.all([
    prisma.tecnico.findMany({ where: { empresaId }, select: { id: true, cpf: true, nome: true } }),
    prisma.cargo.findMany({ where: { empresaId }, select: { id: true, nome: true } }),
    prisma.equipe.findMany({ where: { empresaId, status: "ATIVA" }, select: { id: true, nome: true } }),
  ]);

  let analise;
  try {
    const tabela = lerPlanilha(Buffer.from(await arquivo.arrayBuffer()), (arquivo as File).name ?? "");
    analise = analisarPlanilha(tabela, { existentes, cargos, equipes, atualizarExistentes });
  } catch (e) {
    if (e instanceof ErroPlanilha || e instanceof Error) return NextResponse.json({ erro: e.message }, { status: 400 });
    throw e;
  }

  if (etapa === "previa") return NextResponse.json({ analise });

  const gravar = analise.linhas.filter((l) => l.status === "novo" || l.status === "atualizar");
  if (gravar.length === 0) return NextResponse.json({ erro: "Nenhuma linha para gravar (confira a prévia)." }, { status: 400 });

  try {
    const r = await prisma.$transaction(async (tx) => {
      // Cargos novos (citados nas linhas válidas)
      const idCargo = new Map(cargos.map((c) => [chaveNome(c.nome), c.id]));
      for (const nome of analise.cargosNovos) {
        const c = await tx.cargo.create({ data: { empresaId, nome } });
        idCargo.set(chaveNome(nome), c.id);
      }
      let criados = 0, atualizados = 0;
      for (const l of gravar) {
        const d = l.dados!;
        const cargoId = d.cargo ? idCargo.get(chaveNome(d.cargo)) : undefined;
        const folha = dadosFolha(d);
        if (l.status === "novo") {
          const tipo = funcaoPeloCargo(d.cargo);
          await tx.tecnico.create({
            data: {
              empresaId, nome: d.nome, cpf: d.cpf, telefone: d.telefone ?? "", email: d.email ?? null,
              tipo, tipoEquipe: tipo === "TECNICO_CAMPO" || tipo === "MOTORISTA" ? "CAMPO" : "ADMINISTRATIVO",
              cargoId: cargoId ?? null,
              salario: d.salario ?? null,
              dataAdmissao: d.dataAdmissao ? new Date(d.dataAdmissao) : null,
              folha: { create: { empresaId, ...(folha as any) } },
              ...(l.equipeId && { equipesMembro: { connect: { id: l.equipeId } } }),
            },
          });
          criados++;
        } else {
          const id = l.existenteId!;
          const dadosTec: Prisma.TecnicoUpdateInput = {};
          if (cargoId) dadosTec.cargo = { connect: { id: cargoId } };
          if (d.salario !== undefined) dadosTec.salario = d.salario;
          if (d.dataAdmissao) dadosTec.dataAdmissao = new Date(d.dataAdmissao);
          if (d.email) dadosTec.email = d.email;
          if (d.telefone) dadosTec.telefone = d.telefone;
          if (l.equipeId) dadosTec.equipesMembro = { connect: { id: l.equipeId } };
          await tx.tecnico.update({ where: { id, empresaId }, data: dadosTec });
          await tx.colaboradorFolha.upsert({
            where: { colaboradorId: id },
            create: { empresaId, colaboradorId: id, ...(folha as any) },
            update: folha,
          });
          atualizados++;
        }
      }
      return { criados, atualizados };
    }, { timeout: 50_000, maxWait: 10_000 });

    return NextResponse.json({
      ok: true, ...r,
      ignorados: analise.resumo.existentes, comErro: analise.resumo.erros, cargosCriados: analise.cargosNovos,
    });
  } catch (e: any) {
    // CPF cadastrado por outra pessoa entre a prévia e a confirmação, por exemplo
    if (e?.code === "P2002") return NextResponse.json({ erro: "Algum CPF foi cadastrado enquanto você importava. Gere a prévia de novo." }, { status: 409 });
    console.error("[folha/importar]", e);
    return NextResponse.json({ erro: "Não foi possível gravar a importação. Nada foi alterado." }, { status: 500 });
  }
}
