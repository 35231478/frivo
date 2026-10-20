/**
 * App do TÉCNICO (Etapa 2) — rotas reais com o Prisma real num PostgreSQL real (schema descartável
 * via `prisma db push`). Prova, de ponta a ponta:
 *  - "Meu dia": só as atividades de HOJE atribuídas ao técnico (responsável ou na composição), em
 *    ordem de horário, com cliente, endereço, rota no mapa, horário, situação e nº de equipamentos;
 *    a começada ontem e não concluída aparece à parte; cancelada e de outro técnico não aparecem;
 *  - escopo no SERVIDOR: técnico puro só lê/grava as atividades dele (a de outro: 403); quem tem
 *    permissão maior segue com a empresa toda;
 *  - sincronização offline: a fila inteira (iniciar, TUDO OK, medição, Atenção com foto + áudio,
 *    fotos antes/depois, serviço adicional com foto, concluir) sobe em ordem; REENVIAR não duplica
 *    nada (nem foto, nem adicional); falha numa operação segura as seguintes DA MESMA atividade;
 *  - medição = só captura (número + unidade, sem OK/Atenção); "Atenção" exige foto + observação;
 *  - áudio conferido pelo conteúdo e servido só para a empresa; cobrança do adicional é do escritório.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/app-tecnico-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { inicioHojeBR } from "@/lib/fuso";
import { M4A, PNG, WEBM, dataUrl } from "./arquivos-exemplo";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_app_tecnico_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

/** Técnico puro (perfil padrão de Técnico) ligado ao técnico t1 */
const comoTecnico = (tecnicoId: string | null = "t1", id = "uT", email = "joao@clima.com") => {
  sessao.atual = { user: { id, name: "João", email, empresaId: "e1", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId } };
};
/** Operador com tudo (escritório) */
const comoEscritorio = (empresaId = "e1", permissoes: Permissoes = permissoesTotais(), id = "uA") => {
  sessao.atual = { user: { id, name: "Ana", email: "ana@clima.com", empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown, query = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x${query}`, {
    method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  const tipo = res.headers.get("content-type") ?? "";
  return { status: res.status, tipo, json: tipo.includes("json") ? await res.json() : null };
}
const sync = async (operacoes: unknown[]) => chamar("tecnico/sync", "POST", {}, { operacoes });
const op = (tipo: string, atividadeId: string, extra: Record<string, unknown> = {}) => ({ id: randomUUID(), tipo, atividadeId, em: new Date().toISOString(), ...extra });
const FOTO = dataUrl("image/png", PNG);
const AUDIO = dataUrl("audio/webm", WEBM);
const H = 60 * 60 * 1000;

describe.skipIf(!URL_PG)("app do técnico: Meu dia, escopo e sincronização offline (PostgreSQL real)", () => {
  let prisma: any;
  const hoje = inicioHojeBR();
  const exec = async (atividadeId: string) => (await chamar("tecnico/atividades/[atividadeId]", "GET", { atividadeId })).json;
  const equipDe = (x: any, id: string) => x.execucao.equipamentos.find((e: any) => e.equipamento.id === id);

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all([
      "tecnico/meu-dia", "tecnico/agenda", "tecnico/atividades/[atividadeId]", "tecnico/sync", "checklist-respostas/[id]/audio",
      "servicos-adicionais/fotos/[id]", "ordens/[id]/servicos-adicionais/[servicoId]", "ordens/[id]/atividades/[atividadeId]",
      "ordens/[id]/atividades/[atividadeId]/execucao", "ordens/[id]/atividades/[atividadeId]/execucao/equipamentos/[equipamentoId]/itens/[itemId]",
    ].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await Promise.all([import("@/lib/relatorio-os/dados"), import("@/lib/equipamento-historico")]);

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uT", empresaId: "e1", nome: "João", email: "joao@clima.com", senha: "x", role: "TECNICO" },
      { id: "uT2", empresaId: "e1", nome: "Maria", email: "maria@clima.com", senha: "x", role: "TECNICO" },
      { id: "uA", empresaId: "e1", nome: "Ana", email: "ana@clima.com", senha: "x" },
      { id: "uE2", empresaId: "e2", nome: "Beto", email: "b@x.com", senha: "x" },
    ] });
    await prisma.tecnico.createMany({ data: [
      { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "1", telefone: "1", email: "JOAO@Clima.com" },
      { id: "t2", empresaId: "e1", nome: "Maria Souza", cpf: "2", telefone: "2", email: "maria@clima.com" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Luzia LTDA", nomeFantasia: "Hospital Santa Luzia", cpfCnpj: "1", telefone: "1133334444" },
      { id: "c2", empresaId: "e1", nome: "Padaria Pão Quente", cpfCnpj: "2", endereco: "Rua das Flores", numero: "10", cidade: "Santos", estado: "SP" },
      { id: "cE2", empresaId: "e2", nome: "Da outra", cpfCnpj: "3" },
    ] });
    await prisma.unidade.createMany({ data: [
      { id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz", logradouro: "Av. Paulista", numero: "1000", bairro: "Bela Vista", cidade: "São Paulo", estado: "SP", latitude: -23.56, longitude: -46.65 },
      { id: "un2", empresaId: "e1", clienteId: "c2", nome: "Loja" },
      { id: "unE2", empresaId: "e2", clienteId: "cE2", nome: "Sede" },
    ] });
    await prisma.tipoEquipamentoCustom.create({ data: { id: "te1", empresaId: "e1", nome: "Split Hi-Wall (parede)", chaveEnum: "AR_CONDICIONADO_SPLIT" } });
    await prisma.checklistTipoItem.createMany({ data: [
      { id: "i1", empresaId: "e1", tipoEquipamentoId: "te1", texto: "Limpeza dos filtros de ar", pedirFoto: true, ordem: 1 },
      { id: "i2", empresaId: "e1", tipoEquipamentoId: "te1", texto: "Dreno e bandeja", ordem: 2 },
      { id: "m1", empresaId: "e1", tipoEquipamentoId: "te1", texto: "Pressão de sucção", tipoResposta: "MEDICAO", unidade: "psi", ordem: 3 },
      { id: "m2", empresaId: "e1", tipoEquipamentoId: "te1", texto: "Temperatura de insuflamento", tipoResposta: "MEDICAO", unidade: "°C", ordem: 4 },
    ] });
    const eq = (id: string, unidadeId: string, nome: string, extra: Record<string, unknown> = {}) =>
      ({ id, empresaId: "e1", unidadeId, tipo: "AR_CONDICIONADO_SPLIT", tipoEquipamentoId: "te1", marca: "Daikin", modelo: "FTXS", nome, ...extra });
    await prisma.equipamento.createMany({ data: [
      eq("eqA", "un1", "Split Sala 1", { patrimonio: "AC-01" }), eq("eqB", "un1", "Split Sala 2"), eq("eqN", "un1", "Split Sala 3"),
      eq("eqC", "un2", "Split da padaria"), eq("eqX", "un1", "Desativado", { ativo: false }),
    ] });
    await prisma.qrcode.create({ data: { empresaId: "e1", codigo: "QR-2026-0003", equipamentoId: "eqN", tokenPublico: "tok-eqN" } });
    const os = (id: string, numero: string, clienteId: string, unidadeId: string) =>
      ({ id, empresaId: "e1", numero, clienteId, unidadeId, criadoPorId: "uA", descricao: `Preventiva ${numero}` });
    await prisma.ordemServico.createMany({ data: [
      os("osA", "OS-0001", "c1", "un1"), os("osB", "OS-0002", "c2", "un2"), os("osC", "OS-0003", "c1", "un1"), os("osD", "OS-0004", "c1", "un1"),
    ] });
    const at = (id: string, ordemServicoId: string, titulo: string, tecnicoId: string, dataAgendada: Date | null, status = "AGENDADA") =>
      ({ id, empresaId: "e1", ordemServicoId, titulo, tecnicoId, dataAgendada, status });
    await prisma.atividadeOs.createMany({ data: [
      at("aA", "osA", "Preventiva mensal", "t1", new Date(hoje.getTime() + 14 * H)),
      at("aB", "osB", "Corretiva", "t2", new Date(hoje.getTime() + 8.5 * H)), // t1 na composição
      at("aC", "osC", "Da Maria", "t2", new Date(hoje.getTime() + 9 * H)),
      at("aD", "osD", "Começada ontem", "t1", new Date(hoje.getTime() - 15 * H), "EM_ANDAMENTO"),
      at("aE", "osA", "Cancelada", "t1", new Date(hoje.getTime() + 10 * H), "CANCELADA"),
      at("aF", "osA", "Amanhã", "t1", new Date(hoje.getTime() + 33 * H)),
      at("aG", "osD", "Sem horário", "t1", hoje),
    ] });
    await prisma.atividadeTecnico.create({ data: { atividadeId: "aB", tecnicoId: "t1" } });
    await prisma.atividadeEquipamento.createMany({ data: [
      { atividadeId: "aA", equipamentoId: "eqA" }, { atividadeId: "aA", equipamentoId: "eqB" },
      { atividadeId: "aB", equipamentoId: "eqC" }, { atividadeId: "aC", equipamentoId: "eqA" },
    ] });
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("Meu dia: só as de HOJE atribuídas a ele, em ordem de horário (sem horário no fim); a começada ontem à parte", async () => {
    comoTecnico();
    const r = await chamar("tecnico/meu-dia", "GET");
    expect(r.status).toBe(200);
    expect(r.json.tecnico).toEqual({ id: "t1", nome: "João Silva" });
    expect(r.json.atividades.map((a: any) => [a.atividadeId, a.hora])).toEqual([["aB", "08:30"], ["aA", "14:00"], ["aG", null]]);
    expect(r.json.anteriores.map((a: any) => a.atividadeId)).toEqual(["aD"]);
    const a = r.json.atividades[1];
    expect(a).toMatchObject({
      osNumero: "OS-0001", titulo: "Preventiva mensal", status: "AGENDADA", cliente: "Hospital Santa Luzia", unidade: "Matriz",
      endereco: "Av. Paulista, 1000 — Bela Vista, São Paulo/SP", equipamentos: 2, atendidos: 0, telefone: "1133334444",
    });
    expect(a.rota).toBe("https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=-23.56%2C-46.65");
    // Unidade sem endereço: usa o do cliente
    expect(r.json.atividades[0]).toMatchObject({ endereco: "Rua das Flores, 10 — Santos/SP", rota: expect.stringContaining("destination=Rua%20das%20Flores") });
    // Agenda: hoje e os próximos dias, por dia
    const ag = await chamar("tecnico/agenda", "GET", {}, undefined, "?dias=3");
    expect(ag.json.dias.map((d: any) => [d.dia, d.atividades.map((x: any) => x.atividadeId)])).toEqual([
      [r.json.dia, ["aB", "aA", "aG"]], [expect.any(String), ["aF"]],
    ]);
    // Maria vê as dela
    comoTecnico("t2", "uT2", "maria@clima.com");
    expect((await chamar("tecnico/meu-dia", "GET")).json.atividades.map((x: any) => x.atividadeId)).toEqual(["aB", "aC"]);
    // Usuário sem técnico ligado: aviso claro, lista vazia
    comoEscritorio();
    expect((await chamar("tecnico/meu-dia", "GET")).json).toMatchObject({ tecnico: null, atividades: [], aviso: expect.stringContaining("não está ligado a um técnico") });
  });

  it("escopo no servidor: técnico puro lê/grava só as atividades dele; o escritório vê todas; outra empresa não vê", async () => {
    comoTecnico();
    const x = await exec("aA");
    expect(x.cartao.atividadeId).toBe("aA");
    expect(x.execucao.equipamentos.map((e: any) => e.equipamento.id)).toEqual(["eqA", "eqB"]);
    expect(equipDe(x, "eqA").itens.map((i: any) => [i.texto, i.tipoResposta, i.unidade])).toEqual([
      ["Limpeza dos filtros de ar", "OK_ATENCAO_NA", null], ["Dreno e bandeja", "OK_ATENCAO_NA", null],
      ["Pressão de sucção", "MEDICAO", "psi"], ["Temperatura de insuflamento", "MEDICAO", "°C"],
    ]);
    // Lista da unidade para vincular o que faltou: só os ATIVOS da unidade da OS
    expect(x.equipamentosUnidade.map((e: any) => e.id).sort()).toEqual(["eqA", "eqB", "eqN"]);
    expect((await chamar("tecnico/atividades/[atividadeId]", "GET", { atividadeId: "aC" })).status).toBe(403);
    // Rotas da OS (Etapa 1) também respeitam o escopo
    expect((await chamar("ordens/[id]/atividades/[atividadeId]/execucao", "GET", { id: "osC", atividadeId: "aC" })).status).toBe(403);
    expect((await chamar("ordens/[id]/atividades/[atividadeId]/execucao/equipamentos/[equipamentoId]/itens/[itemId]", "PUT",
      { id: "osC", atividadeId: "aC", equipamentoId: "eqA", itemId: "i2" }, { status: "OK" })).json.erro).toBe("Esta atividade não está atribuída a você. Fale com o escritório.");
    expect((await chamar("ordens/[id]/atividades/[atividadeId]", "PUT", { id: "osC", atividadeId: "aC" }, { status: "EM_ANDAMENTO" })).status).toBe(403);
    // Pela sincronização, idem — e nada é gravado
    const r = await sync([op("resposta", "aC", { equipamentoId: "eqA", itemId: "i2", dados: { status: "OK" } })]);
    expect(r.json.resultados[0]).toMatchObject({ ok: false, status: 403 });
    expect(await prisma.checklistResposta.count({ where: { atividadeId: "aC" } })).toBe(0);
    // Técnico sem vínculo na sessão (logou antes de ser ligado) não fica preso: sem restrição de modo
    comoTecnico(null);
    expect((await chamar("tecnico/atividades/[atividadeId]", "GET", { atividadeId: "aC" })).status).toBe(200);
    // Escritório vê qualquer uma; outra empresa, nenhuma
    comoEscritorio();
    expect((await chamar("tecnico/atividades/[atividadeId]", "GET", { atividadeId: "aC" })).status).toBe(200);
    comoEscritorio("e2", permissoesTotais(), "uE2");
    expect((await chamar("tecnico/atividades/[atividadeId]", "GET", { atividadeId: "aA" })).status).toBe(404);
    expect((await sync([op("iniciar", "aA")])).json.resultados[0]).toMatchObject({ ok: false, status: 404 });
  });

  const fila: any[] = [];
  it("a fila feita SEM sinal sobe inteira, em ordem: iniciar, TUDO OK, medições, Atenção com foto+áudio, antes/depois, adicional, concluir", async () => {
    comoTecnico();
    fila.push(
      op("iniciar", "aA"),
      op("foto", "aA", { equipamentoId: "eqA", dados: { dataUrl: FOTO, momento: "ANTES", clientId: "foto-antes-eqA-001" } }),
      op("tudoOk", "aA", { equipamentoId: "eqA" }),
      op("resposta", "aA", { equipamentoId: "eqA", itemId: "i2", dados: { status: "ATENCAO", observacao: "Bandeja com lodo" } }),
      op("foto", "aA", { equipamentoId: "eqA", dados: { dataUrl: FOTO, itemId: "i2", clientId: "foto-i2-eqA-0001" } }),
      op("audio", "aA", { equipamentoId: "eqA", itemId: "i2", dataUrl: AUDIO }),
      op("foto", "aA", { equipamentoId: "eqA", dados: { dataUrl: FOTO, itemId: "i1", clientId: "foto-i1-eqA-0001" } }),
      op("resposta", "aA", { equipamentoId: "eqA", itemId: "m1", dados: { valor: 118.5 } }),
      op("resposta", "aA", { equipamentoId: "eqA", itemId: "m2", dados: { valor: 12, unidade: "°F" } }),
      op("foto", "aA", { equipamentoId: "eqA", dados: { dataUrl: FOTO, momento: "DEPOIS", clientId: "foto-depois-eqA-01" } }),
      op("equipamento", "aA", { equipamentoId: "eqB", dados: { feito: false } }),
      op("adicional", "aA", { dados: { clientId: "adic-0001-aaaa", descricao: "Troca do controle remoto (pedido do cliente)", equipamentoId: "eqB" } }),
      op("adicionalFoto", "aA", { dados: { servicoClientId: "adic-0001-aaaa", dataUrl: FOTO, clientId: "foto-adic-0001" } }),
      op("concluir", "aA", { dados: { resumo: "Preventiva feita; controle remoto trocado a pedido." } }),
    );
    const r = await sync(fila);
    expect(r.status).toBe(200);
    expect(r.json.resultados.map((x: any) => [x.ok, x.status, x.erro ?? null])).toEqual(fila.map((o) => [true, expect.any(Number), null]));
    const a = await prisma.atividadeOs.findUnique({ where: { id: "aA" } });
    expect([a.status, a.resumo]).toEqual(["CONCLUIDA", "Preventiva feita; controle remoto trocado a pedido."]);
    const hist = await prisma.osHistorico.findMany({ where: { ordemServicoId: "osA" }, orderBy: { criadoEm: "asc" } });
    expect(hist.map((h: any) => h.detalhes)).toEqual([
      "\"Preventiva mensal\": AGENDADA → EM_ANDAMENTO (app do técnico)", "\"Preventiva mensal\": EM_ANDAMENTO → CONCLUIDA",
    ]);
    const resp = await prisma.checklistResposta.findMany({ where: { atividadeId: "aA", equipamentoId: "eqA" }, orderBy: { itemId: "asc" } });
    expect(resp.map((x: any) => [x.itemId, x.status, x.observacao, x.valor?.toNumber() ?? null, x.unidade, !!x.audioUrl, x.respondidoPorId])).toEqual([
      ["i1", "OK", null, null, null, false, "uT"],
      ["i2", "ATENCAO", "Bandeja com lodo", null, null, true, "uT"],
      ["m1", null, null, 118.5, "psi", false, "uT"], // unidade padrão do item
      ["m2", null, null, 12, "°F", false, "uT"], // a que o técnico escolheu
    ]);
    const fotos = await prisma.fotoAtendimento.findMany({ where: { atividadeId: "aA" }, orderBy: { criadoEm: "asc" } });
    expect(fotos.map((f: any) => [f.equipamentoId, f.itemId, f.momento, f.clientId])).toEqual([
      ["eqA", null, "ANTES", "foto-antes-eqA-001"], ["eqA", "i2", null, "foto-i2-eqA-0001"], ["eqA", "i1", null, "foto-i1-eqA-0001"], ["eqA", null, "DEPOIS", "foto-depois-eqA-01"],
    ]);
    const adic = await prisma.servicoAdicional.findMany({ include: { fotos: true } });
    expect(adic.map((s: any) => [s.ordemServicoId, s.atividadeId, s.equipamentoId, s.statusCobranca, s.criadoPorId, s.fotos.length])).toEqual([["osA", "aA", "eqB", "A_AVALIAR", "uT", 1]]);
    // Nenhuma OS nova foi criada para o adicional
    expect(await prisma.ordemServico.count()).toBe(4);
    // eqB ficou "não atendido" (não trava); o retrato da atividade já mostra tudo
    comoEscritorio();
    const x = await exec("aA");
    expect(x.execucao).toMatchObject({ bloqueada: true, conclusao: { ok: true, atendidos: 1, naoAtendidos: 1 } });
    expect(equipDe(x, "eqA").respostas.i2).toMatchObject({ status: "ATENCAO", audio: true, audioId: expect.any(String) });
    expect(equipDe(x, "eqA").respostas.m1).toMatchObject({ valor: 118.5, unidade: "psi", status: null });
    expect(x.execucao.adicionais).toEqual([expect.objectContaining({ clientId: "adic-0001-aaaa", descricao: "Troca do controle remoto (pedido do cliente)", statusCobranca: "A_AVALIAR", criadoPor: "João", fotos: [expect.objectContaining({ clientId: "foto-adic-0001" })] })]);
  });

  it("ALIMENTA o relatório da OS (#44) e o histórico do equipamento (#7): medições com unidade, antes/depois, áudio só marcado, adicional destacado", async () => {
    const { relatorioInterno } = await import("@/lib/relatorio-os/dados");
    const { dados } = (await relatorioInterno("osA", "e1"))!;
    expect(dados.equipamentos.map((b) => b.id)).toEqual(["eqA"]); // só o atendido (eqB ficou "não atendido")
    expect(dados.naoAtendidos.map((e) => e.id)).toEqual(["eqB"]);
    const b = dados.equipamentos[0];
    expect(b.checklistTipo[0].itens.map((i) => [i.texto, i.status, i.medicao, i.audio, i.observacao])).toEqual([
      ["Limpeza dos filtros de ar", "OK", null, false, null],
      ["Dreno e bandeja", "ATENCAO", null, true, "Bandeja com lodo"],
      ["Pressão de sucção", null, { valor: 118.5, unidade: "psi" }, false, null],
      ["Temperatura de insuflamento", null, { valor: 12, unidade: "°F" }, false, null],
    ]);
    expect(b.resumoChecklist).toEqual({ ok: 1, atencao: 1, naoSeAplica: 0, medicoes: 2 });
    // antes → fotos dos itens → depois
    expect(b.fotos.map((f) => f.legenda)).toEqual(["Antes do serviço", "Dreno e bandeja", "Limpeza dos filtros de ar", "Depois do serviço"]);
    expect(dados.adicionais).toEqual([{
      id: expect.any(String), descricao: "Troca do controle remoto (pedido do cliente)", atividade: "Preventiva mensal", equipamento: "Split Sala 2",
      statusCobranca: "A_AVALIAR", criadoPor: "João", fotos: [{ url: FOTO, legenda: "Adicional — foto 1" }],
    }]);
    // Histórico do equipamento: medições e áudio no eqA; o adicional no eqB (mesmo não atendido)
    const { carregarHistoricoEquipamento } = await import("@/lib/equipamento-historico");
    const hA = (await carregarHistoricoEquipamento("e1", "eqA")).find((e) => e.atividadeId === "aA")!;
    expect(hA.medicoes).toEqual([{ texto: "Pressão de sucção", valor: 118.5, unidade: "psi" }, { texto: "Temperatura de insuflamento", valor: 12, unidade: "°F" }]);
    expect(hA.checklist).toMatchObject({ ok: 1, atencao: 1, itensAtencao: ["Dreno e bandeja"] });
    expect(hA.audios).toEqual([{ texto: "Dreno e bandeja", url: expect.stringMatching(/^\/api\/checklist-respostas\/.+\/audio$/) }]);
    expect(hA.fotos).toHaveLength(4);
    const hB = (await carregarHistoricoEquipamento("e1", "eqB")).find((e) => e.atividadeId === "aA")!;
    expect(hB.adicionais).toEqual([{ descricao: "Troca do controle remoto (pedido do cliente)", statusCobranca: "A_AVALIAR", fotos: [expect.stringMatching(/^\/api\/servicos-adicionais\/fotos\//)] }]);
    // A foto do adicional é servida só para a empresa
    comoEscritorio();
    const fotoAd = await prisma.servicoAdicionalFoto.findFirst();
    expect((await chamar("servicos-adicionais/fotos/[id]", "GET", { id: fotoAd.id })).tipo).toBe("image/png");
    comoEscritorio("e2", permissoesTotais(), "uE2");
    expect((await chamar("servicos-adicionais/fotos/[id]", "GET", { id: fotoAd.id })).status).toBe(404);
  });

  it("REENVIAR a mesma fila (resposta perdida) não duplica nada: devolve o resultado guardado", async () => {
    comoTecnico();
    const antes = await Promise.all([prisma.fotoAtendimento.count(), prisma.servicoAdicional.count(), prisma.servicoAdicionalFoto.count(), prisma.osHistorico.count()]);
    const r = await sync(fila);
    expect(r.json.resultados.every((x: any) => x.ok && x.repetida)).toBe(true);
    expect(await Promise.all([prisma.fotoAtendimento.count(), prisma.servicoAdicional.count(), prisma.servicoAdicionalFoto.count(), prisma.osHistorico.count()])).toEqual(antes);
    // A mesma foto (mesmo id do aparelho) numa operação NOVA também não duplica
    await prisma.atividadeOs.update({ where: { id: "aA" }, data: { status: "EM_ANDAMENTO" } });
    const r2 = await sync([op("foto", "aA", { equipamentoId: "eqA", dados: { dataUrl: FOTO, momento: "ANTES", clientId: "foto-antes-eqA-001" } })]);
    expect(r2.json.resultados[0]).toMatchObject({ ok: true, dados: { clientId: "foto-antes-eqA-001", momento: "ANTES" } });
    expect(await prisma.fotoAtendimento.count()).toBe(antes[0]);
    // O id da operação é de quem a criou: outro usuário com o mesmo id é recusado
    comoTecnico("t2", "uT2", "maria@clima.com");
    expect((await sync([{ ...fila[0], atividadeId: "aB" }])).json.resultados[0]).toMatchObject({ ok: false, status: 409 });
  });

  it("falha numa operação SEGURA as seguintes da mesma atividade (vão na próxima rodada); outras atividades seguem", async () => {
    comoTecnico();
    const ops = [
      op("resposta", "aB", { equipamentoId: "eqC", itemId: "m1", dados: { status: "OK" } }), // medição não aceita OK
      op("tudoOk", "aB", { equipamentoId: "eqC" }),
      op("iniciar", "aG"),
    ];
    const r = await sync(ops);
    expect(r.json.resultados.map((x: any) => [x.ok, x.status, x.adiada ?? false])).toEqual([[false, 400, false], [false, 0, true], [true, 200, false]]);
    expect(r.json.resultados[0].erro).toBe("Item de medição: informe o número (ou “Não se aplica”).");
    expect(await prisma.checklistResposta.count({ where: { atividadeId: "aB" } })).toBe(0); // o TUDO OK não rodou
    expect((await prisma.atividadeOs.findUnique({ where: { id: "aG" } })).status).toBe("EM_ANDAMENTO");
    // Corrigida a primeira, a adiada sobe na próxima rodada
    const r2 = await sync([op("resposta", "aB", { equipamentoId: "eqC", itemId: "m1", dados: { status: "NAO_SE_APLICA" } }), ops[1]]);
    expect(r2.json.resultados.map((x: any) => x.ok)).toEqual([true, true]);
    expect(r2.json.resultados[1].dados.marcados.sort()).toEqual(["i1", "i2"]);
    // Operação malformada não derruba o lote
    const r3 = await sync([{ id: "x", tipo: "inventado", atividadeId: "aB" }, op("iniciar", "aF")]);
    expect(r3.json.resultados.map((x: any) => [x.ok, x.status])).toEqual([[false, 400], [true, 200]]);
  });

  it("medição = só captura: número + unidade; nada de OK/Atenção; N/A limpa o número e medir tira o N/A; item comum não aceita número", async () => {
    comoTecnico();
    const resp = (itemId: string, dados: unknown) => sync([op("resposta", "aB", { equipamentoId: "eqC", itemId, dados })]).then((r) => r.json.resultados[0]);
    expect(await resp("m2", { valor: -3.25 })).toMatchObject({ ok: true, dados: { valor: -3.25, unidade: "°C", status: null } });
    expect(await resp("m2", { status: "NAO_SE_APLICA" })).toMatchObject({ ok: true, dados: { valor: null, status: "NAO_SE_APLICA" } });
    expect(await resp("m2", { valor: 0 })).toMatchObject({ ok: true, dados: { valor: 0, status: null, unidade: "°C" } });
    expect(await resp("m2", { status: "ATENCAO" })).toMatchObject({ ok: false, status: 400 });
    expect(await resp("i1", { valor: 10 })).toMatchObject({ ok: false, status: 400, erro: "Este item não é de medição." });
    expect(await resp("m1", { valor: 1e12 })).toMatchObject({ ok: false, status: 400 });
    expect(await resp("m1", { valor: "12" })).toMatchObject({ ok: false, status: 400 });
    expect(await resp("m1", { valor: 12.34567 })).toMatchObject({ ok: true, dados: { valor: 12.346 } });
  });

  it("“Atenção” exige foto + observação para concluir (o áudio vale como observação); a mensagem diz o que falta", async () => {
    comoTecnico();
    await sync([
      op("resposta", "aB", { equipamentoId: "eqC", itemId: "i2", dados: { status: "ATENCAO" } }),
      op("tudoOk", "aB", { equipamentoId: "eqC" }), // TUDO OK depois não apaga a Atenção
      op("foto", "aB", { equipamentoId: "eqC", dados: { dataUrl: FOTO, itemId: "i1", clientId: "foto-i1-eqC-0001" } }),
    ]);
    expect((await prisma.checklistResposta.findFirst({ where: { atividadeId: "aB", itemId: "i2" } })).status).toBe("ATENCAO");
    const r = await sync([op("concluir", "aB", { dados: {} })]);
    expect(r.json.resultados[0]).toMatchObject({ ok: false, status: 422 });
    expect(r.json.resultados[0].erro).toBe("Para concluir, falta: Split da padaria — foto em “Dreno e bandeja”; observação em “Dreno e bandeja”.");
    expect(r.json.resultados[0].extra.pendencias[0]).toMatchObject({ equipamentoId: "eqC", semFoto: ["Dreno e bandeja"], semObservacao: ["Dreno e bandeja"] });
    const r2 = await sync([
      op("foto", "aB", { equipamentoId: "eqC", dados: { dataUrl: FOTO, itemId: "i2", clientId: "foto-i2-eqC-0001" } }),
      op("audio", "aB", { equipamentoId: "eqC", itemId: "i2", dataUrl: dataUrl("audio/mp4", M4A) }),
      op("concluir", "aB", { dados: {} }),
    ]);
    expect(r2.json.resultados.map((x: any) => x.ok)).toEqual([true, true, true]);
    // Concluir de novo (reenvio de outro aparelho) não é erro; mexer depois de concluída é (reabra)
    const r3 = await sync([op("concluir", "aB", { dados: {} }), op("resposta", "aB", { equipamentoId: "eqC", itemId: "i1", dados: { status: "ATENCAO" } })]);
    expect(r3.json.resultados.map((x: any) => [x.ok, x.status])).toEqual([[true, 200], [false, 409]]);
    expect(r3.json.resultados[1].erro).toBe("Atividade concluída: reabra a atividade para alterar a execução.");
  });

  it("áudio: tipo conferido pelos bytes (imagem disfarçada é recusada), servido como áudio só para a empresa; tirar o áudio", async () => {
    comoTecnico();
    await prisma.atividadeOs.update({ where: { id: "aB" }, data: { status: "EM_ANDAMENTO" } });
    const falso = await sync([op("audio", "aB", { equipamentoId: "eqC", itemId: "i1", dataUrl: dataUrl("audio/webm", PNG) })]);
    expect(falso.json.resultados[0]).toMatchObject({ ok: false, status: 400, erro: "Áudio inválido: grave de novo pelo app." });
    const resp = await prisma.checklistResposta.findFirst({ where: { atividadeId: "aB", itemId: "i2" } });
    expect(resp.audioUrl.startsWith("data:audio/mp4;base64,")).toBe(true);
    const a = await chamar("checklist-respostas/[id]/audio", "GET", { id: resp.id });
    expect([a.status, a.tipo]).toEqual([200, "audio/mp4"]);
    comoEscritorio("e2", permissoesTotais(), "uE2");
    expect((await chamar("checklist-respostas/[id]/audio", "GET", { id: resp.id })).status).toBe(404);
    comoTecnico("t2", "uT2", "maria@clima.com"); // aB é da Maria (responsável): ela também ouve
    expect((await chamar("checklist-respostas/[id]/audio", "GET", { id: resp.id })).status).toBe(200);
    comoTecnico();
    expect((await sync([op("audio", "aB", { equipamentoId: "eqC", itemId: "i2", dataUrl: null })])).json.resultados[0]).toMatchObject({ ok: true, dados: { audioId: null } });
    expect((await prisma.checklistResposta.findFirst({ where: { id: resp.id } })).audioUrl).toBeNull();
  });

  it("vincular o que faltou (QR e lista) e o adicional: só do cliente da OS; editar/tirar pelo id do aparelho; foto de item não tem antes/depois", async () => {
    comoTecnico();
    await prisma.atividadeOs.update({ where: { id: "aA" }, data: { status: "EM_ANDAMENTO" } });
    const r = await sync([
      op("scan", "aA", { valor: "https://app/qr/tok-eqN" }),
      op("vincular", "aB", { equipamentoIds: ["eqA"] }), // eqA é de outro cliente
    ]);
    expect(r.json.resultados.map((x: any) => [x.ok, x.status])).toEqual([[true, 201], [false, 400]]);
    expect(await prisma.atividadeEquipamento.findFirst({ where: { atividadeId: "aA", equipamentoId: "eqN" } })).toMatchObject({ feito: true });
    const r2 = await sync([
      op("adicional", "aA", { dados: { clientId: "adic-0001-aaaa", descricao: "Troca do controle remoto e das pilhas" } }),
      op("adicional", "aA", { dados: { clientId: "adic-0002-bbbb", descricao: "Limpeza extra", equipamentoId: "eqC" } }), // de outro cliente
      op("adicionalRemover", "aA", { dados: { clientId: "adic-0009-zzzz" } }), // nunca subiu: nada a tirar, não é erro
    ]);
    expect(r2.json.resultados.map((x: any) => [x.ok, x.status])).toEqual([[true, 200], [false, 400], [false, 0]]);
    const s = await prisma.servicoAdicional.findFirst({ where: { clientId: "adic-0001-aaaa" } });
    expect([s.descricao, s.equipamentoId]).toEqual(["Troca do controle remoto e das pilhas", "eqB"]); // equipamento não enviado = mantém
    expect((await sync([op("adicionalRemover", "aA", { dados: { clientId: "adic-0001-aaaa" } })])).json.resultados[0]).toMatchObject({ ok: true, dados: { removidos: 1 } });
    expect(await prisma.servicoAdicionalFoto.count({ where: { servicoId: s.id } })).toBe(0); // as fotos foram junto
    const r3 = await sync([op("foto", "aA", { equipamentoId: "eqA", dados: { dataUrl: FOTO, itemId: "i1", momento: "ANTES", clientId: "foto-errada-0001" } })]);
    expect(r3.json.resultados[0]).toMatchObject({ ok: false, status: 400 });
  });

  it("cobrança do adicional: o escritório decide (fica no histórico da OS); o técnico não", async () => {
    comoEscritorio();
    await sync([op("adicional", "aA", { dados: { clientId: "adic-0003-cccc", descricao: "Instalar suporte novo" } })]);
    const s = await prisma.servicoAdicional.findFirst({ where: { clientId: "adic-0003-cccc" } });
    expect(s.statusCobranca).toBe("A_AVALIAR");
    comoTecnico();
    const t = await chamar("ordens/[id]/servicos-adicionais/[servicoId]", "PATCH", { id: "osA", servicoId: s.id }, { statusCobranca: "NAO_COBRAR" });
    expect([t.status, t.json.erro]).toEqual([403, "A cobrança do serviço adicional é decidida pelo escritório."]);
    comoEscritorio();
    const r = await chamar("ordens/[id]/servicos-adicionais/[servicoId]", "PATCH", { id: "osA", servicoId: s.id }, { statusCobranca: "COBRAR" });
    expect(r.json).toEqual({ id: s.id, statusCobranca: "COBRAR" });
    expect((await prisma.osHistorico.findFirst({ where: { acao: "Serviço adicional: cobrança" } })).detalhes).toBe("\"Instalar suporte novo\": A avaliar → Cobrar");
    expect((await chamar("ordens/[id]/servicos-adicionais/[servicoId]", "PATCH", { id: "osB", servicoId: s.id }, { statusCobranca: "COBRAR" })).status).toBe(404);
    expect((await chamar("ordens/[id]/servicos-adicionais/[servicoId]", "PATCH", { id: "osA", servicoId: s.id }, { statusCobranca: "TALVEZ" })).status).toBe(400);
    comoEscritorio("e2", permissoesTotais(), "uE2");
    expect((await chamar("ordens/[id]/servicos-adicionais/[servicoId]", "PATCH", { id: "osA", servicoId: s.id }, { statusCobranca: "NAO_COBRAR" })).status).toBe(404);
  });

  it("técnico do usuário: achado pelo e-mail sem diferença de maiúsculas, só se ATIVO; adicional de atividade cancelada não vai ao relatório", async () => {
    // sessão sem o vínculo (logou antes de ser ligado): o Meu dia acha pelo e-mail (JOAO@Clima.com × joao@clima.com)
    comoTecnico(null);
    expect((await chamar("tecnico/meu-dia", "GET")).json.tecnico).toEqual({ id: "t1", nome: "João Silva" });
    // técnico inativado: nem pelo vínculo da sessão nem pelo e-mail
    await prisma.tecnico.update({ where: { id: "t1" }, data: { ativo: false } });
    comoTecnico();
    expect((await chamar("tecnico/meu-dia", "GET")).json).toMatchObject({ tecnico: null, atividades: [] });
    comoTecnico(null);
    expect((await chamar("tecnico/meu-dia", "GET")).json.tecnico).toBeNull();
    await prisma.tecnico.update({ where: { id: "t1" }, data: { ativo: true } });
    // adicional numa atividade que depois foi cancelada: não entra no relatório
    await prisma.atividadeOs.create({ data: { id: "aX", empresaId: "e1", ordemServicoId: "osA", titulo: "Visita cancelada", tecnicoId: "t1", status: "CANCELADA" } });
    await prisma.servicoAdicional.create({ data: { empresaId: "e1", ordemServicoId: "osA", atividadeId: "aX", descricao: "Não deveria sair", criadoPorId: "uT" } });
    const { relatorioInterno } = await import("@/lib/relatorio-os/dados");
    const { dados } = (await relatorioInterno("osA", "e1"))!;
    expect(dados.adicionais.map((a) => a.descricao)).not.toContain("Não deveria sair");
    expect(dados.adicionais.length).toBeGreaterThan(0);
  });

  it("permissão: sem login 401; só visualizar não sincroniza; operações antigas são limpas depois de 30 dias", async () => {
    sessao.atual = null;
    expect((await sync([op("iniciar", "aA")])).status).toBe(401);
    expect((await chamar("tecnico/meu-dia", "GET")).status).toBe(401);
    comoEscritorio("e1", PRESETS.AUXILIAR);
    expect((await sync([op("iniciar", "aA")])).status).toBe(403);
    const { limparOperacoesAntigas } = await import("@/lib/tecnico/sync");
    const total = await prisma.syncOperacao.count({ where: { usuarioId: "uT" } });
    expect(total).toBeGreaterThan(10);
    await limparOperacoesAntigas({ empresaId: "e1", usuarioId: "uT", escopo: { restrito: true, tecnicoId: "t1" } }, new Date(Date.now() + 31 * 24 * H));
    expect(await prisma.syncOperacao.count({ where: { usuarioId: "uT" } })).toBe(0);
    expect(await prisma.syncOperacao.count({ where: { usuarioId: "uA" } })).toBeGreaterThan(0); // só as dele
  });
});
