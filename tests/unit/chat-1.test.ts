/**
 * CHAT-1 — regras PURAS do chat interno: o resumo e a busca da lista, o estado de cada mensagem (✓/✓✓), juntar o
 * que está no aparelho com o servidor, os dias e horas de Brasília, a mensagem com foto, a OS cancelada só leitura, o
 * ritmo do tempo real (servidor e navegador) e a foto reduzida no aparelho.
 */
import { describe, expect, it, vi } from "vitest";
import {
  iniciais, mostraEtiquetaOs, ordenarPessoas, osPadraoDaMensagem, urlConversaPessoa, type PessoaResumo,
  estadoDaMensagem, esperaDepoisDeErro, marcaValida, filtrarConversas, horaDaLista, juntarComFila, marcaNovidades, MSG_OS_CANCELADA, ordenarConversas,
  rotuloDoDia, somenteLeitura, textoDaUltima, totalNaoLidas, urlConversaApp, urlConversaEscritorio, ESPERA_NOVIDADES_MS, PASSO_NOVIDADES_MS,
  type ConversaResumo,
} from "@/lib/chat/regras";
import { comentarioSchema, FOTO_TAMANHO_MAX, MSG_FOTO_GRANDE, MSG_MENSAGEM_VAZIA, type ComentarioTela } from "@/lib/tecnico/comentarios";
import { esperarNovidades } from "@/lib/chat/servidor";
import { LacoNovidades, type AmbienteLaco } from "@/lib/chat/novidades-cliente";
import { prepararFoto } from "@/lib/chat/foto-cliente";
import { ALVO_FOTO_BYTES, ALVO_MINIATURA_BYTES } from "@/lib/chat/regras";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const conversa = (over: Partial<ConversaResumo>): ConversaResumo => ({
  osId: "os1", osNumero: "OS-2026-0001", cliente: "Hospital Fictício", status: "AGENDADA", tecnicos: ["Carlos Oliveira"],
  ultima: { texto: "Cheguei.", autor: "Carlos Oliveira", criadoEm: "2026-11-28T12:00:00.000Z", minha: false, foto: false }, naoLidas: 0, ...over,
});
const msg = (over: Partial<ComentarioTela>): ComentarioTela => ({ id: "m1", clientId: "c1", texto: "Oi", autor: "Ana", origem: "ESCRITORIO", criadoEm: "2026-11-28T12:00:00.000Z", meu: true, ...over });
const IMG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";

describe("a lista de conversas", () => {
  it("a última mensagem: a 1ª linha, cortada; só foto vira \"Foto\"; foto com texto, \"Foto · texto\"; sem mensagem, o aviso", () => {
    const u = conversa({}).ultima!;
    expect(textoDaUltima(u)).toBe("Cheguei.");
    expect(textoDaUltima({ ...u, texto: "Primeira linha\nsegunda" })).toBe("Primeira linha");
    expect(textoDaUltima({ ...u, texto: "x".repeat(100) }, 10)).toBe(`${"x".repeat(9)}…`);
    expect(textoDaUltima({ ...u, texto: "", foto: true })).toBe("Foto");
    expect(textoDaUltima({ ...u, texto: "Dreno entupido", foto: true })).toBe("Foto · Dreno entupido");
    expect(textoDaUltima(null)).toBe("Sem mensagens ainda.");
  });

  it("a busca acha pelo nº da OS, cliente, técnico (sem acento e sem caixa) e pelo texto da última; \"Não lidas\" deixa só as com contador", () => {
    const l = [
      conversa({ osId: "a", osNumero: "OS-0314", cliente: "Bom Preço", tecnicos: ["João Araújo"], naoLidas: 2 }),
      conversa({ osId: "b", osNumero: "OS-0315", cliente: "Padaria Sol", tecnicos: ["Maria"], ultima: { ...conversa({}).ultima!, texto: "Falta o tubo" } }),
    ];
    expect(filtrarConversas(l, "0314", false).map((c) => c.osId)).toEqual(["a"]);
    expect(filtrarConversas(l, "bom preco", false).map((c) => c.osId)).toEqual(["a"]);
    expect(filtrarConversas(l, "JOAO ARAUJO", false).map((c) => c.osId)).toEqual(["a"]);
    expect(filtrarConversas(l, "tubo", false).map((c) => c.osId)).toEqual(["b"]);
    expect(filtrarConversas(l, "", true).map((c) => c.osId)).toEqual(["a"]);
    expect(filtrarConversas(l, "padaria", true)).toEqual([]);
    expect(filtrarConversas(l, "  ", false)).toHaveLength(2);
    expect(totalNaoLidas(l)).toBe(2);
  });

  it("ordem: a mais recente primeiro; sem mensagem no fim, pelo número", () => {
    const l = [
      conversa({ osId: "velha", ultima: { ...conversa({}).ultima!, criadoEm: "2026-11-27T10:00:00.000Z" } }),
      conversa({ osId: "semB", osNumero: "OS-B", ultima: null }),
      conversa({ osId: "nova", ultima: { ...conversa({}).ultima!, criadoEm: "2026-11-28T10:00:00.000Z" } }),
      conversa({ osId: "semA", osNumero: "OS-A", ultima: null }),
    ];
    expect(ordenarConversas(l).map((c) => c.osId)).toEqual(["nova", "velha", "semA", "semB"]);
  });

  it("OS cancelada é só leitura; concluída segue aberta (histórico que pode continuar)", () => {
    expect(somenteLeitura("CANCELADA")).toBe(true);
    expect(somenteLeitura("CONCLUIDA")).toBe(false);
    expect(somenteLeitura("EM_ANDAMENTO")).toBe(false);
    expect(somenteLeitura(null)).toBe(false);
    expect(MSG_OS_CANCELADA).toMatch(/só para leitura/);
  });

  it("os endereços que o push e o sino abrem", () => {
    expect(urlConversaEscritorio("os 1")).toBe("/conversas?os=os%201");
    expect(urlConversaEscritorio(null)).toBe("/conversas");
    expect(urlConversaApp("os1")).toBe("/tecnico?ver=chat&os=os1");
    expect(urlConversaApp()).toBe("/tecnico?ver=chat");
  });
});

describe("a conversa POR PESSOA (o desenho aprovado)", () => {
  const pessoa = (over: Partial<PessoaResumo>): PessoaResumo => ({ usuarioId: "u", tecnicoId: "t", nome: "Carlos Oliveira", avatar: null, ultima: null, naoLidas: 0, ...over });
  const ultima = (criadoEm: string) => ({ texto: "x", autor: "x", criadoEm, minha: false, foto: false, osNumero: null });

  it("a lista: não lidas primeiro; depois a mais recente; quem nunca conversou, pelo nome", () => {
    const l = [
      pessoa({ usuarioId: "velha", ultima: ultima("2026-11-27T10:00:00.000Z") }),
      pessoa({ usuarioId: "zeca", nome: "Zeca" }),
      pessoa({ usuarioId: "nova", ultima: ultima("2026-11-28T10:00:00.000Z") }),
      pessoa({ usuarioId: "naoLida", ultima: ultima("2026-11-20T10:00:00.000Z"), naoLidas: 3 }),
      pessoa({ usuarioId: "ana", nome: "Ana" }),
    ];
    expect(ordenarPessoas(l).map((p) => p.usuarioId)).toEqual(["naoLida", "nova", "velha", "ana", "zeca"]);
  });

  it("as iniciais (sem foto) e o endereço da conversa com a pessoa", () => {
    expect([iniciais("Carlos Oliveira"), iniciais("Eng. Roberto Mendes"), iniciais("ana"), iniciais("  ")]).toEqual(["CO", "EM", "A", "?"]);
    expect(urlConversaPessoa("u 1")).toBe("/conversas?pessoa=u%201");
    expect(urlConversaPessoa(null)).toBe("/conversas");
  });

  it("a OS da mensagem vem SOZINHA: a da atividade em andamento; senão a última usada HOJE na conversa; senão Sem OS", () => {
    const agora = new Date("2026-11-28T15:00:00.000Z");
    const doDia = [{ osId: "os1", numero: "OS-1", cliente: "A", emAndamento: false }, { osId: "os2", numero: "OS-2", cliente: "B", emAndamento: true }];
    expect(osPadraoDaMensagem({ osDoDia: doDia, mensagens: [], agora })).toBe("os2");
    const msgs = [
      { os: { id: "os1", numero: "OS-1", cliente: "A" }, criadoEm: "2026-11-28T12:00:00.000Z" },
      { os: null, criadoEm: "2026-11-28T13:00:00.000Z" },
    ];
    expect(osPadraoDaMensagem({ osDoDia: [doDia[0]], mensagens: msgs, agora })).toBe("os1");
    // a de ONTEM não vale
    expect(osPadraoDaMensagem({ osDoDia: [], mensagens: [{ os: { id: "os9", numero: "OS-9", cliente: "" }, criadoEm: "2026-11-27T12:00:00.000Z" }], agora })).toBeNull();
    expect(osPadraoDaMensagem({ osDoDia: [], mensagens: [], agora })).toBeNull();
  });

  it("a etiqueta da OS só aparece quando a OS muda (ou o dia): mensagens seguidas da mesma OS agrupam", () => {
    const os1 = { id: "os1", numero: "OS-1", cliente: "A" };
    const m = (os: typeof os1 | null, criadoEm = "2026-11-28T12:00:00.000Z") => ({ os, criadoEm });
    expect(mostraEtiquetaOs(m(os1), undefined)).toBe(true);
    expect(mostraEtiquetaOs(m(os1), m(os1))).toBe(false);
    expect(mostraEtiquetaOs(m(null), m(os1))).toBe(true);
    expect(mostraEtiquetaOs(m(null), m(null))).toBe(false);
    expect(mostraEtiquetaOs(m(os1, "2026-11-28T12:00:00.000Z"), m(os1, "2026-11-27T12:00:00.000Z"))).toBe(true);
  });
});

describe("a mensagem", () => {
  it("estado da minha mensagem: falhou vence; no aparelho = enviando; com leitura = lida (✓✓); senão enviada (✓)", () => {
    expect(estadoDaMensagem(msg({ pendente: true, falhou: "Recusada" }))).toBe("falhou");
    expect(estadoDaMensagem(msg({ pendente: true }))).toBe("enviando");
    expect(estadoDaMensagem(msg({ lida: { por: "Carlos", em: "2026-11-28T12:05:00.000Z" } }))).toBe("lida");
    expect(estadoDaMensagem(msg({}))).toBe("enviada");
    expect(estadoDaMensagem(msg({ lida: null }))).toBe("enviada");
  });

  it("juntar com a fila do aparelho: a que o servidor já tem (mesmo clientId) sai; as outras vão por último, na ordem escrita", () => {
    const servidor = [msg({ id: "s1", clientId: "a", criadoEm: "2026-11-28T10:00:00.000Z" }), msg({ id: "s2", clientId: "b", criadoEm: "2026-11-28T10:01:00.000Z" })];
    const fila = [msg({ id: null, clientId: "d", pendente: true, criadoEm: "2026-11-28T10:05:00.000Z" }), msg({ id: null, clientId: "b", pendente: true }),
      msg({ id: null, clientId: "c", pendente: true, criadoEm: "2026-11-28T10:03:00.000Z" })];
    expect(juntarComFila(servidor, fila).map((m) => m.clientId)).toEqual(["a", "b", "c", "d"]);
    expect(juntarComFila(servidor, [])).toEqual(servidor);
  });

  it("o dia e a hora são os de Brasília: 01:30 UTC ainda é o dia anterior; hoje mostra a hora, ontem \"Ontem\", antes a data", () => {
    const agora = new Date("2026-11-28T15:00:00.000Z"); // 12h de 28/11 em Brasília
    expect(rotuloDoDia("2026-11-28T03:00:00.000Z", agora)).toBe("Hoje");
    expect(rotuloDoDia("2026-11-28T01:30:00.000Z", agora)).toBe("Ontem"); // 22h30 de 27/11 em Brasília
    expect(rotuloDoDia("2026-11-20T15:00:00.000Z", agora)).toBe("20/11/2026");
    expect(horaDaLista("2026-11-28T14:05:00.000Z", agora)).toBe("11:05");
    expect(horaDaLista("2026-11-27T14:05:00.000Z", agora)).toBe("Ontem");
    expect(horaDaLista("2026-11-02T14:05:00.000Z", agora)).toBe("02/11");
  });

  it("o que se envia: texto, foto (com a miniatura) ou os dois; vazio, foto sem miniatura, arquivo que não é imagem e foto grande são recusados", () => {
    expect(comentarioSchema.safeParse({ clientId: "c1", texto: "Cheguei" }).success).toBe(true);
    expect(comentarioSchema.safeParse({ clientId: "c1", texto: "", foto: IMG, miniatura: IMG }).success).toBe(true);
    expect(comentarioSchema.safeParse({ clientId: "c1", texto: "Veja", foto: IMG, miniatura: IMG }).success).toBe(true);
    expect(comentarioSchema.safeParse({ clientId: "c1", texto: "   " }).error?.issues[0].message).toBe(MSG_MENSAGEM_VAZIA);
    expect(comentarioSchema.safeParse({ clientId: "c1", texto: "", foto: IMG }).error?.issues[0].message).toBe("A foto vai com a miniatura.");
    expect(comentarioSchema.safeParse({ clientId: "c1", texto: "", foto: "data:application/pdf;base64,AAAA", miniatura: IMG }).success).toBe(false);
    const grande = `data:image/jpeg;base64,${"A".repeat(Math.ceil(FOTO_TAMANHO_MAX * 4 / 3) + 200)}`;
    expect(comentarioSchema.safeParse({ clientId: "c1", texto: "", foto: grande, miniatura: IMG }).error?.issues[0].message).toBe(MSG_FOTO_GRANDE);
    expect(comentarioSchema.safeParse({ clientId: "c1", texto: "ok", origem: "APP" }).success).toBe(false);
  });
});

describe("tempo real — o servidor (long-polling curto)", () => {
  const relogio = () => {
    let t = 0;
    return { agora: () => t, dormir: async (ms: number) => { t += ms; } };
  };

  it("sem marca do aparelho: devolve a atual na hora (mudou = falso)", async () => {
    const ler = vi.fn(async () => "1.0");
    expect(await esperarNovidades(ler, null, relogio())).toEqual({ marca: "1.0", mudou: false });
    expect(ler).toHaveBeenCalledTimes(1);
  });

  it("marca já diferente: responde na hora, sem esperar", async () => {
    const r = relogio();
    expect(await esperarNovidades(async () => "2.0", "1.0", r)).toEqual({ marca: "2.0", mudou: true });
    expect(r.agora()).toBe(0);
  });

  it("muda no meio da espera: responde no passo em que mudou", async () => {
    const r = relogio();
    const marcas = ["1.0", "1.0", "1.5"];
    const ler = vi.fn(async () => marcas.shift() ?? "1.5");
    expect(await esperarNovidades(ler, "1.0", r)).toEqual({ marca: "1.5", mudou: true });
    expect(r.agora()).toBe(2 * PASSO_NOVIDADES_MS);
  });

  it("nada muda: olha a cada passo até o fim da espera e devolve a mesma marca", async () => {
    const r = relogio();
    const ler = vi.fn(async () => "1.0");
    expect(await esperarNovidades(ler, "1.0", r)).toEqual({ marca: "1.0", mudou: false });
    expect(r.agora()).toBeLessThanOrEqual(ESPERA_NOVIDADES_MS);
    expect(ler).toHaveBeenCalledTimes(1 + Math.floor(ESPERA_NOVIDADES_MS / PASSO_NOVIDADES_MS));
  });

  it("a pessoa fechou a tela (requisição cancelada): para de olhar", async () => {
    const ler = vi.fn(async () => "1.0");
    await esperarNovidades(ler, "1.0", { ...relogio(), cancelado: () => true });
    expect(ler).toHaveBeenCalledTimes(1);
  });

  it("a marca muda com mensagem nova E com leitura nova (o ✓✓ também é novidade); erro espera 2, 4, 8… até 30 s", () => {
    const m = new Date("2026-11-28T12:00:00.000Z");
    expect(marcaNovidades(m, null)).toBe(`${m.getTime()}.0.0`);
    expect(marcaNovidades(m, m)).not.toBe(marcaNovidades(m, null));
    // a MINHA leitura também muda a marca (ler uma conversa que outro já leu zera o meu contador)
    expect(marcaNovidades(m, m, m)).not.toBe(marcaNovidades(m, m));
    expect(marcaNovidades(null, undefined)).toBe("0.0.0");
    expect([marcaValida("1.0.0"), marcaValida("1.0"), marcaValida("1"), marcaValida("a.b"), marcaValida(undefined)]).toEqual([true, true, false, false, false]);
    expect([1, 2, 3, 4, 5, 6, 10].map(esperaDepoisDeErro)).toEqual([2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    expect(esperaDepoisDeErro(0)).toBe(2000);
  });
});

describe("tempo real — o navegador (um laço por aba)", () => {
  function ambiente() {
    let escondida = false;
    let aparecer: (() => void) | null = null;
    const respostas: (() => Promise<Response>)[] = [];
    const pedidos: string[] = [];
    const sonos: number[] = [];
    const amb: AmbienteLaco = {
      fetch: vi.fn(async (url: any) => {
        pedidos.push(String(url));
        const r = respostas.shift();
        return r ? r() : new Promise<Response>(() => {}); // sem resposta preparada: fica "pendurado" (long-polling)
      }) as any,
      escondida: () => escondida,
      aoAparecer: (cb) => { aparecer = cb; return () => { aparecer = null; }; },
      dormir: async (ms) => { sonos.push(ms); },
      agora: () => 0,
    };
    const ok = (corpo: object) => async () => new Response(JSON.stringify(corpo), { status: 200 });
    return { amb, respostas, pedidos, sonos, ok, esconder: (v: boolean) => { escondida = v; }, aparecer: () => aparecer?.() };
  }
  const tique = () => new Promise((r) => setTimeout(r, 0));

  it("a 1ª resposta avisa todos; depois pergunta com a marca; só avisa de novo quando muda", async () => {
    const a = ambiente();
    a.respostas.push(a.ok({ marca: "1.0", mudou: false, naoLidas: 2 }), a.ok({ marca: "1.0", mudou: false, naoLidas: 2 }), a.ok({ marca: "2.0", mudou: true, naoLidas: 3 }));
    const laco = new LacoNovidades("/api/conversas/novidades", a.amb);
    const recebidas: any[] = [];
    const sair = laco.assinar((r) => recebidas.push(r));
    for (let i = 0; i < 6; i++) await tique();
    expect(a.pedidos.slice(0, 3)).toEqual(["/api/conversas/novidades", "/api/conversas/novidades?desde=1.0", "/api/conversas/novidades?desde=1.0"]);
    expect(recebidas.map((r) => r.marca)).toEqual(["1.0", "2.0"]);
    // quem assina depois recebe a última na hora
    const tarde: any[] = [];
    laco.assinar((r) => tarde.push(r));
    expect(tarde.map((r) => r.naoLidas)).toEqual([3]);
    sair(); laco.parar();
  });

  it("aba escondida: não pergunta; ao aparecer, pergunta na hora", async () => {
    const a = ambiente();
    a.esconder(true);
    const laco = new LacoNovidades("/x", a.amb);
    laco.assinar(() => {});
    for (let i = 0; i < 4; i++) await tique();
    expect(a.pedidos).toEqual([]);
    a.esconder(false);
    a.respostas.push(a.ok({ marca: "1.0", mudou: false }));
    a.aparecer();
    for (let i = 0; i < 4; i++) await tique();
    expect(a.pedidos[0]).toBe("/x");
    laco.parar();
  });

  it("erro de rede: espera crescente (2 s, 4 s…) e tenta de novo; acertou, zera a contagem", async () => {
    const a = ambiente();
    a.respostas.push(async () => { throw new Error("rede"); }, async () => new Response("", { status: 500 }), a.ok({ marca: "1.0", mudou: false }));
    const laco = new LacoNovidades("/x", a.amb);
    laco.assinar(() => {});
    for (let i = 0; i < 10; i++) await tique();
    expect(a.sonos.slice(0, 2)).toEqual([2000, 4000]);
    expect(laco.falhas).toBe(0);
    laco.parar();
  });

  it("sair e assinar de novo no mesmo instante (o React em desenvolvimento faz isso): continua UM laço só", async () => {
    const a = ambiente();
    const laco = new LacoNovidades("/x", a.amb);
    const s1 = laco.assinar(() => {});
    await tique();
    s1();
    laco.assinar(() => {});
    for (let i = 0; i < 6; i++) await tique();
    // o 1º pedido ficou pendurado e foi cancelado; o laço novo fez UM pedido (também pendurado) — não dois
    expect(a.pedidos).toEqual(["/x", "/x"]);
    laco.parar();
  });

  it("resposta sem marca (proxy, página de erro) conta como erro; resposta rápida sem mudança espera 1 s — nunca laço apertado", async () => {
    const a = ambiente();
    a.respostas.push(a.ok({}), a.ok({ marca: "1.0", mudou: false }), a.ok({ marca: "1.0", mudou: false }));
    const laco = new LacoNovidades("/x", a.amb);
    laco.assinar(() => {});
    for (let i = 0; i < 10; i++) await tique();
    expect(a.sonos.slice(0, 2)).toEqual([2000, 1000]);
    laco.parar();
  });

  it("o último a sair desliga o laço (não pergunta mais)", async () => {
    const a = ambiente();
    a.respostas.push(a.ok({ marca: "1.0", mudou: false }));
    const laco = new LacoNovidades("/x", a.amb);
    const s1 = laco.assinar(() => {});
    const s2 = laco.assinar(() => {});
    for (let i = 0; i < 4; i++) await tique();
    s1(); s2();
    const antes = a.pedidos.length;
    for (let i = 0; i < 4; i++) await tique();
    expect(a.pedidos.length).toBe(antes);
  });
});

describe("a foto preparada no aparelho", () => {
  const arquivo = (tipo = "image/jpeg") => new Blob(["x"], { type: tipo });
  const redutor = (tamanhos: number[]) => vi.fn(async (_f: Blob, lado: number, _q: number) => ({ imagem: { dataUrl: `data:image/jpeg;base64,${"A".repeat(Math.ceil((tamanhos.shift() ?? 10) * 4 / 3))}#${lado}` } }));

  // Hotfix 2: em produção as fotos chegavam com 520–556 KB (1600 px, 80%). Agora DEGRAUS até caber no alvo
  it("reduz pelo 1º degrau (1280 px, 70%) e faz a miniatura (256 px); cabendo no alvo, para ali", async () => {
    const r = redutor([150_000, 10_000]);
    expect((await prepararFoto(arquivo(), r)).ok).toBe(true);
    expect(r.mock.calls.map((c) => [c[1], c[2]])).toEqual([[1280, 0.7], [256, 0.6]]);
  });

  it("acima do alvo (200 KB): desce os degraus (1024/60%, 800/55%); a miniatura acima de 15 KB desce para 192/50%", async () => {
    const r = redutor([ALVO_FOTO_BYTES + 1, 190_000, 20_000, 9_000]);
    expect((await prepararFoto(arquivo(), r)).ok).toBe(true);
    expect(r.mock.calls.map((c) => [c[1], c[2]])).toEqual([[1280, 0.7], [1024, 0.6], [256, 0.6], [192, 0.5]]);
    const r2 = redutor([ALVO_FOTO_BYTES + 1, ALVO_FOTO_BYTES + 1, 300_000, 9_000]);
    const p2 = await prepararFoto(arquivo(), r2);
    expect(p2.ok).toBe(true); // nenhum degrau coube no alvo: vai o menor (ainda dentro do limite)
    expect(r2.mock.calls.map((c) => c[1])).toEqual([1280, 1024, 800, 256]);
  });

  it("nem o menor degrau cabe no limite do servidor: avisa com o limite", async () => {
    const r = redutor([FOTO_TAMANHO_MAX + 10, FOTO_TAMANHO_MAX + 10, FOTO_TAMANHO_MAX + 10]);
    expect(await prepararFoto(arquivo(), r)).toEqual({ ok: false, erro: MSG_FOTO_GRANDE });
    expect(ALVO_FOTO_BYTES).toBe(200_000);
    expect(ALVO_MINIATURA_BYTES).toBe(15_000);
  });

  it("não é imagem ou não dá para ler: avisa sem travar", async () => {
    expect(await prepararFoto(arquivo("application/pdf"), redutor([]))).toEqual({ ok: false, erro: "Escolha uma foto (JPG, PNG ou WEBP)." });
    const quebra = vi.fn(async () => { throw new Error("decode"); });
    expect((await prepararFoto(arquivo(), quebra)).ok).toBe(false);
  });
});
