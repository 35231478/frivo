/**
 * Implantação, leva 6 — contratos e PMOC por planilha, com as rotas reais e o Prisma real num PostgreSQL real:
 *  - contrato: SÓ cadastra; o "ativo" entra SUSPENSO, com faturamento automático, aprovação, NFS-e, boleto,
 *    recorrência de OS, renovação automática e reajuste DESLIGADOS; nem a rotina diária de previsões nem a de OS
 *    recorrentes tocam nele; número vazio vem da numeração; encerrado/cancelado entram como estão; o histórico diz
 *    por que está suspenso; erros: cliente que não existe, unidade que não é do cliente, número repetido;
 *  - PMOC: SÓ cadastra, em RASCUNHO (sem cronograma); equipamentos pela série, do mesmo cliente e ativos;
 *    validade padrão 12 meses; o mesmo nome na mesma unidade é erro;
 *  - os dois entram no lote e o "Desfazer lote" apaga o que não foi usado (o que a importação criou junto — as
 *    unidades do contrato, o histórico, os equipamentos do plano — não conta como uso); o usado fica com o motivo;
 *  - permissão (Contratos › Criar, PMOC › Criar) e módulo desligado.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/implantacao-6-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { gerarCsv } from "@/lib/folha/planilha";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_implantacao6_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.setConfig({ testTimeout: 90_000 });

const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1", id = "u1") => {
  sessao.atual = { user: { id, name: "Zé", email: "ze@x.com", empresaId, role: "OPERADOR", permissoes } };
};
const fmt = (d: string) => d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
const CNPJ_A = "11222333000181", CNPJ_B = "11444777000161", CNPJ_X = "45723174000110";

type Planilha = (string | number | null)[][];
const csv = (linhas: Planilha, nome = "dados.csv") => new File([gerarCsv(linhas.map((l) => l.map((c) => (c == null ? "" : String(c)))))], nome, { type: "text/csv" });

async function importar(entidade: string, arquivo: File, etapa: "previa" | "confirmar" = "confirmar") {
  const fd = new FormData();
  fd.append("arquivo", arquivo);
  fd.append("etapa", etapa);
  const mod = await import("@/app/api/importacao/[entidade]/route");
  const res: Response = await mod.POST(new NextRequest(`http://localhost/api/importacao/${entidade}`, { method: "POST", body: fd }), { params: Promise.resolve({ entidade }) });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
async function previa(id: string) {
  const mod = await import("@/app/api/importacao/lotes/[id]/route");
  const res: Response = await mod.GET(new Request(`http://localhost/api/importacao/lotes/${id}`), { params: Promise.resolve({ id }) });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
async function desfazer(id: string) {
  const mod = await import("@/app/api/importacao/lotes/[id]/desfazer/route");
  const res: Response = await mod.POST(new Request(`http://localhost/api/importacao/lotes/${id}/desfazer`, { method: "POST" }), { params: Promise.resolve({ id }) });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
const motivosDe = (p: any, rotulo: string) => p.ficam.find((f: any) => f.rotulo === rotulo)?.motivos.join(" | ");
/** Erros por linha: da prévia (analise.linhas) ou do resultado da gravação (erros) */
const errosDe = (r: any) => Object.fromEntries((r.json.analise ? r.json.analise.linhas.filter((l: any) => l.status === "erro") : r.json.erros ?? []).map((e: any) => [e.linha, e.erros.join(" | ")]));

describe.skipIf(!URL_PG)("Implantação, leva 6 — contratos e PMOC por planilha (PostgreSQL real)", () => {
  let prisma: any;
  let esquecerModulos: (e?: string) => void;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    ({ esquecerModulos } = await import("@/lib/modulos/servidor"));
    await Promise.all([import("@/app/api/importacao/[entidade]/route"), import("@/app/api/importacao/lotes/[id]/route"), import("@/app/api/importacao/lotes/[id]/desfazer/route")]);
  }, 180_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });
  beforeEach(async () => {
    for (const m of ["importacaoLote", "contratoRecorrenciaLocal", "contrato", "pmoc", "contaReceber", "ordemServico", "numeracao", "equipamento", "tipoEquipamentoCustom", "unidade", "cliente", "empresaModulo", "usuario", "empresa"])
      await prisma[m].deleteMany({});
    esquecerModulos();
    await prisma.empresa.createMany({ data: [{ id: "e1", nome: "Clima", cnpj: "12345678000190", email: "e@x.com" }, { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" }] });
    await prisma.usuario.createMany({ data: [{ id: "u1", empresaId: "e1", nome: "Zé", email: "ze@x.com", senha: "x" }, { id: "u2", empresaId: "e2", nome: "Ana", email: "ana@x.com", senha: "x" }] });
    // Clientes fictícios já cadastrados, cada um com a Principal; A tem também a unidade "Filial Norte"
    await prisma.cliente.createMany({ data: [
      { id: "cA", empresaId: "e1", nome: "Clínica Alfa (fictícia)", cpfCnpj: fmt(CNPJ_A), tipoPessoa: "JURIDICA" },
      { id: "cB", empresaId: "e1", nome: "Mercado Beta (fictício)", cpfCnpj: fmt(CNPJ_B), tipoPessoa: "JURIDICA" },
    ] });
    await prisma.unidade.createMany({ data: [
      { id: "uA", empresaId: "e1", clienteId: "cA", nome: "Principal", principal: true },
      { id: "uA2", empresaId: "e1", clienteId: "cA", nome: "Filial Norte" },
      { id: "uB", empresaId: "e1", clienteId: "cB", nome: "Principal", principal: true },
    ] });
    logar();
  });

  const CABEC_CT = ["numero", "cnpj_cpf", "tipo", "situacao", "data_inicio", "data_fim", "valor_mensal", "periodicidade", "dia_vencimento", "unidades", "descricao_servicos"];

  it("contrato: o ativo entra SUSPENSO com tudo que cobra ou agenda desligado; as rotinas diárias não tocam nele", async () => {
    // A prévia não grava nada
    const pv = await importar("contratos", csv([CABEC_CT, ["", CNPJ_A, "preventiva", "", "01/02/2026", "", "1.250,00", "", "10", "", "Preventiva mensal"]]), "previa");
    expect(pv.json.analise.resumo).toMatchObject({ criar: 1, erros: 0 });
    expect(await prisma.contrato.count()).toBe(0);

    const r = await importar("contratos", csv([
      CABEC_CT,
      ["", CNPJ_A, "preventiva", "", "01/02/2026", "", "1.250,00", "", "10", "", "Preventiva mensal"],
      ["CT-ANT-07", CNPJ_B, "Manutenção Corretiva", "encerrado", "2024-01-15", "2025-01-14", "800", "mensal", "", "Principal", ""],
      ["CT-FIL-01", CNPJ_A, "completa", "ativo", "01/03/2026", "28/02/2027", "", "trimestral", "", "Principal; Filial Norte", ""],
    ], "contratos.csv"));
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ criados: 3, atualizados: 0 });
    expect(r.json.observacoes.join(" ")).toMatch(/2 contratos ativos entraram SUSPENSOS/);

    const cs = await prisma.contrato.findMany({ orderBy: { numero: "asc" }, include: { unidades: { select: { unidadeId: true } }, historicoStatus: true } });
    const auto = cs.find((c: any) => c.clienteId === "cA" && c.tipo === "MANUTENCAO_PREVENTIVA");
    // Número automático pela numeração da empresa
    expect(auto.numero).toMatch(/^CT-\d+/);
    expect(await prisma.numeracao.count({ where: { empresaId: "e1", tipo: "contrato" } })).toBe(1);
    for (const c of cs) {
      expect(c).toMatchObject({
        faturamentoAutomatico: false, aprovacaoAutomatica: false, emitirNfseAuto: false, emitirBoletoAuto: false,
        recorrencia: false, renovacaoAutomatica: false, reajusteAtivo: false, alertaEmailCliente: false, notificarClienteRenovacao: false,
      });
    }
    expect(auto).toMatchObject({ status: "SUSPENSO", periodicidade: "MENSAL", diaVencimento: 10, descricaoServicos: "Preventiva mensal" });
    expect(Number(auto.valorMensal)).toBe(1250);
    expect(auto.dataInicio.toISOString().slice(0, 10)).toBe("2026-02-01");
    expect(auto.unidades.map((u: any) => u.unidadeId)).toEqual(["uA"]); // vazio = a Principal
    expect(auto.historicoStatus).toMatchObject([{ statusAnterior: "ATIVO", statusNovo: "SUSPENSO", usuarioId: "u1" }]);
    expect(auto.historicoStatus[0].motivo).toMatch(/suspenso até a revisão/);
    const ant = cs.find((c: any) => c.numero === "CT-ANT-07");
    expect(ant).toMatchObject({ status: "ENCERRADO", tipo: "MANUTENCAO_CORRETIVA" });
    expect(ant.historicoStatus).toEqual([]);
    expect(ant.dataFim.toISOString().slice(0, 10)).toBe("2025-01-14");
    const fil = cs.find((c: any) => c.numero === "CT-FIL-01");
    expect(fil).toMatchObject({ status: "SUSPENSO", periodicidade: "TRIMESTRAL" });
    expect(fil.unidades.map((u: any) => u.unidadeId).sort()).toEqual(["uA", "uA2"]);

    // A importação não gerou previsão nem OS — e as rotinas diárias também não geram (só contrato ATIVO)
    expect(await prisma.contaReceber.count()).toBe(0);
    const { rolarHorizonteDePrevisoes } = await import("@/lib/financeiro-server");
    const { rolarHorizonteDeOsRecorrentes } = await import("@/lib/recorrencia-server");
    expect(await rolarHorizonteDePrevisoes({ empresaId: "e1" })).toMatchObject({ contratos: 0, previsoes: 0 });
    expect(await rolarHorizonteDeOsRecorrentes({ empresaId: "e1" })).toMatchObject({ os: 0 });
    expect(await prisma.contaReceber.count()).toBe(0);
    expect(await prisma.ordemServico.count()).toBe(0);

    // Entrou no lote
    const lote = await prisma.importacaoLote.findFirst({ where: { entidade: "contratos" }, include: { itens: true } });
    expect(lote).toMatchObject({ arquivo: "contratos.csv", criados: 3 });
    expect(lote.itens.map((i: any) => `${i.entidade}:${i.acao}`)).toEqual(["contratos:CRIADO", "contratos:CRIADO", "contratos:CRIADO"]);
  });

  it("contrato: erros — cliente que não existe, unidade de outro cliente, número que já existe ou repetido, datas e opções", async () => {
    await prisma.contrato.create({ data: { empresaId: "e1", clienteId: "cA", numero: "CT-2026-001", tipo: "INSTALACAO", dataInicio: new Date("2026-01-01") } });
    const r = await importar("contratos", csv([
      CABEC_CT,
      ["", CNPJ_X, "preventiva", "", "01/02/2026", "", "", "", "", "", ""],              // 2: cliente não cadastrado
      ["", CNPJ_A, "preventiva", "", "01/02/2026", "", "", "", "", "Filial Sul", ""],    // 3: unidade que não existe
      ["", CNPJ_B, "preventiva", "", "01/02/2026", "", "", "", "", "Filial Norte", ""],  // 4: unidade de OUTRO cliente
      ["ct-2026-001", CNPJ_A, "preventiva", "", "01/02/2026", "", "", "", "", "", ""],   // 5: número que já existe
      ["CT-X", CNPJ_A, "preventiva", "", "01/02/2026", "", "", "", "", "", ""],
      ["ct-x", CNPJ_A, "preventiva", "", "01/02/2026", "", "", "", "", "", ""],          // 7: repetido na planilha
      ["", CNPJ_A, "pintura", "suspenso", "31/02/2026", "01/01/2026", "-5", "diária", "40", "", ""], // 8: tudo errado
      ["", CNPJ_A, "", "", "", "", "", "", "", "", ""],                                   // 9: obrigatórios
    ]), "previa");
    const e = errosDe(r);
    expect(e[2]).toMatch(/nenhum cliente com o documento 45\.723\.174\/0001-10 nesta empresa/);
    expect(e[3]).toMatch(/“Filial Sul” não é uma unidade ativa deste cliente/);
    expect(e[4]).toMatch(/“Filial Norte” não é uma unidade ativa deste cliente/);
    expect(e[5]).toMatch(/o contrato ct-2026-001 já existe\. A planilha só cadastra contratos novos/);
    expect(e[6]).toBeUndefined();
    expect(e[7]).toMatch(/Repete a linha 6/); // o motor barra a mesma chave (o número) duas vezes
    expect(e[8]).toMatch(/tipo “pintura” não existe/);
    expect(e[8]).toMatch(/situacao “suspenso” não existe/);
    expect(e[8]).toMatch(/data_inicio: “31\/02\/2026” não é uma data/);
    expect(e[8]).toMatch(/valor_mensal: não pode ser negativo/);
    expect(e[8]).toMatch(/periodicidade “diária” não existe/);
    expect(e[8]).toMatch(/dia_vencimento: de 1 a 31/);
    expect(e[9]).toMatch(/tipo: obrigatório/);
    expect(e[9]).toMatch(/data_inicio: obrigatória/);
    // Fim antes do início
    const r2 = await importar("contratos", csv([CABEC_CT, ["", CNPJ_A, "preventiva", "", "01/02/2026", "31/01/2026", "", "", "", "", ""]]), "previa");
    expect(errosDe(r2)[2]).toMatch(/data_fim: antes da data de início/);
    // A gravação confere de novo: unidade que não é do cliente (dados adulterados ou trocados depois da análise) não entra
    const { gravarImportacao } = await import("@/lib/importacao/servidor");
    const linha = { linha: 2, status: "criar", rotulo: "x", erros: [], valores: {}, dados: { clienteId: "cA", tipo: "INSTALACAO", situacao: "ATIVO", dataInicio: "2026-02-01", periodicidade: "MENSAL", unidadeIds: ["uB"] } };
    const g = await gravarImportacao("contratos", { linhas: [linha], resumo: { total: 1, criar: 1, atualizar: 0, erros: 0, avisos: 0 }, colunasIgnoradas: [], colunas: { cabecalho: [], ligadas: {}, faltando: [] } } as any, "e1");
    expect(g.criados).toBe(0);
    expect(g.erros[0].erros).toEqual(["unidades: uma das unidades não é mais deste cliente. Gere a prévia de novo."]);
    expect(await prisma.contrato.count({ where: { tipo: "INSTALACAO", numero: { not: "CT-2026-001" } } })).toBe(0);
  });

  it("PMOC: entra em RASCUNHO, sem cronograma; equipamentos pela série (do cliente, ativos); validade padrão 12 meses; nome repetido na unidade é erro", async () => {
    // Equipamentos: dois do cliente A, um do B, um inativo do A
    const eqBase = { empresaId: "e1", tipo: "AR_CONDICIONADO_SPLIT", marca: "Midea", modelo: "X" };
    await prisma.equipamento.createMany({ data: [
      { ...eqBase, id: "eq1", unidadeId: "uA", numeroSerie: "SN-001" },
      { ...eqBase, id: "eq2", unidadeId: "uA2", numeroSerie: "sn 002" },
      { ...eqBase, id: "eq3", unidadeId: "uB", numeroSerie: "SN-003" },
      { ...eqBase, id: "eq4", unidadeId: "uA", numeroSerie: "SN-004", ativo: false },
    ] });
    const CAB = ["cnpj_cpf", "unidade", "nome", "data_inicio", "data_expiracao", "equipamentos", "rt_nome", "rt_crea", "art_numero"];
    const r = await importar("pmocs", csv([
      CAB,
      [CNPJ_A, "", "PMOC 2026 — Sede", "31/01/2026", "", "SN-001; SN002", "Eng. Fictício", "MG-000", "ART-1"],
      [CNPJ_A, "Filial Norte", "PMOC Filial", "01/02/2026", "31/12/2026", "", "", "", ""],
      [CNPJ_A, "", "PMOC 2026 — Sede", "01/03/2026", "", "", "", "", ""],      // 4: mesmo nome, mesma unidade
      [CNPJ_A, "", "PMOC Outro", "01/03/2026", "", "SN-003", "", "", ""],     // 5: equipamento de outro cliente
      [CNPJ_A, "", "PMOC Inativo", "01/03/2026", "", "SN-004", "", "", ""],   // 6: equipamento inativo
      [CNPJ_A, "", "PMOC Datas", "01/03/2026", "01/03/2026", "", "", "", ""], // 7: validade = início
    ], "pmoc.csv"));
    expect(r.json).toMatchObject({ criados: 2 });
    const e = errosDe(r);
    expect(e[4]).toMatch(/o mesmo plano na mesma unidade já está na linha 2/);
    expect(e[5]).toMatch(/nenhum equipamento ativo deste cliente com a série “SN-003”/);
    expect(e[6]).toMatch(/nenhum equipamento ativo deste cliente com a série “SN-004”/);
    expect(e[7]).toMatch(/data_expiracao: precisa ser depois da data de início/);
    expect(r.json.avisos.map((a: any) => a.avisos.join())).toEqual(["Sem equipamentos: vincule-os na tela do PMOC antes de publicar."]);
    const ps = await prisma.pmoc.findMany({ orderBy: { nome: "asc" }, include: { equipamentos: true, cronograma: true } });
    expect(ps.map((p: any) => [p.nome, p.status, p.unidadeId, p.criadoPorId])).toEqual([["PMOC 2026 — Sede", "RASCUNHO", "uA", "u1"], ["PMOC Filial", "RASCUNHO", "uA2", "u1"]]);
    const sede = ps[0];
    expect(sede.equipamentos.map((x: any) => x.equipamentoId).sort()).toEqual(["eq1", "eq2"]);
    expect(sede.cronograma).toEqual([]);
    expect(sede.dataExpiracao.toISOString().slice(0, 10)).toBe("2027-01-31"); // 12 meses depois
    expect(sede).toMatchObject({ rtNome: "Eng. Fictício", rtCrea: "MG-000", artNumero: "ART-1" });
    // Reimportar o mesmo plano: erro (a planilha só cadastra)
    const r2 = await importar("pmocs", csv([CAB, [CNPJ_A, "Principal", "pmoc 2026 — sede", "01/03/2026", "", "", "", "", ""]]), "previa");
    expect(errosDe(r2)[2]).toMatch(/já existe um plano “pmoc 2026 — sede” nesta unidade/);
  });

  it("desfazer: contrato e PMOC sem uso saem (com as unidades, o histórico e os equipamentos que vieram junto); usado ou publicado fica", async () => {
    await prisma.equipamento.create({ data: { id: "eq1", empresaId: "e1", unidadeId: "uA", tipo: "AR_CONDICIONADO_SPLIT", marca: "Midea", modelo: "X", numeroSerie: "SN-001" } });
    await importar("contratos", csv([CABEC_CT, ["CT-A", CNPJ_A, "preventiva", "", "01/02/2026", "", "900", "", "", "Principal; Filial Norte", ""], ["CT-B", CNPJ_B, "preventiva", "", "01/02/2026", "", "", "", "", "", ""]]));
    const lc = await prisma.importacaoLote.findFirst({ where: { entidade: "contratos" } });
    // CT-B passa a ter uma recorrência por local (configurada pela tela) → fica
    const ctB = await prisma.contrato.findFirst({ where: { numero: "CT-B" } });
    await prisma.contratoRecorrenciaLocal.create({ data: { empresaId: "e1", contratoId: ctB.id, unidadeId: "uB" } });
    const p = (await previa(lc.id)).json;
    expect(p.apagar.map((x: any) => x.rotulo)).toEqual(["CT-A — Clínica Alfa (fictícia)"]);
    expect(motivosDe(p, "CT-B — Mercado Beta (fictício)")).toBe("recorrências por local: 1");
    expect((await desfazer(lc.id)).json).toMatchObject({ apagados: 1 });
    expect(await prisma.contrato.findMany({ select: { numero: true } })).toEqual([{ numero: "CT-B" }]);
    expect(await prisma.contratoUnidade.count({ where: { contrato: { numero: "CT-A" } } })).toBe(0);
    expect(await prisma.unidade.count()).toBe(3); // as unidades do cliente ficam

    await importar("pmocs", csv([["cnpj_cpf", "nome", "data_inicio", "equipamentos"], [CNPJ_A, "PMOC Sede", "01/02/2026", "SN-001"], [CNPJ_B, "PMOC Beta", "01/02/2026", ""]]));
    const lp = await prisma.importacaoLote.findFirst({ where: { entidade: "pmocs" } });
    // O plano do Beta foi publicado pela tela depois da importação → fica
    await prisma.pmoc.updateMany({ where: { nome: "PMOC Beta" }, data: { status: "PUBLICADO", atualizadoEm: new Date(Date.now() + 60_000) } });
    const pp = (await previa(lp.id)).json;
    expect(pp.apagar.map((x: any) => x.rotulo)).toEqual(["PMOC Sede — Clínica Alfa (fictícia)"]);
    expect(motivosDe(pp, "PMOC Beta — Mercado Beta (fictício)")).toMatch(/alterado depois desta importação/);
    expect((await desfazer(lp.id)).json).toMatchObject({ apagados: 1 });
    expect(await prisma.pmoc.findMany({ select: { nome: true } })).toEqual([{ nome: "PMOC Beta" }]);
    expect(await prisma.pmocEquipamento.count()).toBe(0);
    expect(await prisma.equipamento.count()).toBe(1); // o equipamento fica
  });

  it("desfazer clientes: o cliente que ganhou contrato pela planilha depois fica (a unidade dele está no contrato)", async () => {
    await prisma.unidade.deleteMany({}); await prisma.cliente.deleteMany({});
    await importar("clientes", csv([["nome", "cnpj_cpf"], ["Escola Gama (fictícia)", CNPJ_X]]));
    const lcli = await prisma.importacaoLote.findFirst({ where: { entidade: "clientes" } });
    await importar("contratos", csv([CABEC_CT, ["CT-G", CNPJ_X, "preventiva", "", "01/02/2026", "", "", "", "", "", ""]]));
    const p = (await previa(lcli.id)).json;
    expect(p.apagar).toEqual([]);
    expect(motivosDe(p, "Escola Gama (fictícia)")).toMatch(/contratos: 1/);
    expect((await desfazer(lcli.id)).json.apagados).toBe(0);
  });

  it("permissão e módulo: Contratos › Criar e PMOC › Criar; o desfazer pede Contratos › Editar / PMOC › Excluir; módulo desligado não importa", async () => {
    logar(montarPermissoes({ clientes: ["visualizar"] }));
    expect((await importar("contratos", csv([CABEC_CT]), "previa")).status).toBe(403);
    expect((await importar("pmocs", csv([["cnpj_cpf", "nome", "data_inicio"]]), "previa")).status).toBe(403);
    logar();
    await importar("contratos", csv([CABEC_CT, ["CT-P", CNPJ_A, "preventiva", "", "01/02/2026", "", "", "", "", "", ""]]));
    const lc = await prisma.importacaoLote.findFirst({ where: { entidade: "contratos" } });
    logar(montarPermissoes({ configuracoes: ["visualizar", "gerenciar"], contratos: ["visualizar", "criar"] }));
    expect(motivosDe((await previa(lc.id)).json, "CT-P — Clínica Alfa (fictícia)")).toBe("você não tem permissão para editar contratos");
    logar();
    await prisma.empresaModulo.create({ data: { empresaId: "e1", modulo: "contratos", ativo: false } }); esquecerModulos();
    const r = await importar("contratos", csv([CABEC_CT]), "previa");
    expect(r.status).toBe(403);
    expect(r.json.modulo).toBe("contratos");
    expect(motivosDe((await previa(lc.id)).json, "CT-P — Clínica Alfa (fictícia)")).toBe("o módulo de contratos está desligado");
  });
});
