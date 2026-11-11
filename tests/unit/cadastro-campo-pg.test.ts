/**
 * Cadastro de equipamento EM CAMPO (app do técnico) — rotas reais com o Prisma real num PostgreSQL
 * real (schema descartável via `prisma db push`). Prova, de ponta a ponta, pela MESMA fila de
 * sincronização do app:
 *  - o equipamento nasce na unidade da OS, com o id gerado no aparelho, já vinculado à atividade, e as
 *    gravações seguintes (checklist, foto) do mesmo envio já caem nele;
 *  - reenviar não duplica (mesma operação, ou outra operação com o mesmo equipamento);
 *  - tipo: só um que já existe e está ativo; marca/modelo/série são opcionais;
 *  - QR: a etiqueta avulsa lida é ligada; sem etiqueta (ou etiqueta de outro) o número sai do contador
 *    da empresa — a numeração corrigida, que passa do 9999;
 *  - série repetida NUNCA trava: grava, avisa o técnico e deixa no histórico da OS;
 *  - permissão "Permitir cadastrar equipamento em campo" desligada: o servidor recusa e nada é criado;
 *  - o retrato da atividade leva o que o app precisa para cadastrar sem sinal;
 *  - conferência de série com sinal: nome de OUTRO cliente nunca sai; leitura da etiqueta só para quem pode.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/cadastro-campo-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { MSG_CADASTRO_DESLIGADO, MSG_SEM_UNIDADE } from "@/lib/tecnico/cadastro-equipamento";
import { PNG, dataUrl } from "./arquivos-exemplo";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_cadastro_campo_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const ocr = vi.hoisted(() => ({ lerEtiqueta: vi.fn() }));
vi.mock("@/lib/equipamento-ocr", () => ({ lerEtiqueta: ocr.lerEtiqueta, lerPlaca: vi.fn() }));

const comoEscritorio = (permissoes: Permissoes = permissoesTotais(), id = "uA", empresaId = "e1") => {
  sessao.atual = { user: { id, name: "Ana", email: `${id}@x.com`, empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};
const comoTecnico = (tecnicoId = "t1", id = "uT") => {
  sessao.atual = { user: { id, name: "João", email: `${id}@x.com`, empresaId: "e1", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId } };
};

async function chamar(rota: string, metodo: string, params: Record<string, string>, corpo?: unknown, query = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x${query}`, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: (res.headers.get("content-type") ?? "").includes("json") ? await res.json() : null };
}
const sync = async (operacoes: unknown[]) => (await chamar("tecnico/sync", "POST", {}, { operacoes })).json.resultados as any[];
const op = (tipo: string, atividadeId: string, extra: Record<string, unknown> = {}) => ({ id: randomUUID(), tipo, atividadeId, em: new Date().toISOString(), ...extra });
const cadastro = (atividadeId: string, dados: Record<string, unknown> = {}) => op("cadastrarEquipamento", atividadeId, { dados: { id: randomUUID(), tipo: "AR_CONDICIONADO_SPLIT", ...dados } });
const FOTO = dataUrl("image/png", PNG);

describe.skipIf(!URL_PG)("Cadastro de equipamento em campo (PostgreSQL real)", () => {
  let prisma: any;
  const historico = async (osId = "osA") => (await prisma.osHistorico.findMany({ where: { ordemServicoId: osId, acao: "Equipamento cadastrado em campo" }, orderBy: { criadoEm: "asc" } })).map((h: any) => h.detalhes);
  const permitir = (ligado: boolean) => prisma.configuracao.upsert({ where: { empresaId: "e1" }, create: { empresaId: "e1", appCadastrarEquipamento: ligado }, update: { appCadastrarEquipamento: ligado } });

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["tecnico/sync", "tecnico/atividades/[atividadeId]", "tecnico/atividades/[atividadeId]/serie", "tecnico/atividades/[atividadeId]/etiqueta"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana Souza", email: "ana@x.com", senha: "x" },
      { id: "uT", empresaId: "e1", nome: "João Silva", email: "joao@x.com", senha: "x", role: "TECNICO" },
      { id: "uT2", empresaId: "e1", nome: "Outro técnico", email: "t2@x.com", senha: "x", role: "TECNICO" },
    ] });
    await prisma.tecnico.createMany({ data: [
      { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "1", telefone: "1", email: "joao@x.com" },
      { id: "t2", empresaId: "e1", nome: "Outro técnico", cpf: "2", telefone: "2", email: "t2@x.com" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Luzia", cpfCnpj: "1" },
      { id: "c2", empresaId: "e1", nome: "Colégio Viva", cpfCnpj: "2" },       // outro cliente da MESMA empresa
      { id: "c3", empresaId: "e1", nome: "Rede Duas Lojas", cpfCnpj: "3" },    // cliente com duas unidades
      { id: "cE2", empresaId: "e2", nome: "Da outra", cpfCnpj: "9" },
    ] });
    await prisma.unidade.createMany({ data: [
      { id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz" },
      { id: "un2", empresaId: "e1", clienteId: "c2", nome: "Unidade Pinheiros" },
      { id: "un3a", empresaId: "e1", clienteId: "c3", nome: "Loja Centro" }, { id: "un3b", empresaId: "e1", clienteId: "c3", nome: "Loja Norte" },
      { id: "unE2", empresaId: "e2", clienteId: "cE2", nome: "Sede" },
    ] });
    await prisma.tipoEquipamentoCustom.createMany({ data: [
      { id: "te1", empresaId: "e1", nome: "Split Hi-Wall", chaveEnum: "AR_CONDICIONADO_SPLIT" },
      { id: "teCam", empresaId: "e1", nome: "Câmara fria" },                                   // personalizado
      { id: "teOff", empresaId: "e1", nome: "Cortina de ar", ativo: false },                   // personalizado INATIVO
      { id: "teChi", empresaId: "e1", nome: "Chiller", chaveEnum: "CHILLER", ativo: false },   // padrão INATIVADO pela empresa
    ] });
    await prisma.checklistTipoItem.createMany({ data: [
      { id: "i1", empresaId: "e1", tipoEquipamentoId: "te1", texto: "Limpeza dos filtros", ordem: 1 },
      { id: "iCam", empresaId: "e1", tipoEquipamentoId: "teCam", texto: "Vedação da porta", ordem: 1 }, // tipo que NÃO existe na unidade
    ] });
    const eq = (id: string, empresaId: string, unidadeId: string, extra: Record<string, unknown> = {}) =>
      ({ id, empresaId, unidadeId, tipo: "AR_CONDICIONADO_SPLIT", tipoEquipamentoId: empresaId === "e1" ? "te1" : null, marca: "Daikin", modelo: "FTXS", ...extra });
    await prisma.equipamento.createMany({ data: [
      eq("eqA", "e1", "un1", { nome: "Split Recepção", numeroSerie: "SERIE-HOSP-1", setor: "Térreo", localizacao: "Recepção" }),
      eq("eqOutroCliente", "e1", "un2", { nome: "Split da diretoria", numeroSerie: "SERIE-COLEGIO-9", localizacao: "Diretoria" }),
      eq("eqE2", "e2", "unE2", { numeroSerie: "SERIE-HOSP-1" }), // outra EMPRESA: nunca conta
    ] });
    await prisma.ordemServico.createMany({ data: [
      { id: "osA", empresaId: "e1", numero: "OS-0001", clienteId: "c1", unidadeId: "un1", criadoPorId: "uA", descricao: "Preventiva" },
      { id: "osSemUn", empresaId: "e1", numero: "OS-0002", clienteId: "c1", unidadeId: null, criadoPorId: "uA", descricao: "Sem endereço (cliente de 1 unidade)" },
      { id: "osDuas", empresaId: "e1", numero: "OS-0003", clienteId: "c3", unidadeId: null, criadoPorId: "uA", descricao: "Sem endereço (cliente de 2 unidades)" },
    ] });
    await prisma.atividadeOs.createMany({ data: [
      { id: "a1", empresaId: "e1", ordemServicoId: "osA", titulo: "Preventiva mensal", tecnicoId: "t1", status: "EM_ANDAMENTO" },
      { id: "aSemUn", empresaId: "e1", ordemServicoId: "osSemUn", titulo: "Visita", tecnicoId: "t1", status: "EM_ANDAMENTO" },
      { id: "aDuas", empresaId: "e1", ordemServicoId: "osDuas", titulo: "Visita", tecnicoId: "t1", status: "EM_ANDAMENTO" },
      { id: "aFeita", empresaId: "e1", ordemServicoId: "osA", titulo: "Anterior", tecnicoId: "t1", status: "CONCLUIDA" },
    ] });
    // Histórico de QR no formato antigo até o 9999: o próximo número é QR-10000 (a numeração corrigida)
    await prisma.qrcode.createMany({ data: [
      { id: "qVelho", empresaId: "e1", codigo: "QR-2026-9999", equipamentoId: "eqA" },
      { id: "qAvulso", empresaId: "e1", codigo: "QR-2026-0500", tokenPublico: "tok-avulso-500" }, // etiqueta impressa, ainda sem equipamento
      { id: "qE2", empresaId: "e2", codigo: "QR-2026-0001", tokenPublico: "tok-da-outra-empresa" },
    ] });
    comoTecnico();
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  /* ───────── criar + vincular ───────── */
  it("cria na UNIDADE da OS com o id do aparelho, já vinculado à atividade; QR sai do contador (depois do 9999 vem QR-10000)", async () => {
    const c = cadastro("a1", { marca: "LG", modelo: "S4-W12JA3AA", numeroSerie: " LG24K8891X ", capacidade: "12000 BTU/h", setor: "2º andar", ambiente: "Sala 201", fotos: [FOTO, FOTO] });
    const id = (c as any).dados.id;
    const [r] = await sync([c]);
    expect(r).toMatchObject({ ok: true, status: 201 });
    expect(r.dados).toMatchObject({ equipamentoId: id, qr: "QR-10000", serieRepetida: 0, jaExistia: false, aviso: null });
    const eq = await prisma.equipamento.findUnique({ where: { id }, include: { qrcode: true } });
    expect(eq).toMatchObject({
      empresaId: "e1", unidadeId: "un1", tipo: "AR_CONDICIONADO_SPLIT", tipoEquipamentoId: "te1", marca: "LG", modelo: "S4-W12JA3AA",
      numeroSerie: "LG24K8891X", capacidade: "12000 BTU/h", setor: "2º andar", localizacao: "Sala 201", ativo: true,
      observacoesTecnicas: "Cadastrado em campo, pelo app do colaborador.",
    });
    expect(eq.fotos).toHaveLength(2);
    expect(eq.qrcode.codigo).toBe("QR-10000");
    const vinculo = await prisma.atividadeEquipamento.findFirst({ where: { atividadeId: "a1", equipamentoId: id } });
    expect(vinculo).toMatchObject({ id: r.dados.vinculoId, feito: false }); // vinculado; "atendido" só quando ele responder algo
    expect((await historico()).at(-1)).toBe("Split Hi-Wall — 12.000 BTU/h · QR-10000 (app do técnico)");
  });

  it("no mesmo envio, o checklist e a foto do equipamento novo já caem nele (a ordem da fila vale)", async () => {
    const c = cadastro("a1", { marca: "Midea" });
    const id = (c as any).dados.id;
    const rs = await sync([
      c,
      op("resposta", "a1", { equipamentoId: id, itemId: "i1", dados: { status: "OK" } }),
      op("foto", "a1", { equipamentoId: id, dados: { dataUrl: FOTO, momento: "ANTES", clientId: "aparelho-novo-0001" } }),
    ]);
    expect(rs.map((r) => r.ok)).toEqual([true, true, true]);
    expect(await prisma.checklistResposta.count({ where: { atividadeId: "a1", equipamentoId: id, status: "OK" } })).toBe(1);
    expect(await prisma.fotoAtendimento.count({ where: { atividadeId: "a1", equipamentoId: id } })).toBe(1);
    expect((await prisma.atividadeEquipamento.findFirst({ where: { atividadeId: "a1", equipamentoId: id } })).feito).toBe(true);
  });

  it("só o tipo é obrigatório: sem marca, modelo, série, capacidade, local e foto — cadastra do mesmo jeito", async () => {
    const c = cadastro("a1");
    const [r] = await sync([c]);
    expect(r.ok).toBe(true);
    expect(await prisma.equipamento.findUnique({ where: { id: (c as any).dados.id } })).toMatchObject({ marca: "", modelo: "", numeroSerie: null, capacidade: null, setor: null, localizacao: null, fotos: [] });
  });

  /* ───────── reenvio ───────── */
  it("reenviar a MESMA operação não duplica nada (nem equipamento, nem QR, nem histórico)", async () => {
    const c = cadastro("a1", { marca: "Reenvio" });
    const [r1] = await sync([c]);
    const antes = { eq: await prisma.equipamento.count(), qr: await prisma.qrcode.count(), h: (await historico()).length };
    const [r2] = await sync([c]);
    expect(r2).toMatchObject({ ok: true, repetida: true });
    expect(r2.dados).toEqual(r1.dados);
    expect({ eq: await prisma.equipamento.count(), qr: await prisma.qrcode.count(), h: (await historico()).length }).toEqual(antes);
  });

  it("outra operação com o MESMO equipamento (o aparelho refez a fila): reconhece, não cria outro e garante o vínculo", async () => {
    const c = cadastro("a1", { marca: "Refeita" });
    const id = (c as any).dados.id;
    await sync([c]);
    await prisma.atividadeEquipamento.deleteMany({ where: { atividadeId: "a1", equipamentoId: id } });
    const total = await prisma.equipamento.count();
    const [r] = await sync([{ ...c, id: randomUUID() }]);
    expect(r.dados).toMatchObject({ equipamentoId: id, jaExistia: true });
    expect(await prisma.equipamento.count()).toBe(total);
    expect(await prisma.atividadeEquipamento.count({ where: { atividadeId: "a1", equipamentoId: id } })).toBe(1);
  });

  it("id que já é de um equipamento de OUTRO cliente é recusado (ninguém 'adota' equipamento alheio)", async () => {
    const [r] = await sync([op("cadastrarEquipamento", "a1", { dados: { id: "00000000-0000-4000-8000-000000000001", tipo: "AR_CONDICIONADO_SPLIT" } })]);
    expect(r.ok).toBe(true); // 1º uso: cria
    await prisma.equipamento.update({ where: { id: "00000000-0000-4000-8000-000000000001" }, data: { unidadeId: "un2" } }); // agora é do outro cliente
    await prisma.atividadeEquipamento.deleteMany({ where: { equipamentoId: "00000000-0000-4000-8000-000000000001" } });
    const [r2] = await sync([op("cadastrarEquipamento", "a1", { dados: { id: "00000000-0000-4000-8000-000000000001", tipo: "AR_CONDICIONADO_SPLIT" } })]);
    expect(r2).toMatchObject({ ok: false, status: 409 });
    expect(await prisma.atividadeEquipamento.count({ where: { atividadeId: "a1", equipamentoId: "00000000-0000-4000-8000-000000000001" } })).toBe(0);
  });

  /* ───────── tipo ───────── */
  it("tipo: personalizado que existe entra; tipo inventado, inativo (padrão ou personalizado) ou de outra empresa é recusado — nada é criado", async () => {
    const total = await prisma.equipamento.count();
    const tiposAntes = await prisma.tipoEquipamentoCustom.count();
    const bom = cadastro("a1", { tipo: "custom:teCam" });
    expect((await sync([bom]))[0].ok).toBe(true);
    expect(await prisma.equipamento.findUnique({ where: { id: (bom as any).dados.id } })).toMatchObject({ tipo: "OUTRO", tipoEquipamentoId: "teCam" });
    for (const tipo of ["TIPO_QUE_NAO_EXISTE", "custom:nao-existe", "custom:teOff", "CHILLER", "Câmara nova"]) {
      const [r] = await sync([cadastro("a1", { tipo })]);
      expect([tipo, r.ok, r.status]).toEqual([tipo, false, 400]);
    }
    expect(await prisma.equipamento.count()).toBe(total + 1);
    expect(await prisma.tipoEquipamentoCustom.count()).toBe(tiposAntes); // nenhum tipo novo nasce em campo
  });

  it("dados fora do formato (sem tipo, id que não é uuid, campo a mais, fotos demais) são recusados antes de gravar", async () => {
    const ruins = [
      { dados: { id: randomUUID() } }, { dados: { id: "nao-e-uuid", tipo: "AR_CONDICIONADO_SPLIT" } },
      { dados: { id: randomUUID(), tipo: "AR_CONDICIONADO_SPLIT", unidadeId: "un2" } }, // não se escolhe a unidade: é a da OS
      { dados: { id: randomUUID(), tipo: "AR_CONDICIONADO_SPLIT", fotos: [FOTO, FOTO, FOTO, FOTO] } },
    ];
    for (const extra of ruins) expect((await sync([op("cadastrarEquipamento", "a1", extra)]))[0]).toMatchObject({ ok: false, status: 400 });
    const html = cadastro("a1", { fotos: [dataUrl("text/html", new TextEncoder().encode("<script>alert(1)</script>"))] });
    expect((await sync([html]))[0]).toMatchObject({ ok: false, status: 400 }); // foto: tipo decidido pelos bytes
    expect(await prisma.equipamento.findUnique({ where: { id: (html as any).dados.id } })).toBeNull();
  });

  /* ───────── unidade ───────── */
  it("OS sem endereço: cliente com UMA unidade usa essa; com duas, não dá para saber — recusa com a explicação", async () => {
    const uma = cadastro("aSemUn");
    expect((await sync([uma]))[0].ok).toBe(true);
    expect((await prisma.equipamento.findUnique({ where: { id: (uma as any).dados.id } })).unidadeId).toBe("un1");
    const duas = cadastro("aDuas");
    expect((await sync([duas]))[0]).toMatchObject({ ok: false, status: 409, erro: MSG_SEM_UNIDADE });
    expect(await prisma.equipamento.findUnique({ where: { id: (duas as any).dados.id } })).toBeNull();
  });

  /* ───────── QR ───────── */
  it("etiqueta QR avulsa lida no equipamento: é ela que fica (não gasta número novo); vale pelo link, pelo token ou pelo código", async () => {
    const proximoAntes = (await prisma.numeracao.findUnique({ where: { empresaId_tipo: { empresaId: "e1", tipo: "qrcode" } } })).proximo;
    const c = cadastro("a1", { qrLido: "https://app.frivo.com.br/qr/tok-avulso-500" });
    const [r] = await sync([c]);
    expect(r.dados).toMatchObject({ qr: "QR-2026-0500", aviso: null });
    expect((await prisma.qrcode.findUnique({ where: { id: "qAvulso" } })).equipamentoId).toBe((c as any).dados.id);
    expect((await prisma.numeracao.findUnique({ where: { empresaId_tipo: { empresaId: "e1", tipo: "qrcode" } } })).proximo).toBe(proximoAntes);
  });

  it("etiqueta que já é de outro equipamento, ou que não é da empresa: NÃO trava — gera um número novo e avisa", async () => {
    const deOutro = cadastro("a1", { qrLido: "QR-2026-0500" }); // acabou de ser usada no teste anterior
    const [r1] = await sync([deOutro]);
    expect(r1.ok).toBe(true);
    expect(r1.dados.qr).toMatch(/^QR-100\d\d$/);
    expect(r1.dados.aviso).toBe(`QR ${r1.dados.qr} gerado: a etiqueta QR-2026-0500 já é de outro equipamento. Cadastro mantido — o escritório foi avisado.`);
    const alheia = cadastro("a1", { qrLido: "tok-da-outra-empresa" });
    const [r2] = await sync([alheia]);
    expect(r2.dados.aviso).toContain("a etiqueta lida não é desta empresa");
    expect((await prisma.qrcode.findUnique({ where: { id: "qE2" } })).equipamentoId).toBeNull(); // a etiqueta da outra empresa fica intocada
    expect((await historico()).at(-1)).toContain("a etiqueta lida não é desta empresa");
  });

  /* ───────── série repetida ───────── */
  it("série que já existe na empresa: cadastra assim mesmo, avisa o técnico e deixa no histórico da OS (só aviso)", async () => {
    const c = cadastro("a1", { numeroSerie: "serie-hosp-1 " }); // igual à do eqA, em minúsculas e com espaço
    const [r] = await sync([c]);
    expect(r).toMatchObject({ ok: true, status: 201 });
    expect(r.dados.serieRepetida).toBe(1); // o da outra EMPRESA não conta
    expect(r.dados.aviso).toBe("O nº de série serie-hosp-1 já existia em outro equipamento. Cadastro mantido — o escritório foi avisado.");
    expect(await prisma.equipamento.findUnique({ where: { id: (c as any).dados.id } })).toMatchObject({ numeroSerie: "serie-hosp-1" });
    expect((await historico()).at(-1)).toContain("O nº de série serie-hosp-1 já existia em outro equipamento.");
  });

  /* ───────── permissão e escopo ───────── */
  it("permissão desligada na empresa: o servidor recusa (403), nada é criado, e as gravações seguintes da OS esperam", async () => {
    await permitir(false);
    const c = cadastro("a1", { marca: "Bloqueado" });
    const id = (c as any).dados.id;
    const rs = await sync([c, op("resposta", "a1", { equipamentoId: id, itemId: "i1", dados: { status: "OK" } })]);
    expect(rs[0]).toMatchObject({ ok: false, status: 403, erro: MSG_CADASTRO_DESLIGADO });
    expect(rs[1]).toMatchObject({ ok: false, adiada: true });
    expect(await prisma.equipamento.findUnique({ where: { id } })).toBeNull();
    await permitir(true);
    expect((await sync([c]))[0].ok).toBe(true); // religou: a mesma operação sobe
  });

  it("técnico que não é desta atividade não cadastra nela; atividade concluída também não", async () => {
    comoTecnico("t2", "uT2");
    const c = cadastro("a1");
    expect((await sync([c]))[0]).toMatchObject({ ok: false, status: 403 });
    comoTecnico();
    expect((await sync([cadastro("aFeita")]))[0]).toMatchObject({ ok: false, status: 409 });
    expect(await prisma.equipamento.findUnique({ where: { id: (c as any).dados.id } })).toBeNull();
  });

  /* ───────── o que o app recebe para cadastrar sem sinal ───────── */
  it("retrato da atividade: unidade, tipos ATIVOS que já existem (com o checklist até de tipo que não há na unidade) e sugestões de local", async () => {
    const r = (await chamar("tecnico/atividades/[atividadeId]", "GET", { atividadeId: "a1" })).json;
    expect(r.cadastro.unidadeId).toBe("un1");
    const tipos = Object.fromEntries(r.cadastro.tipos.map((t: any) => [t.valor, [t.nome, t.tipoEquipamentoId]]));
    expect(tipos.AR_CONDICIONADO_SPLIT).toEqual(["Split Hi-Wall", "te1"]);
    expect(tipos["custom:teCam"]).toEqual(["Câmara fria", "teCam"]);
    expect(tipos["custom:teOff"]).toBeUndefined();   // inativo não é oferecido
    expect(tipos.CHILLER).toBeUndefined();            // padrão inativado pela empresa também não
    expect(r.checklistsPorTipo.teCam.map((i: any) => i.texto)).toEqual(["Vedação da porta"]);
    expect(r.cadastro.setores).toEqual(expect.arrayContaining(["2º andar", "Térreo"]));
    expect(r.cadastro.ambientes).toEqual(expect.arrayContaining(["Recepção", "Sala 201"]));
    // o equipamento cadastrado em campo já volta no retrato, na OS e na lista da unidade (com o QR)
    expect(r.execucao.equipamentos.some((e: any) => e.equipamento.numeroSerie === "LG24K8891X")).toBe(true);
    expect(r.equipamentosUnidade.find((e: any) => e.numeroSerie === "LG24K8891X").qr.codigo).toBe("QR-10000");
  });

  it("retrato: OS sem endereço com duas unidades → sem unidade para cadastrar; permissão desligada → cadastro nulo", async () => {
    expect((await chamar("tecnico/atividades/[atividadeId]", "GET", { atividadeId: "aDuas" })).json.cadastro.unidadeId).toBeNull();
    expect((await chamar("tecnico/atividades/[atividadeId]", "GET", { atividadeId: "aSemUn" })).json.cadastro.unidadeId).toBe("un1");
    await permitir(false);
    expect((await chamar("tecnico/atividades/[atividadeId]", "GET", { atividadeId: "a1" })).json.cadastro).toBeNull();
    await permitir(true);
  });

  /* ───────── conferência de série com sinal ───────── */
  const serie = (numero: string, ignorar = "") => chamar("tecnico/atividades/[atividadeId]/serie", "GET", { atividadeId: "a1" }, undefined, `?numero=${encodeURIComponent(numero)}&ignorar=${ignorar}`);

  it("série do MESMO cliente da OS: diz qual equipamento e onde; sem ligar para maiúsculas e espaços", async () => {
    const r = await serie("  lg24k8891x");
    expect(r.status).toBe(200);
    expect(r.json.outrosClientes).toBe(0);
    expect(r.json.doCliente).toEqual([expect.objectContaining({ titulo: "Split Hi-Wall — 12.000 BTU/h", fabricante: "LG S4-W12JA3AA", local: "Matriz › Sala 201 › 2º andar", ativo: true })]);
  });

  it("série de OUTRO cliente: só a contagem — nome de cliente, unidade e equipamento NUNCA saem", async () => {
    const r = await serie("SERIE-COLEGIO-9");
    expect(r.json).toEqual({ doCliente: [], outrosClientes: 1 });
    expect(JSON.stringify(r.json)).not.toMatch(/Col[ée]gio|Pinheiros|diretoria/i);
  });

  it("com 'Exibir dados do cliente' desligado, nem o nome da unidade do próprio cliente sai; série curta ou inédita não acha nada", async () => {
    await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { appExibirDadosCliente: false } });
    expect((await serie("LG24K8891X")).json.doCliente[0].local).toBe("Sala 201 › 2º andar");
    await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { appExibirDadosCliente: true } });
    expect((await serie("LG")).json).toEqual({ doCliente: [], outrosClientes: 0 });
    expect((await serie("NUNCA-VISTA-123")).json).toEqual({ doCliente: [], outrosClientes: 0 });
  });

  it("conferência e leitura da etiqueta: só quem executa a atividade, com a permissão ligada", async () => {
    ocr.lerEtiqueta.mockResolvedValue({ legivel: true, campos: { numero_serie: "ABC123" }, duvidosos: [] });
    const etiqueta = () => chamar("tecnico/atividades/[atividadeId]/etiqueta", "POST", { atividadeId: "a1" }, { imagem: FOTO });
    expect((await etiqueta()).json.campos.numero_serie).toBe("ABC123");
    expect(ocr.lerEtiqueta).toHaveBeenCalledWith(FOTO);
    comoTecnico("t2", "uT2"); // outro técnico
    expect((await etiqueta()).status).toBe(403);
    expect((await serie("LG24K8891X")).status).toBe(403);
    comoTecnico();
    await permitir(false);
    expect((await etiqueta()).status).toBe(403);
    expect((await serie("LG24K8891X")).status).toBe(403);
    await permitir(true);
    sessao.atual = null;
    expect((await etiqueta()).status).toBe(401);
    comoTecnico();
    expect(ocr.lerEtiqueta).toHaveBeenCalledTimes(1); // recusado antes de mandar a foto para fora
  });

  it("o painel continua igual: o equipamento cadastrado em campo aparece na ficha com a OS no histórico dele", async () => {
    comoEscritorio();
    const eq = await prisma.equipamento.findFirst({ where: { numeroSerie: "LG24K8891X" }, include: { atividades: { include: { atividade: { select: { ordemServicoId: true } } } }, unidade: { select: { clienteId: true } } } });
    expect(eq.unidade.clienteId).toBe("c1");
    expect(eq.atividades.map((v: any) => v.atividade.ordemServicoId)).toEqual(["osA"]);
    comoTecnico();
  });
});
