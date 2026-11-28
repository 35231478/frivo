"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Receipt, Plus, Loader2 } from "lucide-react";
import { cn, formatarMoeda } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { InputData } from "@/components/ui/input-data";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Dica } from "@/components/ui/dica";
import { toast } from "@/components/ui/avisos";
import { BotaoFoto, Miniatura } from "@/components/tecnico/captura";
import { irPara, useTecnico } from "@/components/tecnico/contexto";
import { novoClientId } from "@/lib/tecnico/offline/motor";
import { chaveHojeBR } from "@/lib/fuso";
import {
  CATEGORIAS_DESPESA, dataDespesaValida, DESCRICAO_MAX, lerValor, NOME_CATEGORIA, PAGAMENTOS, ROTULO_SITUACAO, SEM_OS, VALOR_MAX,
  type CategoriaDespesa, type DadosDespesa, type DespesaTela, type Pagamento, type SituacaoDespesa,
  faltaNaDespesa, textoFaltaDespesa,
} from "@/lib/tecnico/despesas";
import type { OperacaoFila } from "@/lib/tecnico/offline/tipos";

const CLASSE_SITUACAO: Record<SituacaoDespesa, string> = {
  PENDENTE: "bg-atencao-claro text-atencao-texto", APROVADA: "bg-success-100 text-success-700", REEMBOLSADA: "bg-success-100 text-success-700", RECUSADA: "bg-atrasado-claro text-atrasado-texto",
};
const dataBR = (dia: string) => dia.split("-").reverse().join("/");

/** O que ainda está no aparelho vira linha "no aparelho" (some quando a lista do servidor já tem o mesmo clientId). */
export function despesasDoAparelho(fila: OperacaoFila[], servidor: DespesaTela[]): DespesaTela[] {
  const ja = new Set(servidor.map((d) => d.clientId));
  return fila.flatMap((o) => {
    if (o.tipo !== "despesa" || ja.has(o.dados.clientId)) return [];
    const d = o.dados;
    return [{
      id: null, clientId: d.clientId, categoria: d.categoria, valor: d.valor, data: d.data, pagamento: d.pagamento, descricao: d.descricao ?? null,
      osNumero: null, situacao: "PENDENTE" as const, motivoRecusa: null, pendente: true, fotoLocal: d.foto,
      ...(o.estado === "erro" && { erroEnvio: o.erro ?? "Recusada pelo servidor." }),
    }];
  });
}

/** "Minhas despesas": as do colaborador (servidor + o que está no aparelho) e o botão de lançar. */
export function VistaDespesas() {
  const { motor, estado, config } = useTecnico();
  const [servidor, setServidor] = useState<DespesaTela[] | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [fila, setFila] = useState<OperacaoFila[]>([]);
  const [lancando, setLancando] = useState(false);
  useEffect(() => {
    if (!motor) return;
    let vivo = true;
    void motor.baixarLista<{ despesas: DespesaTela[]; aviso?: string }>("despesas", "/api/tecnico/despesas").then((r) => {
      if (!vivo) return;
      setServidor(r.dados?.despesas ?? []); setAviso(r.dados?.aviso ?? null);
    });
    return () => { vivo = false; };
  }, [motor, estado.versao]);
  useEffect(() => { motor?.banco.fila().then(setFila); }, [motor, estado.versao]);
  const lista = useMemo(() => [...despesasDoAparelho(fila, servidor ?? []), ...(servidor ?? [])], [fila, servidor]);

  return (
    <div className="space-y-4" data-vista="despesas">
      <button type="button" onClick={() => irPara({ ver: "perfil" })} className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-700 py-1 touch-target">
        <ArrowLeft className="w-4 h-4" /> Perfil
      </button>
      <h1 className="text-2xl font-bold text-ink flex items-center gap-2">Minhas despesas
        <Dica rotulo="Minhas despesas" texto="Despesas de campo com a foto do cupom. O escritório aprova: a paga do seu bolso vira reembolso; a paga pela empresa fica só registrada." />
      </h1>
      {aviso && <p className="rounded-card bg-atencao-claro p-3 text-sm text-atencao-texto" data-aviso-despesas>{aviso}</p>}
      {config.lancarDespesas && !aviso && (
        <button type="button" onClick={() => setLancando(true)} data-lancar-despesa
          className="w-full rounded-card bg-primary-600 text-white py-4 text-base font-bold inline-flex items-center justify-center gap-2 touch-target">
          <Plus className="w-5 h-5" /> Lançar despesa
        </button>
      )}
      {servidor === null && <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-ink-subtle" /></div>}
      {servidor !== null && !lista.length && <p className="rounded-card bg-white border border-surface-border p-4 text-sm text-ink-muted" data-sem-despesas>Nenhuma despesa nos últimos 90 dias.</p>}
      <ul className="space-y-2">
        {lista.map((d) => (
          <li key={d.clientId} className="rounded-card bg-white border border-surface-border p-3 space-y-1" data-despesa={d.situacao} data-pendente={d.pendente || undefined}>
            <div className="flex items-start justify-between gap-2">
              <span className="font-semibold text-ink">{NOME_CATEGORIA[d.categoria]}</span>
              <span className="text-base font-bold text-ink tabular-nums" data-valor-despesa>{formatarMoeda(d.valor)}</span>
            </div>
            <p className="text-xs text-ink-muted">{[dataBR(d.data), d.osNumero, PAGAMENTOS[d.pagamento], d.descricao].filter(Boolean).join(" · ")}</p>
            <span className={cn("inline-block text-xs font-semibold rounded-full px-2 py-0.5", d.erroEnvio ? CLASSE_SITUACAO.RECUSADA : CLASSE_SITUACAO[d.situacao])} data-situacao-despesa={d.erroEnvio ? "NAO_ENVIADA" : d.situacao}>
              {d.erroEnvio ? "Não enviada" : d.pendente ? "No aparelho" : ROTULO_SITUACAO[d.situacao]}
            </span>
            {d.erroEnvio && <p className="text-sm text-atrasado-texto" data-erro-envio>{d.erroEnvio}</p>}
            {d.situacao === "RECUSADA" && d.motivoRecusa && <p className="text-sm text-atrasado-texto" data-motivo-recusa>Motivo: {d.motivoRecusa}</p>}
          </li>
        ))}
      </ul>
      {lancando && <ModalDespesa onFechar={() => setLancando(false)} />}
    </div>
  );
}

/** O botão que abre o lançamento (no Meu dia e na OS); some com a permissão desligada. */
export function BotaoLancarDespesa({ atividadeId, osNumero, className }: { atividadeId?: string; osNumero?: string; className?: string }) {
  const { config } = useTecnico();
  const [aberto, setAberto] = useState(false);
  if (!config.lancarDespesas) return null;
  return (
    <>
      <button type="button" onClick={() => setAberto(true)} data-lancar-despesa={atividadeId ?? SEM_OS}
        className={cn("w-full rounded-card border border-surface-border bg-white text-ink py-3 text-sm font-semibold inline-flex items-center justify-center gap-2 touch-target", className)}>
        <Receipt className="w-5 h-5" /> {atividadeId ? "Lançar despesa desta OS" : "Lançar despesa"}
      </button>
      {aberto && <ModalDespesa atividadeId={atividadeId} osNumero={osNumero} onFechar={() => setAberto(false)} />}
    </>
  );
}

/** Categoria, valor, dia, como pagou, descrição e a FOTO DO CUPOM (obrigatória). Grava no aparelho. */
export function ModalDespesa({ atividadeId, osNumero, onFechar }: { atividadeId?: string; osNumero?: string; onFechar: () => void }) {
  const { motor } = useTecnico();
  const hoje = chaveHojeBR();
  const [categoria, setCategoria] = useState<CategoriaDespesa | null>(null);
  const [valor, setValor] = useState("");
  const [data, setData] = useState(hoje);
  const [pagamento, setPagamento] = useState<Pagamento | null>(null);
  const [descricao, setDescricao] = useState("");
  const [foto, setFoto] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  // ERRO NO CAMPO: o valor só acusa depois que a pessoa sai do campo (nunca enquanto digita pela 1ª vez)
  const [saiuDoValor, setSaiuDoValor] = useState(false);
  const n = lerValor(valor);
  const valorOk = Number.isFinite(n) && n > 0 && n <= VALOR_MAX;
  const erroData = dataDespesaValida(data, hoje);
  const faltaDescricao = categoria === "OUTROS" && descricao.trim().length < 3;
  const falta = faltaNaDespesa({ categoria: !!categoria, valorOk, dataOk: !erroData, pagamento: !!pagamento, descricaoOk: !faltaDescricao, foto: !!foto });
  const pronta = falta.length === 0;

  async function lancar() {
    if (!pronta || !motor) return;
    setGravando(true);
    try {
      const dados: DadosDespesa = { clientId: novoClientId(), categoria: categoria!, valor: n, data, pagamento: pagamento!, foto: foto!, ...(descricao.trim() && { descricao: descricao.trim() }) };
      await motor.registrar([{ tipo: "despesa", atividadeId: atividadeId ?? SEM_OS, dados }]);
      toast(typeof navigator !== "undefined" && !navigator.onLine ? "Despesa guardada no aparelho: sobe sozinha quando houver sinal." : "Despesa lançada.");
      onFechar();
    } finally { setGravando(false); }
  }

  return (
    <Modal aberto titulo={osNumero ? `Despesa · ${osNumero}` : "Lançar despesa"} onFechar={onFechar}>
      <div className="space-y-4" data-modal-despesa>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Categoria">
          {CATEGORIAS_DESPESA.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={categoria === c.id} onClick={() => setCategoria(c.id)} data-categoria={c.id}
              className={cn("rounded-card border-2 px-2 py-3 text-sm font-semibold touch-target", categoria === c.id ? "border-primary-600 bg-primary-50 text-ink" : "border-surface-border bg-white text-ink", c.id === "MATERIAL" && "col-span-2")}>
              {c.nome}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <FormField label="Valor (R$)" name="valor" error={saiuDoValor && valor && !valorOk ? "Informe um valor maior que zero." : undefined}>
            <Input value={valor} onChange={(e) => setValor(e.target.value)} onBlur={() => setSaiuDoValor(true)} inputMode="decimal" placeholder="0,00" aria-label="Valor da despesa" data-valor-despesa-campo
              className="rounded-card py-3 text-lg font-bold tabular-nums min-h-[44px]" />
          </FormField>
          <FormField label="Dia" name="data" error={erroData ?? undefined}>
            <InputData value={data} onChange={setData} aria-label="Dia da despesa" />
          </FormField>
        </div>
        <div className="grid grid-cols-1 gap-2" role="radiogroup" aria-label="Como foi paga">
          {(Object.keys(PAGAMENTOS) as Pagamento[]).map((p) => (
            <button key={p} type="button" role="radio" aria-checked={pagamento === p} onClick={() => setPagamento(p)} data-pagamento={p}
              className={cn("rounded-card border-2 px-3 py-3 text-sm font-semibold text-left touch-target", pagamento === p ? "border-primary-600 bg-primary-50 text-ink" : "border-surface-border bg-white text-ink")}>
              {PAGAMENTOS[p]}
            </button>
          ))}
        </div>
        <FormField label={`Descrição${categoria === "OUTROS" ? "" : " (opcional)"}`} name="descricao">
          <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={DESCRICAO_MAX} aria-label="Descrição da despesa" data-descricao-despesa
            className="rounded-card py-3 text-base min-h-[44px]" />
        </FormField>
        <div className="space-y-2">
          {foto ? <Miniatura src={foto} alt="foto do cupom" pendente onRemover={() => setFoto(null)} />
            : <BotaoFoto grande rotulo="Foto do cupom" onFoto={setFoto} />}
        </div>
        <button type="button" disabled={!pronta || gravando} onClick={lancar} data-salvar-despesa
          className="w-full rounded-card bg-primary-600 text-white py-4 text-base font-bold disabled:opacity-40 touch-target">Lançar</button>
        {!pronta && <p className="text-sm text-ink-muted text-center" data-falta-despesa>{textoFaltaDespesa(falta)}</p>}
      </div>
    </Modal>
  );
}
