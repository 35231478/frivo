"use client";

import { cn } from "@/lib/utils";
import {
  Children, cloneElement, isValidElement, useEffect, useId, useRef, useState,
  type FocusEvent, type FormEvent, type ReactElement, type ReactNode,
} from "react";
import { Dica } from "@/components/ui/dica";
import { CampoCtx, juntarIds } from "@/components/ui/campo-contexto";
import { useErrosCtx } from "@/components/ui/formulario-erros";
import { validarFormato, type Formato } from "@/lib/forms/erros";

interface FormFieldProps {
  label: string;
  /** O erro deste campo (o explícito ganha do que vem do formulário por `name`) */
  error?: string;
  /**
   * O nome do campo no formulário (o mesmo da API: `campos.cpfCnpj`). Dentro de <ErrosDoFormulario>, o erro vem
   * daqui, some quando a pessoa corrige e o campo entra no resumo da faixa do topo.
   */
  name?: string;
  /** Confere o formato ao SAIR do campo (CNPJ/CPF, e-mail, CEP, telefone, data, hora, valor); vazio não acusa */
  formato?: Formato;
  /** O valor de um controle sem evento de digitação (seletor com busca, cliente…): mudou, o erro some */
  valor?: unknown;
  required?: boolean;
  hint?: string;
  /** Explicação longa do campo: vai para o ⓘ ao lado do rótulo (Princípio 7) */
  dica?: ReactNode;
  /** Rótulo só para leitor de tela (célula de tabela editável) */
  rotuloOculto?: boolean;
  className?: string;
  children: ReactNode;
}

const TAGS_CAMPO = new Set(["input", "select", "textarea"]);
const CONTEINERES = new Set(["div", "span", "label", "fieldset"]);

/** Um controle de formulário: <input>/<select>/<textarea> ou um componente marcado como campo (Input, Select…) */
function ehCampo(el: ReactElement) {
  const t = el.type as unknown;
  if (typeof t === "string") return TAGS_CAMPO.has(t) && (el.props as { type?: string }).type !== "hidden";
  return !!(t && (t as { campoDeFormulario?: boolean }).campoDeFormulario);
}

/**
 * Dá o id (o do rótulo) ao PRIMEIRO controle de dentro de um filho composto (ex.: CNPJ + botão Consultar):
 * desce por div/span/label até achar um campo. Um filho único continua recebendo o id direto (UX-8).
 */
function comIdNoPrimeiroCampo(no: ReactNode, id: string, achou = { v: false }, prof = 0): ReactNode {
  if (prof > 4) return no;
  return Children.map(no, (c) => {
    if (achou.v || !isValidElement<{ id?: string; children?: ReactNode }>(c)) return c;
    if (ehCampo(c)) { achou.v = true; return c.props.id ? c : cloneElement(c, { id }); }
    if (typeof c.type === "string" && CONTEINERES.has(c.type) && c.props.children != null) {
      const filhos = comIdNoPrimeiroCampo(c.props.children, id, achou, prof + 1);
      return achou.v ? cloneElement(c, undefined, filhos) : c;
    }
    return c;
  });
}

export function FormField({ label, error, name, formato, valor, required, hint, dica, rotuloOculto, className, children }: FormFieldProps) {
  // UX-8 (G2): label ASSOCIADO ao campo (a11y + clique no rótulo foca o campo + automação).
  // Quando o filho é um elemento único sem id, ele ganha o id gerado; composto, o primeiro controle de dentro.
  const idGerado = useId();
  const form = useErrosCtx();
  const [erroFormato, setErroFormato] = useState<string | null>(null);

  const filhoUnico = isValidElement<{ id?: string }>(children) && !(typeof children.type === "string" && CONTEINERES.has(children.type)) ? children : null;
  let id: string | undefined;
  let campo: ReactNode = children;
  if (filhoUnico) {
    id = filhoUnico.props.id ?? idGerado;
    if (!filhoUnico.props.id) campo = cloneElement(filhoUnico, { id });
  } else {
    // Composto: o rótulo aponta para o primeiro controle (com o id que ele já tiver)
    let idDoFilho: string | undefined;
    const procurar = (no: ReactNode, prof = 0) => Children.forEach(no, (c) => {
      if (idDoFilho !== undefined || prof > 4 || !isValidElement<{ id?: string; children?: ReactNode }>(c)) return;
      if (ehCampo(c)) idDoFilho = c.props.id ?? "";
      else if (typeof c.type === "string" && CONTEINERES.has(c.type)) procurar(c.props.children, prof + 1);
    });
    procurar(children);
    if (idDoFilho !== undefined) {
      id = idDoFilho || idGerado;
      if (!idDoFilho) campo = comIdNoPrimeiroCampo(children, id);
    }
  }

  const erroDoForm = name ? form?.erroDe(name) : undefined;
  const erro = error || erroDoForm || erroFormato || undefined;
  const erroId = `${idGerado}-erro`;
  const dicaId = `${idGerado}-dica`;
  const descricaoId = erro ? erroId : hint ? dicaId : undefined;

  // O resumo da faixa usa o rótulo do campo
  useEffect(() => { if (name && form) form.registrarRotulo(name, label); }, [name, label, form]);

  // Controle sem digitação (seletor): o valor mudou, o erro de "obrigatório"/servidor some
  const valorAnterior = useRef(valor);
  useEffect(() => {
    if (valorAnterior.current === valor) return;
    valorAnterior.current = valor;
    limparTudo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor]);

  const valorDoAlvo = (t: EventTarget | null) => {
    const el = t as HTMLInputElement | null;
    if (!el || !("value" in el) || !el.tagName || !TAGS_CAMPO.has(el.tagName.toLowerCase())) return null;
    if (el.type === "checkbox" || el.type === "radio" || el.type === "hidden" || el.getAttribute("aria-hidden") === "true") return null;
    return String(el.value ?? "");
  };

  // O erro do formulário veio do formato (não do servidor nem do "obrigatório"): só o formato certo o tira
  const formatoNoForm = useRef(false);
  const limparTudo = () => {
    setErroFormato(null);
    if (name && form?.erroDe(name)) form.limpar(name);
    formatoNoForm.current = false;
  };

  // Ao SAIR do campo: confere o formato óbvio (vazio não acusa; o obrigatório é só ao salvar)
  const aoSair = (e: FocusEvent<HTMLDivElement>) => {
    if (!formato) return;
    const v = valorDoAlvo(e.target);
    if (v === null) return;
    const msg = validarFormato(formato, v);
    if (name && form) {
      if (msg) { form.definirCampo(name, msg); formatoNoForm.current = true; }
      else if (formatoNoForm.current) { form.limpar(name); formatoNoForm.current = false; }
    } else setErroFormato(msg);
  };

  // Digitou: o erro some assim que fica certo (o de formato, quando o formato fecha; os outros, na hora)
  const aoDigitar = (e: FormEvent<HTMLDivElement>) => {
    if (!erro) return;
    const alvo = e.target as HTMLInputElement;
    // O calendário do aparelho (campo de data escondido) escolheu uma data: vale como correção
    if (alvo?.tagName === "INPUT" && alvo.getAttribute("aria-hidden") === "true") { limparTudo(); return; }
    const v = valorDoAlvo(alvo);
    if (v === null) return;
    // Já acusou o formato: some quando fica certo; enquanto segue errado, a mensagem acompanha o que está digitado
    // (ex.: "Informe os 14 dígitos" → "CNPJ inválido" quando os 14 dígitos chegam com o verificador errado)
    if (formato && (erroFormato || formatoNoForm.current)) {
      const msg = validarFormato(formato, v);
      if (msg === null) limparTudo();
      else if (name && form) form.definirCampo(name, msg);
      else setErroFormato(msg);
      return;
    }
    if (name && erroDoForm) form?.limpar(name);
  };

  const rotulo = (
    <label htmlFor={id} className={cn("text-sm font-medium text-ink", rotuloOculto && "sr-only")}>
      {label}
      {required && <span className="text-atrasado ml-0.5" aria-hidden>*</span>}
    </label>
  );
  return (
    <div
      className={cn("flex flex-col gap-1.5", className)}
      data-campo-nome={name} data-campo-com-erro={erro ? "" : undefined}
      onBlur={formato ? aoSair : undefined} onInput={aoDigitar} onChange={aoDigitar}
    >
      {/* Com dica, o ⓘ fica ao lado do rótulo e FORA do <label> (não entra no nome do campo nem o foca) */}
      {dica ? (
        <div className="flex items-center gap-1">{rotulo}<Dica texto={dica} rotulo={label} lado="direita" /></div>
      ) : rotulo}
      <CampoCtx.Provider value={{ invalido: !!erro, descricaoId }}>{campo}</CampoCtx.Provider>
      {hint && !erro && <p id={dicaId} className="text-xs text-ink-muted">{hint}</p>}
      {erro && <p id={erroId} className="text-xs text-atrasado-texto font-medium" data-erro-campo>{erro}</p>}
    </div>
  );
}

/** Para um controle feito à mão fora dos componentes de components/ui: as mesmas props de erro do contexto */
export { juntarIds };

export function FormSection({ title, icon, dica, children }: { title: string; icon?: ReactNode; dica?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-4">
      <h3 className="flex items-center gap-2 text-xs font-semibold text-ink-muted uppercase tracking-wider pb-2 border-b border-surface-border">
        {icon && <span className="text-acento">{icon}</span>}
        {title}
        {dica && <Dica texto={dica} rotulo={title} lado="direita" />}
      </h3>
      {children}
    </div>
  );
}

export function FormGrid({ cols = 2, children }: { cols?: 2 | 3; children: ReactNode }) {
  return (
    <div className={cn("grid gap-4", cols === 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2")}>
      {children}
    </div>
  );
}
