"use client";

import { useMemo, useState } from "react";
import { Calculator, CheckCircle2, Loader2, Plus, Snowflake, Trash2 } from "lucide-react";
import { calcularAmbiente, preOrcamento, TIPOS_AMBIENTE, type TipoAmbiente } from "@/lib/leads/btu";
import { enviarLead } from "@/app/(publico)/calculadora/acao";

interface LinhaAmbiente { id: number; nome: string; tipo: TipoAmbiente; area: string; pessoas: string; solTarde: boolean }

let seq = 1;
const novoAmbiente = (): LinhaAmbiente => ({ id: seq++, nome: "", tipo: "quarto", area: "", pessoas: "2", solTarde: false });
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const INPUT = "w-full bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all";

/**
 * Calculadora de BTU pública (lead do site, sem login). Calcula a capacidade por ambiente, mostra um
 * pré-orçamento de referência e, no "Solicitar orçamento", cria o lead no Frivo (cliente origem SITE +
 * orçamento "Lead do site"). Contato obrigatório, com mensagem clara (padrão do manifesto).
 */
export function CalculadoraBtu() {
  const [ambientes, setAmbientes] = useState<LinhaAmbiente[]>([novoAmbiente()]);
  const [contato, setContato] = useState({ nome: "", whatsapp: "", email: "", cidade: "", mensagem: "" });
  const [erro, setErro] = useState<string>("");
  const [enviando, setEnviando] = useState(false);
  const [sucesso, setSucesso] = useState<{ codigo: string } | null>(null);

  const calculados = useMemo(
    () => ambientes.map((a) => calcularAmbiente({ nome: a.nome, tipo: a.tipo, areaM2: Number(a.area.replace(",", ".")) || 0, pessoas: Number(a.pessoas) || 1, solTarde: a.solTarde })),
    [ambientes],
  );
  const temArea = ambientes.some((a) => (Number(a.area.replace(",", ".")) || 0) > 0);
  const totais = useMemo(() => preOrcamento(calculados.filter((_, i) => (Number(ambientes[i].area.replace(",", ".")) || 0) > 0)), [calculados, ambientes]);
  const temComercial = ambientes.some((a) => TIPOS_AMBIENTE.find((t) => t.valor === a.tipo)?.comercial);

  const setAmb = (id: number, patch: Partial<LinhaAmbiente>) => setAmbientes((l) => l.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const setC = (patch: Partial<typeof contato>) => { setContato((c) => ({ ...c, ...patch })); setErro(""); };

  async function enviar() {
    setErro("");
    // Validação mínima: contato obrigatório, com mensagem clara
    if (contato.nome.trim().length < 3) return setErro("Informe seu nome completo.");
    if (contato.whatsapp.replace(/\D/g, "").length < 10) return setErro("Informe um WhatsApp com DDD para o retorno.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contato.email.trim())) return setErro("Informe um e-mail válido.");
    const ambientesValidos = calculados.filter((_, i) => (Number(ambientes[i].area.replace(",", ".")) || 0) > 0);
    if (ambientesValidos.length === 0) return setErro("Preencha a área de ao menos um ambiente para calcularmos a capacidade.");

    setEnviando(true);
    try {
      const r = await enviarLead({
        nome: contato.nome, whatsapp: contato.whatsapp, email: contato.email, cidade: contato.cidade,
        tipoUso: temComercial ? "Comercial" : "Residencial",
        mensagemAdicional: contato.mensagem || undefined,
        ambientes: ambientesValidos.map((a) => ({
          nome: a.nome, areaM2: a.areaM2, btuCalculado: a.btuCalculado, btuRecomendado: a.btuRecomendado,
          tipoEquipamento: a.tipoEquipamento, justificativa: a.justificativa,
        })),
        preOrcamento: totais,
      });
      if (!r.ok) { setErro(r.erro); return; }
      setSucesso({ codigo: r.codigo });
    } catch {
      setErro("Não foi possível enviar agora. Tente de novo em instantes.");
    } finally {
      setEnviando(false);
    }
  }

  if (sucesso) {
    return (
      <div className="text-center py-10" data-sucesso-lead>
        <CheckCircle2 className="w-14 h-14 text-ok mx-auto" aria-hidden />
        <h2 className="mt-4 text-xl font-bold text-ink">Pedido enviado.</h2>
        <p className="mt-2 text-sm text-ink-muted max-w-md mx-auto">
          A solicitação (nº <strong className="font-mono text-ink">{sucesso.codigo}</strong>) chegou à nossa equipe. O retorno vem pelo WhatsApp com o orçamento.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-calculadora-btu>
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-ink">
          <Calculator className="w-5 h-5 text-primary-600" aria-hidden />
          <h2 className="text-base font-semibold">1. Seus ambientes</h2>
        </div>
        {ambientes.map((a, i) => {
          const r = calculados[i];
          const temAreaLinha = (Number(a.area.replace(",", ".")) || 0) > 0;
          return (
            <div key={a.id} className="rounded-card border border-surface-border bg-white p-4 space-y-3" data-ambiente={i}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-ink-muted">Nome do ambiente</span>
                  <input className={INPUT} value={a.nome} onChange={(e) => setAmb(a.id, { nome: e.target.value })} placeholder="Ex.: Quarto do casal" data-amb-nome />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-ink-muted">Tipo</span>
                  <select className={INPUT} value={a.tipo} onChange={(e) => setAmb(a.id, { tipo: e.target.value as TipoAmbiente })} data-amb-tipo>
                    {TIPOS_AMBIENTE.map((t) => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-ink-muted">Área (m²)</span>
                  <input className={INPUT} inputMode="decimal" value={a.area} onChange={(e) => setAmb(a.id, { area: e.target.value })} placeholder="Ex.: 20" data-amb-area />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-ink-muted">Pessoas no ambiente</span>
                  <input className={INPUT} inputMode="numeric" value={a.pessoas} onChange={(e) => setAmb(a.id, { pessoas: e.target.value })} placeholder="2" data-amb-pessoas />
                </label>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex items-center gap-2 text-sm text-ink-muted cursor-pointer select-none">
                  <input type="checkbox" className="accent-primary-600" checked={a.solTarde} onChange={(e) => setAmb(a.id, { solTarde: e.target.checked })} data-amb-sol /> Pega sol à tarde
                </label>
                {ambientes.length > 1 && (
                  <button type="button" onClick={() => setAmbientes((l) => l.filter((x) => x.id !== a.id))} className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-atrasado" data-remover-ambiente={i}>
                    <Trash2 className="w-4 h-4" aria-hidden /> Excluir
                  </button>
                )}
              </div>
              {temAreaLinha && (
                <div className="rounded-lg bg-primary-50 px-3 py-2 text-sm text-primary-700 flex items-center gap-2" data-amb-resultado={i}>
                  <Snowflake className="w-4 h-4 shrink-0" aria-hidden />
                  <span>Recomendado: <strong className="tabular-nums">{r.btuRecomendado.toLocaleString("pt-BR")} BTU/h</strong> — {r.tipoEquipamento}</span>
                </div>
              )}
            </div>
          );
        })}
        <button type="button" onClick={() => setAmbientes((l) => [...l, novoAmbiente()])} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-700 hover:underline" data-adicionar-ambiente>
          <Plus className="w-4 h-4" aria-hidden /> Adicionar ambiente
        </button>
      </section>

      {temArea && (
        <section className="rounded-card border border-surface-border bg-surface-alt/50 p-4" data-pre-orcamento>
          <h2 className="text-base font-semibold text-ink">Pré-orçamento estimado (equipamentos)</h2>
          <p className="mt-1 text-2xl font-bold text-ink tabular-nums">{brl(totais.totalMin)} a {brl(totais.totalMax)}</p>
          <p className="mt-1 text-xs text-ink-muted">Instalação à parte. Valores de referência — o orçamento definitivo sai após a visita técnica.</p>
        </section>
      )}

      <section className="space-y-4">
        <div className="flex items-center gap-2 text-ink">
          <h2 className="text-base font-semibold">2. Seus dados para contato</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-muted">Nome completo *</span>
            <input className={INPUT} value={contato.nome} onChange={(e) => setC({ nome: e.target.value })} data-contato-nome />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-muted">WhatsApp (com DDD) *</span>
            <input className={INPUT} inputMode="tel" value={contato.whatsapp} onChange={(e) => setC({ whatsapp: e.target.value })} placeholder="(62) 99999-9999" data-contato-whatsapp />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-muted">E-mail *</span>
            <input className={INPUT} inputMode="email" value={contato.email} onChange={(e) => setC({ email: e.target.value })} data-contato-email />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-muted">Cidade</span>
            <input className={INPUT} value={contato.cidade} onChange={(e) => setC({ cidade: e.target.value })} data-contato-cidade />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-xs font-medium text-ink-muted">Mensagem (opcional)</span>
            <textarea className={`${INPUT} min-h-[72px]`} value={contato.mensagem} onChange={(e) => setC({ mensagem: e.target.value })} data-contato-mensagem />
          </label>
        </div>

        {erro && <p className="text-sm text-atrasado font-medium" role="alert" data-erro-lead>{erro}</p>}

        <button type="button" onClick={enviar} disabled={enviando}
          className="inline-flex items-center justify-center gap-2 w-full sm:w-auto bg-primary-500 hover:bg-primary-600 text-white font-semibold px-6 py-3 rounded-lg disabled:opacity-60 transition-colors" data-solicitar-orcamento>
          {enviando ? <><Loader2 className="w-5 h-5 animate-spin" aria-hidden /> Enviando…</> : <>Solicitar orçamento</>}
        </button>
      </section>
    </div>
  );
}
