import fs from "node:fs";
import path from "node:path";
import Image from "next/image";
import { cn } from "@/lib/utils";
import type { Print } from "./conteudo";

/**
 * Print do sistema na home de vendas. Cada lugar tem um NOME (PRINTS, em ./conteudo) e mostra o
 * arquivo com esse nome em public/marketing/prints (next/image: tamanho por tela, WebP/AVIF, sob
 * demanda). Sem o arquivo, a moldura não aparece — nunca um espaço reservado no ar; o teste da página
 * exige que todos existam. Os arquivos saem de `npm run prints:vendas`.
 *
 * A checagem é no servidor, na geração da página (estática).
 */
export const PASTA_PRINTS = path.join(process.cwd(), "public", "marketing", "prints");
const EXTENSOES = ["webp", "avif", "png", "jpg"] as const;

/** Caminho público do arquivo, se ele está na pasta. */
export function localizarPrint(arquivo: string, pasta = PASTA_PRINTS): string | null {
  for (const ext of EXTENSOES) {
    if (fs.existsSync(path.join(pasta, `${arquivo}.${ext}`))) return `/marketing/prints/${arquivo}.${ext}`;
  }
  return null;
}

const PROPORCAO = { desktop: "aspect-[16/10]", celular: "aspect-[9/19]" } as const;

function Tela({ print, src, sizes, prioridade }: { print: Print; src: string; sizes: string; prioridade?: boolean }) {
  return (
    <div className={cn("relative w-full overflow-hidden bg-white", PROPORCAO[print.formato])} data-print={print.arquivo}>
      <Image src={src} alt={print.alt} fill sizes={sizes} priority={prioridade} className="object-cover object-top" />
    </div>
  );
}

/** Foto real (não é tela do sistema): só aparece com o arquivo na pasta. A proporção é a do `className`. */
export function Foto({ foto, sizes, className }: { foto: { arquivo: string; alt: string }; sizes: string; className?: string }) {
  const src = localizarPrint(foto.arquivo);
  if (!src) return null;
  return (
    <div className={cn("relative overflow-hidden rounded-card bg-surface-page", className)} data-foto={foto.arquivo}>
      <Image src={src} alt={foto.alt} fill sizes={sizes} className="object-cover" />
    </div>
  );
}

/** Print de computador numa moldura de notebook. */
export function Notebook({ print, sizes, prioridade, className }: { print: Print; sizes: string; prioridade?: boolean; className?: string }) {
  const src = localizarPrint(print.arquivo);
  if (!src) return null;
  return (
    <div className={className}>
      <div className="rounded-t-xl border-[6px] border-b-0 border-ink bg-ink sm:rounded-t-2xl sm:border-[8px] sm:border-b-0">
        <div className="overflow-hidden rounded-t-md">
          <Tela print={print} src={src} sizes={sizes} prioridade={prioridade} />
        </div>
      </div>
      <div className="mx-[-4%] h-2.5 rounded-b-xl bg-previsto sm:h-3" aria-hidden />
    </div>
  );
}

/** Print de celular numa moldura de aparelho. */
export function Celular({ print, sizes, prioridade, className }: { print: Print; sizes: string; prioridade?: boolean; className?: string }) {
  const src = localizarPrint(print.arquivo);
  if (!src) return null;
  return (
    <div className={cn("overflow-hidden rounded-[1.5rem] border-[5px] border-ink bg-ink shadow-elevated sm:rounded-[2rem] sm:border-[6px]", className)}>
      <div className="overflow-hidden rounded-[1.1rem] sm:rounded-[1.55rem]">
        <Tela print={print} src={src} sizes={sizes} prioridade={prioridade} />
      </div>
    </div>
  );
}

/** Miniatura com legenda: as telas extras de um módulo, abaixo do print principal. */
export function Miniatura({ print, sizes }: { print: Print; sizes: string }) {
  const src = localizarPrint(print.arquivo);
  if (!src) return null;
  return (
    <figure data-miniatura={print.arquivo}>
      <div className="overflow-hidden rounded-lg border border-surface-border bg-white shadow-card">
        <Tela print={print} src={src} sizes={sizes} />
      </div>
      <figcaption className="mt-2 text-center text-xs font-medium text-ink-muted">{print.tela}</figcaption>
    </figure>
  );
}

/** Print de computador numa janela simples (os blocos dos módulos). */
export function Janela({ print, sizes, className }: { print: Print; sizes: string; className?: string }) {
  const src = localizarPrint(print.arquivo);
  if (!src) return null;
  return (
    <div className={cn("overflow-hidden rounded-card border border-surface-border bg-white shadow-elevated", className)}>
      <div className="flex h-7 items-center gap-1.5 border-b border-surface-border bg-surface-page px-3" aria-hidden>
        <span className="h-2 w-2 rounded-full bg-surface-border" />
        <span className="h-2 w-2 rounded-full bg-surface-border" />
        <span className="h-2 w-2 rounded-full bg-surface-border" />
      </div>
      <Tela print={print} src={src} sizes={sizes} />
    </div>
  );
}
