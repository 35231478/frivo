"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, FileKey2, FileUp, FlaskConical, Info, Landmark, Loader2, MapPin, PlugZap, Save, ShieldCheck, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField, FormSection } from "@/components/ui/form-field";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { StatusPill, type TomStatus } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/avisos";
import { cn, formatarCpfCnpj, formatarData, formatarDataHora } from "@/lib/utils";
import { hrefSecaoConfig } from "@/lib/navegacao/configuracoes";
import { ACEITA_CERTIFICADO, ehArquivoCertificado, LABEL_AMBIENTE, LABEL_REGIME, REGIMES, REGIMES_ESPECIAIS, type Ambiente, type StatusEmitente } from "@/lib/nfse/regras";
import type { EmitenteTela } from "@/lib/nfse/emitente-server";
import { AvisoPlugNotas } from "@/components/fiscal/aviso-plugnotas";

const AJUDA_CERTIFICADO = "Arquivo do certificado digital A1, com extensão .pfx ou .p12.";
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
  const [arrastando, setArrastando] = useState(false);
  // Autenticação da prefeitura: digitada só para este envio (a guardada nunca volta para a tela)
  const [prefLogin, setPrefLogin] = useState("");
  const [prefSenha, setPrefSenha] = useState("");
  const [removerPref, setRemoverPref] = useState(false);
  const [ocupado, setOcupado] = useState<"salvar" | "testar" | "municipio" | null>(null);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro" | "aviso"; texto: string } | null>(null);
  const muda = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((s) => ({ ...s, [k]: v })); setMsg(null); };

  /** Arquivo escolhido no seletor ou solto na área: só .pfx/.p12 (soltar não passa pelo filtro do seletor). Fica só na memória da tela até o envio. */
  function escolherArquivo(novo: File | null | undefined) {
    if (!novo) return;
    if (!ehArquivoCertificado(novo.name)) {
      setMsg({ tipo: "erro", texto: "Envie o certificado A1 no formato .pfx ou .p12." });
      if (arquivoRef.current) arquivoRef.current.value = "";
      return;
    }
    setArquivo(novo); setMsg(null);
  }
  function tirarArquivo() {
    setArquivo(null); setSenha("");
    if (arquivoRef.current) arquivoRef.current.value = "";
  }

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
    if (prefLogin.trim()) corpo.append("prefeituraLogin", prefLogin.trim());
    if (prefSenha) corpo.append("prefeituraSenha", prefSenha);
    if (removerPref && !prefLogin.trim() && !prefSenha) corpo.append("prefeituraRemover", "true");
    setOcupado("salvar");
    try {
      const r = await fetch("/api/fiscal/emitente", { method: "POST", body: corpo });
      const d = await r.json().catch(() => ({}));
      if (d.emitente) { setE(d.emitente); setF(d.emitente.dados); }
      // recusado aqui (senha errada, vencido, outro CNPJ…): o arquivo fica para tentar de novo, a senha não
      if (!r.ok && !d.emitente) { setMsg({ tipo: "erro", texto: d.erro ?? "Não foi possível salvar." }); return; }
      // chegou ao servidor e foi processado: a senha e o arquivo saem da tela; a prefeitura já está guardada
      setArquivo(null); if (arquivoRef.current) arquivoRef.current.value = "";
      setPrefLogin(""); setRemoverPref(false);
      if (d.sincronizado) { toast(d.mensagem); setMsg({ tipo: "ok", texto: d.mensagem }); }
      else setMsg({ tipo: d.erro ? "erro" : "aviso", texto: d.mensagem ?? d.erro });
    } catch { setMsg({ tipo: "erro", texto: "Sem conexão. Tente de novo." }); } finally {
      // as senhas nunca ficam na tela depois de um envio, dê certo ou não
      setSenha(""); setPrefSenha(""); setOcupado(null);
    }
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

      <AvisoPlugNotas webhook={e.webhook} onAtualizar={(webhook) => setE((s) => ({ ...s, webhook }))} />

      {e.dados.ambiente === "HOMOLOGACAO" && (
        <p className="text-xs text-atencao-texto bg-atencao-claro border border-atencao/20 rounded-lg px-3 py-2 flex items-start gap-1.5" data-aviso-homologacao>
          <Info className="w-3.5 h-3.5 mt-px shrink-0" />
          Ambiente de homologação: cadastro e notas sem valor fiscal. Passe para produção após validar a emissão.
        </p>
      )}

      {e.pendencias.length > 0 && (
        <div className="text-sm text-atencao-texto bg-atencao-claro border border-atencao/20 rounded-lg px-3 py-2" data-pendencias>
          <p className="font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Pendências para o cadastro no PlugNotas:</p>
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
            <FormField label="Regime especial" dica="Preencha apenas se a prefeitura enquadrou a empresa em regime especial de tributação.">
              <Select value={f.regimeEspecial ?? ""} onChange={(ev) => muda("regimeEspecial", (ev.target.value || null) as typeof f.regimeEspecial)} placeholder="Nenhum" name="regimeEspecial">
                {REGIMES_ESPECIAIS.filter((r) => r.id !== "MEI").map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </Select>
            </FormField>
          )}
        </div>
        <div className="divide-y divide-surface-border border-y border-surface-border">
          <ToggleSwitch label="Incentivo fiscal" dica="Ative se a empresa possui incentivo fiscal concedido pelo município." checked={f.incentivoFiscal} onChange={(v) => muda("incentivoFiscal", v)} />
          <ToggleSwitch label="Incentivador cultural" dica="Ative se a empresa é incentivadora cultural." checked={f.incentivadorCultural} onChange={(v) => muda("incentivadorCultural", v)} />
        </div>
      </FormSection>

      <FormSection title="Município da emissão" icon={<MapPin className="w-4 h-4" />} dica="Município onde a empresa emite a NFS-e, identificado pelo código IBGE de 7 dígitos.">
        <p className="text-xs text-ink-muted" data-endereco-empresa>
          Endereço da empresa: {[e.empresa.endereco, e.empresa.cidade && `${e.empresa.cidade}/${e.empresa.estado}`, e.empresa.cep].filter(Boolean).join(" · ") || "não preenchido"}
          {" "}· <Link href={hrefSecaoConfig("empresa")} className="font-medium text-primary-700 hover:underline">Editar</Link>
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

      <FormSection title="Ambiente" icon={<FlaskConical className="w-4 h-4" />} dica="Homologação é o ambiente de testes do PlugNotas, sem valor fiscal. Produção emite notas válidas perante a prefeitura.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Ambiente do PlugNotas">
          {(["HOMOLOGACAO", "PRODUCAO"] as Ambiente[]).map((a) => {
            const bloqueado = a === "PRODUCAO" && !producaoLiberada;
            return (
              <label key={a} className={cn("flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm cursor-pointer", f.ambiente === a ? "border-acento bg-acento-claro/40" : "border-surface-border", bloqueado && "opacity-60 cursor-not-allowed")}>
                <input type="radio" name="ambiente" value={a} checked={f.ambiente === a} disabled={bloqueado} onChange={() => muda("ambiente", a)} className="mt-0.5" data-ambiente-opcao={a} />
                <span>
                  <span className="font-medium text-ink">{LABEL_AMBIENTE[a]}</span>
                  <span className="block text-xs text-ink-muted">
                    {a === "HOMOLOGACAO" ? "Padrão. Testes sem valor fiscal." : bloqueado ? "Não liberada neste servidor." : "Notas com valor fiscal."}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </FormSection>

      <FormSection title="Autenticação na prefeitura" icon={<Landmark className="w-4 h-4" />}
        dica="Login e senha da empresa no portal de NFS-e da prefeitura. Alguns municípios exigem apenas a senha.">
        {e.prefeitura && (
          <div data-prefeitura-guardada className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-xs",
            e.prefeitura.ilegivel ? "border-atencao/30 bg-atencao-claro text-atencao-texto" : "border-surface-border bg-surface-alt/60 text-ink-muted")}>
            {e.prefeitura.ilegivel ? (
              <span className="flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> A credencial armazenada não pôde ser lida neste servidor. Informe o login e a senha novamente.</span>
            ) : (
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-ok" />
                {removerPref ? "Será removida ao salvar." : `Armazenada (${[e.prefeitura.temLogin && "login", e.prefeitura.temSenha && "senha"].filter(Boolean).join(" e ")}${e.prefeitura.atualizadaEm ? `, em ${formatarData(e.prefeitura.atualizadaEm)}` : ""}). Deixe em branco para manter.`}
              </span>
            )}
            <button type="button" data-remover-prefeitura onClick={() => { setRemoverPref((v) => !v); setMsg(null); }}
              className="ml-auto font-medium text-acento hover:underline">{removerPref ? "Manter" : "Remover"}</button>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Login">
            <Input value={prefLogin} onChange={(ev) => { setPrefLogin(ev.target.value); setMsg(null); }} name="prefeituraLogin" autoComplete="off" maxLength={120}
              placeholder={e.prefeitura?.temLogin ? "Armazenado. Digite para alterar" : "Opcional"} />
          </FormField>
          <FormField label="Senha">
            <Input type="password" value={prefSenha} onChange={(ev) => { setPrefSenha(ev.target.value); setMsg(null); }} name="prefeituraSenha" autoComplete="new-password" maxLength={200}
              placeholder={e.prefeitura?.temSenha ? "Armazenada. Digite para alterar" : "Opcional"} />
          </FormField>
        </div>
        <p className="text-xs text-ink-muted flex items-start gap-1.5"><ShieldCheck className="w-3.5 h-3.5 mt-px shrink-0 text-ok" />
          Enviada ao PlugNotas por conexão segura (HTTPS) e armazenada criptografada. Não é exibida novamente.</p>
      </FormSection>

      <FormSection title="Certificado digital A1" icon={<FileKey2 className="w-4 h-4" />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label={c ? "Enviar novo certificado (opcional)" : "Arquivo do certificado (.pfx ou .p12)"} required={!c} dica={AJUDA_CERTIFICADO}>
            <div
              role="button" tabIndex={0} data-area-certificado data-arrastando={arrastando || undefined} aria-description={AJUDA_CERTIFICADO}
              onClick={() => arquivoRef.current?.click()}
              onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); arquivoRef.current?.click(); } }}
              onDragOver={(ev) => { ev.preventDefault(); setArrastando(true); }}
              onDragLeave={() => setArrastando(false)}
              onDrop={(ev) => { ev.preventDefault(); setArrastando(false); escolherArquivo(ev.dataTransfer.files?.[0]); }}
              className={cn("flex items-center gap-3 rounded-lg border-2 border-dashed px-3 py-3 cursor-pointer transition-colors",
                arrastando ? "border-acento bg-acento-claro/40" : "border-surface-border hover:border-acento/60 hover:bg-surface-alt/60")}
            >
              <span className="p-2 rounded-full bg-surface-alt shrink-0">
                {arquivo ? <FileKey2 className="w-5 h-5 text-acento" /> : <FileUp className="w-5 h-5 text-acento" />}
              </span>
              <span className="min-w-0 flex-1 text-sm">
                {arquivo ? (
                  <>
                    <span className="block font-medium text-ink truncate" data-arquivo-escolhido>{arquivo.name}</span>
                    <span className="block text-xs text-ink-muted">Clique ou arraste outro arquivo para substituir</span>
                  </>
                ) : (
                  <span className="block font-medium text-ink">{arrastando ? "Solte o certificado aqui" : "Arraste o certificado aqui ou clique para escolher"}</span>
                )}
              </span>
              {arquivo && (
                <button type="button" aria-label="Tirar o certificado escolhido" data-tirar-certificado
                  onClick={(ev) => { ev.stopPropagation(); tirarArquivo(); }}
                  className="p-1.5 rounded-md text-ink-muted hover:text-ink hover:bg-surface-border shrink-0"><X className="w-4 h-4" /></button>
              )}
              <input ref={arquivoRef} type="file" accept={ACEITA_CERTIFICADO} className="hidden" tabIndex={-1} data-arquivo-certificado
                onChange={(ev) => escolherArquivo(ev.target.files?.[0])} />
            </div>
          </FormField>
          <FormField label="Senha do certificado" required={!!arquivo}>
            <Input type="password" value={senha} onChange={(ev) => { setSenha(ev.target.value); setMsg(null); }} autoComplete="new-password" disabled={!arquivo} placeholder={arquivo ? "" : "Selecione o arquivo antes"} name="senhaCertificado" />
          </FormField>
        </div>
        <p className="text-xs text-ink-muted flex items-start gap-1.5"><ShieldCheck className="w-3.5 h-3.5 mt-px shrink-0 text-ok" />
          Arquivo e senha são validados e enviados diretamente ao PlugNotas por conexão segura (HTTPS). O Frivo não armazena o arquivo nem a senha.</p>
      </FormSection>

      {msg && (
        <p role={msg.tipo === "erro" ? "alert" : "status"} data-mensagem={msg.tipo}
          className={cn("text-sm font-medium", msg.tipo === "ok" ? "text-ok-texto" : msg.tipo === "aviso" ? "text-atencao-texto" : "text-atrasado")}>{msg.texto}</p>
      )}
      <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-end gap-2">
        {ocupado === "salvar" && <p className="text-xs text-ink-muted sm:mr-auto flex items-center gap-1"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Validando e enviando ao PlugNotas…</p>}
        <Button onClick={salvar} disabled={!!ocupado} loading={ocupado === "salvar"} data-salvar-fiscal>
          <Save className="w-4 h-4" /> Salvar e cadastrar no PlugNotas
        </Button>
      </div>
    </div>
  );
}
