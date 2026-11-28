"use client";

import { AlertCircle, Check, CheckCheck, Clock, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { horaBR } from "@/lib/fuso";
import { estadoDaMensagem, ROTULO_ESTADO } from "@/lib/chat/regras";
import type { ComentarioTela } from "@/lib/tecnico/comentarios";

/** O "porquê" do estado, na dica do ✓ (quem leu e quando) */
function dicaEstado(m: ComentarioTela): string {
  const e = estadoDaMensagem(m);
  if (e === "lida" && m.lida) return `Lida por ${m.lida.por} às ${horaBR(m.lida.em)}`;
  if (e === "falhou") return m.falhou ?? ROTULO_ESTADO.falhou;
  if (e === "enviando") return "Enviando… (no aparelho, sobe quando houver sinal)";
  return "Enviada (ainda não lida)";
}

/**
 * UM balão da conversa (escritório e app): à direita o que é meu, à esquerda o dos outros (com o nome e de onde
 * escreveu). Foto: a miniatura, que amplia no toque. Na minha mensagem, a hora e o estado: relógio (enviando), ✓
 * (enviada), ✓✓ (lida — quem e quando na dica) ou "Não enviada" com "Tentar de novo".
 */
export function Balao({ m, mostrarAutor, onAmpliar, onTentarDeNovo }: {
  m: ComentarioTela;
  /** O nome em cima (1ª de uma sequência do mesmo autor) */
  mostrarAutor: boolean;
  onAmpliar?: (m: ComentarioTela) => void;
  onTentarDeNovo?: (m: ComentarioTela) => void;
}) {
  const estado = m.meu ? estadoDaMensagem(m) : null;
  const IconeEstado = estado === "lida" ? CheckCheck : estado === "enviada" ? Check : estado === "enviando" ? Clock : AlertCircle;
  return (
    <li className={cn("flex", m.meu ? "justify-end" : "justify-start")} data-mensagem={m.clientId ?? m.id ?? undefined} data-minha={m.meu || undefined}
      data-origem={m.origem} data-estado={estado ?? undefined} data-nova={m.novo || undefined}>
      <div className={cn("max-w-[85%] sm:max-w-[70%] rounded-2xl px-3 py-2 shadow-sm space-y-1",
        m.meu ? "bg-primary-50 border border-primary-200 rounded-br-md" : "bg-white border border-surface-border rounded-bl-md",
        m.novo && "ring-2 ring-acento/40", estado === "falhou" && "border-atrasado/40")}>
        {mostrarAutor && !m.meu && (
          <p className="text-xs font-semibold text-primary-700" data-autor>
            {m.autor}<span className="font-normal text-ink-muted">{m.origem === "ESCRITORIO" ? " · escritório" : m.atividade ? ` · ${m.atividade}` : " · app"}</span>
          </p>
        )}
        {m.foto && (
          <button type="button" onClick={() => onAmpliar?.(m)} disabled={!onAmpliar || !m.foto.id} aria-label="Ampliar a foto" data-foto-mensagem
            className="block overflow-hidden rounded-lg bg-surface-alt disabled:cursor-default">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={m.foto.miniatura} alt="Foto da mensagem" className="max-h-60 w-auto max-w-full object-cover" loading="lazy" />
          </button>
        )}
        {m.texto && <p className="text-sm sm:text-[15px] text-ink whitespace-pre-line break-words">{m.texto}</p>}
        <p className={cn("flex items-center justify-end gap-1 text-[11px]", estado === "falhou" ? "text-atrasado" : "text-ink-subtle")}>
          {estado === "falhou"
            ? <span data-falhou>{ROTULO_ESTADO.falhou}</span>
            : <span>{m.para && <span className="mr-1" data-para>para {m.para.split(" ")[0]} ·</span>}{m.pendente ? "" : horaBR(m.criadoEm)}</span>}
          {estado && (
            <span title={dicaEstado(m)} aria-label={dicaEstado(m)} data-estado-icone={estado}
              className={cn("inline-flex", estado === "lida" && "text-primary-600")}>
              <IconeEstado className="w-3.5 h-3.5" aria-hidden />
            </span>
          )}
        </p>
        {estado === "falhou" && onTentarDeNovo && (
          <button type="button" onClick={() => onTentarDeNovo(m)} data-tentar-de-novo
            className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 touch-target">
            <RotateCcw className="w-3.5 h-3.5" aria-hidden /> Tentar de novo
          </button>
        )}
      </div>
    </li>
  );
}
