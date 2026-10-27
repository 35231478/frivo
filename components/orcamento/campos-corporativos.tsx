"use client";

import { Plus, Check } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { adicionarNaoIncluso, linhasNaoIncluso, NAO_INCLUSO_SUGESTOES, NORMAS } from "@/lib/orcamentos/proposta";

/** Sugestões da garantia (o campo é texto livre) */
export const GARANTIAS_SERVICO_SUGERIDAS = ["90 dias", "6 meses", "12 meses", "Sem garantia (serviço emergencial)"];
export const GARANTIAS_PECAS_SUGERIDAS = ["Conforme garantia do fabricante", "90 dias", "6 meses", "12 meses"];

/**
 * "Não incluso": texto livre (uma exclusão por linha) + sugestões rápidas que acrescentam a linha.
 * Usado no construtor do orçamento e no padrão de Configurações.
 */
export function NaoInclusoCampo({ valor, onChange, id }: { valor: string; onChange: (v: string) => void; id?: string }) {
  const atuais = new Set(linhasNaoIncluso(valor).map((l) => l.toLocaleLowerCase("pt-BR")));
  return (
    <div className="space-y-2" data-nao-incluso>
      <Textarea
        id={id}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        rows={Math.min(8, Math.max(3, valor.split("\n").length + 1))}
        maxLength={4000}
        placeholder="Uma exclusão por linha. Ex.: Obra civil"
        aria-describedby={id ? `${id}-dica` : undefined}
      />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sugestões de itens não inclusos">
        {NAO_INCLUSO_SUGESTOES.map((s) => {
          const usado = atuais.has(s.toLocaleLowerCase("pt-BR"));
          return (
            <button
              key={s}
              type="button"
              disabled={usado}
              onClick={() => onChange(adicionarNaoIncluso(valor, s))}
              data-sugestao-nao-incluso={s}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
                usado ? "border-ok/30 bg-ok-claro text-ok-texto cursor-default" : "border-surface-border bg-white text-ink-muted hover:border-acento hover:text-acento",
              )}
            >
              {usado ? <Check className="w-3 h-3" aria-hidden /> : <Plus className="w-3 h-3" aria-hidden />}
              {s}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Normas atendidas: liga/desliga cada uma (nenhuma marcada = o bloco não sai no documento). */
export function NormasCampo({ valor, onChange }: { valor: string[]; onChange: (v: string[]) => void }) {
  const marcadas = new Set(valor);
  return (
    <div className="space-y-2" role="group" aria-label="Normas atendidas" data-normas>
      {NORMAS.map((n) => {
        const ativo = marcadas.has(n.codigo);
        return (
          <label
            key={n.codigo}
            className={cn(
              "flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors",
              ativo ? "border-primary-300 bg-primary-50/60" : "border-surface-border bg-white hover:bg-surface-alt",
            )}
          >
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-primary-600"
              checked={ativo}
              onChange={() => onChange(NORMAS.map((x) => x.codigo).filter((c) => (c === n.codigo ? !ativo : marcadas.has(c))))}
              data-norma={n.codigo}
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-ink">{n.titulo}</span>
              <span className="block text-xs text-ink-muted">{n.descricao}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
