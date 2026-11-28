/**
 * HOTFIX push — a regra pura: como ler a resposta do serviço de push (o que apaga, o que conta falha, o motivo), a
 * impressão da chave (nunca a chave), o par de chaves conferido, o serviço pelo endpoint; e as amarras: o service
 * worker mostra a notificação, os arquivos do service worker não passam pelo middleware, o envio espera a resposta.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import webpush from "web-push";
import {
  apagarInscricao, chavesCoerentes, impressaoDaChave, motivoDaResposta, servicoDoEndpoint, situacaoDaResposta, trechoDoCorpo,
} from "@/lib/push/diagnostico";
import { config as configMiddleware } from "@/middleware";

const RAIZ = path.resolve(__dirname, "../..");
const ler = (f: string) => readFileSync(path.join(RAIZ, f), "utf8");

describe("a resposta do serviço de push", () => {
  it("2xx aceito; 404/410 inscrição morta; 401/403 (com ou sem o texto) chave diferente; 429/5xx/rede temporário; o resto recusado", () => {
    const casos: [number | null, string | null, string][] = [
      [201, null, "ok"], [200, null, "ok"], [202, null, "ok"],
      [404, null, "inscricao_morta"], [410, "expired", "inscricao_morta"],
      [403, "the VAPID credentials in the authorization header do not correspond to the credentials used to create the subscriptions.", "chave_diferente"],
      [400, "VapidPkHashMismatch", "chave_diferente"], [403, "BadJwtToken", "chave_diferente"], [401, "", "chave_diferente"], [403, null, "chave_diferente"],
      [400, "bad payload", "recusado"], [413, null, "recusado"],
      [429, null, "temporario"], [500, null, "temporario"], [503, "x", "temporario"], [null, "ECONNRESET", "temporario"],
    ];
    for (const [status, corpo, esperado] of casos) expect(situacaoDaResposta({ status, corpo }), `${status} ${corpo}`).toBe(esperado);
  });
  it("apaga só o que nunca vai funcionar (expirada ou outra chave)", () => {
    expect(["ok", "inscricao_morta", "chave_diferente", "recusado", "temporario"].filter((s) => apagarInscricao(s as never))).toEqual(["inscricao_morta", "chave_diferente"]);
  });
  it("o motivo em português, sem endpoint nem chave", () => {
    expect(motivoDaResposta({ status: 201 })).toBe("Aceito pelo serviço de push.");
    expect(motivoDaResposta({ status: 410 })).toContain("expirou");
    expect(motivoDaResposta({ status: 403, corpo: "do not correspond" })).toContain("outra chave VAPID");
    expect(motivoDaResposta({ status: 413 })).toBe("Mensagem grande demais para o serviço de push.");
    expect(motivoDaResposta({ status: 429 })).toContain("esperar");
    expect(motivoDaResposta({ status: null })).toBe("Sem resposta do serviço de push (rede).");
    expect(motivoDaResposta({ status: 502 })).toBe("Erro temporário no serviço de push (502).");
    expect(motivoDaResposta({ status: 400, corpo: "x" })).toBe("Recusado pelo serviço de push (400).");
    expect(trechoDoCorpo(`  a\n\n b  ${"c".repeat(300)}`)).toHaveLength(200);
    expect(trechoDoCorpo("   ")).toBeNull();
  });
  it("o serviço pelo endereço (o resto do endpoint é segredo do aparelho)", () => {
    expect(servicoDoEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe("Google (Chrome/Android)");
    expect(servicoDoEndpoint("https://web.push.apple.com/QGx")).toBe("Apple (iPhone/Safari)");
    expect(servicoDoEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe("Mozilla (Firefox)");
    expect(servicoDoEndpoint("https://wns2-par02p.notify.windows.com/w/?token=x")).toBe("Microsoft (Edge)");
    expect(servicoDoEndpoint("https://push.exemplo:8443/x")).toBe("push.exemplo:8443");
    expect(servicoDoEndpoint("nada")).toBe("desconhecido");
  });
});

describe("as chaves VAPID (nunca reveladas)", () => {
  const par = webpush.generateVAPIDKeys();
  const outro = webpush.generateVAPIDKeys();
  it("a impressão: 12 hex, estável, igual com ou sem '=' e em base64 comum ou url; não contém a chave", () => {
    const i = impressaoDaChave(par.publicKey)!;
    expect(i).toMatch(/^[0-9a-f]{12}$/);
    expect(impressaoDaChave(` ${par.publicKey}== `)).toBe(i);
    expect(impressaoDaChave(par.publicKey.replace(/-/g, "+").replace(/_/g, "/"))).toBe(i);
    expect(impressaoDaChave(outro.publicKey)).not.toBe(i);
    expect(par.publicKey.includes(i)).toBe(false);
    expect(impressaoDaChave("")).toBeNull();
    expect(impressaoDaChave(null)).toBeNull();
  });
  it("o par confere: a privada gera a pública; de pares diferentes, trocadas ou lixo, não", () => {
    expect(chavesCoerentes(par.publicKey, par.privateKey)).toBe(true);
    expect(chavesCoerentes(par.publicKey, outro.privateKey)).toBe(false);
    expect(chavesCoerentes(par.privateKey, par.publicKey)).toBe(false);
    expect(chavesCoerentes("lixo", "lixo")).toBe(false);
    expect(chavesCoerentes(par.publicKey, "")).toBe(false);
  });
});

describe("as amarras", () => {
  it("os arquivos do service worker (sw.js e o worker do push) não passam pelo middleware; as telas passam", () => {
    const re = new RegExp(`^${configMiddleware.matcher[0]}$`);
    for (const p of ["/sw.js", "/worker-8d15055feb5caed7.js", "/swe-worker-5c72df51bb1f6ee0.js", "/fallback-ce627215c0e4a9af.js", "/workbox-84c8cf68.js", "/manifest.json"]) expect(re.test(p), p).toBe(false);
    for (const p of ["/dashboard", "/ordens/os1", "/tecnico", "/api/push/diagnostico"]) expect(re.test(p), p).toBe(true);
  });
  it("o service worker mostra a notificação em todo push (esperando o showNotification, como o iPhone exige)", () => {
    const sw = ler("worker/index.ts");
    expect(sw).toMatch(/addEventListener\("push"[\s\S]{0,200}event\.waitUntil\(sw\.registration\.showNotification\(n\.titulo, n\.opcoes\)\)/);
  });
  it("o envio espera a resposta do serviço de push (nada fica rodando depois que a função da Vercel responde)", () => {
    const s = ler("lib/push/servidor.ts");
    expect(s).toContain("const resultados = await mandarParaAparelhos(usuarioId, msg);");
    expect(s).toMatch(/await webpush\.sendNotification\(/);
    // o teste do app espera o envio inteiro antes de responder
    expect(ler("app/api/push/teste/route.ts")).toContain("const r = await enviarPush(");
  });
  it("a chave privada nunca sai: nem no diagnóstico, nem no log", () => {
    for (const f of ["app/api/push/diagnostico/route.ts", "lib/push/servidor.ts", "lib/push/diagnostico.ts", "app/api/push/subscribe/route.ts"]) {
      const s = ler(f);
      expect(s, f).not.toMatch(/console\.\w+\([^)]*(privada|privateKey|VAPID_PRIVATE)/);
      expect(s, f).not.toMatch(/NextResponse\.json\([^)]*(chaves\.privada|chaves\.publica)/);
    }
  });
  it("o SQL só acrescenta", () => {
    const sql = ler("prisma/sql/2027-02-13_push_resultado_por_aparelho.sql").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(sql).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE)\b/i);
    expect(sql.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(6);
  });
});
