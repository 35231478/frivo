"use client";

import { useEffect, useMemo, useState } from "react";
import { Handshake } from "lucide-react";
import { toast } from "@/components/ui/avisos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { InputData } from "@/components/ui/input-data";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { Dica } from "@/components/ui/dica";
import { EditorParcelas } from "@/components/financeiro/editor-parcelas";
import { cn, formatarData, formatarMoeda, LABELS_FORMA_PAGAMENTO } from "@/lib/utils";
import { PLANILHA, valorSemMoeda } from "@/lib/planilha";
import { chaveHojeBR } from "@/lib/fuso";
import type { ParcelaPlano } from "@/lib/financeiro/parcelas";
import { motivoEncargosInvalidos, motivoPlanoRenegociacao, totalRenegociacao } from "@/lib/financeiro/renegociacao";

/** O que GET /api/contas-receber/renegociar?clienteId= devolve */
export interface CobrancaRenegociavel {
  id: string; numero: string; descricao: string; status: string; dataVencimento: string | null;
  valor: number; recebido: number; saldo: number; parcelaNumero: number | null; parcelaTotal: number | null;
  /** Por que não pode entrar (null = pode) */
  motivo: string | null;
}

const num = (v: string) => (v.trim() === "" ? 0 : Number(v.replace(",", ".")));

/**
 * Renegociar: as cobranças em aberto do cliente (as marcadas vêm escolhidas), juros/multa/desconto e a
 * condição nova (à vista ou parcelado, com o mesmo editor de parcelas). Só o saldo de cada uma entra.
 */
export function RenegociarCobrancas({ clienteId, clienteNome, iniciais, onPronto, onCancelar }: {
  clienteId: string; clienteNome: string; iniciais: string[]; onPronto: () => void; onCancelar: () => void;
}) {
  const [lista, setLista] = useState<CobrancaRenegociavel[] | null>(null);
  const [escolhidas, setEscolhidas] = useState<Set<string>>(new Set());
  const [juros, setJuros] = useState("");
  const [multa, setMulta] = useState("");
  const [desconto, setDesconto] = useState("");
  const [parcelado, setParcelado] = useState(true);
  const [vencimento, setVencimento] = useState(chaveHojeBR(30));
  const [plano, setPlano] = useState<ParcelaPlano[]>([]);
  const [motivoPlano, setMotivoPlano] = useState<string | null>(null);
  const [forma, setForma] = useState("");
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let vivo = true;
    fetch(`/api/contas-receber/renegociar?clienteId=${encodeURIComponent(clienteId)}`).then((r) => (r.ok ? r.json() : [])).catch(() => [])
      .then((d: CobrancaRenegociavel[]) => {
        if (!vivo) return;
        setLista(d);
        setEscolhidas(new Set(d.filter((c) => !c.motivo && iniciais.includes(c.id)).map((c) => c.id)));
      });
    return () => { vivo = false; };
  }, [clienteId]); // eslint-disable-line react-hooks/exhaustive-deps

  const marcadas = useMemo(() => (lista ?? []).filter((c) => escolhidas.has(c.id)), [lista, escolhidas]);
  const enc = { juros: num(juros), multa: num(multa), desconto: num(desconto) };
  const { saldo, total } = totalRenegociacao(marcadas.map((c) => c.saldo), enc);
  const invEnc = marcadas.length ? motivoEncargosInvalidos(saldo, enc) : null;
  const planoFinal: ParcelaPlano[] = parcelado ? plano : [{ vencimento, valor: total }];
  const invPlano = parcelado ? motivoPlano : motivoPlanoRenegociacao(total, planoFinal);
  const invalido = !marcadas.length ? "Escolha pelo menos uma cobrança." : invEnc ?? invPlano;

  const alternar = (id: string) => setEscolhidas((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function renegociar() {
    if (invalido) { setErro(invalido); return; }
    setErro(""); setSalvando(true);
    try {
      const res = await fetch("/api/contas-receber/renegociar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contaIds: marcadas.map((c) => c.id), juros: enc.juros, multa: enc.multa, desconto: enc.desconto,
          parcelas: planoFinal, formaPagamento: forma || null, observacao: observacao.trim() || null,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d.erro ?? "Não foi possível renegociar."); return; }
      toast(`Renegociação ${d.numero} criada: ${formatarMoeda(d.total)}${planoFinal.length > 1 ? ` em ${planoFinal.length} parcelas` : ""}.`, "sucesso");
      onPronto();
    } catch { setErro("Sem conexão. Tente novamente."); } finally { setSalvando(false); }
  }

  const linhaResumo = (rotulo: string, v: number, sinal = "", destaque = false, id?: string) => (
    <div className={cn("flex justify-between gap-3", destaque && "border-t border-surface-border pt-1 font-semibold text-ink")} data-resumo-reneg={id}>
      <dt className={destaque ? "" : "text-ink-muted"}>{rotulo}</dt><dd className="tabular-nums">{sinal}{formatarMoeda(v)}</dd>
    </div>
  );

  return (
    <div className="space-y-4" data-renegociar>
      {erro && <div role="alert" className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2" data-erro-conta>{erro}</div>}
      <p className="text-sm text-ink-muted">
        <strong className="text-ink">{clienteNome}</strong> · escolha as cobranças. Só o que falta de cada uma entra.
        {" "}<Dica rotulo="Renegociar" texto="As cobranças escolhidas viram uma conta nova (à vista ou parcelada) e ficam como “Renegociada”. O que já foi recebido nelas continua recebido. Juros e multa são receita financeira; o desconto é desconto concedido — não entram no faturamento." />
      </p>

      {lista === null ? <p className="text-sm text-ink-muted" data-carregando-renegociaveis>Carregando cobranças…</p> : lista.length === 0 ? (
        <p className="text-sm text-ink-muted" data-sem-renegociaveis>Nenhuma cobrança em aberto deste cliente.</p>
      ) : (
        <div className="border border-surface-border rounded-lg overflow-hidden max-h-64 overflow-y-auto">
          <table className={cn(PLANILHA.tabela, "table-fixed")} data-tabela-renegociaveis>
            <thead className="sticky top-0">
              <tr className={PLANILHA.cabecalho}>
                <th scope="col" className={cn(PLANILHA.th, "w-8")}><span className="sr-only">Escolher</span></th>
                <th scope="col" className={cn(PLANILHA.th, "text-left")}>Cobrança</th>
                <th scope="col" className={cn(PLANILHA.th, "text-left w-[5.5rem] hidden sm:table-cell")}>Vencimento</th>
                <th scope="col" className={cn(PLANILHA.th, "text-right w-[6.5rem] hidden sm:table-cell")}>Recebido (R$)</th>
                <th scope="col" className={cn(PLANILHA.th, "text-right w-[6.5rem]")}>Falta (R$)</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.id} className={cn(PLANILHA.linha, c.motivo && "opacity-60", escolhidas.has(c.id) && "bg-primary-50/60")} data-renegociavel={c.id}>
                  <td className={cn(PLANILHA.td, "align-middle")}>
                    <input type="checkbox" className="w-4 h-4 accent-acento" checked={escolhidas.has(c.id)} disabled={!!c.motivo} onChange={() => alternar(c.id)}
                      aria-label={`Escolher ${c.numero}`} data-escolher={c.id} />
                  </td>
                  <td className={cn(PLANILHA.td, "align-middle")}>
                    <p className="font-mono text-[11px] text-ink">{c.numero}</p>
                    <p className="text-[11px] text-ink-subtle truncate" title={c.descricao}>{c.descricao}</p>
                    {c.motivo && <p className="text-[11px] text-atencao-texto" data-motivo-renegociar>{c.motivo}</p>}
                  </td>
                  <td className={cn(PLANILHA.td, "align-middle tabular-nums text-ink-muted hidden sm:table-cell")}>{c.dataVencimento ? formatarData(c.dataVencimento) : "—"}</td>
                  <td className={cn(PLANILHA.td, PLANILHA.numero, "align-middle text-ink-muted hidden sm:table-cell")}>{c.recebido > 0 ? valorSemMoeda(c.recebido) : "—"}</td>
                  <td className={cn(PLANILHA.td, PLANILHA.numero, "align-middle font-semibold text-ink")}>{valorSemMoeda(c.saldo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <FormGrid>
        <FormField label="Juros (R$)"><Input type="number" step="0.01" min="0" value={juros} onChange={(e) => setJuros(e.target.value)} placeholder="0,00" aria-label="Juros" /></FormField>
        <FormField label="Multa (R$)"><Input type="number" step="0.01" min="0" value={multa} onChange={(e) => setMulta(e.target.value)} placeholder="0,00" aria-label="Multa" /></FormField>
      </FormGrid>
      <FormGrid>
        <FormField label="Desconto (R$)"><Input type="number" step="0.01" min="0" value={desconto} onChange={(e) => setDesconto(e.target.value)} placeholder="0,00" aria-label="Desconto" /></FormField>
        <dl className="bg-surface-alt rounded-lg p-3 text-sm space-y-0.5 self-end" data-resumo-renegociacao>
          {linhaResumo(`Saldo de ${marcadas.length} ${marcadas.length === 1 ? "cobrança" : "cobranças"}`, saldo, "", false, "saldo")}
          {enc.juros > 0 && linhaResumo("Juros", enc.juros, "+ ", false, "juros")}
          {enc.multa > 0 && linhaResumo("Multa", enc.multa, "+ ", false, "multa")}
          {enc.desconto > 0 && linhaResumo("Desconto", enc.desconto, "− ", false, "desconto")}
          {linhaResumo("Total novo", total, "", true, "total")}
        </dl>
      </FormGrid>

      <div className="space-y-1.5">
        <p className="text-sm font-medium text-ink" id="rotulo-condicao-reneg">Condição</p>
        <div className="inline-flex rounded-lg border border-surface-border p-0.5 bg-surface-alt" role="radiogroup" aria-labelledby="rotulo-condicao-reneg" data-condicao>
          {([["vista", "À vista"], ["parcelado", "Parcelado"]] as const).map(([k, rotulo]) => (
            <button key={k} type="button" role="radio" aria-checked={(k === "parcelado") === parcelado} onClick={() => setParcelado(k === "parcelado")}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${(k === "parcelado") === parcelado ? "bg-white shadow-sm text-ink font-semibold" : "text-ink-muted hover:text-ink"}`} data-condicao-opcao={k}>
              {rotulo}
            </button>
          ))}
        </div>
      </div>
      {parcelado
        ? (total > 0 && marcadas.length
          ? <EditorParcelas total={total} primeiroVencimento={vencimento} onChange={(p, m) => { setPlano(p); setMotivoPlano(m); }} />
          : <p className="text-sm text-ink-muted" data-parcelar-sem-valor>Escolha as cobranças para dividir o total.</p>)
        : <FormGrid><FormField label="Vencimento" required><InputData value={vencimento} onChange={setVencimento} aria-label="Vencimento" /></FormField></FormGrid>}

      <FormGrid>
        <FormField label="Forma de pagamento">
          <Select value={forma} onChange={(e) => setForma(e.target.value)} aria-label="Forma de pagamento">
            <option value="">A mesma das cobranças</option>
            {Object.entries(LABELS_FORMA_PAGAMENTO).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </FormField>
      </FormGrid>
      <FormField label="Observação" dica="Fica na conta nova e na linha do tempo (ex.: o que foi combinado com o cliente).">
        <Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} maxLength={500} aria-label="Observação" />
      </FormField>

      {invalido && marcadas.length > 0 && <p role="alert" className="text-sm text-atrasado-texto" data-invalido-renegociacao>{invalido}</p>}
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <Button variant="secondary" onClick={onCancelar} disabled={salvando}>Voltar</Button>
        <Button loading={salvando} onClick={renegociar} disabled={!!invalido} data-confirmar-renegociar>
          <Handshake className="w-4 h-4" /> Renegociar {formatarMoeda(total)}
        </Button>
      </div>
    </div>
  );
}
