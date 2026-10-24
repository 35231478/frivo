"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Toast e confirmação DA CASA (UX-3/Y1): um jeito só de avisar e de confirmar em todo o
 * sistema, no lugar dos alert()/confirm() nativos do navegador.
 *
 * Uso imperativo, de qualquer client component (sem provider):
 *   toast("Salvo com sucesso!");                      // sucesso (padrão)
 *   toast("Não foi possível salvar.", "erro");
 *   if (!(await confirmar({ mensagem: "Cancelar esta conta?" }))) return;
 *
 * O <Avisos /> é montado UMA vez por layout (dashboard — que também cobre o app do
 * técnico — e portal). Sem host montado, confirmar() cai no confirm() nativo para
 * nunca travar um fluxo.
 */

export type TipoToast = "sucesso" | "erro" | "info";
interface ItemToast { id: number; mensagem: string; tipo: TipoToast }
export interface OpcoesConfirmar {
  mensagem: string;
  titulo?: string;
  /** Texto do botão que confirma (padrão: "Confirmar"). */
  confirmarTexto?: string;
  cancelarTexto?: string;
  /** Ação destrutiva: botão vermelho. */
  perigo?: boolean;
}
interface PedidoConfirmar extends OpcoesConfirmar { resolver: (ok: boolean) => void }

let proximoId = 1;
const estado: { toasts: ItemToast[]; confirmacao: PedidoConfirmar | null } = { toasts: [], confirmacao: null };
const ouvintes = new Set<() => void>();
let hosts = 0;
const avisar = () => ouvintes.forEach((f) => f());

/** Mostra um toast no canto da tela (some sozinho; "erro" fica mais tempo). */
export function toast(mensagem: string, tipo: TipoToast = "sucesso") {
  const id = proximoId++;
  estado.toasts = [...estado.toasts, { id, mensagem, tipo }];
  avisar();
  setTimeout(() => {
    estado.toasts = estado.toasts.filter((t) => t.id !== id);
    avisar();
  }, tipo === "erro" ? 7000 : 4000);
}

/** Confirmação no padrão da casa. Resolve true (confirmou) ou false (cancelou/fechou). */
export function confirmar(opcoes: OpcoesConfirmar | string): Promise<boolean> {
  const o = typeof opcoes === "string" ? { mensagem: opcoes } : opcoes;
  // Sem host (tela fora dos layouts): não trava o fluxo — usa o nativo
  if (hosts === 0) return Promise.resolve(window.confirm(o.mensagem));
  return new Promise((resolver) => {
    // Um pedido por vez: um novo cancela o anterior (não deveria acontecer)
    estado.confirmacao?.resolver(false);
    estado.confirmacao = { ...o, resolver };
    avisar();
  });
}

function responder(ok: boolean) {
  estado.confirmacao?.resolver(ok);
  estado.confirmacao = null;
  avisar();
}

const ICONE: Record<TipoToast, typeof CheckCircle2> = { sucesso: CheckCircle2, erro: XCircle, info: Info };
const COR: Record<TipoToast, string> = {
  sucesso: "bg-success-600 text-white",
  erro: "bg-atrasado text-white",
  info: "bg-ink text-white",
};

/** Host dos toasts e da confirmação — montar UMA vez por layout. */
export function Avisos() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const f = () => setTick((n) => n + 1);
    ouvintes.add(f);
    hosts++;
    return () => { ouvintes.delete(f); hosts--; };
  }, []);

  const c = estado.confirmacao;
  useEffect(() => {
    if (!c) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") responder(false); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [c]);

  return (
    <>
      {/* Toasts */}
      <div className="fixed top-5 right-5 z-[90] flex flex-col gap-2 items-end pointer-events-none" aria-live="polite" data-toasts>
        {estado.toasts.map((t) => {
          const Icone = ICONE[t.tipo];
          return (
            <div key={t.id} role="status" data-toast={t.tipo}
              className={cn("pointer-events-auto flex items-start gap-2 max-w-sm text-sm font-medium rounded-card px-4 py-3 shadow-card-hover animate-in fade-in slide-in-from-top-2", COR[t.tipo])}>
              <Icone className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="whitespace-pre-wrap">{t.mensagem}</span>
              <button type="button" aria-label="Fechar" className="opacity-70 hover:opacity-100 shrink-0"
                onClick={() => { estado.toasts = estado.toasts.filter((x) => x.id !== t.id); avisar(); }}>
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Confirmação */}
      {c && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center p-4" role="dialog" aria-modal="true" data-confirmacao>
          <div className="absolute inset-0 bg-black/50" onClick={() => responder(false)} />
          <div className="relative bg-white rounded-card shadow-card-hover w-full max-w-md p-5 space-y-4 text-left whitespace-normal">
            <div className="flex items-start gap-3">
              <span className={cn("w-9 h-9 rounded-full flex items-center justify-center shrink-0", c.perigo ? "bg-atrasado-claro text-atrasado" : "bg-primary-50 text-primary-600")}>
                {c.perigo ? <AlertTriangle className="w-5 h-5" /> : <Info className="w-5 h-5" />}
              </span>
              <div className="min-w-0 space-y-1">
                <h3 className="text-base font-bold text-ink">{c.titulo ?? "Confirmar"}</h3>
                <p className="text-sm text-ink-muted whitespace-pre-wrap">{c.mensagem}</p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" data-confirmar-nao onClick={() => responder(false)}
                className="px-4 py-2.5 text-sm font-medium rounded-lg border border-surface-border text-ink hover:bg-surface-alt">
                {c.cancelarTexto ?? "Cancelar"}
              </button>
              <button type="button" autoFocus data-confirmar-sim onClick={() => responder(true)}
                className={cn("px-4 py-2.5 text-sm font-semibold rounded-lg text-white",
                  c.perigo ? "bg-atrasado hover:brightness-95" : "bg-primary-500 hover:bg-primary-600")}>
                {c.confirmarTexto ?? "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
