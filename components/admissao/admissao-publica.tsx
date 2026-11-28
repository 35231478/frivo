"use client";

import { useCallback, useRef, useState } from "react";
import {
  AlertCircle, ArrowLeft, ArrowRight, Camera, Check, ChevronDown, FileSignature, Loader2, RotateCcw, ShieldCheck, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { CapturaFoto } from "@/components/ui/captura-foto";
import { Stepper } from "@/components/ui/stepper";
import { cn } from "@/lib/utils";
import {
  ETAPAS, MSG_EMAIL_NAO_VERIFICADO, ROTULO_ETAPA_CURTO, faltaNaEtapa, formVazio, obrigatoriosDa,
  type Etapa, type FormAdmissao,
} from "@/lib/admissao/admissao";
import type { AdmissaoPublica } from "@/lib/admissao/admissao-server";
import {
  CamposBanco, CamposDados, CamposDependentes, CamposDocumentos, CamposEndereco, VerificarEmail,
} from "@/components/admissao/campos-admissao";

/** As etapas que o colaborador preenche (a assinatura é a última, à parte). */
const PASSOS = ETAPAS.map((id) => ({ id, rotulo: ROTULO_ETAPA_CURTO[id] }));


/**
 * O LINK do colaborador: consentimento LGPD, o formulário em etapas (rascunho salvo a cada passo),
 * os documentos, o contrato e a assinatura com foto. Feito para o celular: uma coluna, campos
 * grandes e a ação principal fixa embaixo.
 *
 * Nada aqui decide regra: `faltaNaEtapa` é a MESMA função que a rota usa, então o botão só libera o
 * que o servidor aceitaria — e o servidor confere de novo.
 */
export function AdmissaoPublicaCliente({ token, inicial }: { token: string; inicial: AdmissaoPublica }) {
  const [dados, setDados] = useState<AdmissaoPublica>(inicial);
  const [form, setForm] = useState<FormAdmissao>(inicial.form ?? formVazio());
  const [etapa, setEtapa] = useState<Etapa>(() => {
    const salva = ETAPAS.find((e) => e === inicial.etapa);
    return inicial.assinaturaEm ? "CONTRATO" : (inicial.etapaPendente ?? salva ?? "DADOS");
  });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [falta, setFalta] = useState<string[]>([]);
  const [consentido, setConsentido] = useState(false);
  const [assinando, setAssinando] = useState(false);
  const [nomeAssinatura, setNomeAssinatura] = useState("");
  const [selfie, setSelfie] = useState<string | null>(null);
  const [verContrato, setVerContrato] = useState(false);
  const topo = useRef<HTMLDivElement>(null);

  const set = useCallback(<K extends keyof FormAdmissao>(campo: K, valor: FormAdmissao[K]) => {
    setForm((f) => ({ ...f, [campo]: valor }));
    setFalta([]);
  }, []);

  const obrigatorios = obrigatoriosDa(dados.documentos);
  const enviados = dados.enviados.map((e) => e.docId);
  const docs = { enviados, obrigatorios };
  const indice = PASSOS.findIndex((p) => p.id === etapa);
  const assinado = !!dados.assinaturaEm;

  const subir = () => topo.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  async function chamar(caminho: string, corpo: unknown, metodo = "POST") {
    const res = await fetch(`/api/publico/admissao/${token}${caminho}`, {
      method: metodo, headers: { "Content-Type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d?.erro ?? "Não foi possível salvar. Tente de novo.");
    return d;
  }

  /* ───────── consentimento ───────── */

  async function aceitar() {
    setErro(""); setSalvando(true);
    try {
      const d = (await chamar("/consentimento", {})) as AdmissaoPublica;
      setDados(d);
      setForm(d.form ?? formVazio());
      setEtapa(d.etapaPendente ?? "DADOS");
    } catch (e) { setErro((e as Error).message); } finally { setSalvando(false); }
  }

  /* ───────── rascunho e navegação ───────── */

  async function salvar(proxima: Etapa | null) {
    setErro("");
    const pendencias = faltaNaEtapa(etapa, form, docs);
    if (pendencias.length) { setFalta(pendencias); subir(); return; }
    setSalvando(true);
    try {
      const d = (await chamar("/rascunho", { form, etapa: proxima ?? etapa }, "PUT")) as AdmissaoPublica;
      setDados(d);
      if (proxima) { setEtapa(proxima); setFalta([]); subir(); }
    } catch (e) { setErro((e as Error).message); } finally { setSalvando(false); }
  }

  /** Último passo dos dados: grava e manda o servidor conferir tudo (ele decide, não a tela). */
  async function concluir() {
    setErro("");
    const pendencias = faltaNaEtapa(etapa, form, docs);
    if (pendencias.length) { setFalta(pendencias); subir(); return; }
    setSalvando(true);
    try {
      await chamar("/rascunho", { form, etapa: "CONTRATO" }, "PUT");
      const d = (await chamar("/concluir", undefined)) as AdmissaoPublica;
      setDados(d);
      setEtapa("CONTRATO");
      setFalta([]);
      subir();
    } catch (e) {
      setErro((e as Error).message);
      // O e-mail sem confirmar é cobrado só aqui, no fim: volta à etapa Dados, onde está o código
      if ((e as Error).message === MSG_EMAIL_NAO_VERIFICADO) { setEtapa("DADOS"); subir(); }
    } finally { setSalvando(false); }
  }

  async function recarregar() {
    try {
      const res = await fetch(`/api/publico/admissao/${token}`);
      if (!res.ok) return;
      const d = (await res.json()) as AdmissaoPublica;
      // Só troca o estado por uma resposta com a cara certa: a tela é pública e não pode quebrar
      // na mão de quem está preenchendo por causa de uma resposta estranha
      if (d && Array.isArray(d.documentos)) setDados(d);
    } catch { /* sem rede: a tela segue com o que tem */ }
  }

  /* ───────── assinatura ───────── */


  async function assinar() {
    setErro(""); setAssinando(true);
    try {
      const d = (await chamar("/assinar", { nome: nomeAssinatura, selfie })) as AdmissaoPublica;
      setDados(d);
      subir();
    } catch (e) { setErro((e as Error).message); } finally { setAssinando(false); }
  }

  /* ───────── telas ───────── */

  const aviso = erro && (
    <div className="flex items-start gap-2 bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-4 py-3" data-admissao-erro>
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden /> {erro}
    </div>
  );

  // 1. Sem consentimento: o que vai ser pedido e o aceite
  if (!dados.consentidoEm) {
    return (
      <div className="space-y-5" data-admissao-etapa="CONSENTIMENTO" ref={topo}>
        <section className="bg-white rounded-card shadow-card p-5 space-y-4">
          <h2 className="font-display text-lg font-semibold text-ink">Antes de começar</h2>
          <p className="text-sm text-ink">
            A <strong>{dados.empresa}</strong> precisa dos seus dados, dos documentos e da sua assinatura.
          </p>
          <ul className="text-sm text-ink-muted space-y-1.5 list-disc pl-5">
            <li>Os dados são usados para registrar a sua admissão e a folha de pagamento.</li>
            <li>Os documentos ficam guardados no cadastro da empresa, com acesso restrito ao RH.</li>
            <li>A data, a hora, o seu IP e o navegador ficam registrados como prova do aceite.</li>
            <li>O preenchimento é salvo a cada passo: dá para fechar e voltar depois.</li>
          </ul>
          <label className="flex items-start gap-2.5 text-sm text-ink cursor-pointer select-none">
            <input type="checkbox" checked={consentido} onChange={(e) => setConsentido(e.target.checked)}
              className="accent-primary-600 w-5 h-5 mt-0.5 shrink-0" data-aceitar-lgpd />
            <span>Concordo com o tratamento dos meus dados para esta admissão.</span>
          </label>
          {aviso}
          <Button type="button" onClick={aceitar} loading={salvando} disabled={!consentido}
            className="w-full justify-center py-3" data-continuar-lgpd>
            Continuar <ArrowRight className="w-4 h-4" />
          </Button>
        </section>
      </div>
    );
  }

  // 2. Assinado: a tela final, com as orientações da empresa
  if (assinado) {
    return (
      <div className="space-y-5" data-admissao-etapa="PRONTO" ref={topo}>
        <section className="bg-white rounded-card shadow-card p-5 space-y-3 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-ok-claro flex items-center justify-center">
            <Check className="w-6 h-6 text-ok-texto" aria-hidden />
          </div>
          <h2 className="font-display text-xl font-bold text-ink">Admissão concluída</h2>
          <p className="text-sm text-ink-muted">
            Contrato assinado por {dados.assinaturaNome}. A {dados.empresa} já recebeu os seus dados.
          </p>
        </section>

        {dados.orientacoes && (
          <section className="bg-white rounded-card shadow-card p-5 space-y-2" data-orientacoes>
            <h3 className="font-semibold text-ink">Orientações da empresa</h3>
            <p className="text-sm text-ink whitespace-pre-wrap break-words">{dados.orientacoes}</p>
          </section>
        )}

        {dados.contrato && (
          <section className="bg-white rounded-card shadow-card p-5" data-contrato-assinado>
            <button type="button" onClick={() => setVerContrato((v) => !v)} aria-expanded={verContrato}
              className="w-full flex items-center justify-between gap-2 text-left" data-ver-contrato>
              <span className="font-semibold text-ink">Contrato assinado</span>
              <ChevronDown className={cn("w-4 h-4 text-ink-muted transition-transform", verContrato && "rotate-180")} aria-hidden />
            </button>
            {verContrato && (
              <pre className="mt-3 text-xs text-ink whitespace-pre-wrap break-words font-sans">{dados.contrato}</pre>
            )}
          </section>
        )}
      </div>
    );
  }

  // 3. O formulário em etapas
  const ultimoDeDados = etapa === "DEPENDENTES";
  const naAssinatura = etapa === "CONTRATO";
  const anterior = indice > 0 ? PASSOS[indice - 1].id : null;
  const proxima = indice >= 0 && indice < PASSOS.length - 1 ? PASSOS[indice + 1].id : null;
  // Sem o modelo de contrato da empresa não existe botão de assinar (nem a trava de um botão
  // desligado sem explicação): a tela diz o que falta e o RH resolve
  const podeAssinar = nomeAssinatura.trim().length >= 3 && !!selfie;

  return (
    <div className="space-y-4" data-admissao-etapa={etapa} ref={topo}>
      <Stepper passos={PASSOS} atual={indice} rotulo="Etapas da admissão" data-stepper-admissao="" />

      {falta.length > 0 && (
        <div className="flex items-start gap-2 bg-atencao-claro border border-atencao/20 text-atencao-texto text-sm rounded-lg px-4 py-3" data-admissao-falta>
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
          <span>Falta preencher: {falta.join(", ")}.</span>
        </div>
      )}
      {aviso}

      <section className="bg-white rounded-card shadow-card p-4 sm:p-5">
        {etapa === "DADOS" && (
          <div className="space-y-4">
            <CamposDados form={form} set={set} />
            <VerificarEmail
              form={form} set={set} token={token} verificado={dados.emailVerificado}
              onVerificado={(email) => { setForm((f) => ({ ...f, email })); setDados((d) => ({ ...d, emailVerificado: email })); }}
            />
          </div>
        )}
        {etapa === "ENDERECO" && <CamposEndereco form={form} set={set} />}
        {etapa === "DOCUMENTOS" && (
          <CamposDocumentos token={token} pedidos={dados.documentos} enviados={dados.enviados} onMudou={recarregar} />
        )}
        {etapa === "BANCO" && <CamposBanco form={form} set={set} />}
        {etapa === "DEPENDENTES" && <CamposDependentes form={form} set={set} />}

        {naAssinatura && (
          <div className="space-y-4" data-etapa-campos="CONTRATO">
            {dados.contrato ? (
              <>
                <h3 className="font-semibold text-ink">Contrato de trabalho</h3>
                <div className="max-h-72 overflow-y-auto rounded-lg border border-surface-border bg-surface-alt/40 p-3" data-contrato-texto>
                  <pre className="text-xs text-ink whitespace-pre-wrap break-words font-sans">{dados.contrato}</pre>
                </div>
                <FormField label="Escreva o seu nome completo" required hint="É a sua assinatura. Ela fica registrada com data, hora, IP e navegador.">
                  <Input value={nomeAssinatura} onChange={(e) => setNomeAssinatura(e.target.value)} caixa="nome" data-assinatura-nome autoComplete="name" />
                </FormField>

                <CapturaFoto
                  valor={selfie} onValor={setSelfie} onErro={setErro}
                  rotulo="Foto sua, segurando o documento" obrigatorio
                />

                <p className="flex items-start gap-1.5 text-xs text-ink-muted">
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />
                  Ao assinar, o texto acima é guardado como está, junto com a sua foto e o registro do aceite.
                </p>
              </>
            ) : (
              <div className="flex items-start gap-2 bg-atencao-claro border border-atencao/20 text-atencao-texto text-sm rounded-lg px-4 py-3" data-sem-contrato>
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
                <span>Falta o modelo de contrato da empresa. Os seus dados estão salvos: fale com o RH.</span>
              </div>
            )}
          </div>
        )}
      </section>

      {/* A ação principal fica fixa embaixo no celular: o dedo não precisa caçar o botão */}
      <div className="sticky bottom-0 -mx-3 sm:mx-0 bg-surface-page/95 backdrop-blur px-3 py-3 border-t border-surface-border flex gap-2">
        {anterior && (
          <Button type="button" variant="secondary" onClick={() => { setEtapa(anterior); setFalta([]); subir(); }} data-etapa-voltar>
            <ArrowLeft className="w-4 h-4" /> Voltar
          </Button>
        )}
        {naAssinatura ? (
          dados.contrato ? (
            <Button type="button" onClick={assinar} loading={assinando} disabled={!podeAssinar}
              className="flex-1 justify-center py-3" data-assinar>
              <FileSignature className="w-4 h-4" /> Assinar o contrato
            </Button>
          ) : null
        ) : ultimoDeDados ? (
          <Button type="button" onClick={concluir} loading={salvando} className="flex-1 justify-center py-3" data-concluir>
            Concluir e ver o contrato <ArrowRight className="w-4 h-4" />
          </Button>
        ) : (
          <Button type="button" onClick={() => salvar(proxima)} loading={salvando} className="flex-1 justify-center py-3" data-etapa-continuar>
            Salvar e continuar <ArrowRight className="w-4 h-4" />
          </Button>
        )}
      </div>

      {!naAssinatura && (
        <p className="text-center text-xs text-ink-muted flex items-center justify-center gap-1.5">
          {salvando ? <><Loader2 className="w-3 h-3 animate-spin" aria-hidden /> Salvando…</> : "O que foi preenchido fica salvo."}
        </p>
      )}
    </div>
  );
}
