/**
 * Despoluição — Lote B (OS/Estoque/Orçamentos/Serviços/Compras + Entrada/Portal/Público/Técnico):
 * o que o lote garante além do ratchet.
 *  - entrada, portal e páginas públicas sem tom de assistente ("Vamos mandar", "Olá, Fulano!", "você") e sem "!";
 *  - mensagens ao cliente/fornecedor (WhatsApp, e-mail) começam formais ("Prezado(a)"/"Prezados,");
 *  - sem emoji nas mensagens de rota (pedido de compra, prazo, lead) e no app do técnico;
 *  - cores da página pública do QR e da etiqueta impressa vêm dos tokens;
 *  - perfil do usuário usa o toast da casa;
 *  - títulos de página em caixa de frase.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");
const EMOJI = /(?![©®™])\p{Extended_Pictographic}|[✓✔✅❌]/u;
const ASSISTENTE = /(?<![\wÀ-ú])(?:você|Vamos|Olá|Bem-vind[oa])(?![\wÀ-ú])/;
const TITLE_CASE = /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+(?: (?:de|da|do|das|dos|e|a|em|por))? [A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+/;

describe("entrada, portal e público", () => {
  const telas = [
    "components/auth/login-form.tsx", "components/auth/esqueci-senha-form.tsx", "components/auth/definir-senha-form.tsx",
    "components/portal/portal-esqueci-senha-form.tsx", "components/portal/portal-definir-senha-form.tsx", "components/portal/portal-shell.tsx", "components/portal/sem-acesso.tsx",
    "app/(portal)/portal/(protegido)/dashboard/page.tsx", "app/(portal)/portal/(protegido)/financeiro/page.tsx", "app/(portal)/portal/(protegido)/equipamentos/page.tsx",
    "app/(publico)/medicao/[token]/page.tsx", "app/(publico)/orcamento/[token]/page.tsx", "app/(publico)/relatorio/[token]/page.tsx", "app/(publico)/qr/[token]/not-found.tsx",
    "components/public/qr-publico-client.tsx", "app/(dashboard)/sem-permissao/page.tsx", "app/offline/page.tsx",
  ];
  it.each(telas)("%s: sem tom de assistente nem exclamação em texto de UI", (f) => {
    const src = ler(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const textos = [...src.matchAll(/(?<=[\w"'}\]])>([^<>{}]{3,})<|["`]([^"`\n]{3,})["`]/g)].map((m) => (m[1] ?? m[2]).trim()).filter((t) => /[A-Za-zÀ-ú]{3,}\s+[A-Za-zÀ-ú]/.test(t));
    for (const t of textos) {
      expect(ASSISTENTE.test(t), `${f}: ${t}`).toBe(false);
      expect(/[A-Za-zÀ-ú]!\s*$/.test(t), `${f}: ${t}`).toBe(false);
    }
    // saudação com nome interpolado ("Olá, {nome}!") escapa da extração acima: nenhuma no arquivo
    expect(src, f).not.toMatch(/Olá|Bem-vind/);
  });
  it("mensagens ao cliente/fornecedor começam formais", () => {
    expect(ler("lib/compras/pedido.ts")).toMatch(/Prezado\(a\) \$\{[^}]+\},` : "Prezados,"/);
    expect(ler("app/api/orcamentos/[id]/enviar/route.ts")).toMatch(/Prezado\(a\)/);
    for (const f of ["lib/orcamento-helpers.ts", "components/relatorio/relatorio-envio.tsx", "app/api/medicoes/[id]/acao/route.ts", "components/forms/portal-acesso-contato.tsx"]) {
      expect(ler(f), f).not.toMatch(/Olá/);
      expect(ler(f), f).toMatch(/Prezad/);
    }
  });
});

describe("operacional e técnico", () => {
  it("sem emoji nas mensagens de rota e no app do técnico", () => {
    for (const f of ["app/api/pedidos-compra/route.ts", "app/api/os-prazos/[id]/avancar/route.ts", "app/api/publico/leads/route.ts", "components/tecnico/equipamento.tsx", "components/tecnico/execucao.tsx"]) {
      expect(EMOJI.test(ler(f)), f).toBe(false);
    }
    expect(ler("components/tecnico/equipamento.tsx")).toContain("Foto registrada (");
    expect(ler("components/tecnico/equipamento.tsx")).toContain(">Marcar atenção<");
  });
  it("página pública do QR e etiqueta impressa com cores dos tokens; tipo de OS com padrão da paleta", () => {
    for (const f of ["app/(publico)/qr/[token]/page.tsx", "app/(dashboard)/qrcodes/imprimir/imprimir-client.tsx"]) {
      const src = ler(f);
      expect(src, f).not.toMatch(/#[0-9A-Fa-f]{6}\b/);
      expect(src, f).toMatch(/from "@\/lib\/ui\/tokens"/);
    }
    // O tipo de OS passou para o cadastro padrão: a rota só delega, e a cor de um tipo novo vem da paleta, no registro
    expect(ler("app/api/tipos-os/route.ts")).not.toMatch(/#[0-9A-Fa-f]{6}\b/);
    expect(ler("lib/cadastros/registro.ts")).toMatch(/descricao: null, cor: corDado\.azulForte, exigeEquipamento: true/);
    expect(ler("lib/cadastros/registro.ts")).toMatch(/from "@\/lib\/ui\/tokens"/);
  });
  it("orientação do consumo de material sem 'X = Y'; perfil do usuário com o toast da casa", () => {
    expect(ler("components/os/os-separacao.tsx")).toContain("Em branco, assume o separado.");
    expect(ler("components/os/os-separacao.tsx")).not.toContain("Padrão = ");
    const perfil = ler("components/perfil/perfil-client.tsx");
    expect(perfil).toContain('import { toast } from "@/components/ui/avisos";');
    expect(perfil).not.toMatch(/setToast|mostrarToast|fixed top-5 right-5/);
    expect(perfil).not.toMatch(/toast\([^)]*!["'`]/);
  });
  it("títulos de página em caixa de frase", () => {
    const paginas = [
      "app/(dashboard)/ordens/page.tsx", "app/(dashboard)/ordens/[id]/page.tsx", "app/(dashboard)/orcamentos/novo/page.tsx", "app/(dashboard)/compras/pedidos/page.tsx",
      "app/(dashboard)/equipamentos/novo/page.tsx", "app/(dashboard)/veiculos/checklist/page.tsx", "app/(dashboard)/perfil/page.tsx", "app/(publico)/relatorio/atividade/[id]/page.tsx",
      "components/ordens/ordens-lista-client.tsx", "components/perfil/perfil-client.tsx",
    ];
    for (const f of paginas) {
      const titulos = [...ler(f).matchAll(/(?:title[:=]\s*|page-title[^>]*>|label: )"?([^"<}|,]+)/g)].map((x) => x[1].trim());
      expect(titulos.length, f).toBeGreaterThan(0);
      for (const t of titulos) expect(TITLE_CASE.test(t), `${f}: ${t}`).toBe(false);
    }
  });
});
