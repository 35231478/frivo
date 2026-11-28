"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Receipt, Plus, Loader2, Pencil, Trash2 } from "lucide-react";
import { cn, formatarMoeda } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { InputData } from "@/components/ui/input-data";
import { Dica } from "@/components/ui/dica";
import { confirmar, toast } from "@/components/ui/avisos";
import { BotaoFoto, Miniatura } from "@/components/tecnico/captura";
import { irPara, useTecnico } from "@/components/tecnico/contexto";
import { novoClientId } from "@/lib/tecnico/offline/motor";
import { chaveHojeBR } from "@/lib/fuso";
import {
  CATEGORIAS_DESPESA, dataDespesaValida, DESCRICAO_MAX, lerValor, NOME_CATEGORIA, PAGAMENTOS, podeCorrigirDespesa, ROTULO_SITUACAO, SEM_OS, VALOR_MAX,
  type CategoriaDespesa, type DadosDespesa, type DespesaTela, type EdicaoDespesa, type Pagamento, type SituacaoDespesa,
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
      osNumero: null, situacao: "PENDENTE" as const, motivoRecusa: null, pendente: true, fotoLocal: d.foto, atividadeFila: o.atividadeId,
      ...(o.estado === "erro" && { erroEnvio: o.erro ?? "Recusada pelo servidor." }),
    }];
  });
}

/**
 * D7 — "Minhas despesas" como fica com o que está na fila: as do aparelho + as do servidor, com as correções e as
 * exclusões aplicadas na ordem (também sem sinal). A correção/exclusão que o servidor recusou não se aplica: a linha
 * mostra o motivo (ex.: o escritório já tinha decidido).
 */
export function minhasDespesas(fila: OperacaoFila[], servidor: DespesaTela[]): DespesaTela[] {
  let lista = [...despesasDoAparelho(fila, servidor), ...servidor];
  for (const o of [...fila].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))) {
    if (o.tipo !== "despesaEditar" && o.tipo !== "despesaExcluir") continue;
    const alvo = o.dados.clientId;
    if (o.estado === "erro") {
      const erro = `${o.tipo === "despesaExcluir" ? "Exclusão" : "Correção"} não enviada: ${o.erro ?? "recusada pelo servidor."}`;
      lista = lista.map((d) => (d.clientId === alvo ? { ...d, erroCorrecao: erro } : d));
      continue;
    }
    // Já foi enviada e a lista do servidor já reflete: aplicar de novo não muda nada
    const noAparelho = o.estado !== "enviada";
    if (o.tipo === "despesaExcluir") { lista = lista.filter((d) => d.clientId !== alvo); continue; }
    const e = o.dados;
    lista = lista.map((d) => (d.clientId !== alvo ? d : {
      ...d, categoria: e.categoria, valor: e.valor, data: e.data, pagamento: e.pagamento, descricao: (e.descricao ?? "").trim() || null,
      ...(e.foto && { fotoLocal: e.foto }), ...(noAparelho && { corrigidaNoAparelho: true }),
    }));
  }
  return lista;
}

/** "Minhas despesas": as do colaborador (servidor + o que está no aparelho) e o botão de lançar. */
export function VistaDespesas() {
  const { motor, estado, config } = useTecnico();
  const [servidor, setServidor] = useState<DespesaTela[] | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [fila, setFila] = useState<OperacaoFila[]>([]);
  const [lancando, setLancando] = useState(false);
  const [corrigindo, setCorrigindo] = useState<DespesaTela | null>(null);
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
  const lista = useMemo(() => minhasDespesas(fila, servidor ?? []), [fila, servidor]);
  // D7: excluir (a sua, enquanto o escritório não decidiu) — vai pela fila, atrás do lançamento
  async function excluir(d: DespesaTela) {
    if (!motor) return;
    const ok = await confirmar({ titulo: "Excluir despesa?", mensagem: `${NOME_CATEGORIA[d.categoria]} · ${formatarMoeda(d.valor)} · ${dataBR(d.data)}`, perigo: true, confirmarTexto: "Excluir" });
    if (!ok) return;
    await motor.registrar([{ tipo: "despesaExcluir", atividadeId: d.atividadeFila ?? SEM_OS, dados: { clientId: d.clientId } }]);
    toast("Despesa excluída.");
  }

  return (
    <div className="space-y-4" data-vista="despesas">
      <button type="button" onClick={() => irPara({ ver: "perfil" })} className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-700 py-1 touch-target">
        <ArrowLeft className="w-4 h-4" /> Perfil
      </button>
      <h1 className="text-2xl font-bold text-ink flex items-center gap-2">Minhas despesas
        <Dica rotulo="Minhas despesas" texto="Despesas de campo com a foto do cupom. O escritório aprova: a paga do seu bolso vira reembolso; a paga pela empresa fica só registrada. Até o escritório decidir, você corrige ou exclui (fica registrado o que mudou)." />
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
            {d.corrigidaNoAparelho && !d.erroCorrecao && <p className="text-xs text-ink-muted" data-correcao-no-aparelho>Correção no aparelho: sobe quando houver sinal.</p>}
            {d.erroCorrecao && <p className="text-sm text-atrasado-texto" data-erro-correcao>{d.erroCorrecao}</p>}
            {podeCorrigirDespesa(d) && !d.erroCorrecao && (
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setCorrigindo(d)} data-corrigir-despesa={d.clientId}
                  className="flex-1 min-h-[44px] rounded-card border border-surface-border bg-white text-sm font-semibold text-ink inline-flex items-center justify-center gap-1.5">
                  <Pencil className="w-4 h-4" aria-hidden /> Corrigir
                </button>
                <button type="button" onClick={() => void excluir(d)} data-excluir-despesa={d.clientId}
                  className="flex-1 min-h-[44px] rounded-card border border-surface-border bg-white text-sm font-semibold text-atrasado inline-flex items-center justify-center gap-1.5">
                  <Trash2 className="w-4 h-4" aria-hidden /> Excluir
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {lancando && <ModalDespesa onFechar={() => setLancando(false)} />}
      {corrigindo && <ModalDespesa corrigir={corrigindo} onFechar={() => setCorrigindo(null)} />}
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

/** A despesa no formulário: o texto do valor como o técnico digita ("45,90") */
const valorParaCampo = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\./g, "");

/**
 * Categoria, valor, dia, como pagou, descrição e a FOTO DO CUPOM (obrigatória). Grava no aparelho.
 * D7 — `corrigir`: a mesma tela, preenchida, para corrigir a despesa que o escritório ainda não decidiu (a foto já
 * enviada vale; trocar é opcional). O dia antigo que já estava continua valendo.
 */
export function ModalDespesa({ atividadeId, osNumero, corrigir, onFechar }: { atividadeId?: string; osNumero?: string; corrigir?: DespesaTela; onFechar: () => void }) {
  const { motor } = useTecnico();
  const hoje = chaveHojeBR();
  const [categoria, setCategoria] = useState<CategoriaDespesa | null>(corrigir?.categoria ?? null);
  const [valor, setValor] = useState(corrigir ? valorParaCampo(corrigir.valor) : "");
  const [data, setData] = useState(corrigir?.data ?? hoje);
  const [pagamento, setPagamento] = useState<Pagamento | null>(corrigir?.pagamento ?? null);
  const [descricao, setDescricao] = useState(corrigir?.descricao ?? "");
  const [foto, setFoto] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const n = lerValor(valor);
  const valorOk = Number.isFinite(n) && n > 0 && n <= VALOR_MAX;
  const erroData = corrigir && data === corrigir.data ? null : dataDespesaValida(data, hoje);
  const faltaDescricao = categoria === "OUTROS" && descricao.trim().length < 3;
  // Na correção, a foto do cupom já foi (no servidor ou na fila): trocar é opcional
  const temFoto = !!foto || !!corrigir;
  const falta = faltaNaDespesa({ categoria: !!categoria, valorOk, dataOk: !erroData, pagamento: !!pagamento, descricaoOk: !faltaDescricao, foto: temFoto });
  const pronta = falta.length === 0;

  async function lancar() {
    if (!pronta || !motor) return;
    setGravando(true);
    try {
      const semSinal = typeof navigator !== "undefined" && !navigator.onLine;
      if (corrigir) {
        const dados: EdicaoDespesa = { clientId: corrigir.clientId, categoria: categoria!, valor: n, data, pagamento: pagamento!, descricao: descricao.trim(), ...(foto && { foto }) };
        await motor.registrar([{ tipo: "despesaEditar", atividadeId: corrigir.atividadeFila ?? SEM_OS, dados }]);
        toast(semSinal ? "Correção guardada no aparelho: sobe sozinha quando houver sinal." : "Despesa corrigida.");
      } else {
        const dados: DadosDespesa = { clientId: novoClientId(), categoria: categoria!, valor: n, data, pagamento: pagamento!, foto: foto!, ...(descricao.trim() && { descricao: descricao.trim() }) };
        await motor.registrar([{ tipo: "despesa", atividadeId: atividadeId ?? SEM_OS, dados }]);
        toast(semSinal ? "Despesa guardada no aparelho: sobe sozinha quando houver sinal." : "Despesa lançada.");
      }
      onFechar();
    } finally { setGravando(false); }
  }

  return (
    <Modal aberto titulo={corrigir ? "Corrigir despesa" : osNumero ? `Despesa · ${osNumero}` : "Lançar despesa"} onFechar={onFechar}>
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
          <label className="block space-y-1">
            <span className="text-sm font-semibold text-ink">Valor (R$)</span>
            <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="0,00" aria-label="Valor da despesa" data-valor-despesa-campo
              className={cn("w-full rounded-card border px-3 py-3 text-lg font-bold tabular-nums", valor && !valorOk ? "border-atrasado" : "border-surface-border")} />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-semibold text-ink">Dia</span>
            <InputData value={data} onChange={setData} aria-label="Dia da despesa" />
          </label>
        </div>
        {valor && !valorOk && <p className="text-xs text-atrasado-texto" data-valor-invalido>Informe um valor maior que zero.</p>}
        {erroData && <p className="text-xs text-atrasado-texto" data-data-invalida>{erroData}</p>}
        <div className="grid grid-cols-1 gap-2" role="radiogroup" aria-label="Como foi paga">
          {(Object.keys(PAGAMENTOS) as Pagamento[]).map((p) => (
            <button key={p} type="button" role="radio" aria-checked={pagamento === p} onClick={() => setPagamento(p)} data-pagamento={p}
              className={cn("rounded-card border-2 px-3 py-3 text-sm font-semibold text-left touch-target", pagamento === p ? "border-primary-600 bg-primary-50 text-ink" : "border-surface-border bg-white text-ink")}>
              {PAGAMENTOS[p]}
            </button>
          ))}
        </div>
        <label className="block space-y-1">
          <span className="text-sm font-semibold text-ink">Descrição{categoria === "OUTROS" ? "" : " (opcional)"}</span>
          <input value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={DESCRICAO_MAX} aria-label="Descrição da despesa" data-descricao-despesa
            className="w-full rounded-card border border-surface-border px-3 py-3 text-base" />
        </label>
        <div className="space-y-2">
          {foto ? <Miniatura src={foto} alt="foto do cupom" pendente onRemover={() => setFoto(null)} />
            : corrigir ? (
              <div className="space-y-2" data-foto-ja-enviada>
                {corrigir.fotoLocal && <Miniatura src={corrigir.fotoLocal} alt="foto do cupom" pendente />}
                <p className="text-sm text-ink-muted">{corrigir.fotoLocal ? "A foto do cupom continua esta." : "A foto do cupom já enviada continua valendo."}</p>
                <BotaoFoto rotulo="Trocar a foto do cupom" onFoto={setFoto} />
              </div>
            ) : <BotaoFoto grande rotulo="Foto do cupom" onFoto={setFoto} />}
        </div>
        <button type="button" disabled={!pronta || gravando} onClick={lancar} data-salvar-despesa
          className="w-full rounded-card bg-primary-600 text-white py-4 text-base font-bold disabled:opacity-40 touch-target">{corrigir ? "Salvar correção" : "Lançar"}</button>
        {!pronta && <p className="text-sm text-ink-muted text-center" data-falta-despesa>{textoFaltaDespesa(falta)}</p>}
      </div>
    </Modal>
  );
}
