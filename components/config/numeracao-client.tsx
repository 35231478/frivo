"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Dica } from "@/components/ui/dica";
import { cn } from "@/lib/utils";
import { PLANILHA } from "@/lib/planilha";
import { formatarNumero, minimoPermitido, NUMERO_MAXIMO, type NumeracaoTela, type TipoNumeracao } from "@/lib/numeracao";

/**
 * Numeração de documentos: uma linha por tipo com o maior número já usado e o campo "Próximo número".
 * A tela não deixa salvar um próximo igual ou abaixo do maior usado (o servidor recusa também e diz o
 * mínimo). Cada linha salva sozinha. Sem permissão de gerenciar: só leitura.
 */
export function NumeracaoClient({ inicial, podeEditar }: { inicial: NumeracaoTela[]; podeEditar: boolean }) {
  const [linhas, setLinhas] = useState(inicial);
  const [valores, setValores] = useState<Record<string, string>>(Object.fromEntries(inicial.map((n) => [n.tipo, String(n.proximo)])));
  const [salvando, setSalvando] = useState<TipoNumeracao | null>(null);
  const [msgs, setMsgs] = useState<Record<string, { tipo: "ok" | "erro"; texto: string } | undefined>>({});

  const ano = new Date().getFullYear();
  const mudar = (tipo: TipoNumeracao, v: string) => { setValores((s) => ({ ...s, [tipo]: v })); setMsgs((m) => ({ ...m, [tipo]: undefined })); };

  /** O que impede salvar esta linha agora (vazio = pode) */
  const problema = (n: NumeracaoTela): string | null => {
    const v = valores[n.tipo];
    if (!/^\d+$/.test(v ?? "")) return "Informe um número inteiro.";
    const num = Number(v);
    if (num < minimoPermitido(n.maiorUsado)) return `O mínimo permitido é ${minimoPermitido(n.maiorUsado)}${n.maiorUsado > 0 ? ` (o maior já usado é ${n.maiorUsado})` : ""}.`;
    if (num > NUMERO_MAXIMO) return `O máximo é ${NUMERO_MAXIMO.toLocaleString("pt-BR")}.`;
    return null;
  };

  async function salvar(n: NumeracaoTela) {
    const erro = problema(n);
    if (erro) { setMsgs((m) => ({ ...m, [n.tipo]: { tipo: "erro", texto: erro } })); return; }
    const proximo = Number(valores[n.tipo]);
    setSalvando(n.tipo);
    try {
      const r = await fetch("/api/configuracoes/numeracao", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipo: n.tipo, proximo }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsgs((m) => ({ ...m, [n.tipo]: { tipo: "erro", texto: j.erro ?? "Não foi possível salvar." } }));
        // O servidor sabe o mínimo de verdade (outro documento pode ter nascido enquanto isso)
        if (typeof j.minimo === "number") setLinhas((ls) => ls.map((l) => (l.tipo === n.tipo ? { ...l, maiorUsado: j.minimo - 1 } : l)));
        return;
      }
      setLinhas((ls) => ls.map((l) => (l.tipo === n.tipo ? { ...l, proximo: j.proximo, exemplo: j.exemplo, configurado: true } : l)));
      setMsgs((m) => ({ ...m, [n.tipo]: { tipo: "ok", texto: `Salvo. O próximo ${n.rotulo.toLowerCase()} sai como ${j.exemplo}.` } }));
    } catch {
      setMsgs((m) => ({ ...m, [n.tipo]: { tipo: "erro", texto: "Sem conexão. Tente de novo." } }));
    } finally { setSalvando(null); }
  }

  return (
    <div className="card overflow-hidden" data-numeracao>
      <div className="px-4 py-3 border-b border-surface-border bg-surface-alt/40 text-sm text-ink-muted">
        Defina o <strong className="text-ink">próximo número</strong> de cada documento. Nunca abaixo do maior já usado: o número nunca se repete.
      </div>
      <div className="overflow-x-auto">
        <table className={PLANILHA.tabela} data-tabela-planilha>
          <thead>
            <tr className={PLANILHA.cabecalho}>
              <th scope="col" className={cn(PLANILHA.th, "text-left")}>Documento</th>
              <th scope="col" className={cn(PLANILHA.th, "text-right sm:w-[8.5rem]")}>Maior já usado</th>
              <th scope="col" className={cn(PLANILHA.th, "text-left sm:w-[11rem] min-w-[7rem]")}>Próximo número</th>
              <th scope="col" className={cn(PLANILHA.th, "text-left w-[10rem] hidden sm:table-cell")}>Vai sair como</th>
              <th scope="col" className={cn(PLANILHA.th, "w-12 sm:w-24")}><span className="sr-only">Salvar</span></th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((n) => {
              const v = valores[n.tipo] ?? "";
              const erro = problema(n);
              const mudou = v !== String(n.proximo);
              const msg = msgs[n.tipo];
              const exemplo = /^\d+$/.test(v) ? formatarNumero(n.tipo, Number(v), ano) : "—";
              return (
                <tr key={n.tipo} className={PLANILHA.linha} data-numeracao-tipo={n.tipo}>
                  <td className={cn(PLANILHA.td, "align-middle")}>
                    <span className="inline-flex items-center gap-1.5">
                      <span className={PLANILHA.nome}>{n.rotulo}</span>
                      <span className={cn(PLANILHA.codigo, "text-ink-subtle font-normal hidden sm:inline")}>{n.prefixo}-</span>
                      <Dica texto={n.dica} rotulo={n.rotulo} />
                    </span>
                    {msg && <p className={cn("text-xs mt-1", msg.tipo === "ok" ? "text-ok-texto" : "text-atrasado")} data-msg={msg.tipo} role={msg.tipo === "erro" ? "alert" : "status"}>{msg.texto}</p>}
                    {!msg && mudou && erro && <p className="text-xs mt-1 text-atrasado" data-msg="aviso">{erro}</p>}
                  </td>
                  <td className={cn(PLANILHA.td, PLANILHA.numero, "align-middle text-ink-muted")} data-maior-usado>{n.maiorUsado > 0 ? n.maiorUsado.toLocaleString("pt-BR") : "—"}</td>
                  <td className={cn(PLANILHA.td, "align-middle")}>
                    <input
                      type="number" inputMode="numeric" min={minimoPermitido(n.maiorUsado)} max={NUMERO_MAXIMO} step={1}
                      value={v} onChange={(e) => mudar(n.tipo, e.target.value)} disabled={!podeEditar}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void salvar(n); } }}
                      aria-label={`Próximo número de ${n.rotulo.toLowerCase()}`} aria-invalid={mudou && !!erro} data-proximo={n.tipo}
                      className={cn("w-full bg-white border rounded-lg px-3 py-1.5 text-sm text-ink tabular-nums focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 disabled:bg-surface-alt",
                        mudou && erro ? "border-atrasado" : "border-surface-border")}
                    />
                    <p className="sm:hidden mt-1 text-[11px] text-ink-muted leading-tight">Sai como <span className={PLANILHA.codigo} data-exemplo-cel>{exemplo}</span></p>
                  </td>
                  <td className={cn(PLANILHA.td, "align-middle hidden sm:table-cell")}><span className={PLANILHA.codigo} data-exemplo>{exemplo}</span></td>
                  <td className={cn(PLANILHA.td, "align-middle text-right")}>
                    {podeEditar && (
                      <button
                        type="button" onClick={() => void salvar(n)} disabled={!mudou || !!erro || salvando === n.tipo} data-salvar={n.tipo}
                        className="inline-flex items-center gap-1.5 h-8 px-2.5 sm:px-3 rounded-lg text-xs font-semibold bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-40"
                      >
                        {salvando === n.tipo ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Check className="w-3.5 h-3.5" aria-hidden />} <span className="hidden sm:inline">Salvar</span><span className="sr-only sm:hidden">Salvar</span>
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
