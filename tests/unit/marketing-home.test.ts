/**
 * Home de vendas ("/"): a página renderizada de verdade (react-dom/server) e o middleware real.
 * Prova: estrutura do briefing na ordem, um CTA primário repetido com um destino só, os 10 prints
 * como espaços reservados nomeados (e a troca pela imagem quando o arquivo existe), nenhuma prova
 * social inventada, SEO básico e o acesso (anônimo vê a home; o resto do sistema segue fechado).
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";

const SEGREDO = "segredo-de-teste-marketing-home-com-32-caracteres!";
process.env.AUTH_SECRET = SEGREDO;
process.env.AUTH_URL = "http://localhost/api/auth";

import HomeDeVendas, { metadata } from "@/app/(publico)/(marketing)/page";
import {
  CTA, CTA_FINAL, DOR, FAQ, HERO, LINK_TESTE_GRATIS, MODULOS, PRINTS, PROVA_SOCIAL, PUBLICADA,
} from "@/components/marketing/conteudo";
import { localizarPrint } from "@/components/marketing/print";

const html = renderToStaticMarkup(createElement(HomeDeVendas));
const todos = (re: RegExp) => [...html.matchAll(re)].map((m) => m[1]);
const texto = html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("home de vendas: página", () => {
  it("seções na ordem do briefing, com um h1 só", () => {
    expect(todos(/data-secao="([^"]+)"/g)).toEqual(["hero", "dor", "modulos", "por-que", "como-funciona", "prova-social", "planos", "faq", "cta-final"]);
    expect(todos(/<h1[^>]*>([^<]+)</g)).toEqual([HERO.titulo]);
    expect(texto).toContain(DOR.titulo);
    expect(texto).toContain(CTA_FINAL.titulo);
  });

  it("os 8 módulos em zigue-zague, na ordem, com o PMOC em destaque", () => {
    expect(todos(/data-modulo="([^"]+)"/g)).toEqual(["ordens-de-servico", "pmoc", "aceite", "desempenho", "equipamentos", "estoque", "financeiro", "mapa"]);
    for (const m of MODULOS) expect(texto, m.id).toContain(m.titulo);
    expect(MODULOS.filter((m) => m.destaque).map((m) => m.id)).toEqual(["pmoc"]);
    // o texto troca de lado a cada bloco (2º, 4º, 6º e 8º)
    expect(html.match(/lg:order-2/g)).toHaveLength(4);
  });

  it("um CTA primário, repetido, sempre para o mesmo destino", () => {
    const ctas = [...html.matchAll(/<a[^>]*data-cta="teste-gratis"[^>]*>/g)].map((m) => m[0]);
    const locais = ctas.map((a) => /data-cta-local="([^"]+)"/.exec(a)![1]);
    expect(new Set(locais)).toEqual(new Set(["cabecalho", "hero", "modulo-pmoc", "como-funciona", "planos", "cta-final"]));
    for (const a of ctas) expect(a).toContain(`href="${LINK_TESTE_GRATIS}"`);
    expect(texto).toContain(CTA.principal);
    expect(texto).toContain(CTA.apoio);
    // o cabeçalho é fixo e leva o botão
    expect(html).toMatch(/<header class="sticky top-0[^"]*"/);
  });

  it("os 10 prints da lista são espaços reservados nomeados", () => {
    const lista = Object.values(PRINTS);
    expect(lista.map((p) => p.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(todos(/data-print="([^"]+)"/g))).toEqual(new Set(lista.map((p) => p.arquivo)));
    for (const p of lista) {
      expect(texto, p.arquivo).toContain(`Print ${p.n} ${p.tela}`);
      expect(texto).toContain(`${p.arquivo}.webp`);
    }
    // o LEIA-ME da pasta lista os mesmos nomes
    const leiaMe = readFileSync("public/marketing/prints/LEIA-ME.md", "utf8");
    for (const p of lista) expect(leiaMe, p.arquivo).toContain(`\`${p.arquivo}\``);
  });

  it("o arquivo com o nome certo na pasta troca o espaço reservado pela imagem", () => {
    const pasta = mkdtempSync(path.join(tmpdir(), "prints-"));
    expect(localizarPrint("01-dashboard", pasta)).toBeNull();
    writeFileSync(path.join(pasta, "01-dashboard.png"), "");
    expect(localizarPrint("01-dashboard", pasta)).toBe("/marketing/prints/01-dashboard.png");
    writeFileSync(path.join(pasta, "01-dashboard.webp"), "");
    expect(localizarPrint("01-dashboard", pasta)).toBe("/marketing/prints/01-dashboard.webp");
    expect(localizarPrint("02-calendario-os", pasta)).toBeNull();
  });

  it("prova social: vazia e marcada como espaço reservado (nada inventado)", () => {
    expect(PROVA_SOCIAL).toEqual({ depoimentos: [], numeros: [], logos: [] });
    expect(html).toContain("data-prova-social-pendente");
    expect(todos(/data-reservado="([^"]+)"/g).sort()).toEqual(["depoimento", ...Array(5).fill("logo"), ...Array(3).fill("numero")]);
    expect(html).not.toContain("<blockquote");
    // nenhum número de cliente na página: "+ de 500 empresas", "98% de satisfação"…
    expect(texto).not.toMatch(/\d+\s*(?:%|mil\b|\+)|\+\s*de\s*\d|\d+\s+(?:empresas|clientes|técnicos|usuários)/i);
  });

  it("FAQ: as 6 perguntas do briefing, com resposta, e o caminho para a completa", () => {
    expect(FAQ.map((f) => f.pergunta)).toEqual([
      "O que é o Frivo?", "Pra quem é?", "Funciona offline no campo?", "Emite nota fiscal e boleto?", "Tem teste grátis?", "Meus dados estão seguros (LGPD)?",
    ]);
    expect(html.match(/<details/g)).toHaveLength(6);
    for (const f of FAQ) { expect(texto).toContain(f.pergunta); expect(texto).toContain(f.resposta); }
    expect(html).toContain('href="/faq"');
  });

  it("rodapé: links do briefing e contato como placeholder", () => {
    const rodape = html.slice(html.indexOf("<footer"));
    for (const href of ["#planos", "/faq", "/privacidade", "#contato"]) expect(rodape).toContain(`href="${href}"`);
    expect(rodape).toContain("WhatsApp [número]");
    expect(rodape).toContain("E-mail [e-mail]");
    expect(rodape).toMatch(/© \d{4} Frivo/);
  });

  it("SEO básico: título, descrição, canonical e Open Graph; fora dos buscadores até publicar", () => {
    const m = metadata as any;
    expect(m.title.absolute).toMatch(/Frivo/);
    expect(m.description.length).toBeGreaterThan(80);
    expect(m.description.length).toBeLessThanOrEqual(160);
    expect(m.alternates.canonical).toBe("/");
    expect(m.openGraph).toMatchObject({ type: "website", locale: "pt_BR", title: m.title.absolute, description: m.description });
    expect(m.twitter.card).toBe("summary_large_image");
    expect(PUBLICADA).toBe(false);
    expect(m.robots).toEqual({ index: false, follow: false });
  });
});

describe("home de vendas: acesso (middleware real)", () => {
  const abrir = async (caminho: string, cookie?: string) => {
    const { default: middleware } = await import("@/middleware");
    return (await (middleware as any)(new NextRequest(`http://localhost${caminho}`, cookie ? { headers: { cookie } } : undefined), {})) as Response;
  };
  const destino = async (caminho: string, cookie?: string) => (await abrir(caminho, cookie)).headers.get("location");

  it("anônimo abre a home, o destino do CTA, os prints e a imagem de compartilhamento", async () => {
    for (const c of ["/", "/teste-gratis", "/marketing/prints/01-dashboard.webp", "/opengraph-image", "/faq", "/privacidade"]) {
      expect(await destino(c), c).toBeNull();
    }
  });

  it('liberar "/" não libera o sistema', async () => {
    for (const c of ["/dashboard", "/ordens", "/clientes", "/api/ordens", "/marketing"]) {
      expect(await destino(c), c).toBe(`http://localhost/login?callbackUrl=${encodeURIComponent(c)}`);
    }
  });

  it("quem está logado vai da home direto para o painel", async () => {
    const nome = "authjs.session-token";
    const token = await encode({ secret: SEGREDO, salt: nome, token: { sub: "u1", id: "u1", role: "ADMIN", empresaId: "e1" } });
    const local = await destino("/", `${nome}=${token}`);
    expect(local).toBe("http://localhost/dashboard");
  });
});
