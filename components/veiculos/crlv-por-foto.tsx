"use client";

import { useRef, useState } from "react";
import {
  AlertTriangle, Camera, CheckCircle2, FileText, ImagePlus, Keyboard, Loader2, RotateCcw, ShieldAlert, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { reduzirImagem, type QualidadeImagem } from "@/lib/imagem-cliente";
import { CAMPOS_CRLV, CAMPOS_CRLV_CADASTRO, COMBUSTIVEIS, type CampoCrlv } from "@/lib/veiculo-campos";

export type DadosCrlv = Partial<Record<CampoCrlv, string>> & { registrarCrlv?: boolean };

const TIPOS: Record<string, string> = { CARRO: "Carro", VAN: "Van", MOTO: "Moto", CAMINHAO: "Caminhão", OUTRO: "Outro" };

type Etapa = "inicio" | "lendo" | "conferencia" | "aplicado";

async function lerCrlvComIa(imagem: string): Promise<{ ok: true; dados: any } | { ok: false; erro: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 50_000);
  try {
    const res = await fetch("/api/veiculos/ocr", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imagem }), signal: ctrl.signal,
    });
    const dados = await res.json().catch(() => null);
    if (!res.ok || !dados) return { ok: false, erro: dados?.erro ?? "A leitura automática não respondeu." };
    return { ok: true, dados };
  } catch (e: any) {
    return { ok: false, erro: e?.name === "AbortError" ? "A leitura demorou demais (tempo esgotado)." : "Sem conexão com o servidor." };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * "Preencher com foto do documento": a pessoa fotografa o CRLV, a IA lê os dados do
 * VEÍCULO e eles só vão para o formulário depois da CONFERÊNCIA (corrigir/confirmar).
 * A foto do documento não é guardada no sistema. Qualquer falha cai para a digitação.
 */
export function CrlvPorFoto({ onAplicar, onConferindo, compacto }: {
  onAplicar: (d: DadosCrlv) => void;
  /** Avisa quando a conferência abre/fecha (o cadastro esconde o formulário manual enquanto isso). */
  onConferindo?: (conferindo: boolean) => void;
  compacto?: boolean;
}) {
  const [etapa, setEtapaInterna] = useState<Etapa>("inicio");
  const setEtapa = (e: Etapa) => { setEtapaInterna(e); onConferindo?.(e === "conferencia"); };
  const [foto, setFoto] = useState<string | null>(null);
  const [qualidade, setQualidade] = useState<QualidadeImagem | null>(null);
  const [erro, setErro] = useState("");
  const [valores, setValores] = useState<Record<CampoCrlv, string>>(() => Object.fromEntries(CAMPOS_CRLV.map((c) => [c, ""])) as Record<CampoCrlv, string>);
  const [duvidosos, setDuvidosos] = useState<Set<CampoCrlv>>(new Set());
  const [lidos, setLidos] = useState<Set<CampoCrlv>>(new Set());
  const [registrarCrlv, setRegistrarCrlv] = useState(true);
  const camera = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);

  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    setErro(""); setEtapa("lendo");
    let imagem: string;
    try {
      // Documento: um pouco mais de resolução que a foto do veículo, para os dígitos do chassi/RENAVAM
      const r = await reduzirImagem(file, 1800, 0.85);
      imagem = r.imagem.dataUrl; setFoto(imagem); setQualidade(r.qualidade);
    } catch {
      setErro("Não foi possível abrir esta imagem. Tente outra foto ou preencha manualmente.");
      setEtapa("inicio"); return;
    }
    const r = await lerCrlvComIa(imagem);
    if (!r.ok) { setErro(`${r.erro} Preencha os campos manualmente abaixo.`); setEtapa("inicio"); return; }
    if (!r.dados.legivel) {
      setErro(`Não deu para ler o documento${r.dados.problema_imagem ? ` (${r.dados.problema_imagem})` : ""}. Tente outra foto, com o documento inteiro e sem reflexo, ou preencha manualmente.`);
      setEtapa("inicio"); return;
    }
    const campos = r.dados.campos ?? {};
    setValores(Object.fromEntries(CAMPOS_CRLV.map((c) => [c, campos[c] ?? ""])) as Record<CampoCrlv, string>);
    setLidos(new Set(CAMPOS_CRLV.filter((c) => !!campos[c])));
    setDuvidosos(new Set((r.dados.duvidosos ?? []) as CampoCrlv[]));
    setEtapa("conferencia");
  }

  function aplicar() {
    const d: DadosCrlv = {};
    for (const c of CAMPOS_CRLV) if (valores[c].trim()) d[c] = valores[c].trim();
    d.registrarCrlv = registrarCrlv && !!d.exercicio;
    onAplicar(d);
    setEtapa("aplicado");
  }

  function recomecar() {
    setFoto(null); setQualidade(null); setErro(""); setEtapa("inicio");
  }

  const inputs = (
    <>
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={escolher} aria-label="Foto do documento (câmera)" />
      <input ref={galeria} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={escolher} aria-label="Foto do documento (arquivo)" />
    </>
  );

  const privacidade = (
    <div data-aviso-privacidade className="flex items-start gap-2 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
      <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-slate-500" />
      <span>
        <strong>Privacidade:</strong> a foto do documento é enviada para a <strong>Anthropic</strong> (IA Claude), fora do Frivo, só para ler o texto, e
        <strong> não é guardada</strong> no sistema. Lemos apenas os dados do <strong>veículo</strong>: nome, CPF/CNPJ e endereço do proprietário são ignorados e nunca salvos.
      </span>
    </div>
  );

  /* ── Aplicado ── */
  if (etapa === "aplicado") {
    return (
      <div data-crlv-aplicado className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-3">
        <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
        <p className="text-sm text-emerald-900 flex-1">Dados do documento conferidos e aplicados. Revise os campos abaixo, adicione as fotos e salve.</p>
        {inputs}
        <button type="button" onClick={() => { recomecar(); camera.current?.click(); }} className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-800 hover:text-emerald-900">
          <RotateCcw className="w-4 h-4" /> Ler outro documento
        </button>
      </div>
    );
  }

  /* ── Conferência obrigatória ── */
  if (etapa === "conferencia") {
    const marcados = CAMPOS_CRLV.filter((c) => duvidosos.has(c)).length;
    return (
      <section data-conferencia-crlv className="rounded-2xl border border-primary-200 bg-white shadow-sm overflow-hidden">
        <header className="flex items-start gap-3 px-5 py-4 border-b border-surface-border bg-primary-50/40">
          <Sparkles className="w-5 h-5 text-primary-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-ink">Confira o que a IA leu do documento</h2>
            <p className="text-xs text-ink-muted mt-0.5">
              Nada foi salvo ainda. Corrija o que estiver errado e confirme para preencher o cadastro.
              {marcados > 0 && <> <strong className="text-amber-700">{marcados} campo(s) com dúvida</strong> estão destacados.</>}
            </p>
          </div>
        </header>
        <div className="p-5 grid gap-5 lg:grid-cols-[200px_1fr]">
          {foto && (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={foto} alt="Documento lido" className="w-full max-h-56 object-contain rounded-lg border border-surface-border bg-surface-alt" />
              <p className="text-[11px] text-ink-subtle">Só para conferência — esta foto não é salva.</p>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {CAMPOS_CRLV.map((c) => {
              const duv = duvidosos.has(c); const naoLido = !lidos.has(c);
              const rot = CAMPOS_CRLV_CADASTRO[c].rotulo;
              const cls = cn(duv && "border-amber-400 bg-amber-50 focus:border-amber-500");
              return (
                <label key={c} className="block" data-campo-crlv={c} data-duvidoso={duv || undefined}>
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-ink mb-1">
                    {rot}
                    {duv && <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 rounded">confira</span>}
                    {naoLido && <span className="text-[10px] font-medium text-ink-subtle">não lido</span>}
                  </span>
                  {c === "combustivel" ? (
                    <Select aria-label={rot} value={valores[c]} onChange={(e) => setValores((v) => ({ ...v, [c]: e.target.value }))} className={cls}>
                      <option value="">—</option>
                      {COMBUSTIVEIS.map((x) => <option key={x} value={x}>{x}</option>)}
                    </Select>
                  ) : c === "tipo" ? (
                    <Select aria-label={rot} value={valores[c]} onChange={(e) => setValores((v) => ({ ...v, [c]: e.target.value }))} className={cls}>
                      <option value="">—</option>
                      {Object.entries(TIPOS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </Select>
                  ) : (
                    <Input aria-label={rot} value={valores[c]} onChange={(e) => setValores((v) => ({ ...v, [c]: e.target.value }))} className={cls} />
                  )}
                </label>
              );
            })}
          </div>
        </div>
        <div className="px-5 pb-5 space-y-3">
          {valores.exercicio.trim() && (
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={registrarCrlv} onChange={(e) => setRegistrarCrlv(e.target.checked)} className="accent-primary-600" />
              Registrar &quot;CRLV {valores.exercicio.trim()}&quot; na aba Documentos (sem anexar a foto)
            </label>
          )}
          {privacidade}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button type="button" onClick={recomecar} className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border border-surface-border text-sm text-ink hover:bg-surface-alt">
              <Keyboard className="w-4 h-4" /> Descartar e digitar
            </button>
            <button type="button" onClick={aplicar} className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold">
              <CheckCircle2 className="w-4 h-4" /> Conferi, preencher cadastro
            </button>
          </div>
        </div>
      </section>
    );
  }

  /* ── Início / lendo ── */
  const lendo = etapa === "lendo";
  return (
    <div data-atalho-crlv className={cn(
      "rounded-2xl border border-primary-200 bg-gradient-to-br from-primary-50 via-white to-white shadow-sm",
      compacto ? "p-4" : "p-5 sm:p-6",
    )}>
      {inputs}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <span className={cn("rounded-xl bg-primary-500 text-white flex items-center justify-center shrink-0 shadow-sm", compacto ? "w-10 h-10" : "w-12 h-12")}>
          {lendo ? <Loader2 className="w-6 h-6 animate-spin" /> : <FileText className="w-6 h-6" />}
        </span>
        <div className="flex-1 min-w-0">
          <p className="flex items-center gap-2 flex-wrap">
            <span className={cn("font-semibold text-ink", compacto ? "text-base" : "text-lg")}>{compacto ? "Atualizar pelo documento (CRLV)" : "Preencher com foto do documento"}</span>
            {!compacto && <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-primary-700 bg-primary-100 px-2 py-0.5 rounded-full"><Sparkles className="w-3 h-3" /> Recomendado</span>}
          </p>
          <p className="text-sm text-ink-muted mt-1">
            {lendo
              ? "Lendo o documento com IA… isso leva alguns segundos."
              : <>Fotografe o <strong className="text-ink">CRLV</strong> (documento do veículo). A IA lê placa, marca/modelo, anos, cor, combustível, chassi e RENAVAM — e você confere antes de salvar.</>}
          </p>
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          <button type="button" disabled={lendo} onClick={() => camera.current?.click()}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-primary-500 hover:bg-primary-600 disabled:opacity-60 text-white text-sm font-semibold">
            <Camera className="w-4 h-4" /> Fotografar documento
          </button>
          <button type="button" disabled={lendo} onClick={() => galeria.current?.click()} className="inline-flex items-center justify-center gap-1 text-xs text-ink-muted hover:text-ink disabled:opacity-60">
            <ImagePlus className="w-3.5 h-3.5" /> ou escolher arquivo (foto/print do CRLV-e)
          </button>
        </div>
      </div>
      {qualidade && (qualidade.escura || qualidade.borrada) && !erro && lendo && (
        <p className="mt-3 text-xs text-amber-800">A foto parece {qualidade.escura ? "escura" : "tremida"} — se a leitura falhar, tente de novo com mais luz.</p>
      )}
      {erro && (
        <div data-erro-crlv className="mt-3 flex items-start gap-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{erro}</span>
        </div>
      )}
      <div className="mt-3">{privacidade}</div>
    </div>
  );
}
