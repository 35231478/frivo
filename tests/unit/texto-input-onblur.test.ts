// @vitest-environment happy-dom
/**
 * O Input compartilhado padroniza a digitação ao sair do campo (onBlur), conforme a prop `caixa`.
 * A MESMA função do servidor roda aqui; sem `caixa`, nada muda.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Input } from "@/components/ui/input";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let caixa: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); });

function montar(props: Record<string, unknown>) {
  caixa = document.createElement("div"); document.body.appendChild(caixa);
  root = createRoot(caixa);
  act(() => root.render(createElement(Input, props)));
  return caixa.querySelector("input") as HTMLInputElement;
}
function digitarEBlur(el: HTMLInputElement, v: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    // React mapeia onBlur para o evento nativo "focusout" (que borbulha)
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

describe("Input onBlur (prop caixa)", () => {
  it('caixa="nome": ajeita para Nome Próprio ao sair', () => {
    const el = montar({ caixa: "nome", defaultValue: "" });
    digitarEBlur(el, "joão DA silva LTDA");
    expect(el.value).toBe("João da Silva Ltda");
  });

  it('caixa="email": minúsculo ao sair', () => {
    const el = montar({ caixa: "email", defaultValue: "" });
    digitarEBlur(el, "JOAO@Ex.COM");
    expect(el.value).toBe("joao@ex.com");
  });

  it("sem caixa: não mexe no valor", () => {
    const el = montar({ defaultValue: "" });
    digitarEBlur(el, "joão DA silva");
    expect(el.value).toBe("joão DA silva");
  });

  it("controlado (estado segue o onChange): o valor final fica padronizado", () => {
    // componente controlado de verdade: o estado acompanha o onChange, como nos formulários reais
    function Controlado() {
      const [v, setV] = useState("");
      return createElement(Input, { caixa: "nome", value: v, onChange: (e: any) => setV(e.target.value) });
    }
    caixa = document.createElement("div"); document.body.appendChild(caixa);
    root = createRoot(caixa);
    act(() => root.render(createElement(Controlado)));
    const el = caixa.querySelector("input") as HTMLInputElement;
    digitarEBlur(el, "maria DAS dores");
    expect(el.value).toBe("Maria das Dores");
  });
});
