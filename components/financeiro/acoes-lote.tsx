"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Ban, CalendarClock, CheckCircle2, ChevronUp, Layers, Loader2, XCircle } from "lucide-react";
import { cn, formatarMoeda, LABELS_FORMA_PAGAMENTO } from "@/lib/utils";
import { chaveHojeBR } from "@/lib/fuso";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { InputData } from "@/components/ui/input-data";
import { SeletorCadastro } from "@/components/cadastros/seletor-cadastro";
import {
  ACOES_LOTE, ROTULOS, motivoPedidoInvalido, resumoPagar, resumoReceber,
  type AcaoLote, type ContaPagarLote, type ContaReceberLote, type ParamsVencimento, type TipoLista,
} from "@/lib/financeiro/acoes-lote";

/**
 * "Ações em lote" das listas financeiras (padrão do Conta Azul): com linhas marcadas, um menu na
 * barra flutuante com três ações — dar como recebido/pago, alterar vencimento, cancelar. Cada uma
 * abre um modal com o formulário e o RESUMO antes de confirmar ("X serão baixadas (R$ …), Y
 * ignoradas: 1 já recebida…"), calculado com as mesmas regras do servidor (lib/financeiro/acoes-lote).
 * O servidor processa só as elegíveis, numa transação, e devolve o que fez e o que ignorou.
 */
type Lista =
  | { tipo: "receber"; contas: (ContaReceberLote & { id: string; numero: string })[] }
  | { tipo: "pagar"; contas: (ContaPagarLote & { id: string; numero: string })[] };

const ICONE: Record<AcaoLote, React.ComponentType<{ className?: string }>> = { baixar: CheckCircle2, vencimento: CalendarClock, cancelar: Ban };
const unidade = (tipo: TipoLista, n: number) => (tipo === "receber" ? (n === 1 ? "cobrança" : "cobranças") : (n === 1 ? "conta" : "contas"));

export function AcoesLote({ lista, onConcluido }: { lista: Lista; onConcluido: () => void }) {
  const [aberto, setAberto] = useState(false);
  const [acao, setAcao] = useState<AcaoLote | null>(null);
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("mousedown", fora); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [aberto]);
  const n = lista.contas.length;
  return (
    <div ref={caixa} className="relative">
      <button type="button" onClick={() => setAberto((v) => !v)} aria-haspopup="menu" aria-expanded={aberto} data-acoes-lote
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink bg-white border border-surface-border hover:bg-surface-page px-3 py-2 rounded-lg">
        <Layers className="w-4 h-4" /> Ações em lote <ChevronUp className={cn("w-3.5 h-3.5 transition-transform", aberto && "rotate-180")} />
      </button>
      {aberto && (
        <div role="menu" className="absolute bottom-full mb-2 right-0 w-60 bg-white border border-surface-border rounded-lg shadow-card-hover py-1 text-left z-10" data-menu-lote>
          {ACOES_LOTE.map((a) => {
            const Icone = ICONE[a];
            return (
              <button key={a} type="button" role="menuitem" onClick={() => { setAberto(false); setAcao(a); }} data-acao-lote={a}
                className={cn("flex items-center gap-2 w-full px-3 py-2 text-sm", a === "cancelar" ? "text-atrasado hover:bg-atrasado-claro" : "text-ink hover:bg-surface-alt")}>
                <Icone className="w-3.5 h-3.5" /> {ROTULOS[lista.tipo][a].rotulo}
              </button>
            );
          })}
        </div>
      )}
      <Modal aberto={!!acao} onFechar={() => setAcao(null)} titulo={acao ? `${ROTULOS[lista.tipo][acao].rotulo} — ${n} ${unidade(lista.tipo, n)}` : ""}>
        {acao && <ExecucaoLote lista={lista} acao={acao} onFechar={(mudou) => { setAcao(null); if (mudou) onConcluido(); }} />}
      </Modal>
    </div>
  );
}

interface Resultado { feitas: { id: string; numero: string; detalhe: string }[]; ignoradas: { id: string; numero: string; motivo: string }[]; total: number }

function ExecucaoLote({ lista, acao, onFechar }: { lista: Lista; acao: AcaoLote; onFechar: (mudou: boolean) => void }) {
  const { tipo } = lista;
  const rot = ROTULOS[tipo][acao];
  const [etapa, setEtapa] = useState<"form" | "enviando" | "resultado">("form");
  const [data, setData] = useState(chaveHojeBR());
  const [forma, setForma] = useState("");
  const [contaBancariaId, setContaBancariaId] = useState("");
  const [banco, setBanco] = useState("");
  const [modo, setModo] = useState<"data" | "dias">("data");
  const [novaData, setNovaData] = useState("");
  const [dias, setDias] = useState("30");
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState("");
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const vencimento: ParamsVencimento = modo === "data" ? { modo: "data", data: novaData } : { modo: "dias", dias: Number(dias) };
  const pedido = { data, vencimento: acao === "vencimento" ? vencimento : null, motivo };
  const invalido = motivoPedidoInvalido(acao, pedido);
  // O resumo segue as mesmas regras do servidor; recalcula com o modo do vencimento (sem data + "empurrar" = ignorada)
  const resumo = useMemo(
    () => (lista.tipo === "receber" ? resumoReceber(acao, lista.contas, vencimento) : resumoPagar(acao, lista.contas, vencimento)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lista, acao, modo, dias, novaData],
  );
  const nE = resumo.elegiveis.length, nI = resumo.ignoradas.length;
  const verbo = (k: number) => (k === 1 ? rot.feito[0] : rot.feito[1]);

  async function confirmar() {
    if (invalido) { setErro(invalido); return; }
    setErro(""); setEtapa("enviando");
    try {
      const r = await fetch(`/api/contas-${tipo}/lote`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acao, ids: lista.contas.map((c) => c.id),
          ...(acao === "baixar" && { data, formaPagamento: forma || null, ...(tipo === "receber" ? { contaBancariaId: contaBancariaId || null } : { banco: banco.trim() || null }) }),
          ...(acao === "vencimento" && { vencimento }),
          ...(acao === "cancelar" && { motivo: motivo.trim() }),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.erro ?? "Não foi possível concluir."); setEtapa("form"); return; }
      setResultado(d as Resultado); setEtapa("resultado");
    } catch {
      setErro("Erro de conexão: nada foi alterado."); setEtapa("form");
    }
  }

  const Ignoradas = ({ itens }: { itens: { id: string; numero: string; motivo: string }[] }) => itens.length === 0 ? null : (
    <div className="rounded-lg border border-surface-border" data-ignoradas>
      <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-ink-muted border-b border-surface-border bg-surface-alt/60">Ignoradas — por quê</p>
      <ul className="divide-y divide-surface-border max-h-56 overflow-y-auto">
        {itens.map((i) => (
          <li key={i.id} className="px-3 py-1.5 text-sm flex flex-wrap gap-x-2" data-ignorada={i.id}>
            <span className="font-mono text-xs text-ink-muted pt-0.5">{i.numero}</span>{" "}<span className="text-ink flex-1 min-w-0">{i.motivo}</span>
          </li>
        ))}
      </ul>
    </div>
  );

  if (etapa === "resultado" && resultado) {
    const f = resultado.feitas.length, i = resultado.ignoradas.length;
    return (
      <div className="space-y-4" data-resultado-lote>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <span className="flex items-center gap-1.5 font-semibold text-success-700" data-feitas><CheckCircle2 className="w-4 h-4" /> {f} {verbo(f)}{acao === "baixar" && f > 0 && ` · ${formatarMoeda(resultado.total)}`}</span>
          <span className={cn("flex items-center gap-1.5 font-semibold", i ? "text-atencao-texto" : "text-ink-muted")} data-ignoradas-n><XCircle className="w-4 h-4" /> {i} {i === 1 ? "ignorada" : "ignoradas"}</span>
        </div>
        {f > 0 && (
          <ul className="text-xs text-ink-muted max-h-40 overflow-y-auto space-y-0.5" data-feitas-lista>
            {resultado.feitas.map((x) => <li key={x.id}><span className="font-mono">{x.numero}</span> · {x.detalhe}</li>)}
          </ul>
        )}
        <Ignoradas itens={resultado.ignoradas} />
        {acao === "baixar" && f > 0 && <p className="text-xs text-ink-muted">Cada baixa pode ser estornada conta a conta, pelo histórico dela.</p>}
        <div className="flex justify-end"><Button onClick={() => onFechar(f > 0)} data-fechar-lote>Fechar</Button></div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-form-lote={acao}>
      {erro && <div role="alert" className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2" data-erro-lote>{erro}</div>}

      {acao === "baixar" && (
        <>
          <p className="text-sm text-ink-muted">Baixa total pelo que falta em cada {unidade(tipo, 1)} (a paga em parte quita o restante). Reversível conta a conta, pelo estorno.</p>
          <FormGrid>
            <FormField label={tipo === "receber" ? "Data do recebimento" : "Data do pagamento"} required><InputData value={data} onChange={setData} aria-label="Data" /></FormField>
            <FormField label="Forma de pagamento">
              <Select value={forma} onChange={(e) => setForma(e.target.value)} aria-label="Forma de pagamento" data-forma-lote>
                <option value="">Não informada</option>
                {Object.entries(LABELS_FORMA_PAGAMENTO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </FormField>
          </FormGrid>
          {tipo === "receber"
            ? <FormField label="Conta bancária"><SeletorCadastro entidade="contas-bancarias" valor={contaBancariaId} vazio="Não informada" onChange={setContaBancariaId} nome="contaBancariaId" semCriar /></FormField>
            : <FormField label="Banco / conta"><Input value={banco} onChange={(e) => setBanco(e.target.value)} maxLength={120} placeholder="Opcional" aria-label="Banco" data-banco-lote /></FormField>}
        </>
      )}

      {acao === "vencimento" && (
        <>
          <p className="text-sm text-ink-muted">Pagas e canceladas ficam como estão. Com boleto emitido, cancele o boleto antes.</p>
          <div className="space-y-2" role="radiogroup" aria-label="Como alterar">
            <label className="flex items-start gap-2 text-sm text-ink">
              <input type="radio" name="modo-venc" checked={modo === "data"} onChange={() => setModo("data")} className="mt-1 accent-acento" data-modo-venc="data" />
              <span className="flex-1 space-y-1.5">
                <span className="font-medium">Nova data única para todas</span>
                {modo === "data" && <InputData value={novaData} onChange={setNovaData} aria-label="Nova data de vencimento" />}
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-ink">
              <input type="radio" name="modo-venc" checked={modo === "dias"} onChange={() => setModo("dias")} className="mt-1 accent-acento" data-modo-venc="dias" />
              <span className="flex-1 space-y-1.5">
                <span className="font-medium">Empurrar a partir do vencimento de cada uma</span>
                {modo === "dias" && (
                  <span className="flex items-center gap-2">
                    <Input type="number" step="1" value={dias} onChange={(e) => setDias(e.target.value)} className="w-28" aria-label="Dias" data-dias-lote /> <span className="text-ink-muted">dias (ex.: 30; negativo adianta)</span>
                  </span>
                )}
              </span>
            </label>
          </div>
        </>
      )}

      {acao === "cancelar" && (
        <>
          <p className="text-sm text-ink">As {unidade(tipo, 2)} viram <strong>canceladas</strong> e saem dos valores {tipo === "receber" ? "a receber" : "a pagar"}. O registro e o histórico ficam: é cancelamento, não exclusão.</p>
          <FormField label="Motivo" required><Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={500} placeholder="Ex.: cobrança em duplicidade" aria-label="Motivo" data-motivo-lote /></FormField>
        </>
      )}

      {/* Resumo antes de confirmar: quem entra e quem fica de fora, com o porquê */}
      <div className={cn("rounded-lg p-3 text-sm space-y-2", nE ? "bg-surface-alt" : "bg-atencao-claro")} data-resumo-lote>
        <p className="text-ink">
          <strong data-resumo-elegiveis>{nE}</strong> {nE === 1 ? "será" : "serão"} {verbo(nE)}{acao === "baixar" && nE > 0 && <> (<strong className="tabular-nums" data-resumo-total>{formatarMoeda(resumo.total)}</strong>)</>}
          {nI > 0 && <>, <strong data-resumo-ignoradas>{nI}</strong> {nI === 1 ? "ignorada" : "ignoradas"} ({resumo.porMotivo.map((m) => `${m.n} ${m.motivo.replace(/\.$/, "").replace(/^(Esta conta|Conta) /, "").toLowerCase()}`).join(" · ")})</>}
          {nI === 0 && "."}
        </p>
        <Ignoradas itens={resumo.ignoradas.map((i) => ({ id: i.id, numero: i.numero, motivo: i.motivo! }))} />
      </div>

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <Button variant="secondary" onClick={() => onFechar(false)} disabled={etapa === "enviando"}>Voltar</Button>
        <Button variant={acao === "cancelar" ? "danger" : "primary"} onClick={confirmar} disabled={nE === 0 || etapa === "enviando"} data-confirmar-lote>
          {etapa === "enviando" ? <Loader2 className="w-4 h-4 animate-spin" /> : null} {rot.rotulo} ({nE})
        </Button>
      </div>
    </div>
  );
}
