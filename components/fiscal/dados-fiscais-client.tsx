"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, FileKey2, FlaskConical, Info, Loader2, MapPin, PlugZap, Save, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField, FormSection } from "@/components/ui/form-field";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { StatusPill, type TomStatus } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/avisos";
import { cn, formatarCpfCnpj, formatarData, formatarDataHora } from "@/lib/utils";
import { hrefSecaoConfig } from "@/lib/navegacao/configuracoes";
import { LABEL_AMBIENTE, LABEL_REGIME, REGIMES, REGIMES_ESPECIAIS, type Ambiente, type StatusEmitente } from "@/lib/nfse/regras";
import type { EmitenteTela } from "@/lib/nfse/emitente-server";

const TOM_STATUS: Record<StatusEmitente, TomStatus> = { NAO_CONFIGURADO: "previsto", PENDENTE: "atencao", ATIVO: "ok", ERRO: "atrasado" };

/**
 * Dados fiscais da empresa como EMITENTE de NFS-e (PlugNotas): status do emitente, regime,
 * município (IBGE), ambiente (homologação por padrão) e o certificado A1. O .pfx e a senha vão
 * no envio e não voltam nunca: a tela só mostra o que se leu do certificado (titular, validade).
 */
export function DadosFiscaisClient({ inicial }: { inicial: EmitenteTela }) {
  const [e, setE] = useState(inicial);
  const [f, setF] = useState(inicial.dados);
  const [senha, setSenha] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const [ocupado, setOcupado] = useState<"salvar" | "testar" | "municipio" | null>(null);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro" | "aviso"; texto: string } | null>(null);
  const muda = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((s) => ({ ...s, [k]: v })); setMsg(null); };

  async function buscarMunicipio() {
    setOcupado("municipio");
    try {
      const r = await fetch("/api/fiscal/municipio");
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ tipo: "erro", texto: d.erro ?? "Não foi possível buscar o município." }); return; }
      setF((s) => ({ ...s, codigoMunicipio: d.codigo, municipioNome: d.nome, municipioUf: d.uf }));
      setMsg(null);
    } catch { setMsg({ tipo: "erro", texto: "Sem conexão. Tente de novo." }); } finally { setOcupado(null); }
  }

  async function salvar() {
    setMsg(null);
    if (arquivo && !senha) { setMsg({ tipo: "erro", texto: "Informe a senha do certificado." }); return; }
    const corpo = new FormData();
    corpo.append("inscricaoMunicipal", f.inscricaoMunicipal ?? "");
    corpo.append("regimeTributario", f.regimeTributario ?? "");
    corpo.append("regimeEspecial", f.regimeTributario === "MEI" ? "" : f.regimeEspecial ?? "");
    corpo.append("incentivoFiscal", String(f.incentivoFiscal));
    corpo.append("incentivadorCultural", String(f.incentivadorCultural));
    corpo.append("ambiente", f.ambiente);
    corpo.append("codigoMunicipio", f.codigoMunicipio ?? "");
    corpo.append("municipioNome", f.municipioNome ?? "");
    corpo.append("municipioUf", f.municipioUf ?? "");
    if (arquivo) { corpo.append("certificado", arquivo); corpo.append("senha", senha); }
    setOcupado("salvar");
    try {
      const r = await fetch("/api/fiscal/emitente", { method: "POST", body: corpo });
      const d = await r.json().catch(() => ({}));
      if (d.emitente) { setE(d.emitente); setF(d.emitente.dados); }
      if (!r.ok && !d.emitente) { setMsg({ tipo: "erro", texto: d.erro ?? "Não foi possível salvar." }); return; }
      // a senha e o arquivo saem da tela assim que o envio termina (deu certo ou não)
      setSenha(""); setArquivo(null); if (arquivoRef.current) arquivoRef.current.value = "";
      if (d.sincronizado) { toast(d.mensagem); setMsg({ tipo: "ok", texto: d.mensagem }); }
      else setMsg({ tipo: d.erro ? "erro" : "aviso", texto: d.mensagem ?? d.erro });
    } catch { setMsg({ tipo: "erro", texto: "Sem conexão. Tente de novo." }); } finally { setOcupado(null); }
  }

  async function testar() {
    setOcupado("testar");
    setMsg(null);
    try {
      const r = await fetch("/api/fiscal/emitente/testar", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (d.emitente) setE(d.emitente);
      setMsg({ tipo: d.ok ? "ok" : "erro", texto: d.mensagem ?? d.erro ?? "Não foi possível testar." });
    } catch { setMsg({ tipo: "erro", texto: "Sem conexão. Tente de novo." }); } finally { setOcupado(null); }
  }

  const c = e.certificado;
  const producaoLiberada = e.ambientesDisponiveis.PRODUCAO;
  return (
    <div className="space-y-6">
      {/* Situação do emitente */}
      <div className="rounded-card border border-surface-border bg-surface-alt/40 p-4 space-y-3" data-situacao-emitente>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tom={TOM_STATUS[e.status]} data-status-emitente={e.status}>{e.statusLabel}</StatusPill>
          <StatusPill tom={e.dados.ambiente === "PRODUCAO" ? "atrasado" : "atencao"} data-ambiente={e.dados.ambiente}>
            <FlaskConical className="w-3 h-3" /> {LABEL_AMBIENTE[e.dados.ambiente]}
          </StatusPill>
          <Button variant="secondary" size="sm" className="sm:ml-auto" onClick={testar} disabled={!e.emitente || !!ocupado} loading={ocupado === "testar"} data-testar-conexao>
            <PlugZap className="w-4 h-4" /> Testar conexão
          </Button>
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div><dt className="text-xs text-ink-muted">Emitente no PlugNotas</dt>
            <dd className="text-ink" data-emitente>{e.emitente ? `${formatarCpfCnpj(e.emitente.cnpj)} · ${LABEL_AMBIENTE[e.emitente.ambiente]}` : "Ainda não cadastrado"}</dd>
            {e.emitente?.sincronizadoEm && <dd className="text-xs text-ink-subtle">atualizado em {formatarDataHora(e.emitente.sincronizadoEm)}</dd>}
          </div>
          <div><dt className="text-xs text-ink-muted">Certificado digital A1</dt>
            {c ? (
              <dd data-certificado className={cn("text-ink", c.vencido && "text-atrasado-texto", c.vencendo && "text-atencao-texto")}>
                {c.titular ?? "—"}{c.cnpj && <span className="text-ink-muted"> · {formatarCpfCnpj(c.cnpj)}</span>}
                <span className="block text-xs">
                  {c.validoAte ? (c.vencido ? `Vencido em ${formatarData(c.validoAte)}` : `Válido até ${formatarData(c.validoAte)}${c.vencendo ? ` — faltam ${c.dias} dias` : ""}`) : "Validade não informada"}
                </span>
              </dd>
            ) : <dd className="text-ink" data-certificado>Não enviado</dd>}
          </div>
        </dl>
        {e.ultimoTeste && (
          <p className={cn("text-xs flex items-start gap-1.5", e.ultimoTeste.ok ? "text-ok-texto" : "text-atrasado-texto")} data-ultimo-teste={e.ultimoTeste.ok ? "ok" : "erro"}>
            {e.ultimoTeste.ok ? <CheckCircle2 className="w-3.5 h-3.5 mt-px shrink-0" /> : <XCircle className="w-3.5 h-3.5 mt-px shrink-0" />}
            <span>Último teste ({formatarDataHora(e.ultimoTeste.em)}): {e.ultimoTeste.mensagem}</span>
          </p>
        )}
        {e.status === "ERRO" && e.ultimoErro && !e.ultimoTeste?.mensagem?.includes(e.ultimoErro) && (
          <p className="text-xs text-atrasado-texto flex items-start gap-1.5" data-ultimo-erro><XCircle className="w-3.5 h-3.5 mt-px shrink-0" /> {e.ultimoErro}</p>
        )}
      </div>

      {e.dados.ambiente === "HOMOLOGACAO" && (
        <p className="text-xs text-atencao-texto bg-atencao-claro border border-atencao/20 rounded-lg px-3 py-2 flex items-start gap-1.5" data-aviso-homologacao>
          <Info className="w-3.5 h-3.5 mt-px shrink-0" />
          Ambiente de homologação (testes): o cadastro e as notas daqui não têm valor fiscal. Produção só depois de validar tudo aqui.
        </p>
      )}

      {e.pendencias.length > 0 && (
        <div className="text-sm text-atencao-texto bg-atencao-claro border border-atencao/20 rounded-lg px-3 py-2" data-pendencias>
          <p className="font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Falta para cadastrar no PlugNotas:</p>
          <ul className="mt-1 list-disc pl-5 space-y-0.5 text-xs">{e.pendencias.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}

      <FormSection title="Tributação" icon={<ShieldCheck className="w-4 h-4" />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Inscrição municipal" required>
            <Input value={f.inscricaoMunicipal ?? ""} onChange={(ev) => muda("inscricaoMunicipal", ev.target.value)} inputMode="numeric" maxLength={30} name="inscricaoMunicipal" />
          </FormField>
          <FormField label="Regime tributário" required>
            <Select value={f.regimeTributario ?? ""} onChange={(ev) => muda("regimeTributario", (ev.target.value || null) as typeof f.regimeTributario)} placeholder="Escolha…" name="regimeTributario">
              {REGIMES.map((r) => <option key={r} value={r}>{LABEL_REGIME[r]}</option>)}
            </Select>
          </FormField>
          {f.regimeTributario !== "MEI" && (
            <FormField label="Regime especial (opcional)" hint="Só se a prefeitura enquadrou a empresa num regime especial">
              <Select value={f.regimeEspecial ?? ""} onChange={(ev) => muda("regimeEspecial", (ev.target.value || null) as typeof f.regimeEspecial)} placeholder="Nenhum" name="regimeEspecial">
                {REGIMES_ESPECIAIS.filter((r) => r.id !== "MEI").map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </Select>
            </FormField>
          )}
        </div>
        <div className="divide-y divide-surface-border border-y border-surface-border">
          <ToggleSwitch label="Incentivo fiscal" description="A empresa tem incentivo fiscal do município" checked={f.incentivoFiscal} onChange={(v) => muda("incentivoFiscal", v)} />
          <ToggleSwitch label="Incentivador cultural" description="A empresa é incentivadora cultural" checked={f.incentivadorCultural} onChange={(v) => muda("incentivadorCultural", v)} />
        </div>
      </FormSection>

      <FormSection title="Município da emissão" icon={<MapPin className="w-4 h-4" />}>
        <p className="text-xs text-ink-muted" data-endereco-empresa>
          Endereço da empresa: {[e.empresa.endereco, e.empresa.cidade && `${e.empresa.cidade}/${e.empresa.estado}`, e.empresa.cep].filter(Boolean).join(" · ") || "não preenchido"}
          {" "}— <Link href={hrefSecaoConfig("empresa")} className="font-medium text-primary-700 hover:underline">editar em Dados da empresa</Link>
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-[10rem_1fr_5rem] gap-4 items-end">
          <FormField label="Código IBGE" required>
            <Input value={f.codigoMunicipio ?? ""} onChange={(ev) => muda("codigoMunicipio", ev.target.value.replace(/\D/g, "").slice(0, 7) || null)} inputMode="numeric" placeholder="7 dígitos" name="codigoMunicipio" />
          </FormField>
          <FormField label="Município">
            <Input value={f.municipioNome ?? ""} onChange={(ev) => muda("municipioNome", ev.target.value || null)} name="municipioNome" />
          </FormField>
          <FormField label="UF" required>
            <Input value={f.municipioUf ?? ""} onChange={(ev) => muda("municipioUf", ev.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2) || null)} maxLength={2} name="municipioUf" />
          </FormField>
        </div>
        <Button variant="ghost" size="sm" onClick={buscarMunicipio} disabled={!!ocupado} loading={ocupado === "municipio"} data-buscar-municipio>
          <MapPin className="w-4 h-4" /> Buscar pelo endereço da empresa
        </Button>
      </FormSection>

      <FormSection title="Ambiente" icon={<FlaskConical className="w-4 h-4" />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Ambiente do PlugNotas">
          {(["HOMOLOGACAO", "PRODUCAO"] as Ambiente[]).map((a) => {
            const bloqueado = a === "PRODUCAO" && !producaoLiberada;
            return (
              <label key={a} className={cn("flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm cursor-pointer", f.ambiente === a ? "border-acento bg-acento-claro/40" : "border-surface-border", bloqueado && "opacity-60 cursor-not-allowed")}>
                <input type="radio" name="ambiente" value={a} checked={f.ambiente === a} disabled={bloqueado} onChange={() => muda("ambiente", a)} className="mt-0.5" data-ambiente-opcao={a} />
                <span>
                  <span className="font-medium text-ink">{LABEL_AMBIENTE[a]}</span>
                  <span className="block text-xs text-ink-muted">
                    {a === "HOMOLOGACAO" ? "Padrão. Para testar sem valor fiscal." : bloqueado ? "Ainda não liberada neste servidor." : "Notas com valor fiscal."}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </FormSection>

      <FormSection title="Certificado digital A1" icon={<FileKey2 className="w-4 h-4" />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label={c ? "Enviar novo certificado (opcional)" : "Arquivo do certificado (.pfx ou .p12)"} required={!c}>
            <input ref={arquivoRef} type="file" accept=".pfx,.p12" onChange={(ev) => { setArquivo(ev.target.files?.[0] ?? null); setMsg(null); }} data-arquivo-certificado
              className="block w-full text-sm text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-surface-alt file:px-3 file:py-2 file:text-sm file:font-medium file:text-ink hover:file:bg-surface-border" />
          </FormField>
          <FormField label="Senha do certificado" required={!!arquivo}>
            <Input type="password" value={senha} onChange={(ev) => { setSenha(ev.target.value); setMsg(null); }} autoComplete="new-password" disabled={!arquivo} placeholder={arquivo ? "" : "Escolha o arquivo primeiro"} name="senhaCertificado" />
          </FormField>
        </div>
        <p className="text-xs text-ink-muted flex items-start gap-1.5"><ShieldCheck className="w-3.5 h-3.5 mt-px shrink-0 text-ok" />
          O arquivo e a senha são conferidos aqui e vão direto ao PlugNotas por conexão segura (HTTPS). O Frivo não guarda o arquivo nem a senha — só a referência do certificado lá e a validade.</p>
      </FormSection>

      {msg && (
        <p role={msg.tipo === "erro" ? "alert" : "status"} data-mensagem={msg.tipo}
          className={cn("text-sm font-medium", msg.tipo === "ok" ? "text-ok-texto" : msg.tipo === "aviso" ? "text-atencao-texto" : "text-atrasado")}>{msg.texto}</p>
      )}
      <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-end gap-2">
        {ocupado === "salvar" && <p className="text-xs text-ink-muted sm:mr-auto flex items-center gap-1"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Conferindo e enviando ao PlugNotas…</p>}
        <Button onClick={salvar} disabled={!!ocupado} loading={ocupado === "salvar"} data-salvar-fiscal>
          <Save className="w-4 h-4" /> Salvar e cadastrar no PlugNotas
        </Button>
      </div>
    </div>
  );
}
