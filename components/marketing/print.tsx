import fs from "node:fs";
import path from "node:path";
import Image from "next/image";
import { Camera } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Print } from "./conteudo";

/**
 * Print do sistema na home de vendas. Cada espaço tem um NOME (PRINTS, em ./conteudo): se o arquivo
 * com esse nome existe em public/marketing/prints, entra a imagem real (next/image: tamanhos por tela,
 * WebP/AVIF, carregamento sob demanda); se não existe, fica o espaço reservado com o nome da tela e do
 * arquivo esperado. Trocar um print é só soltar o arquivo na pasta — sem mexer em código.
 *
 * A checagem é no servidor, na geração da página (estática).
 */
export const PASTA_PRINTS = path.join(process.cwd(), "public", "marketing", "prints");
const EXTENSOES = ["webp", "avif", "png", "jpg"] as const;

/** Caminho público do print, se o arquivo já foi colocado na pasta. */
export function localizarPrint(arquivo: string, pasta = PASTA_PRINTS): string | null {
  for (const ext of EXTENSOES) {
    if (fs.existsSync(path.join(pasta, `${arquivo}.${ext}`))) return `/marketing/prints/${arquivo}.${ext}`;
  }
  return null;
}

const PROPORCAO = { desktop: "aspect-[16/10]", celular: "aspect-[9/19]" } as const;

function Tela({ print, sizes, prioridade, compacto, proporcaoFixa }: { print: Print; sizes: string; prioridade?: boolean; compacto?: boolean; proporcaoFixa?: boolean }) {
  const src = localizarPrint(print.arquivo);
  if (src) {
    // Recorte da tela: a moldura segue a proporção da imagem (nas miniaturas, todas iguais)
    const recorte = print.proporcao && !proporcaoFixa ? print.proporcao : null;
    return (
      <div
        className={cn("relative w-full overflow-hidden bg-white", !recorte && PROPORCAO[print.formato])}
        style={recorte ? { aspectRatio: recorte } : undefined}
        data-print={print.arquivo}
      >
        <Image src={src} alt={print.alt} fill sizes={sizes} priority={prioridade} className="object-cover object-top" />
      </div>
    );
  }
  return (
    <div
      className={cn("relative w-full overflow-hidden bg-surface-page", PROPORCAO[print.formato])}
      data-print={print.arquivo}
      data-print-pendente
    >
      <Esqueleto formato={print.formato} />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-3 text-center">
        <span className={cn("whitespace-nowrap rounded-full bg-acento-claro font-semibold uppercase tracking-wide text-acento", compacto ? "px-1.5 py-0.5 text-[9px]" : "px-2.5 py-1 text-[11px]")}>
          Print {print.n}
        </span>
        <span className={cn("font-display font-semibold text-ink", compacto ? "text-[10px] leading-tight" : "text-sm sm:text-base")}>{print.tela}</span>
        <code className={cn("max-w-full break-all text-[10px] text-ink-muted sm:text-[11px]", compacto && "sr-only")}>{print.arquivo}.webp</code>
      </div>
    </div>
  );
}

/** Silhueta de uma tela do sistema, atrás do rótulo do espaço reservado. */
function Esqueleto({ formato }: { formato: Print["formato"] }) {
  if (formato === "celular") {
    return (
      <div className="absolute inset-0 flex flex-col gap-2 p-3 opacity-60" aria-hidden>
        <div className="h-4 w-1/2 rounded bg-surface-border" />
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-[13%] rounded-lg border border-surface-border bg-white" />)}
      </div>
    );
  }
  return (
    <div className="absolute inset-0 flex opacity-60" aria-hidden>
      <div className="h-full w-[16%] border-r border-surface-border bg-white" />
      <div className="flex flex-1 flex-col gap-[4%] p-[3%]">
        <div className="h-[7%] w-1/3 rounded bg-surface-border" />
        <div className="grid h-[22%] grid-cols-4 gap-[3%]">
          {[0, 1, 2, 3].map((i) => <div key={i} className="rounded-lg border border-surface-border bg-white" />)}
        </div>
        <div className="flex-1 rounded-lg border border-surface-border bg-white" />
      </div>
    </div>
  );
}

/**
 * Foto real (não é tela do sistema), no mesmo esquema: o arquivo com o nome certo na pasta troca o
 * espaço reservado. A proporção é a do `className` (a foto é cortada pelo centro para caber).
 */
export function Foto({ foto, sizes, className }: { foto: { arquivo: string; descricao: string; alt: string }; sizes: string; className?: string }) {
  const src = localizarPrint(foto.arquivo);
  if (src) {
    return (
      <div className={cn("relative overflow-hidden rounded-card bg-surface-page", className)} data-foto={foto.arquivo}>
        <Image src={src} alt={foto.alt} fill sizes={sizes} className="object-cover" />
      </div>
    );
  }
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-2 rounded-card border border-dashed border-surface-border bg-surface-page p-4 text-center", className)}
      data-foto={foto.arquivo}
      data-foto-pendente
    >
      <Camera className="h-6 w-6 text-ink-subtle" aria-hidden />
      <span className="font-display text-sm font-semibold text-ink sm:text-base">{foto.descricao}</span>
      <code className="text-[11px] text-ink-muted">{foto.arquivo}.jpg</code>
    </div>
  );
}

/** Print de computador numa moldura de notebook. */
export function Notebook({ print, sizes, prioridade, className }: { print: Print; sizes: string; prioridade?: boolean; className?: string }) {
  return (
    <div className={className}>
      <div className="rounded-t-xl border-[6px] border-b-0 border-ink bg-ink sm:rounded-t-2xl sm:border-[8px] sm:border-b-0">
        <div className="overflow-hidden rounded-t-md">
          <Tela print={print} sizes={sizes} prioridade={prioridade} />
        </div>
      </div>
      <div className="mx-[-4%] h-2.5 rounded-b-xl bg-previsto sm:h-3" aria-hidden />
    </div>
  );
}

/** Print de celular numa moldura de aparelho. `compacto`: o aparelho pequeno, sobreposto a outro print. */
export function Celular({ print, sizes, prioridade, compacto, className }: { print: Print; sizes: string; prioridade?: boolean; compacto?: boolean; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-[1.5rem] border-[5px] border-ink bg-ink shadow-elevated sm:rounded-[2rem] sm:border-[6px]", className)}>
      <div className="overflow-hidden rounded-[1.1rem] sm:rounded-[1.55rem]">
        <Tela print={print} sizes={sizes} prioridade={prioridade} compacto={compacto} />
      </div>
    </div>
  );
}

/** Miniatura com legenda: as telas extras de um módulo, abaixo do print principal. */
export function Miniatura({ print, sizes }: { print: Print; sizes: string }) {
  return (
    <figure data-miniatura={print.arquivo}>
      <div className="overflow-hidden rounded-lg border border-surface-border bg-white shadow-card">
        <Tela print={print} sizes={sizes} compacto proporcaoFixa />
      </div>
      <figcaption className="mt-2 text-center text-xs font-medium text-ink-muted">{print.tela}</figcaption>
    </figure>
  );
}

/** Print de computador numa janela simples (os blocos dos módulos). */
export function Janela({ print, sizes, className }: { print: Print; sizes: string; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-card border border-surface-border bg-white shadow-elevated", className)}>
      <div className="flex h-7 items-center gap-1.5 border-b border-surface-border bg-surface-page px-3" aria-hidden>
        <span className="h-2 w-2 rounded-full bg-surface-border" />
        <span className="h-2 w-2 rounded-full bg-surface-border" />
        <span className="h-2 w-2 rounded-full bg-surface-border" />
      </div>
      <Tela print={print} sizes={sizes} />
    </div>
  );
}
