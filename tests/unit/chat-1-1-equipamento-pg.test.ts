/**
 * CHAT-1.1 — a FOTO do chat VINCULADA ao equipamento, no PostgreSQL real e pelas rotas reais (dados fictícios):
 *  - as 4 regras pela fila do app: a OS tem um só; a atividade em andamento; o QR code na foto (mesma empresa e mesmo
 *    cliente); vários e nada indica (fica sem; a escolha vale);
 *  - QR de OUTRO cliente: sugere, não vincula; QR de OUTRA empresa: nem aparece;
 *  - a foto do escritório: só as regras 1 e 4;
 *  - offline: a fila reenvia e não duplica nem muda o vínculo; a correção pela fila, também pelo clientId;
 *  - corrigir/tirar o vínculo: escritório (rota) e técnico (fila), com a trilha no histórico da OS; o mesmo de novo não
 *    registra nada; equipamento de fora da OS não; isolamento (outra empresa, "Ver só os próprios", outra OS, sem editar);
 *  - a mensagem nunca se edita: a rota só aceita o equipamento ou o relatório;
 *  - o relatório da atividade: só a foto que o escritório pôs lá, por REFERÊNCIA (a mesma foto, nada copiado);
 *  - o histórico do equipamento mostra a foto.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/chat-1-1-equipamento-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, permissoesTotais } from "@/lib/permissoes";
import { MSG_EQUIPAMENTO_FORA_DA_OS, MSG_FOTO_NAO_ENCONTRADA } from "@/lib/chat/equipamento-foto";
import { JPEG, dataUrl } from "./arquivos-exemplo";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_chat11e_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
vi.setConfig({ testTimeout: 60_000 });

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/push/servidor", async (orig) => ({
  ...(await orig<typeof import("@/lib/push/servidor")>()),
  usuariosComAparelho: vi.fn(async () => []),
  enviarPush: vi.fn(async () => ({ enviados: 0 })),
}));

const TOTAIS = permissoesTotais();
const user = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, email: `${id}@exemplo.test`, empresaId: "e1", role: "ADMIN", permissoes: TOTAIS, tecnicoId: null, ...extra });
const comoAdmin = () => { sessao.atual = { user: user("uA") }; };
const comoVera = () => { sessao.atual = { user: user("uV", { role: "OPERADOR", permissoes: { ...TOTAIS, ordens: { ...TOTAIS.ordens, verSoProprios: true } } }) }; };
const comoLeitor = () => { sessao.atual = { user: user("uL", { role: "OPERADOR", permissoes: { ...TOTAIS, ordens: { ...TOTAIS.ordens, editar: false } } }) }; };
const comoOutraEmpresa = () => { sessao.atual = { user: user("uX", { empresaId: "e2" }) }; };
const comoTecnico = (id = "uT", tecnicoId = "t1") => { sessao.atual = { user: { id, name: id, email: `${id}@exemplo.test`, empresaId: "e1", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId } }; };

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const FOTO = { foto: dataUrl("image/jpeg", JPEG), miniatura: dataUrl("image/jpeg", JPEG) };
const op = (atividadeId: string, tipo: string, dados: Record<string, unknown>) => ({ id: randomUUID(), tipo, atividadeId, em: new Date().toISOString(), dados });
const sync = async (ops: unknown[], quem = () => comoTecnico()) => { quem(); return (await chamar("tecnico/sync", "POST", {}, { operacoes: ops })).json.resultados as any[]; };
const fotoPeloApp = async (atividadeId: string, extra: Record<string, unknown> = {}) => {
  const clientId = randomUUID();
  const [r] = await sync([op(atividadeId, "comentario", { clientId, texto: "Foto do serviço", ...FOTO, ...extra })]);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return clientId;
};

describe.skipIf(!URL_PG)("CHAT-1.1: a foto do chat e o equipamento (PostgreSQL real)", () => {
  let prisma: any;
  const vinculo = async (clientId: string) => prisma.osComentario.findFirst({
    where: { clientId }, select: { id: true, foto: { select: { equipamentoId: true, equipamentoOrigem: true, equipamentoSugeridoId: true, noRelatorio: true } } },
  });
  const historico = (osId: string) => prisma.osHistorico.findMany({ where: { ordemServicoId: osId }, orderBy: { criadoEm: "asc" }, select: { acao: true, detalhes: true, usuarioId: true } });

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["tecnico/sync", "conversas/pessoas/[usuarioId]", "conversas/[osId]", "conversas/mensagens/[comentarioId]/foto", "tecnico/conversas"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Empresa Exemplo", cnpj: "12.345.678/0001-90", email: "contato@exemplo.test" },
      { id: "e2", nome: "Outra Exemplo", cnpj: "98.765.432/0001-10", email: "contato@outra.test" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana Souza", email: "uA@exemplo.test", senha: "x", role: "ADMIN" },
      { id: "uV", empresaId: "e1", nome: "Vera Lima", email: "uV@exemplo.test", senha: "x", role: "OPERADOR" },
      { id: "uL", empresaId: "e1", nome: "Leo Leitura", email: "uL@exemplo.test", senha: "x", role: "OPERADOR" },
      { id: "uT", empresaId: "e1", nome: "João Silva", email: "uT@exemplo.test", senha: "x", role: "TECNICO" },
      { id: "uM", empresaId: "e1", nome: "Maria Souza", email: "uM@exemplo.test", senha: "x", role: "TECNICO" },
      { id: "uX", empresaId: "e2", nome: "Xavier", email: "uX@exemplo.test", senha: "x", role: "ADMIN" },
    ] });
    await prisma.tecnico.createMany({ data: [
      { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "1", telefone: "1", email: "uT@exemplo.test" },
      { id: "t2", empresaId: "e1", nome: "Maria Souza", cpf: "2", telefone: "2", email: "uM@exemplo.test" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Mercado Exemplo", cpfCnpj: "1" },
      { id: "c2", empresaId: "e1", nome: "Padaria Fictícia", cpfCnpj: "2" },
      { id: "c3", empresaId: "e2", nome: "Cliente da outra", cpfCnpj: "3" },
    ] });
    await prisma.unidade.createMany({ data: [
      { id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz" },
      { id: "un2", empresaId: "e1", clienteId: "c2", nome: "Loja" },
      { id: "un3", empresaId: "e2", clienteId: "c3", nome: "Sede" },
    ] });
    const eq = (id: string, empresaId: string, unidadeId: string, nome: string) => ({ id, empresaId, unidadeId, tipo: "AR_CONDICIONADO_SPLIT", marca: "Marca", modelo: "12000", nome });
    await prisma.equipamento.createMany({ data: [
      eq("eA", "e1", "un1", "Split sala 3"), eq("eB", "e1", "un1", "Split sala 4"), eq("eN", "e1", "un1", "Split recepção"),
      eq("eC", "e1", "un2", "Split da padaria"), eq("eX", "e2", "un3", "Split da outra"),
    ] });
    await prisma.qrcode.createMany({ data: [
      { id: "qA", empresaId: "e1", codigo: "QR-0001", equipamentoId: "eA", tokenPublico: "tok-eA" },
      { id: "qN", empresaId: "e1", codigo: "QR-0002", equipamentoId: "eN", tokenPublico: "tok-eN" },
      { id: "qC", empresaId: "e1", codigo: "QR-0003", equipamentoId: "eC", tokenPublico: "tok-eC" },
      { id: "qX", empresaId: "e2", codigo: "QR-0001", equipamentoId: "eX", tokenPublico: "tok-eX" },
    ] });
    const os = (id: string, numero: string, extra: Record<string, unknown> = {}) => ({ id, empresaId: "e1", numero, clienteId: "c1", unidadeId: "un1", criadoPorId: "uA", descricao: "Manutenção", ...extra });
    await prisma.ordemServico.createMany({ data: [os("os1", "OS-0001"), os("os2", "OS-0002"), os("os3", "OS-0003"), os("os4", "OS-0004", { criadoPorId: "uV" })] });
    await prisma.atividadeOs.createMany({ data: [
      { id: "a1", empresaId: "e1", ordemServicoId: "os1", titulo: "Preventiva", tecnicoId: "t1", status: "AGENDADA" },
      { id: "a2", empresaId: "e1", ordemServicoId: "os2", titulo: "Corretiva", tecnicoId: "t1", status: "EM_ANDAMENTO" },
      { id: "a3", empresaId: "e1", ordemServicoId: "os3", titulo: "Instalação", tecnicoId: "t1", status: "AGENDADA" },
      { id: "a4", empresaId: "e1", ordemServicoId: "os4", titulo: "Da Maria", tecnicoId: "t2", status: "AGENDADA" },
    ] });
    await prisma.atividadeEquipamento.createMany({ data: [
      { atividadeId: "a1", equipamentoId: "eA" },
      { atividadeId: "a2", equipamentoId: "eA", feito: true }, { atividadeId: "a2", equipamentoId: "eB" },
      { atividadeId: "a3", equipamentoId: "eA" }, { atividadeId: "a3", equipamentoId: "eB" },
      { atividadeId: "a4", equipamentoId: "eA" }, { atividadeId: "a4", equipamentoId: "eB" },
    ] });
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("regra 1: a OS tem UM equipamento → ele (UNICO)", async () => {
    expect((await vinculo(await fotoPeloApp("a1"))).foto).toMatchObject({ equipamentoId: "eA", equipamentoOrigem: "UNICO" });
  });

  it("regra 2: a atividade em andamento do técnico, no equipamento ainda não atendido → ele (ANDAMENTO)", async () => {
    expect((await vinculo(await fotoPeloApp("a2"))).foto).toMatchObject({ equipamentoId: "eB", equipamentoOrigem: "ANDAMENTO" });
  });

  it("regra 3: o QR code na foto, mesma empresa e mesmo cliente → ele (também fora da OS); outro cliente: só sugere; outra empresa: nada", async () => {
    expect((await vinculo(await fotoPeloApp("a3", { qr: "https://app.exemplo.test/qr/tok-eA" }))).foto).toMatchObject({ equipamentoId: "eA", equipamentoOrigem: "QR" });
    expect((await vinculo(await fotoPeloApp("a3", { qr: "QR-0002" }))).foto).toMatchObject({ equipamentoId: "eN", equipamentoOrigem: "QR" });
    expect((await vinculo(await fotoPeloApp("a3", { qr: "tok-eC" }))).foto).toEqual({ equipamentoId: null, equipamentoOrigem: null, equipamentoSugeridoId: "eC", noRelatorio: false });
    expect((await vinculo(await fotoPeloApp("a3", { qr: "tok-eX" }))).foto).toEqual({ equipamentoId: null, equipamentoOrigem: null, equipamentoSugeridoId: null, noRelatorio: false });
  });

  it("regra 4: vários e nada indica → sem vínculo; a escolha de quem enviou vale (de fora da OS, não)", async () => {
    expect((await vinculo(await fotoPeloApp("a3"))).foto).toMatchObject({ equipamentoId: null, equipamentoOrigem: null });
    expect((await vinculo(await fotoPeloApp("a3", { equipamentoId: "eB" }))).foto).toMatchObject({ equipamentoId: "eB", equipamentoOrigem: "ESCOLHA" });
    expect((await vinculo(await fotoPeloApp("a3", { equipamentoId: "eC" }))).foto).toMatchObject({ equipamentoId: null });
    // "Sem equipamento" escolhido vale até sobre a regra 1
    expect((await vinculo(await fotoPeloApp("a1", { equipamentoId: null }))).foto).toMatchObject({ equipamentoId: null, equipamentoOrigem: null });
  });

  it("a foto do escritório: regra 1 sim; atividade em andamento e QR não (regra 4)", async () => {
    comoAdmin();
    const um = await chamar("conversas/[osId]", "POST", { osId: "os1" }, { texto: "", ...FOTO });
    expect(um.json.mensagem.foto).toMatchObject({ equipamento: { id: "eA", titulo: "Split sala 3 — Marca 12000" }, origemEquipamento: "UNICO" });
    const varios = await chamar("conversas/pessoas/[usuarioId]", "POST", { usuarioId: "uT" }, { texto: "", ...FOTO, osId: "os2", qr: "tok-eA" });
    expect(varios.json.mensagem.foto).toMatchObject({ equipamento: null, origemEquipamento: null, sugerido: null });
    const escolhido = await chamar("conversas/pessoas/[usuarioId]", "POST", { usuarioId: "uT" }, { texto: "", ...FOTO, osId: "os3", equipamentoId: "eB" });
    expect(escolhido.json.mensagem.foto).toMatchObject({ equipamento: { id: "eB" }, origemEquipamento: "ESCOLHA" });
  });

  it("offline: a fila reenvia a mesma foto e nada duplica nem muda", async () => {
    const o = op("a3", "comentario", { clientId: "rep-1", texto: "", ...FOTO, equipamentoId: "eA" });
    await sync([o]); await sync([o]);
    expect(await prisma.osComentario.count({ where: { clientId: "rep-1" } })).toBe(1);
    expect((await vinculo("rep-1")).foto).toMatchObject({ equipamentoId: "eA", equipamentoOrigem: "ESCOLHA" });
  });

  it("corrigir pelo escritório: vincular → corrigir → tirar, cada um no histórico da OS; o mesmo de novo não registra", async () => {
    const clientId = await fotoPeloApp("a3");
    const { id } = await vinculo(clientId);
    const antes = (await historico("os3")).length;
    comoAdmin();
    const r1 = await chamar("conversas/mensagens/[comentarioId]/foto", "PATCH", { comentarioId: id }, { equipamentoId: "eB" });
    expect(r1.status).toBe(200);
    expect(r1.json.mensagem.foto).toMatchObject({ equipamento: { id: "eB" }, origemEquipamento: "CORRIGIDO" });
    await chamar("conversas/mensagens/[comentarioId]/foto", "PATCH", { comentarioId: id }, { equipamentoId: "eB" }); // o mesmo de novo
    await chamar("conversas/mensagens/[comentarioId]/foto", "PATCH", { comentarioId: id }, { equipamentoId: "eA" });
    await chamar("conversas/mensagens/[comentarioId]/foto", "PATCH", { comentarioId: id }, { equipamentoId: null });
    const h = (await historico("os3")).slice(antes);
    expect(h.map((x: any) => x.acao)).toEqual(["Foto do chat vinculada ao equipamento", "Equipamento da foto do chat corrigido", "Vínculo da foto do chat removido"]);
    expect(h[1].detalhes).toMatch(/^Split sala 4 — Marca 12000 → Split sala 3 — Marca 12000 \(foto de João Silva, /);
    expect(h.every((x: any) => x.usuarioId === "uA")).toBe(true);
    expect((await vinculo(clientId)).foto).toMatchObject({ equipamentoId: null, equipamentoOrigem: "CORRIGIDO" });
    // equipamento de fora da OS
    const fora = await chamar("conversas/mensagens/[comentarioId]/foto", "PATCH", { comentarioId: id }, { equipamentoId: "eC" });
    expect(fora).toMatchObject({ status: 422, json: { erro: MSG_EQUIPAMENTO_FORA_DA_OS } });
  });

  it("a mensagem nunca se edita: a rota da foto recusa texto (só equipamento ou relatório) e o texto fica igual", async () => {
    const clientId = await fotoPeloApp("a3");
    const { id } = await vinculo(clientId);
    comoAdmin();
    expect((await chamar("conversas/mensagens/[comentarioId]/foto", "PATCH", { comentarioId: id }, { texto: "Outro texto" })).status).toBe(400);
    expect((await chamar("conversas/mensagens/[comentarioId]/foto", "PATCH", { comentarioId: id }, { equipamentoId: "eA", texto: "x" })).status).toBe(400);
    expect((await prisma.osComentario.findFirst({ where: { id }, select: { texto: true } })).texto).toBe("Foto do serviço");
    const rotas = await import("@/app/api/conversas/mensagens/[comentarioId]/foto/route");
    expect(Object.keys(rotas).filter((k) => ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(k))).toEqual(["PATCH"]);
  });

  it("isolamento da correção: outra empresa, \"Ver só os próprios\", sem editar a OS", async () => {
    const { id } = await vinculo(await fotoPeloApp("a3"));
    comoOutraEmpresa();
    expect((await chamar("conversas/mensagens/[comentarioId]/foto", "PATCH", { comentarioId: id }, { equipamentoId: "eA" })).status).toBe(404);
    comoVera(); // a OS-0003 é da Ana
    expect((await chamar("conversas/mensagens/[comentarioId]/foto", "PATCH", { comentarioId: id }, { equipamentoId: "eA" })).json).toEqual({ erro: MSG_FOTO_NAO_ENCONTRADA });
    comoLeitor();
    expect((await chamar("conversas/mensagens/[comentarioId]/foto", "PATCH", { comentarioId: id }, { equipamentoId: "eA" })).status).toBe(403);
    expect((await vinculo((await prisma.osComentario.findFirst({ where: { id }, select: { clientId: true } })).clientId)).foto.equipamentoId).toBeNull();
  });

  it("corrigir pela fila do app (offline, pelo clientId, no mesmo lote da foto); outra técnica de outra OS não corrige", async () => {
    const clientId = randomUUID();
    const res = await sync([
      op("a3", "comentario", { clientId, texto: "", ...FOTO }),
      op("a3", "fotoChatEquipamento", { comentario: { clientId }, equipamentoId: "eA" }),
    ]);
    expect(res.map((r) => r.ok)).toEqual([true, true]);
    expect((await vinculo(clientId)).foto).toMatchObject({ equipamentoId: "eA", equipamentoOrigem: "CORRIGIDO" });
    expect((await historico("os3")).at(-1)).toMatchObject({ acao: "Foto do chat vinculada ao equipamento", usuarioId: "uT" });
    expect((await historico("os3")).at(-1).detalhes).toMatch(/\(app do técnico\)$/);
    // a Maria, pela atividade dela na OS-0004, tenta corrigir a foto da OS-0003
    const [r] = await sync([op("a4", "fotoChatEquipamento", { comentario: { clientId }, equipamentoId: "eB" })], () => comoTecnico("uM", "t2"));
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect((await vinculo(clientId)).foto.equipamentoId).toBe("eA");
    // o próprio João, mas pela atividade de OUTRA OS (a1, OS-0001): a correção vai pela atividade da OS da foto
    const [outra] = await sync([op("a1", "fotoChatEquipamento", { comentario: { clientId }, equipamentoId: "eB" })]);
    expect(outra).toMatchObject({ ok: false, status: 404 });
    expect((await vinculo(clientId)).foto.equipamentoId).toBe("eA");
  });

  it("o relatório da atividade: só a foto que o escritório pôs lá, por REFERÊNCIA (o mesmo arquivo); tirar, sai", async () => {
    const naoMarcada = await fotoPeloApp("a1");
    const marcada = await fotoPeloApp("a1");
    const { id } = await vinculo(marcada);
    comoAdmin();
    const r = await chamar("conversas/mensagens/[comentarioId]/foto", "PATCH", { comentarioId: id }, { noRelatorio: true });
    expect(r.json.mensagem.foto.noRelatorio).toBe(true);
    expect((await historico("os1")).at(-1)).toMatchObject({ acao: "Foto do chat incluída no relatório" });
    await prisma.atividadeEquipamento.updateMany({ where: { atividadeId: "a1" }, data: { feito: true } });
    const { carregarAtividade } = await import("@/lib/relatorio-server");
    const token = (await prisma.atividadeOs.findUnique({ where: { id: "a1" }, select: { tokenRelatorio: true } })).tokenRelatorio;
    const fotos = () => carregarAtividade("a1", token).then((x: any) => JSON.stringify(x));
    // Cada foto com um conteúdo só dela (as do teste nascem iguais): dá para saber qual entrou
    const marcar = (clientId: string, marca: string) => prisma.osComentarioFoto.updateMany({ where: { comentario: { clientId } }, data: { conteudo: `${FOTO.foto}${marca}` } });
    await marcar(marcada, "MARCADA"); await marcar(naoMarcada, "NAOMARCADA");
    const conteudo = `${FOTO.foto}MARCADA`;
    const rel = await fotos();
    expect(rel).toContain(conteudo); // a mesma foto, lida da mensagem
    expect(rel).not.toContain(`${FOTO.foto}NAOMARCADA`); // a não marcada não entra
    expect(await prisma.osAnexo.count({ where: { ordemServicoId: "os1" } })).toBe(0); // nada copiado para os anexos
    await chamar("conversas/mensagens/[comentarioId]/foto", "PATCH", { comentarioId: id }, { noRelatorio: false });
    expect(await fotos()).not.toContain(conteudo);
  });

  it("o histórico do equipamento mostra a foto do chat vinculada a ele (por referência)", async () => {
    const clientId = await fotoPeloApp("a1");
    const fotoId = (await prisma.osComentarioFoto.findFirst({ where: { comentario: { clientId } }, select: { id: true } })).id;
    const { carregarHistoricoEquipamento } = await import("@/lib/equipamento-historico");
    const eventos = await carregarHistoricoEquipamento("e1", "eA");
    expect(eventos.find((e: any) => e.atividadeId === "a1")!.fotos).toContain(`/api/conversas/fotos/${fotoId}`);
    expect((await carregarHistoricoEquipamento("e1", "eB")).flatMap((e: any) => e.fotos)).not.toContain(`/api/conversas/fotos/${fotoId}`);
    // numa OS com dois equipamentos: a foto do eA não aparece no histórico do eB (mesma atividade, mesma OS)
    const daOs3 = await fotoPeloApp("a3", { equipamentoId: "eA" });
    const fotoOs3 = (await prisma.osComentarioFoto.findFirst({ where: { comentario: { clientId: daOs3 } }, select: { id: true } })).id;
    expect((await carregarHistoricoEquipamento("e1", "eA")).flatMap((e: any) => e.fotos)).toContain(`/api/conversas/fotos/${fotoOs3}`);
    expect((await carregarHistoricoEquipamento("e1", "eB")).flatMap((e: any) => e.fotos)).not.toContain(`/api/conversas/fotos/${fotoOs3}`);
  });

  it("a conversa traz os equipamentos de cada OS (para escolher e corrigir) e o equipamento de cada foto", async () => {
    comoTecnico();
    const r = (await chamar("tecnico/conversas", "GET")).json;
    expect(r.equipamentosDasOs.os2).toMatchObject({ emAndamento: "eB" });
    expect(r.equipamentosDasOs.os3.equipamentos.map((e: any) => e.id)).toEqual(["eA", "eB"]);
    expect(r.mensagens.some((m: any) => m.foto?.equipamento?.id === "eB" && m.foto.origemEquipamento === "ANDAMENTO")).toBe(true);
  });
});
