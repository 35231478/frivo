"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/** Largura máxima do balão; no celular encolhe para caber na tela */
const LARGURA = 264;
/** Distância mínima da borda da tela */
const MARGEM = 8;
/** Abaixo disso de espaço livre sob o ícone, o balão abre para cima */
const ESPACO_MINIMO = 140;

/**
 * Ícone ⓘ com a explicação num balão (Princípio 7: rótulo curto na tela, o detalhe na dica).
 * O ÚNICO tooltip do sistema: use este em toda tela (direto ou pela prop `dica` de FormField,
 * FormSection, CardTitulo e PageHeader).
 *
 * - Desktop: abre no hover e fecha ao sair o mouse.
 * - Celular: abre e fecha no toque; toque fora ou rolar a tela fecha.
 * - Teclado: abre no foco, Esc fecha.
 * - Leitor de tela: o botão diz "Ajuda: <rótulo>" e é descrito pelo balão (`aria-describedby`,
 *   `role="tooltip"`), presente no DOM mesmo fechado.
 *
 * O balão vai para o `body` (portal, posição fixa): não é cortado por gaveta, modal ou tabela
 * com rolagem, e nunca sai da tela.
 */
export function Dica({ texto, rotulo, className, lado = "centro" }: {
  texto: ReactNode;
  /** Do que a dica fala (ex.: "CNAE"): vira o nome acessível do botão */
  rotulo?: string;
  className?: string;
  /** Alinhamento preferido do balão em relação ao ícone (é ajustado para caber na tela) */
  lado?: "centro" | "direita" | "esquerda";
}) {
  const id = useId();
  const [aberta, setAberta] = useState(false);
  const [montada, setMontada] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const botao = useRef<HTMLButtonElement>(null);
  const balao = useRef<HTMLSpanElement>(null);
  // Tipo do último ponteiro que apertou o botão: separa toque, mouse e teclado no clique
  const ponteiro = useRef<string | null>(null);

  useEffect(() => setMontada(true), []);

  // Cancela o clique já no botão (fase nativa), antes de subir: dentro de um <label>, o clique no ⓘ
  // não pode ligar o switch nem focar o campo (o preventDefault do React só roda no fim da propagação)
  useEffect(() => {
    const b = botao.current;
    if (!b) return;
    const cancelar = (e: Event) => e.preventDefault();
    b.addEventListener("click", cancelar);
    return () => b.removeEventListener("click", cancelar);
  }, []);

  const fechar = () => setAberta(false);

  useLayoutEffect(() => {
    if (!aberta || !botao.current) return;
    const r = botao.current.getBoundingClientRect();
    const largura = Math.min(LARGURA, window.innerWidth - 2 * MARGEM);
    const preferida = lado === "direita" ? r.left : lado === "esquerda" ? r.right - largura : r.left + r.width / 2 - largura / 2;
    const left = Math.max(MARGEM, Math.min(preferida, window.innerWidth - largura - MARGEM));
    const abaixo = window.innerHeight - r.bottom;
    setPos(abaixo < ESPACO_MINIMO && r.top > abaixo
      ? { left, width: largura, bottom: window.innerHeight - r.top + 6 }
      : { left, width: largura, top: r.bottom + 6 });
  }, [aberta, lado]);

  useEffect(() => {
    if (!aberta) return;
    const fora = (e: Event) => {
      const alvo = e.target as Node;
      if (!botao.current?.contains(alvo) && !balao.current?.contains(alvo)) fechar();
    };
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") fechar(); };
    document.addEventListener("pointerdown", fora, true);
    document.addEventListener("keydown", tecla);
    window.addEventListener("scroll", fechar, true);
    window.addEventListener("resize", fechar);
    return () => {
      document.removeEventListener("pointerdown", fora, true);
      document.removeEventListener("keydown", tecla);
      window.removeEventListener("scroll", fechar, true);
      window.removeEventListener("resize", fechar);
    };
  }, [aberta]);

  return (
    <span className={cn("inline-flex align-middle", className)}>
      <button
        ref={botao}
        type="button"
        aria-label={rotulo ? `Ajuda: ${rotulo}` : "Mais informações"}
        aria-describedby={montada ? id : undefined}
        aria-expanded={aberta}
        data-dica
        onPointerEnter={(e) => { if (e.pointerType === "mouse") setAberta(true); }}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") fechar(); }}
        onPointerDown={(e) => { ponteiro.current = e.pointerType; }}
        onFocus={() => { if (!ponteiro.current) setAberta(true); }}
        onBlur={() => { ponteiro.current = null; fechar(); }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const tipo = ponteiro.current;
          ponteiro.current = null;
          // Mouse: o hover já abriu, o clique não fecha. Toque ou teclado (Enter/Espaço): alterna
          setAberta((v) => tipo === "mouse" || !v);
        }}
        className="p-0.5 rounded-full text-ink-subtle hover:text-acento focus:outline-none focus-visible:ring-2 focus-visible:ring-acento/40"
      >
        <Info className="w-3.5 h-3.5" aria-hidden />
      </button>
      {montada && createPortal(
        <span
          ref={balao}
          id={id}
          role="tooltip"
          hidden={!aberta}
          style={pos}
          data-dica-texto
          className="fixed z-[80] rounded-lg bg-ink px-3 py-2 text-xs font-normal leading-relaxed text-white shadow-elevated normal-case tracking-normal text-left whitespace-normal"
        >
          {texto}
        </span>,
        document.body,
      )}
    </span>
  );
}
