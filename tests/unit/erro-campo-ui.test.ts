// @vitest-environment happy-dom
/**
 * ERRO NO CAMPO — o mecanismo compartilhado, na tela (components/ui/form-field + formulario-erros):
 *  - o campo com erro ganha borda vermelha + a mensagem logo abaixo, com aria-invalid/aria-describedby; o rótulo não muda;
 *  - a faixa do topo é o resumo ("N campos para corrigir" com os nomes; um erro só repete o texto);
 *  - ao salvar, rola e foca o primeiro campo com erro — abrindo a aba escondida (e mostrando o ponto vermelho nela);
 *  - o erro some quando a pessoa corrige (na hora; o de formato, quando o formato fica certo);
 *  - formato ao sair do campo (nunca enquanto digita pela 1ª vez); vazio não acusa;
 *  - o erro do servidor ({ erro, campos } ou o `detalhes` do zod) cai no campo certo;
 *  - seletor com busca, data e e-mails seguem o mesmo padrão.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { InputData } from "@/components/ui/input-data";
import { BuscaSelect } from "@/components/ui/busca-select";
import { Tabs } from "@/components/ui/tabs";
import { ErrosDoFormulario, ResumoDeErros, useErrosDoFormulario, type ErrosFormulario } from "@/components/ui/formulario-erros";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const h = createElement as any;
let root: Root; let caixa: HTMLDivElement;
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 40)); }); };
beforeEach(() => { caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa); });
afterEach(() => { act(() => root.unmount()); caixa.remove(); });

const $ = <T extends Element = HTMLElement>(s: string) => caixa.querySelector<T>(s);
function digitar(el: HTMLInputElement, v: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => { setter.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); });
}
const sair = (el: HTMLElement) => act(() => { el.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); el.dispatchEvent(new FocusEvent("blur")); });

let api: ErrosFormulario;
/** Um formulário de exemplo com duas abas (a 2ª escondida por CSS, como na ficha do cliente) */
function Exemplo({ comCep = true }: { comCep?: boolean }) {
  const [aba, setAba] = useState("dados");
  const [cnpj, setCnpj] = useState("");
  const [nome, setNome] = useState("");
  const [cep, setCep] = useState("");
  const [uf, setUf] = useState("");
  const f = useErrosDoFormulario({ abrirAba: setAba });
  api = f;
  const salvar = () => {
    f.validar({
      ...(nome.trim() ? {} : { nome: "Informe o nome." }),
      ...(cnpj.replace(/\D/g, "").length === 14 ? {} : { cpfCnpj: "Informe os 14 dígitos do CNPJ." }),
      ...(comCep && !cep ? { cep: "Informe o CEP." } : {}),
    });
  };
  return h(ErrosDoFormulario, { valor: f },
    h("form", { ref: f.ref, onSubmit: (e: Event) => e.preventDefault() },
      h(ResumoDeErros),
      h("nav", null,
        h("button", { type: "button", "data-aba": "dados", onClick: () => setAba("dados") }, "Dados", f.porAba.dados ? h("span", { "data-erro-aba": f.porAba.dados }, f.porAba.dados) : null),
        h("button", { type: "button", "data-aba": "enderecos", onClick: () => setAba("enderecos") }, "Endereços", f.porAba.enderecos ? h("span", { "data-erro-aba": f.porAba.enderecos }, f.porAba.enderecos) : null),
      ),
      h("div", { "data-aba-painel": "dados", className: aba === "dados" ? "" : "hidden" },
        h(FormField, { label: "CNPJ", name: "cpfCnpj", formato: "cnpj", required: true },
          h("div", { className: "flex" }, h(Input, { value: cnpj, onChange: (e: any) => setCnpj(e.target.value), "data-t": "cnpj" }), h("button", { type: "button" }, "Consultar"))),
        h(FormField, { label: "Razão social", name: "nome", required: true }, h(Input, { value: nome, onChange: (e: any) => setNome(e.target.value), "data-t": "nome" })),
        h(FormField, { label: "UF", name: "uf", valor: uf }, h(BuscaSelect, { value: uf, onChange: setUf, options: [{ value: "SP", label: "SP" }], rotulo: "UF" })),
      ),
      h("div", { "data-aba-painel": "enderecos", className: aba === "enderecos" ? "" : "hidden" },
        h(FormField, { label: "CEP", name: "cep", formato: "cep" }, h(Input, { value: cep, onChange: (e: any) => setCep(e.target.value), "data-t": "cep" })),
      ),
      h("button", { type: "button", "data-salvar": "", onClick: salvar }, "Salvar"),
    ));
}

describe("campo com erro", () => {
  it("borda vermelha, mensagem abaixo com aria-invalid/aria-describedby; o rótulo não muda de cor", async () => {
    act(() => root.render(h(Exemplo)));
    act(() => $("[data-salvar]")!.click());
    await flush();
    const cnpj = $<HTMLInputElement>('[data-t="cnpj"]')!;
    expect(cnpj.getAttribute("aria-invalid")).toBe("true");
    expect(cnpj.className).toContain("border-atrasado");
    const msg = document.getElementById(cnpj.getAttribute("aria-describedby")!)!;
    expect(msg.textContent).toBe("Informe os 14 dígitos do CNPJ.");
    // a mensagem fica logo abaixo do controle, dentro do mesmo campo
    const campo = cnpj.closest("[data-campo-nome]")!;
    expect(campo.getAttribute("data-campo-nome")).toBe("cpfCnpj");
    expect(campo.lastElementChild).toBe(msg);
    // o rótulo aponta para o input (filho composto: CNPJ + Consultar) e continua na cor de sempre
    const rotulo = campo.querySelector("label")!;
    expect(rotulo.htmlFor).toBe(cnpj.id);
    expect(rotulo.className).toContain("text-ink");
    expect(rotulo.className).not.toContain("atrasado");
    // os campos certos ficam como estavam
    expect($('[data-t="nome"]')!.getAttribute("aria-invalid")).toBe("true");
  });

  it("a faixa do topo é o resumo: \"N campos para corrigir\" com os nomes, e o toque leva ao campo", async () => {
    act(() => root.render(h(Exemplo)));
    act(() => $("[data-salvar]")!.click());
    await flush();
    const faixa = $("[data-resumo-erros]")!;
    expect(faixa.getAttribute("role")).toBe("alert");
    expect(faixa.textContent).toContain("3 campos para corrigir");
    expect(Array.from(faixa.querySelectorAll("[data-ir-campo]")).map((b) => b.textContent)).toEqual(["CNPJ", "Razão social", "CEP"]);
    act(() => faixa.querySelector<HTMLButtonElement>('[data-ir-campo="cep"]')!.click());
    await flush();
    expect(document.activeElement).toBe($('[data-t="cep"]'));
    expect($('[data-aba-painel="enderecos"]')!.className).not.toContain("hidden");
  });

  it("um erro só de campo: a faixa traz o mesmo texto, sem lista", async () => {
    act(() => root.render(h(Exemplo, { comCep: false })));
    digitar($<HTMLInputElement>('[data-t="nome"]')!, "Polar Demo");
    act(() => $("[data-salvar]")!.click());
    await flush();
    const faixa = $("[data-resumo-erros]")!;
    expect(faixa.textContent).toBe("Informe os 14 dígitos do CNPJ.");
    expect(faixa.querySelector("[data-resumo-campos]")).toBeNull();
  });
});

describe("foco no primeiro erro", () => {
  it("rola e foca o primeiro campo com erro, na ordem da tela", async () => {
    act(() => root.render(h(Exemplo)));
    act(() => $("[data-salvar]")!.click());
    await flush();
    expect(document.activeElement).toBe($('[data-t="cnpj"]'));
  });

  it("o erro em OUTRA aba: a aba ganha o ponto vermelho com a contagem, abre sozinha e o campo recebe o foco", async () => {
    act(() => root.render(h(Exemplo)));
    digitar($<HTMLInputElement>('[data-t="cnpj"]')!, "11.222.333/0001-81");
    digitar($<HTMLInputElement>('[data-t="nome"]')!, "Polar Demo");
    expect($('[data-aba-painel="enderecos"]')!.className).toContain("hidden");
    act(() => $("[data-salvar]")!.click());
    await flush();
    expect($('[data-aba="enderecos"] [data-erro-aba]')!.textContent).toBe("1");
    expect($('[data-aba="dados"] [data-erro-aba]')).toBeNull();
    expect($('[data-aba-painel="enderecos"]')!.className).not.toContain("hidden");
    expect(document.activeElement).toBe($('[data-t="cep"]'));
  });

  it("sem erro de campo, o foco vai para a faixa (erro que não é de campo nenhum)", async () => {
    act(() => root.render(h(Exemplo)));
    act(() => { api.erroDaApi({ erro: "Erro de conexão." }); });
    await flush();
    expect(document.activeElement).toBe($("[data-resumo-erros]"));
    expect($("[data-resumo-erros]")!.textContent).toBe("Erro de conexão.");
  });
});

describe("o erro some quando a pessoa corrige", () => {
  it("obrigatório: some na hora em que a pessoa digita (sem esperar o próximo salvar)", async () => {
    act(() => root.render(h(Exemplo)));
    act(() => $("[data-salvar]")!.click());
    await flush();
    const nome = $<HTMLInputElement>('[data-t="nome"]')!;
    digitar(nome, "P");
    expect(nome.getAttribute("aria-invalid")).toBeNull();
    expect(nome.closest("[data-campo-nome]")!.querySelector("[data-erro-campo]")).toBeNull();
    expect($("[data-resumo-erros]")!.textContent).toContain("2 campos para corrigir");
  });

  it("formato: continua enquanto o formato está errado e some quando fecha", async () => {
    act(() => root.render(h(Exemplo)));
    const cnpj = $<HTMLInputElement>('[data-t="cnpj"]')!;
    digitar(cnpj, "11.222.333/0001");
    sair(cnpj);
    expect(cnpj.getAttribute("aria-invalid")).toBe("true");
    digitar(cnpj, "11.222.333/0001-8");
    expect(cnpj.getAttribute("aria-invalid")).toBe("true");
    digitar(cnpj, "11.222.333/0001-81");
    expect(cnpj.getAttribute("aria-invalid")).toBeNull();
    expect($("[data-resumo-erros]")).toBeNull();
  });

  it("seletor sem digitação (busca): escolher limpa o erro pelo `valor`", async () => {
    act(() => root.render(h(Exemplo)));
    act(() => { api.validar({ uf: "Escolha a UF." }); });
    await flush();
    const botao = $<HTMLButtonElement>("[data-busca-select]")!;
    expect(botao.getAttribute("aria-invalid")).toBe("true");
    expect(botao.className).toContain("border-atrasado");
    expect(document.activeElement).toBe(botao);
    act(() => botao.click());
    act(() => caixa.querySelector<HTMLButtonElement>('[role="option"]')!.click());
    expect(botao.getAttribute("aria-invalid")).toBeNull();
  });
});

describe("formato ao sair do campo", () => {
  it("nunca acusa enquanto a pessoa digita pela 1ª vez; acusa ao sair; vazio não acusa", () => {
    act(() => root.render(h(Exemplo)));
    const cep = $<HTMLInputElement>('[data-t="cep"]')!;
    digitar(cep, "1301");
    expect(cep.getAttribute("aria-invalid")).toBeNull();
    sair(cep);
    expect(cep.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(cep.getAttribute("aria-describedby")!)!.textContent).toBe("Informe os 8 dígitos do CEP.");
    digitar(cep, "");
    sair(cep);
    expect(cep.getAttribute("aria-invalid")).toBeNull();
  });

  it("sem formulário em volta (FormField solto), o formato também marca o campo", () => {
    act(() => root.render(h(FormField, { label: "E-mail", formato: "email" }, h(Input, { defaultValue: "", "data-t": "email" }))));
    const el = $<HTMLInputElement>('[data-t="email"]')!;
    digitar(el, "joao@");
    sair(el);
    expect(el.getAttribute("aria-invalid")).toBe("true");
    expect(caixa.querySelector("[data-erro-campo]")!.textContent).toBe("E-mail inválido: confira o endereço.");
    digitar(el, "joao@empresa.com.br");
    expect(el.getAttribute("aria-invalid")).toBeNull();
  });
});

describe("erro do servidor no campo certo", () => {
  it("{ erro, campos }: o CNPJ já cadastrado cai no CNPJ, com foco", async () => {
    act(() => root.render(h(Exemplo)));
    act(() => { api.erroDaApi({ erro: "CPF/CNPJ já cadastrado", campos: { cpfCnpj: "CPF/CNPJ já cadastrado" } }); });
    await flush();
    const cnpj = $<HTMLInputElement>('[data-t="cnpj"]')!;
    expect(cnpj.getAttribute("aria-invalid")).toBe("true");
    expect(cnpj.closest("[data-campo-nome]")!.querySelector("[data-erro-campo]")!.textContent).toBe("CPF/CNPJ já cadastrado");
    expect(document.activeElement).toBe(cnpj);
    // a faixa repete (um erro só) — sem a frase duplicada
    expect($("[data-resumo-erros]")!.textContent).toBe("CPF/CNPJ já cadastrado");
    // mexeu no campo, o erro do servidor some
    digitar(cnpj, "11.222.333/0001-8");
    expect(cnpj.getAttribute("aria-invalid")).toBeNull();
  });

  it("o `detalhes` do zod (rotas antigas) também cai no campo", async () => {
    act(() => root.render(h(Exemplo)));
    act(() => { api.erroDaApi({ erro: "Dados inválidos", detalhes: { formErrors: [], fieldErrors: { nome: ["Nome deve ter pelo menos 2 caracteres"] } } }); });
    await flush();
    expect($('[data-t="nome"]')!.getAttribute("aria-invalid")).toBe("true");
    expect($("[data-resumo-erros]")!.textContent).toBe("Nome deve ter pelo menos 2 caracteres");
  });
});

describe("os outros controles seguem o mesmo padrão", () => {
  it("select, data e o explícito `error` do react-hook-form", () => {
    act(() => root.render(h("div", null,
      h(FormField, { label: "Tipo", error: "Escolha o tipo." }, h(Select, { "data-t": "sel" }, h("option", { value: "" }, "—"))),
      h(FormField, { label: "Vencimento", error: "Informe o vencimento." }, h(InputData, { value: "", onChange: () => {} })),
    )));
    const sel = $<HTMLSelectElement>('[data-t="sel"]')!;
    expect(sel.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(sel.getAttribute("aria-describedby")!)!.textContent).toBe("Escolha o tipo.");
    const data = $<HTMLInputElement>("[data-input-data]")!;
    expect(data.getAttribute("aria-invalid")).toBe("true");
    expect(data.className).toContain("border-atrasado");
    expect(document.getElementById(data.getAttribute("aria-describedby")!)!.textContent).toBe("Informe o vencimento.");
    const rotulo = data.closest("[class*='flex-col']")!.querySelector("label")!;
    expect(rotulo.htmlFor).toBe(data.id);
  });

  it("a dica vira a descrição do campo quando não há erro", () => {
    act(() => root.render(h(FormField, { label: "CEP", hint: "Digite o CEP." }, h(Input, { "data-t": "c" }))));
    const el = $<HTMLInputElement>('[data-t="c"]')!;
    expect(el.getAttribute("aria-invalid")).toBeNull();
    expect(document.getElementById(el.getAttribute("aria-describedby")!)!.textContent).toBe("Digite o CEP.");
  });

  it("a aba do componente Tabs mostra o ponto vermelho com a contagem (e o texto para leitor de tela)", () => {
    act(() => root.render(h(Tabs, { tabs: [{ id: "a", label: "Dados", erros: 2 }, { id: "b", label: "Portal" }], children: () => null })));
    expect($('[data-aba="a"] [data-erro-aba]')!.textContent).toBe("2 erros");
    expect($('[data-aba="b"] [data-erro-aba]')).toBeNull();
  });
});
