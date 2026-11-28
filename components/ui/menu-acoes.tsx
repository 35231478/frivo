"use client";

import { CAMADA } from "@/lib/ui/camadas";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Loader2, MoreVertical } from "lucide-react";
import { Dica } from "@/components/ui/dica";
import { cn } from "@/lib/utils";
import { posicaoFlutuante, type PosicaoFlutuante } from "@/lib/ui/flutuante";

const ALTURA_MENU = 300;

/**
 * Menu de ações ⋮ de uma linha: fixo na tela, em portal (nem a tabela com rolagem nem a coluna fixa o
 * cobrem); perto do rodapé abre para cima; fecha ao rolar, redimensionar, clicar fora ou Esc.
 * Os itens recebem `fechar` para fechar o menu antes de agir.
 */
export function MenuAcoes({ children, ocupado, largura = "w-60", rotulo = "Mais ações", gatilho, classeGatilho, dadosGatilho }: {
  children: (fechar: () => void) => React.ReactNode;
  /** Botão com texto no lugar do ⋮ (ex.: "Novo ▾"); sem isso, o ⋮ de sempre */
  gatilho?: React.ReactNode;
  classeGatilho?: string;
  dadosGatilho?: Record<`data-${string}`, string>;
  /** Mostra o giro no lugar do ⋮ (ação em andamento) */
  ocupado?: boolean;
  largura?: string;
  rotulo?: string;
}) {
  const [aberto, setAberto] = useState(false);
  // lib/ui/flutuante dá a posição; perto da borda esquerda (celular) o menu troca o `right` por `left`
  const [pos, setPos] = useState<(Omit<PosicaoFlutuante, "right"> & { right?: number; left?: number }) | null>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!aberto || !botao.current) return;
    // O mesmo cálculo do menu "Colunas" (lib/ui/flutuante): para baixo se couber, senão para cima; rola por dentro
    setPos(posicaoFlutuante(botao.current.getBoundingClientRect(), { largura: window.innerWidth, altura: window.innerHeight }, ALTURA_MENU));
  }, [aberto]);
  // Botão perto da borda esquerda (celular): o menu, alinhado pela direita, sairia da tela — encosta à esquerda
  useLayoutEffect(() => {
    if (!pos || pos.left != null || !menu.current) return;
    if (menu.current.getBoundingClientRect().left < 8) setPos({ ...pos, right: undefined, left: 8 });
  }, [pos]);
  useEffect(() => {
    if (!aberto) return;
    const fechar = () => setAberto(false);
    window.addEventListener("scroll", fechar, true);
    window.addEventListener("resize", fechar);
    return () => { window.removeEventListener("scroll", fechar, true); window.removeEventListener("resize", fechar); };
  }, [aberto]);
  const fechar = () => setAberto(false);
  return (
    <>
      <button ref={botao} type="button" onClick={() => setAberto((v) => !v)} aria-haspopup="menu" aria-expanded={aberto} aria-label={rotulo} title={rotulo}
        className={gatilho ? classeGatilho : "p-1.5 rounded text-ink-muted hover:text-primary-600"} data-acao="menu" {...dadosGatilho}>
        {ocupado ? <Loader2 className="w-4 h-4 animate-spin" /> : gatilho ?? <MoreVertical className="w-4 h-4" />}
      </button>
      {aberto && pos && createPortal(
        <>
          <div className={cn("fixed inset-0", CAMADA.flutuante)} onClick={fechar} />
          <div ref={menu} role="menu" style={pos} className={cn("fixed overflow-y-auto bg-white border border-surface-border rounded-lg shadow-card-hover py-1 text-left", CAMADA.flutuante, largura)} data-menu-acoes
            onKeyDown={(e) => { if (e.key === "Escape") fechar(); }}>
            {children(fechar)}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

export function SeparadorMenu() {
  return <div role="separator" className="my-1 border-t border-surface-border" />;
}

export function ItemMenu({ icone: Icone, children, onClick, href, novaAba, desabilitado, motivo, perigo, id, className }: {
  icone: React.ComponentType<{ className?: string }>; children: React.ReactNode; onClick?: () => void; href?: string; novaAba?: boolean;
  desabilitado?: boolean; motivo?: string | null; perigo?: boolean; id: string; className?: string;
}) {
  // Desabilitado vence tudo: vira texto (sem link nem clique) com o motivo na dica
  const cls = cn("flex items-center gap-2 w-full px-3 py-2 text-sm", className, desabilitado ? "text-ink-subtle cursor-not-allowed" : perigo ? "text-atrasado hover:bg-atrasado-claro" : "text-ink hover:bg-surface-alt");
  if (desabilitado) {
    return (
      <span role="menuitem" aria-disabled="true" title={motivo ?? undefined} className={cls} data-item={id} data-desabilitado="">
        <Icone className="w-3.5 h-3.5" /><span className="flex-1">{children}</span>{motivo && <Dica texto={motivo} rotulo={typeof children === "string" ? children : undefined} lado="esquerda" />}
      </span>
    );
  }
  if (href) {
    return novaAba || href.startsWith("/api/")
      ? <a role="menuitem" href={href} target={novaAba ? "_blank" : undefined} rel="noreferrer" className={cls} data-item={id}><Icone className="w-3.5 h-3.5" />{children}</a>
      : <Link role="menuitem" href={href} className={cls} data-item={id}><Icone className="w-3.5 h-3.5" />{children}</Link>;
  }
  return <button type="button" role="menuitem" onClick={onClick} className={cls} data-item={id}><Icone className="w-3.5 h-3.5" />{children}</button>;
}
