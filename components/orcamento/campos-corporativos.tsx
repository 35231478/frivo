"use client";

import { useState } from "react";
import { Plus, Check, ChevronDown } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  FORMAS_PAGAMENTO, FORMA_PAGAMENTO_MAX, lerFormaPagamento, OPCAO_OUTRO, PARCELAS_MAX, PARCELAS_MIN, textoFormaPagamento, type EscolhaPagamento,
} from "@/lib/orcamentos/forma-pagamento";
import { adicionarNaoIncluso, linhasNaoIncluso, NAO_INCLUSO_SUGESTOES, NAO_INCLUSO_VISIVEIS, NORMAS } from "@/lib/orcamentos/proposta";

/** Sugestões da garantia (o campo é texto livre) */
export const GARANTIAS_SERVICO_SUGERIDAS = ["90 dias", "6 meses", "12 meses", "Sem garantia (serviço emergencial)"];
export const GARANTIAS_PECAS_SUGERIDAS = ["Conforme garantia do fabricante", "90 dias", "6 meses", "12 meses"];

/**
 * "Não incluso": texto livre (uma exclusão por linha) + sugestões rápidas que acrescentam a linha.
 * Usado no construtor do orçamento e no padrão de Configurações.
 */
export function NaoInclusoCampo({ valor, onChange, id }: { valor: string; onChange: (v: string) => void; id?: string }) {
  const [todas, setTodas] = useState(false);
  const atuais = new Set(linhasNaoIncluso(valor).map((l) => l.toLocaleLowerCase("pt-BR")));
  const sugestoes = todas ? NAO_INCLUSO_SUGESTOES : NAO_INCLUSO_SUGESTOES.slice(0, NAO_INCLUSO_VISIVEIS);
  const escondidas = NAO_INCLUSO_SUGESTOES.length - NAO_INCLUSO_VISIVEIS;
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
        {sugestoes.map((s) => {
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
        {escondidas > 0 && (
          <button
            type="button"
            onClick={() => setTodas((v) => !v)}
            aria-expanded={todas}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-acento hover:underline"
            data-mais-sugestoes-nao-incluso
          >
            {todas ? "Menos sugestões" : `Mais ${escondidas} sugestões`}
            <ChevronDown className={cn("w-3 h-3 transition-transform", todas && "rotate-180")} aria-hidden />
          </button>
        )}
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

/**
 * Forma de pagamento: escolhe UMA opção da lista (com o nº de parcelas quando é parcelado) ou
 * "Outro" para digitar. Devolve o texto que sai no documento (o mesmo campo de sempre); um texto
 * antigo que não é da lista abre como "Outro".
 */
export function FormaPagamentoCampo({ valor, onChange, id }: { valor: string; onChange: (texto: string) => void; id?: string }) {
  const [escolha, setEscolha] = useState<EscolhaPagamento>(() => lerFormaPagamento(valor));
  const opcao = FORMAS_PAGAMENTO.find((o) => o.valor === escolha.opcao);
  const mudar = (parcial: Partial<EscolhaPagamento>) => {
    const nova = { ...escolha, ...parcial };
    setEscolha(nova);
    onChange(textoFormaPagamento(nova));
  };
  return (
    <div className="space-y-2" data-forma-pagamento>
      <div className="flex gap-2">
        <Select
          id={id}
          value={escolha.opcao}
          onChange={(e) => mudar({ opcao: e.target.value })}
          className="flex-1 min-w-0"
          data-forma-pagamento-opcao
        >
          <option value="">Não informar</option>
          {FORMAS_PAGAMENTO.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}{o.parcelas ? " (2x a 12x)" : ""}</option>)}
          <option value={OPCAO_OUTRO}>Outro (digitar)</option>
        </Select>
        {opcao?.parcelas && (
          <Select
            value={String(escolha.parcelas)}
            onChange={(e) => mudar({ parcelas: Number(e.target.value) })}
            className="w-24 shrink-0"
            aria-label="Número de parcelas"
            data-forma-pagamento-parcelas
          >
            {Array.from({ length: PARCELAS_MAX - PARCELAS_MIN + 1 }, (_, i) => i + PARCELAS_MIN).map((n) => <option key={n} value={n}>{n}x</option>)}
          </Select>
        )}
      </div>
      {escolha.opcao === OPCAO_OUTRO && (
        <Input
          value={escolha.outro}
          onChange={(e) => mudar({ outro: e.target.value })}
          maxLength={FORMA_PAGAMENTO_MAX}
          placeholder="Ex.: 40% na aprovação e 60% em 30 dias"
          aria-label="Forma de pagamento (texto livre)"
          autoFocus
          data-forma-pagamento-outro
        />
      )}
    </div>
  );
}
