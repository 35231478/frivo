/**
 * Execução da OS por EQUIPAMENTO — rotas reais com o Prisma real num PostgreSQL real (schema
 * descartável via `prisma db push`). Prova, de ponta a ponta:
 *  - a OS abre sem equipamento, mas não conclui (atividade nem OS) sem 1 equipamento atendido;
 *  - na criação só entram equipamentos ativos do cliente da OS (outro cliente/inativo/outra empresa: 400);
 *  - vínculo pela lista e pelo QR (QR de outro cliente: 409);
 *  - respostas INCREMENTAIS: cada toque grava só o seu campo; reabrir devolve tudo, nada apagado;
 *  - fotos de CADA equipamento (nada replicado para outro do mesmo tipo);
 *  - a trava diz exatamente qual equipamento e quais itens faltam;
 *  - tirar equipamento com execução gravada é recusado; atividade concluída é só leitura;
 *  - relatório fiel (só os atendidos, com checklist, fotos e observação de cada um) e histórico do equipamento;
 *  - checklist do tipo editável sem perder respostas antigas; impacto do tipo; isolamento e permissão.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/execucao-os-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { permissoesTotais, permissoesVazias, type Permissoes } from "@/lib/permissoes";
import { HTML, PNG, dataUrl } from "./arquivos-exemplo";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_execucao_os_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const logar = (empresaId = "e1", permissoes: Permissoes = permissoesTotais(), id = "u1") => {
  sessao.atual = { user: { id, name: "Ana", email: "ana@x.com", empresaId, role: "OPERADOR", permissoes } };
};
const so = (...pares: [string, string][]) => {
  const p = permissoesVazias() as any;
  for (const [m, a] of pares) p[m] = { ...(p[m] ?? {}), [a]: true };
  return p as Permissoes;
};

type Params = Record<string, string>;
async function chamar(rota: string, metodo: string, params: Params, corpo?: unknown) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", {
    method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  const tipo = res.headers.get("content-type") ?? "";
  return { status: res.status, tipo, json: tipo.includes("json") ? await res.json() : null };
}
const A = "ordens/[id]/atividades/[atividadeId]";
const EXEC = `${A}/execucao`;
const ITEM = `${A}/execucao/equipamentos/[equipamentoId]/itens/[itemId]`;
const FOTOS = `${A}/execucao/equipamentos/[equipamentoId]/fotos`;
const EQUIP = `${A}/execucao/equipamentos/[equipamentoId]`;
const FOTO_PNG = dataUrl("image/png", PNG);

describe.skipIf(!URL_PG)("execução da OS por equipamento (PostgreSQL real)", () => {
  let prisma: any;
  let os1: string, at1: string; // OS aberta SEM equipamento
  let os2: string, at2: string; // OS aberta com o eqA
  const p1 = () => ({ id: os1, atividadeId: at1 });
  const p2 = () => ({ id: os2, atividadeId: at2 });
  const responder = (params: Params, equipamentoId: string, itemId: string, corpo: unknown) => chamar(ITEM, "PUT", { ...params, equipamentoId, itemId }, corpo);
  const exec = async (params: Params) => (await chamar(EXEC, "GET", params)).json;
  const equipDe = (x: any, id: string) => x.equipamentos.find((e: any) => e.equipamento.id === id);

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    // Compila as rotas uma vez aqui (fora do limite de 5 s de cada teste)
    await Promise.all([
      "ordens", "ordens/[id]", A, EXEC, ITEM, FOTOS, EQUIP, `${A}/scan`, `${A}/equipamentos`, `${A}/equipamentos/[vinculoId]`,
      "fotos-atendimento/[id]", "tipos-equipamento/[id]/checklist", "cadastros/[entidade]/[id]/impacto",
    ].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await Promise.all([import("@/lib/relatorio-os/dados"), import("@/lib/relatorio-server"), import("@/lib/equipamento-historico")]);
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" },
      { id: "u2", empresaId: "e2", nome: "Beto", email: "b@x.com", senha: "x" },
    ] });
    await prisma.tecnico.create({ data: { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "11122233344", telefone: "11999990000" } });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Luzia", cpfCnpj: "11222333000181" },
      { id: "c2", empresaId: "e1", nome: "Padaria Pão Quente", cpfCnpj: "22333444000190" },
      { id: "cE2", empresaId: "e2", nome: "Cliente da outra", cpfCnpj: "33444555000100" },
    ] });
    await prisma.unidade.createMany({ data: [
      { id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz" },
      { id: "un2", empresaId: "e1", clienteId: "c2", nome: "Loja" },
      { id: "unE2", empresaId: "e2", clienteId: "cE2", nome: "Sede" },
    ] });
    await prisma.tipoEquipamentoCustom.createMany({ data: [
      { id: "te1", empresaId: "e1", nome: "Split Hi-Wall (parede)", chaveEnum: "AR_CONDICIONADO_SPLIT" },
      { id: "te2", empresaId: "e1", nome: "Cassete", chaveEnum: "CASSETE" },
    ] });
    await prisma.checklistTipoItem.createMany({ data: [
      { id: "i1", empresaId: "e1", tipoEquipamentoId: "te1", texto: "Limpeza dos filtros", pedirFoto: true, ordem: 0 },
      { id: "i2", empresaId: "e1", tipoEquipamentoId: "te1", texto: "Medição de corrente do compressor", pedirObservacao: true, ordem: 1 },
      { id: "i3", empresaId: "e1", tipoEquipamentoId: "te1", texto: "Teste de funcionamento", ordem: 2 },
    ] });
    const eq = (id: string, unidadeId: string, nome: string, extra: Record<string, unknown> = {}) =>
      ({ id, empresaId: "e1", unidadeId, tipo: "AR_CONDICIONADO_SPLIT", tipoEquipamentoId: "te1", marca: "Daikin", modelo: "FTXS", nome, ...extra });
    await prisma.equipamento.createMany({ data: [
      eq("eqA", "un1", "Split Sala 1", { patrimonio: "AC-01", localizacao: "Sala 1" }),
      eq("eqB", "un1", "Split Sala 2", { localizacao: "Sala 2" }),
      eq("eqI", "un1", "Split desativado", { ativo: false }),
      eq("eqD", "un1", "Cassete do auditório", { tipo: "CASSETE", tipoEquipamentoId: "te2" }),
      eq("eqC", "un2", "Split da padaria"),
      { ...eq("eqE2", "unE2", "Da outra empresa"), empresaId: "e2", tipoEquipamentoId: null },
    ] });
    await prisma.qrcode.createMany({ data: [
      { empresaId: "e1", codigo: "QR-2026-0001", equipamentoId: "eqB", tokenPublico: "tok-eqB" },
      { empresaId: "e1", codigo: "QR-2026-0002", equipamentoId: "eqC", tokenPublico: "tok-eqC" },
    ] });
    logar();
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  const novaOs = (extra: Record<string, unknown> = {}) => chamar("ordens", "POST", {}, {
    clienteId: "c1", unidadeId: "un1", descricao: "Preventiva mensal", prioridade: "NORMAL",
    execucao: { tecnicoIds: ["t1"], responsavelId: "t1" }, ...extra,
  });
  const primeiraAtividade = async (osId: string) => (await prisma.atividadeOs.findFirst({ where: { ordemServicoId: osId } })).id;

  it("abre a OS sem equipamento; concluir (atividade ou OS) sem equipamento atendido é barrado com a mensagem do que fazer", async () => {
    const r = await novaOs();
    expect(r.status).toBe(201);
    os1 = r.json.id; at1 = await primeiraAtividade(os1);
    expect(await prisma.atividadeEquipamento.count({ where: { atividadeId: at1 } })).toBe(0);

    const a = await chamar(A, "PUT", p1(), { status: "CONCLUIDA" });
    expect(a.status).toBe(422);
    expect(a.json).toMatchObject({ semEquipamento: true, erro: "Para concluir, vincule pelo menos 1 equipamento atendido (pelo QR Code ou pela lista da unidade) e responda o checklist dele." });
    const o = await chamar("ordens/[id]", "PUT", { id: os1 }, { status: "CONCLUIDA" });
    expect(o.status).toBe(422);
    expect(o.json.erro).toMatch(/vincule pelo menos 1 equipamento atendido/);
    expect((await prisma.ordemServico.findUnique({ where: { id: os1 } })).status).not.toBe("CONCLUIDA");
  });

  it("na criação, só equipamentos ATIVOS do cliente da OS entram (na 1ª atividade); os outros são recusados sem criar nada", async () => {
    const antes = await prisma.ordemServico.count();
    for (const ids of [["eqC"], ["eqI"], ["eqE2"], ["eqA", "naoExiste"]]) {
      const r = await novaOs({ equipamentoIds: ids });
      expect(r.status).toBe(400);
    }
    expect((await novaOs({ equipamentoIds: ["eqC"] })).json.erro).toMatch(/outro cliente/);
    expect((await novaOs({ equipamentoIds: ["eqI"] })).json.erro).toMatch(/inativo/);
    expect(await prisma.ordemServico.count()).toBe(antes);

    const r = await novaOs({ equipamentoIds: ["eqA"] });
    expect(r.status).toBe(201);
    os2 = r.json.id; at2 = await primeiraAtividade(os2);
    const v = await prisma.atividadeEquipamento.findMany({ where: { atividadeId: at2 } });
    expect(v.map((x: any) => [x.equipamentoId, x.feito])).toEqual([["eqA", false]]);
  });

  it("vincula pelo QR (já como atendido); QR de outro cliente é recusado; QR desconhecido = 404", async () => {
    const r = await chamar(`${A}/scan`, "POST", p2(), { valor: "https://app.frivo.com.br/qr/tok-eqB" });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ vinculado: true, equipamentoId: "eqB" });
    expect((await prisma.atividadeEquipamento.findFirst({ where: { atividadeId: at2, equipamentoId: "eqB" } })).feito).toBe(true);
    // Ler de novo: já vinculado, só confirma
    expect((await chamar(`${A}/scan`, "POST", p2(), { valor: "QR-2026-0001" })).json).toMatchObject({ vinculado: false, equipamentoId: "eqB" });
    const outro = await chamar(`${A}/scan`, "POST", p2(), { valor: "tok-eqC" });
    expect(outro.status).toBe(409);
    expect(outro.json.erro).toMatch(/é de outro cliente/);
    expect((await chamar(`${A}/scan`, "POST", p2(), { valor: "qualquer-coisa" })).status).toBe(404);
    expect(await prisma.atividadeEquipamento.count({ where: { atividadeId: at2 } })).toBe(2);
  });

  it("cada equipamento carrega o checklist do TIPO dele; responder grava SÓ o campo enviado (incremental)", async () => {
    const x = await exec(p2());
    expect(equipDe(x, "eqA").itens.map((i: any) => i.texto)).toEqual(["Limpeza dos filtros", "Medição de corrente do compressor", "Teste de funcionamento"]);
    expect(equipDe(x, "eqB").itens).toHaveLength(3);

    expect((await responder(p2(), "eqA", "i1", { status: "OK" })).status).toBe(200);
    expect((await responder(p2(), "eqA", "i2", { observacao: "  6,2 A  " })).json).toMatchObject({ status: null, observacao: "6,2 A", feito: true });
    // Mandar só o status não apaga a observação (o bug antigo gravava vazio por cima)
    expect((await responder(p2(), "eqA", "i2", { status: "ATENCAO" })).json).toMatchObject({ status: "ATENCAO", observacao: "6,2 A" });
    const r = await prisma.checklistResposta.findMany({ where: { atividadeId: at2, equipamentoId: "eqA" }, orderBy: { itemId: "asc" } });
    expect(r.map((x: any) => [x.itemId, x.status, x.observacao, x.textoItem, x.respondidoPorId])).toEqual([
      ["i1", "OK", null, "Limpeza dos filtros", "u1"],
      ["i2", "ATENCAO", "6,2 A", "Medição de corrente do compressor", "u1"],
    ]);
    // O eqB (mesmo tipo) não ganhou resposta nenhuma
    expect(await prisma.checklistResposta.count({ where: { atividadeId: at2, equipamentoId: "eqB" } })).toBe(0);
    // Item de outro tipo / inexistente / equipamento fora da atividade
    await prisma.checklistTipoItem.create({ data: { id: "iCas", empresaId: "e1", tipoEquipamentoId: "te2", texto: "Bomba de dreno", ordem: 0 } });
    expect((await responder(p2(), "eqA", "iCas", { status: "OK" })).status).toBe(400);
    expect((await responder(p2(), "eqC", "i1", { status: "OK" })).status).toBe(404);
    expect((await responder(p2(), "eqA", "i1", { status: "TALVEZ" })).status).toBe(400);
    expect((await responder(p2(), "eqA", "i1", {})).status).toBe(400);
  });

  it("fotos são de CADA equipamento: a do eqA não aparece no eqB (mesmo tipo); arquivo que não é imagem é recusado", async () => {
    const f = await chamar(FOTOS, "POST", { ...p2(), equipamentoId: "eqA" }, { dataUrl: FOTO_PNG, itemId: "i1" });
    expect(f.status).toBe(201);
    expect((await chamar(FOTOS, "POST", { ...p2(), equipamentoId: "eqA" }, { dataUrl: dataUrl("image/png", HTML) })).status).toBe(400);
    expect((await chamar(FOTOS, "POST", { ...p2(), equipamentoId: "eqA" }, { dataUrl: FOTO_PNG, itemId: "iCas" })).status).toBe(400);
    const x = await exec(p2());
    expect(equipDe(x, "eqA").fotos.map((ft: any) => [ft.id, ft.itemId])).toEqual([[f.json.id, "i1"]]);
    expect(equipDe(x, "eqB").fotos).toEqual([]);
    // A imagem é servida à parte, só para a empresa da sessão
    const img = await chamar("fotos-atendimento/[id]", "GET", { id: f.json.id });
    expect([img.status, img.tipo]).toEqual([200, "image/png"]);
    logar("e2");
    expect((await chamar("fotos-atendimento/[id]", "GET", { id: f.json.id })).status).toBe(404);
    logar();
  });

  it("a trava diz exatamente o que falta: qual equipamento e quais itens", async () => {
    const r = await chamar(A, "PUT", p2(), { status: "CONCLUIDA" });
    expect(r.status).toBe(422);
    expect(r.json.erro).toBe(
      // Etapa 2: "Atenção" (i2) exige foto do item, além da observação
      "Para concluir, falta: Split Sala 1 (TAG AC-01) — 1 item sem resposta (“Teste de funcionamento”); foto em “Medição de corrente do compressor”"
      + " | Split Sala 2 (Sala 2) — 3 itens sem resposta (“Limpeza dos filtros”, “Medição de corrente do compressor”, “Teste de funcionamento”).",
    );
    expect(r.json.pendencias.map((p: any) => p.equipamentoId)).toEqual(["eqA", "eqB"]);
    // Foto e observação pedidas pelo item também travam
    await prisma.fotoAtendimento.deleteMany({ where: { atividadeId: at2, equipamentoId: "eqA" } });
    await responder(p2(), "eqA", "i2", { observacao: "" });
    const faltas = equipDe(await exec(p2()), "eqA").faltas;
    expect(faltas).toMatchObject({ semFoto: ["Limpeza dos filtros", "Medição de corrente do compressor"], semObservacao: ["Medição de corrente do compressor"] });
    await chamar(FOTOS, "POST", { ...p2(), equipamentoId: "eqA" }, { dataUrl: FOTO_PNG, itemId: "i1" });
    await chamar(FOTOS, "POST", { ...p2(), equipamentoId: "eqA" }, { dataUrl: FOTO_PNG, itemId: "i2" });
    await responder(p2(), "eqA", "i2", { observacao: "6,2 A — acima do nominal" });
  });

  let antesDeConcluir: any;
  it("completa, marca o eqB como não atendido e conclui; concluída é só leitura; REABRIR não apaga nada", async () => {
    await responder(p2(), "eqA", "i3", { status: "OK" });
    expect((await chamar(EQUIP, "PATCH", { ...p2(), equipamentoId: "eqA" }, { observacao: "Dreno parcialmente obstruído — limpo." })).status).toBe(200);
    expect((await chamar(EQUIP, "PATCH", { ...p2(), equipamentoId: "eqB" }, { feito: false })).json).toMatchObject({ feito: false });
    antesDeConcluir = await exec(p2());
    expect(antesDeConcluir.conclusao).toMatchObject({ ok: true, atendidos: 1, naoAtendidos: 1 });

    expect((await chamar(A, "PUT", p2(), { status: "CONCLUIDA" })).status).toBe(200);
    // Só leitura: nada grava com a atividade concluída
    for (const r of [
      await responder(p2(), "eqA", "i1", { status: "ATENCAO" }),
      await chamar(FOTOS, "POST", { ...p2(), equipamentoId: "eqA" }, { dataUrl: FOTO_PNG }),
      await chamar(EQUIP, "PATCH", { ...p2(), equipamentoId: "eqA" }, { observacao: "x" }),
      await chamar(`${A}/scan`, "POST", p2(), { valor: "tok-eqB" }),
    ]) {
      expect(r.status).toBe(409);
      expect(r.json.erro).toBe("Atividade concluída: reabra a atividade para alterar a execução.");
    }
    const v = await prisma.atividadeEquipamento.findFirst({ where: { atividadeId: at2, equipamentoId: "eqA" } });
    expect((await chamar(`${A}/equipamentos/[vinculoId]`, "DELETE", { ...p2(), vinculoId: v.id })).status).toBe(409);

    // Reabrir e voltar: tudo igual (respostas, observações, fotos)
    expect((await chamar(A, "PUT", p2(), { status: "EM_ANDAMENTO" })).status).toBe(200);
    const reaberta = await exec(p2());
    const semStatus = (x: any) => ({ ...x, atividade: { ...x.atividade, status: null }, bloqueada: null });
    expect(semStatus(reaberta)).toEqual(semStatus(antesDeConcluir));
    expect((await chamar(A, "PUT", p2(), { status: "CONCLUIDA" })).status).toBe(200);
    expect(await prisma.checklistResposta.count({ where: { atividadeId: at2 } })).toBe(3);
    expect(await prisma.fotoAtendimento.count({ where: { atividadeId: at2 } })).toBe(2);
  });

  it("tirar equipamento da atividade: com checklist/foto gravado é recusado (marque como não atendido); sem nada, sai", async () => {
    expect((await chamar(`${A}/equipamentos`, "POST", p1(), { equipamentoIds: ["eqA", "eqB"] })).status).toBe(201);
    expect((await chamar(`${A}/equipamentos`, "POST", p1(), { equipamentoIds: ["eqC"] })).status).toBe(400);
    await responder(p1(), "eqA", "i1", { status: "OK" });
    const [vA, vB] = await Promise.all(["eqA", "eqB"].map((e) => prisma.atividadeEquipamento.findFirst({ where: { atividadeId: at1, equipamentoId: e } })));
    const r = await chamar(`${A}/equipamentos/[vinculoId]`, "DELETE", { ...p1(), vinculoId: vA.id });
    expect(r.status).toBe(409);
    expect(r.json.erro).toMatch(/marque-o como “não atendido”/);
    expect((await chamar(`${A}/equipamentos/[vinculoId]`, "DELETE", { ...p1(), vinculoId: vB.id })).status).toBe(200);
    expect((await prisma.atividadeEquipamento.findMany({ where: { atividadeId: at1 } })).map((x: any) => x.equipamentoId)).toEqual(["eqA"]);
    // A atividade com execução gravada também não pode ser excluída — nem com o equipamento marcado
    // "não atendido" (as respostas continuam lá e iriam junto)
    expect((await chamar(A, "DELETE", p1())).status).toBe(409);
    expect((await chamar(EQUIP, "PATCH", { ...p1(), equipamentoId: "eqA" }, { feito: false })).json).toMatchObject({ feito: false });
    const r2 = await chamar(A, "DELETE", p1());
    expect(r2.status).toBe(409);
    expect(r2.json.erro).toMatch(/checklist/);
    expect(await prisma.checklistResposta.count({ where: { atividadeId: at1 } })).toBe(1);
  });

  it("tipos diferentes na mesma atividade: cada equipamento responde o checklist do SEU tipo", async () => {
    expect((await chamar(`${A}/equipamentos`, "POST", p1(), { equipamentoIds: ["eqD"] })).status).toBe(201);
    const x = await exec(p1());
    expect(equipDe(x, "eqD").itens.map((i: any) => i.texto)).toEqual(["Bomba de dreno"]);
    expect(equipDe(x, "eqA").itens.map((i: any) => i.texto)).toEqual(["Limpeza dos filtros", "Medição de corrente do compressor", "Teste de funcionamento"]);
    expect((await responder(p1(), "eqD", "i1", { status: "OK" })).status).toBe(400);
    expect((await responder(p1(), "eqD", "iCas", { status: "OK" })).status).toBe(200);
  });

  it("OS conclui com o que foi atendido (atividade cancelada não conta); relatório fiel: só os atendidos, cada um com o que é DELE", async () => {
    // Uma atividade CANCELADA com o eqB "atendido" e nada respondido: não trava a OS nem vira atendimento no relatório
    await prisma.atividadeOs.create({ data: { id: "at2c", empresaId: "e1", ordemServicoId: os2, titulo: "Retorno (cancelado)", status: "CANCELADA" } });
    await prisma.atividadeEquipamento.create({ data: { atividadeId: "at2c", equipamentoId: "eqB", feito: true } });
    expect((await chamar("ordens/[id]", "PUT", { id: os2 }, { status: "CONCLUIDA" })).status).toBe(200);
    // O equipamento "principal" da OS (o do chamado) sem vínculo NÃO vira atendido quando a OS tem equipamentos
    // vinculados (só a OS antiga, sem nenhum vínculo, conta o principal como atendido)
    await prisma.ordemServico.update({ where: { id: os2 }, data: { equipamentoId: "eqD" } });
    const { relatorioInterno } = await import("@/lib/relatorio-os/dados");
    const { dados } = (await relatorioInterno(os2, "e1"))!;
    expect(dados.equipamentos.map((b) => b.id)).toEqual(["eqA"]);
    expect(dados.naoAtendidos.map((e) => e.id)).toEqual(["eqD", "eqB"]);
    const b = dados.equipamentos[0];
    expect(b.checklistTipo).toEqual([{ atividade: expect.any(String), itens: [
      { texto: "Limpeza dos filtros", status: "OK", observacao: null, medicao: null, audio: false },
      { texto: "Medição de corrente do compressor", status: "ATENCAO", observacao: "6,2 A — acima do nominal", medicao: null, audio: false },
      { texto: "Teste de funcionamento", status: "OK", observacao: null, medicao: null, audio: false },
    ] }]);
    expect(b.resumoChecklist).toEqual({ ok: 2, atencao: 1, naoSeAplica: 0, medicoes: 0 });
    expect(b.fotos.map((f) => [f.url, f.legenda])).toEqual([[FOTO_PNG, "Limpeza dos filtros"], [FOTO_PNG, "Medição de corrente do compressor"]]);
    expect(b.observacoes).toEqual(["Dreno parcialmente obstruído — limpo."]);
    expect(dados.resultado.texto).toBe("Concluída · 1 de 3 equipamentos atendido · 1 de 2 atividades concluída");
    expect(dados.equipamentos.some((x) => x.id === "eqI")).toBe(false); // nunca "todos os da unidade"

    // Relatórios gerados na conclusão (link antigo: geral e por atividade) — também só o atendido
    const { carregarRelatorioPorToken } = await import("@/lib/relatorio-server");
    const rels = await prisma.relatorioOs.findMany({ where: { ordemServicoId: os2 }, orderBy: { escopo: "asc" } });
    expect(rels.map((r: any) => r.escopo).sort()).toEqual(["ATIVIDADE", "GERAL"]);
    for (const rel of rels) {
      const d = (await carregarRelatorioPorToken(rel.tokenPublico))!;
      expect(d.equipamentos.map((e: any) => e.id)).toEqual(["eqA"]);
      expect(d.blocos.map((x) => [x.id, x.checklistTipo[0].itens.length, x.fotos.length])).toEqual([["eqA", 3, 2]]);
    }
  });

  it("2 equipamentos e 2 atividades: cada bloco do relatório só com o que é DELE, das atividades em que ELE foi atendido", async () => {
    const os3 = (await novaOs({ equipamentoIds: ["eqA", "eqB"] })).json.id;
    const atX = await primeiraAtividade(os3);
    const atY = (await prisma.atividadeOs.create({ data: { empresaId: "e1", ordemServicoId: os3, titulo: "Retorno", status: "EM_ANDAMENTO" } })).id;
    const px = { id: os3, atividadeId: atX }, py = { id: os3, atividadeId: atY };
    for (const [eq, item, corpo] of [
      ["eqA", "i1", { status: "OK" }], ["eqA", "i2", { status: "ATENCAO", observacao: "Corrente alta" }], ["eqA", "i3", { status: "OK" }],
      ["eqB", "i1", { status: "NAO_SE_APLICA" }], ["eqB", "i2", { status: "OK", observacao: "5 A" }], ["eqB", "i3", { status: "OK" }],
    ] as const) expect((await responder(px, eq, item, corpo)).status).toBe(200);
    await chamar(FOTOS, "POST", { ...px, equipamentoId: "eqA" }, { dataUrl: FOTO_PNG, itemId: "i1" });
    const fotoB = dataUrl("image/png", new Uint8Array([...PNG, 1, 2, 3]));
    await chamar(FOTOS, "POST", { ...px, equipamentoId: "eqB" }, { dataUrl: fotoB });
    // Na 2ª atividade o eqA chegou a ter resposta, mas foi marcado "não atendido": não entra no bloco dele
    await chamar(`${A}/equipamentos`, "POST", py, { equipamentoIds: ["eqA"] });
    await responder(py, "eqA", "i1", { status: "ATENCAO", observacao: "não deveria aparecer" });
    await chamar(EQUIP, "PATCH", { ...py, equipamentoId: "eqA" }, { feito: false });

    const { relatorioInterno } = await import("@/lib/relatorio-os/dados");
    const { dados } = (await relatorioInterno(os3, "e1"))!;
    const bloco = (id: string) => dados.equipamentos.find((b) => b.id === id)!;
    expect(dados.equipamentos.map((b) => b.id)).toEqual(["eqA", "eqB"]);
    expect(bloco("eqA").checklistTipo.map((g) => g.itens.map((i) => i.status))).toEqual([["OK", "ATENCAO", "OK"]]);
    expect(bloco("eqB").checklistTipo.map((g) => g.itens.map((i) => i.status))).toEqual([["NAO_SE_APLICA", "OK", "OK"]]);
    expect([bloco("eqA").resumoChecklist, bloco("eqB").resumoChecklist]).toEqual([{ ok: 2, atencao: 1, naoSeAplica: 0, medicoes: 0 }, { ok: 2, atencao: 0, naoSeAplica: 1, medicoes: 0 }]);
    expect(bloco("eqA").fotos).toEqual([{ url: FOTO_PNG, legenda: "Limpeza dos filtros" }]);
    expect(bloco("eqB").fotos).toEqual([{ url: fotoB, legenda: "Foto do equipamento" }]);

    // Link antigo por atividade: só o que foi atendido NAQUELA atividade
    const rel = (atividadeId: string, tokenPublico: string) => prisma.relatorioOs.create({ data: {
      empresaId: "e1", ordemServicoId: os3, atividadeId, escopo: "ATIVIDADE", numero: `REL-${tokenPublico}`, mesReferencia: 10, anoReferencia: 2026, tokenPublico,
    } });
    await rel(atX, "tok-rel-x"); await rel(atY, "tok-rel-y");
    const { carregarRelatorioPorToken, carregarAtividade } = await import("@/lib/relatorio-server");
    expect((await carregarRelatorioPorToken("tok-rel-x"))!.blocos.map((b) => b.id)).toEqual(["eqA", "eqB"]);
    expect((await carregarRelatorioPorToken("tok-rel-y"))!.blocos).toEqual([]);
    // Relatório de atividade (o PR #48 acrescenta o token: passa-se o da atividade quando a coluna existir)
    const doc = async (id: string) => {
      const a = await prisma.atividadeOs.findUnique({ where: { id } });
      return (await (carregarAtividade as any)(id, a.tokenRelatorio))!.equipamentos.map((b: any) => b.id);
    };
    expect([await doc(atX), await doc(atY)]).toEqual([["eqA", "eqB"], []]);
  });

  it("histórico do equipamento: o atendimento entra sozinho, com o checklist, as fotos e a observação dele", async () => {
    const { carregarHistoricoEquipamento } = await import("@/lib/equipamento-historico");
    const fotoIds = (await prisma.fotoAtendimento.findMany({ where: { atividadeId: at2, equipamentoId: "eqA" }, orderBy: { criadoEm: "asc" } })).map((f: any) => f.id);
    const hA = (await carregarHistoricoEquipamento("e1", "eqA")).find((e) => e.atividadeId === at2)!;
    expect(hA).toMatchObject({
      equipamentoFeito: true, status: "CONCLUIDA", observacao: "Dreno parcialmente obstruído — limpo.",
      checklist: { ok: 2, atencao: 1, naoSeAplica: 0, total: 3, itensAtencao: ["Medição de corrente do compressor"] },
      fotos: fotoIds.map((id: string) => `/api/fotos-atendimento/${id}`),
    });
    const hB = (await carregarHistoricoEquipamento("e1", "eqB")).find((e) => e.atividadeId === at2)!;
    expect(hB).toMatchObject({ equipamentoFeito: false, checklist: null, fotos: [], observacao: null });
  });

  it("checklist do tipo: editar (remover/acrescentar/reordenar) não apaga respostas; item removido deixa de ser exigido", async () => {
    const r = await chamar("tipos-equipamento/[id]/checklist", "PUT", { id: "te1" }, { itens: [
      { id: "i2", texto: "Medição de corrente do compressor", tipoResposta: "OK_ATENCAO_NA", pedirFoto: false, pedirObservacao: true },
      { texto: "Verificação do dreno e bandeja", tipoResposta: "OK_ATENCAO_NA", pedirFoto: false, pedirObservacao: false },
      { id: "i1", texto: "Limpeza dos filtros", tipoResposta: "OK_ATENCAO_NA", pedirFoto: true, pedirObservacao: false },
    ] });
    expect(r.status).toBe(200);
    expect(await prisma.checklistTipoItem.findUnique({ where: { id: "i3" } })).toMatchObject({ ativo: false });
    expect(await prisma.checklistResposta.findFirst({ where: { itemId: "i3" } })).toMatchObject({ status: "OK", textoItem: "Teste de funcionamento" }); // resposta antiga intacta
    // Execução NOVA: checklist novo, na ordem nova, sem o removido
    const nova = await exec(p1());
    expect(equipDe(nova, "eqA").itens.map((i: any) => i.texto)).toEqual(["Medição de corrente do compressor", "Verificação do dreno e bandeja", "Limpeza dos filtros"]);
    // Execução ANTIGA: o removido continua à mostra (com a resposta), sem ser exigido
    const antiga = equipDe(await exec(p2()), "eqA");
    expect(antiga.itens.find((i: any) => i.id === "i3")).toMatchObject({ ativo: false, texto: "Teste de funcionamento" });
    expect(antiga.respostas.i3).toMatchObject({ status: "OK" });
    // Sem permissão de configurações: não edita
    logar("e1", so(["configuracoes", "visualizar"]));
    expect((await chamar("tipos-equipamento/[id]/checklist", "PUT", { id: "te1" }, { itens: [] })).status).toBe(403);
    logar();
  });

  it("impacto antes de inativar o tipo: equipamentos e itens de checklist que o usam", async () => {
    const r = await chamar("cadastros/[entidade]/[id]/impacto", "GET", { entidade: "tipos-equipamento", id: "te1" });
    expect(r.status).toBe(200);
    // eqA, eqB (Matriz) e eqC (Loja) usam o tipo; o inativo não conta
    expect(r.json.usos).toEqual([{ rotulo: "3 equipamentos ativos", total: 3 }, { rotulo: "3 itens de checklist", total: 3 }]);
    expect(r.json.avisos[1]).toBe("O checklist deste tipo (3 itens) fica guardado: equipamentos deste tipo continuam respondendo ele nas OS, e as respostas antigas não mudam.");
  });

  it("isolamento e permissão: outra empresa não vê nem grava; só visualizar não grava; sem login 401", async () => {
    logar("e2");
    expect((await chamar(EXEC, "GET", p2())).status).toBe(404);
    expect((await responder(p1(), "eqA", "i1", { status: "ATENCAO" })).status).toBe(404);
    expect((await chamar(`${A}/equipamentos`, "POST", p1(), { equipamentoIds: ["eqB"] })).status).toBe(404);
    logar("e1", so(["ordens", "visualizar"]));
    expect((await chamar(EXEC, "GET", p1())).status).toBe(200);
    expect((await responder(p1(), "eqA", "i1", { status: "ATENCAO" })).status).toBe(403);
    // Técnico em campo (só "concluir"): executa e vincula
    logar("e1", so(["ordens", "visualizar"], ["ordens", "concluir"]));
    expect((await responder(p1(), "eqA", "i1", { status: "ATENCAO" })).status).toBe(200);
    sessao.atual = null;
    expect((await chamar(EXEC, "GET", p1())).status).toBe(401);
    logar();
    expect((await prisma.checklistResposta.findFirst({ where: { atividadeId: at1, itemId: "i1" } })).status).toBe("ATENCAO");
  });
});
