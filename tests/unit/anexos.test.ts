import { describe, expect, it } from "vitest";
import { identificarTipo, nomeSeguro, podeVisualizarInline } from "@/lib/anexos";
import { respostaAnexo, validarDataUrl } from "@/lib/anexos-server";
import { HEIC, HTML, JPEG, OLE, PDF, PNG, SVG, WEBP, ZIP, dataUrl } from "./arquivos-exemplo";

describe("identificarTipo (pelo conteúdo, não pelo nome/tipo declarado)", () => {
  it.each([
    ["foto.png", PNG, "image/png"],
    ["foto.jpg", JPEG, "image/jpeg"],
    ["foto.webp", WEBP, "image/webp"],
    ["foto.heic", HEIC, "image/heic"],
    ["laudo.pdf", PDF, "application/pdf"],
    ["contrato.docx", ZIP, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["planilha.xlsx", ZIP, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["antigo.doc", OLE, "application/msword"],
    ["antiga.xls", OLE, "application/vnd.ms-excel"],
  ])("%s → %s", (nome, bytes, esperado) => {
    expect(identificarTipo(bytes, nome)).toBe(esperado);
  });

  it.each([
    ["HTML com nome de imagem", HTML, "foto.png"],
    ["SVG com script", SVG, "logo.svg"],
    ["ZIP qualquer", ZIP, "pacote.zip"],
    ["OLE sem extensão Office", OLE, "arquivo.msi"],
    ["vazio", new Uint8Array(), "x.pdf"],
  ])("recusa %s", (_, bytes, nome) => {
    expect(identificarTipo(bytes, nome)).toBeNull();
  });

  it("só imagens comuns e PDF abrem no navegador", () => {
    expect(podeVisualizarInline("image/png")).toBe(true);
    expect(podeVisualizarInline("application/pdf")).toBe(true);
    expect(podeVisualizarInline("image/svg+xml")).toBe(false);
    expect(podeVisualizarInline("text/html")).toBe(false);
    expect(podeVisualizarInline("image/heic")).toBe(false);
  });

  it("nomeSeguro tira caminho e caracteres de controle", () => {
    expect(nomeSeguro("../../etc/passwd")).toBe("passwd");
    expect(nomeSeguro('C:\\fotos\\a"<b>.png')).toBe("ab.png");
    expect(nomeSeguro("   ")).toBe("arquivo");
  });
});

describe("validarDataUrl", () => {
  it("aceita imagem e grava o tipo detectado, ignorando o prefixo declarado", () => {
    const v = validarDataUrl(dataUrl("text/html", PNG), "foto.png");
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.arquivo.tipo).toBe("image/png");
      expect(v.arquivo.conteudo.startsWith("data:image/png;base64,")).toBe(true);
      expect(v.arquivo.tamanho).toBe(PNG.length);
    }
  });

  it("recusa HTML disfarçado de PNG", () => {
    expect(validarDataUrl(dataUrl("image/png", HTML), "foto.png").ok).toBe(false);
  });

  it("recusa data:text/html e SVG", () => {
    expect(validarDataUrl(dataUrl("text/html", HTML), "a.html").ok).toBe(false);
    expect(validarDataUrl(dataUrl("image/svg+xml", SVG), "a.svg").ok).toBe(false);
  });

  it("respeita a lista de tipos (ex.: só imagens no portal)", () => {
    expect(validarDataUrl(dataUrl("application/pdf", PDF), "a.pdf", { tipos: ["image/png"] }).ok).toBe(false);
  });

  it("recusa texto que não é data URL e arquivo grande demais", () => {
    expect(validarDataUrl("nao-e-data-url", "a.png").ok).toBe(false);
    const grande = new Uint8Array(2048);
    grande.set(PNG);
    expect(validarDataUrl(dataUrl("image/png", grande), "a.png", { tamanhoMax: 1024 }).ok).toBe(false);
  });
});

describe("respostaAnexo (download/visualização de anexo gravado)", () => {
  it("HTML gravado no passado sai como download binário, mesmo pedindo inline", () => {
    const r = respostaAnexo({ nome: "foto.png", conteudo: dataUrl("text/html", HTML) }, true);
    expect(r.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(r.headers.get("Content-Disposition")).toMatch(/^attachment;/);
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(r.headers.get("Content-Security-Policy")).toContain("sandbox");
  });

  it("SVG gravado como imagem também não abre no navegador", () => {
    const r = respostaAnexo({ nome: "logo.svg", conteudo: dataUrl("image/svg+xml", SVG) }, true);
    expect(r.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(r.headers.get("Content-Disposition")).toMatch(/^attachment;/);
  });

  it("foto abre inline com tipo real, nosniff e sandbox", async () => {
    const r = respostaAnexo({ nome: "foto.png", conteudo: dataUrl("image/png", PNG) }, true);
    expect(r.headers.get("Content-Type")).toBe("image/png");
    expect(r.headers.get("Content-Disposition")).toMatch(/^inline;/);
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(r.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(PNG);
  });

  it("PDF abre inline sem sandbox (o visualizador do navegador não abre em sandbox)", () => {
    const r = respostaAnexo({ nome: "laudo.pdf", conteudo: dataUrl("application/pdf", PDF) }, true);
    expect(r.headers.get("Content-Type")).toBe("application/pdf");
    expect(r.headers.get("Content-Disposition")).toMatch(/^inline;/);
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(r.headers.get("Content-Security-Policy")).toBeNull();
  });

  it("sem ?inline=1 é sempre download", () => {
    const r = respostaAnexo({ nome: "foto.png", conteudo: dataUrl("image/png", PNG) }, false);
    expect(r.headers.get("Content-Disposition")).toMatch(/^attachment;/);
  });
});
