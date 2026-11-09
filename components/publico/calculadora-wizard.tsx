"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2, MessageCircle, Plus, Sparkles, Trash2 } from "lucide-react";
import { calcularAmbiente, equipamentoDoAmbiente, preOrcamento, recomendarConjunto, TIPOS_AMBIENTE, type TipoAmbiente } from "@/lib/leads/btu";
import { CenaProjeto } from "@/components/publico/cena-projeto";
import { enviarLead } from "@/app/(publico)/calculadora/acao";

interface Linha { id: number; nome: string; tipo: TipoAmbiente; area: string; pessoas: number; sol: boolean; aparelhos: number; cobertura: boolean; completo: boolean }
let seq = 1;
const nova = (): Linha => ({ id: seq++, nome: "", tipo: "quarto", area: "", pessoas: 2, sol: false, aparelhos: 0, cobertura: false, completo: false });
const n = (v: string) => Number(v.replace(",", ".")) || 0;
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const INSTALACAO_UNIT = 900;

type Fase = "wizard" | "resultado" | "lead" | "sucesso";
const PERGUNTAS = ["tipo", "tamanho", "pessoas", "sol", "aparelhos", "cobertura"] as const;

/** Botão de opção (chip) do wizard, estilo premium escuro. */
function Opcao({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={ativo}
      className={`rounded-xl border px-4 py-3 text-sm font-medium text-left transition-all ${ativo ? "border-cena-frio bg-cena-frio/10 text-cena-texto ring-1 ring-cena-frio" : "border-cena-borda bg-cena-painel text-cena-apoio hover:border-cena-frio/60 hover:text-cena-texto"}`}>
      {children}
    </button>
  );
}
const INPUT = "w-full bg-cena-painel border border-cena-borda rounded-xl px-4 py-3 text-cena-texto placeholder:text-cena-apoio/60 focus:outline-none focus:border-cena-frio focus:ring-2 focus:ring-cena-frio/30";

export function CalculadoraWizard({ whatsapp }: { whatsapp?: string | null }) {
  const [linhas, setLinhas] = useState<Linha[]>([nova()]);
  const [idx, setIdx] = useState(0);
  const [passo, setPasso] = useState(0);
  const [fase, setFase] = useState<Fase>("wizard");
  const [contato, setContato] = useState({ nome: "", whatsapp: "", email: "", cidade: "", mensagem: "" });
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [sucesso, setSucesso] = useState<{ codigo: string } | null>(null);

  const atual = linhas[idx];
  const setAtual = (patch: Partial<Linha>) => setLinhas((l) => l.map((x, i) => (i === idx ? { ...x, ...patch } : x)));

  // Cálculos (só ambientes com área)
  const calculados = useMemo(() => linhas.filter((l) => n(l.area) > 0).map((l) =>
    calcularAmbiente({ nome: l.nome, tipo: l.tipo, areaM2: n(l.area), pessoas: l.pessoas, solTarde: l.sol, aparelhos: l.aparelhos, cobertura: l.cobertura })), [linhas]);
  const totais = useMemo(() => preOrcamento(calculados), [calculados]);
  const conjunto = useMemo(() => recomendarConjunto(calculados), [calculados]);
  const instalacao = calculados.length * INSTALACAO_UNIT;

  // Cena: enquanto no wizard, mostra o ambiente atual crescendo; no resultado, o conjunto
  const areaAtual = n(atual?.area ?? "");
  const cenaForma = fase === "resultado" && calculados.length > 1 ? conjunto.forma
    : areaAtual > 0 ? equipamentoDoAmbiente(calcularAmbiente({ nome: "", tipo: atual.tipo, areaM2: areaAtual, pessoas: atual.pessoas, solTarde: atual.sol, aparelhos: atual.aparelhos, cobertura: atual.cobertura }).btuRecomendado, TIPOS_AMBIENTE.find((t) => t.valor === atual.tipo)!.comercial).forma
    : "hi-wall";
  const cenaEscala = fase === "resultado"
    ? Math.min(1, Math.max(...calculados.map((c) => c.areaM2), 10) / 60)
    : Math.min(1, (areaAtual || 10) / 60);

  function proximo() {
    setErro("");
    if (PERGUNTAS[passo] === "tamanho" && areaAtual <= 0) { setErro("Informe a área (m²) do ambiente."); return; }
    if (passo < PERGUNTAS.length - 1) { setPasso(passo + 1); return; }
    // terminou este ambiente
    setAtual({ completo: true });
    setFase("resultado");
  }
  function voltar() { setErro(""); if (passo > 0) setPasso(passo - 1); }
  function adicionarAmbiente() { const nv = nova(); setLinhas((l) => [...l, nv]); setIdx(linhas.length); setPasso(0); setFase("wizard"); }
  function editar(i: number) { setIdx(i); setPasso(0); setFase("wizard"); }
  function excluir(i: number) {
    setLinhas((l) => { const r = l.filter((_, k) => k !== i); return r.length ? r : [nova()]; });
    setIdx(0); setPasso(0);
  }

  async function enviar() {
    setErro("");
    if (contato.nome.trim().length < 3) return setErro("Informe seu nome completo.");
    if (contato.whatsapp.replace(/\D/g, "").length < 10) return setErro("Informe um WhatsApp com DDD para o retorno.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contato.email.trim())) return setErro("Informe um e-mail válido.");
    if (calculados.length === 0) return setErro("Calcule ao menos um ambiente.");
    setEnviando(true);
    try {
      const comercial = calculados.some((c) => c.comercial);
      const r = await enviarLead({
        nome: contato.nome, whatsapp: contato.whatsapp, email: contato.email, cidade: contato.cidade,
        tipoUso: comercial ? "Comercial" : "Residencial", mensagemAdicional: contato.mensagem || undefined,
        recomendacao: calculados.length > 1 ? conjunto.rotulo : calculados[0]?.equipamento.rotulo,
        ambientes: calculados.map((c) => ({ nome: c.nome, areaM2: c.areaM2, btuCalculado: c.btuCalculado, btuRecomendado: c.btuRecomendado, tipoEquipamento: c.tipoEquipamento, justificativa: c.justificativa })),
        preOrcamento: totais,
      });
      if (!r.ok) { setErro(r.erro); return; }
      setSucesso({ codigo: r.codigo });
      setFase("sucesso");
    } catch {
      setErro("Não foi possível enviar agora. Tente de novo em instantes.");
    } finally { setEnviando(false); }
  }

  const linkWhatsapp = useMemo(() => {
    const num = (whatsapp ?? "").replace(/\D/g, "");
    if (num.length < 10) return null;
    const resumo = calculados.map((c) => `${c.nome}: ${c.btuRecomendado.toLocaleString("pt-BR")} BTU/h`).join(" | ");
    const texto = `Vim pela calculadora de BTU do site. ${resumo || "Gostaria de um orçamento"}. Pré-orçamento estimado: ${brl(totais.totalMin + instalacao)} a ${brl(totais.totalMax + instalacao)}.`;
    return `https://wa.me/${num.startsWith("55") ? num : `55${num}`}?text=${encodeURIComponent(texto)}`;
  }, [whatsapp, calculados, totais, instalacao]);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_minmax(300px,420px)]">
      {/* Painel do wizard / resultado */}
      <div className="order-2 lg:order-1 rounded-2xl bg-cena-painel/60 ring-1 ring-cena-borda p-5 sm:p-6" data-painel-wizard>
        {fase === "wizard" && atual && (
          <Pergunta key={`${idx}-${passo}`} chave={PERGUNTAS[passo]} linha={atual} setAtual={setAtual}
            passo={passo} total={PERGUNTAS.length} />
        )}

        {fase === "resultado" && (
          <div className="anim-calc-entra space-y-4" data-fase-resultado>
            <div className="flex items-center gap-2 text-cena-frio"><Sparkles className="w-5 h-5" aria-hidden /><h2 className="text-lg font-semibold text-cena-texto">Seu projeto</h2></div>
            <ul className="space-y-2" data-ambientes-resultado>
              {calculados.map((c, i) => (
                <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-cena-painel ring-1 ring-cena-borda px-4 py-3" data-ambiente-res={i}>
                  <span className="font-medium text-cena-texto">{c.nome}</span>
                  <span className="text-sm text-cena-apoio">{c.areaM2} m²</span>
                  <span className="ml-auto font-semibold tabular-nums text-cena-frio" data-btu={i}>{c.btuRecomendado.toLocaleString("pt-BR")} BTU/h</span>
                  <span className="w-full text-xs text-cena-apoio" data-equip={i}>{c.tipoEquipamento}</span>
                </li>
              ))}
            </ul>
            {calculados.length > 1 && (
              <p className="rounded-xl bg-cena-frio/10 ring-1 ring-cena-frio/40 px-4 py-3 text-sm text-cena-texto" data-conjunto>
                Para {calculados.length} ambientes, o ideal é <strong>{conjunto.rotulo}</strong>.
              </p>
            )}
            <div className="rounded-xl bg-cena-painel ring-1 ring-cena-borda px-4 py-4" data-pre-orcamento>
              <p className="text-sm text-cena-apoio">Pré-orçamento estimado (equipamentos + instalação)</p>
              <p className="mt-1 text-2xl font-bold text-cena-texto tabular-nums">{brl(totais.totalMin + instalacao)} a {brl(totais.totalMax + instalacao)}</p>
              <p className="mt-1 text-xs text-cena-apoio">Instalação de referência {brl(INSTALACAO_UNIT)} por unidade. Valor definitivo após a visita técnica.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => editar(idx)} className="inline-flex items-center gap-1.5 text-sm text-cena-apoio hover:text-cena-texto"><ArrowLeft className="w-4 h-4" aria-hidden /> Ajustar</button>
              <button type="button" onClick={adicionarAmbiente} className="inline-flex items-center gap-1.5 rounded-lg border border-cena-borda px-3 py-2 text-sm font-medium text-cena-texto hover:border-cena-frio/60" data-adicionar-ambiente><Plus className="w-4 h-4" aria-hidden /> Adicionar ambiente</button>
            </div>
            {calculados.length > 1 && (
              <ul className="flex flex-wrap gap-2 pt-1">
                {calculados.map((c, i) => (
                  <li key={i}><button type="button" onClick={() => excluir(i)} className="inline-flex items-center gap-1 rounded-full bg-cena-painel ring-1 ring-cena-borda px-2.5 py-1 text-xs text-cena-apoio hover:text-atrasado" data-excluir-ambiente={i}>{c.nome} <Trash2 className="w-3 h-3" aria-hidden /></button></li>
                ))}
              </ul>
            )}
            <button type="button" onClick={() => setFase("lead")} className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-cena-frio px-6 py-3.5 font-semibold text-cena-fundo hover:bg-cena-frio2 transition-colors" data-cta-orcamento>
              Quero meu orçamento detalhado <ArrowRight className="w-5 h-5" aria-hidden />
            </button>
            {linkWhatsapp && (
              <a href={linkWhatsapp} target="_blank" rel="noreferrer" className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-cena-borda px-6 py-3 font-medium text-cena-texto hover:border-cena-frio/60 transition-colors" data-cta-whatsapp>
                <MessageCircle className="w-5 h-5" aria-hidden /> Falar no WhatsApp
              </a>
            )}
          </div>
        )}

        {fase === "lead" && (
          <div className="anim-calc-entra space-y-4" data-fase-lead>
            <h2 className="text-lg font-semibold text-cena-texto">Quase lá — para onde enviamos o orçamento?</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input className={INPUT} placeholder="Nome completo *" value={contato.nome} onChange={(e) => { setContato({ ...contato, nome: e.target.value }); setErro(""); }} data-contato-nome />
              <input className={INPUT} inputMode="tel" placeholder="WhatsApp (com DDD) *" value={contato.whatsapp} onChange={(e) => { setContato({ ...contato, whatsapp: e.target.value }); setErro(""); }} data-contato-whatsapp />
              <input className={INPUT} inputMode="email" placeholder="E-mail *" value={contato.email} onChange={(e) => { setContato({ ...contato, email: e.target.value }); setErro(""); }} data-contato-email />
              <input className={INPUT} placeholder="Cidade" value={contato.cidade} onChange={(e) => setContato({ ...contato, cidade: e.target.value })} data-contato-cidade />
            </div>
            {erro && <p className="text-sm font-medium text-atrasado" role="alert" data-erro-lead>{erro}</p>}
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setFase("resultado")} className="inline-flex items-center gap-1.5 text-sm text-cena-apoio hover:text-cena-texto"><ArrowLeft className="w-4 h-4" aria-hidden /> Voltar</button>
              <button type="button" onClick={enviar} disabled={enviando} className="ml-auto inline-flex items-center justify-center gap-2 rounded-xl bg-cena-frio px-6 py-3 font-semibold text-cena-fundo hover:bg-cena-frio2 disabled:opacity-60 transition-colors" data-enviar-lead>
                {enviando ? <><Loader2 className="w-5 h-5 animate-spin" aria-hidden /> Enviando…</> : <>Enviar e receber o orçamento</>}
              </button>
            </div>
          </div>
        )}

        {fase === "sucesso" && sucesso && (
          <div className="anim-calc-entra text-center py-8" data-sucesso-lead>
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-cena-frio/15 ring-1 ring-cena-frio"><Check className="w-7 h-7 text-cena-frio" aria-hidden /></span>
            <h2 className="mt-4 text-xl font-bold text-cena-texto">Pedido enviado.</h2>
            <p className="mt-2 text-sm text-cena-apoio max-w-md mx-auto">A solicitação (nº <strong className="font-mono text-cena-texto">{sucesso.codigo}</strong>) chegou à nossa equipe. O retorno vem pelo WhatsApp com o orçamento.</p>
          </div>
        )}

        {/* navegação do wizard */}
        {fase === "wizard" && (
          <div className="mt-6 flex items-center gap-3">
            {(passo > 0 || idx > 0) && <button type="button" onClick={voltar} className="inline-flex items-center gap-1.5 text-sm text-cena-apoio hover:text-cena-texto" data-voltar><ArrowLeft className="w-4 h-4" aria-hidden /> Voltar</button>}
            {erro && <p className="text-sm font-medium text-atrasado" role="alert" data-erro-wizard>{erro}</p>}
            <button type="button" onClick={proximo} className="ml-auto inline-flex items-center justify-center gap-2 rounded-xl bg-cena-frio px-6 py-3 font-semibold text-cena-fundo hover:bg-cena-frio2 transition-colors" data-continuar>
              {passo === PERGUNTAS.length - 1 ? "Ver meu projeto" : "Continuar"} <ArrowRight className="w-5 h-5" aria-hidden />
            </button>
          </div>
        )}
      </div>

      {/* A cena do projeto, formando-se */}
      <div className="order-1 lg:order-2 lg:sticky lg:top-5 self-start" data-cena-lado>
        <CenaProjeto escala={cenaEscala} forma={cenaForma} ativo={areaAtual > 0 || calculados.length > 0} nInternas={calculados.length || 1} />
        <p className="mt-2 text-center text-xs text-cena-apoio">{calculados.length > 1 ? `${calculados.length} ambientes` : "O projeto se forma a cada resposta."}</p>
      </div>
    </div>
  );
}

/** Uma pergunta do wizard (uma de cada vez). */
function Pergunta({ chave, linha, setAtual, passo, total }: {
  chave: (typeof PERGUNTAS)[number]; linha: Linha; setAtual: (p: Partial<Linha>) => void; passo: number; total: number;
}) {
  return (
    <div className="anim-calc-entra" data-pergunta={chave}>
      <p className="text-xs font-medium uppercase tracking-wider text-cena-frio">Passo {passo + 1} de {total}</p>
      {chave === "tipo" && (
        <>
          <h2 className="mt-1 text-lg font-semibold text-cena-texto">Que ambiente é esse?</h2>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
            {TIPOS_AMBIENTE.map((t) => <Opcao key={t.valor} ativo={linha.tipo === t.valor} onClick={() => setAtual({ tipo: t.valor })}>{t.rotulo}</Opcao>)}
          </div>
          <input className={`${INPUT} mt-3`} placeholder="Dê um nome (ex.: Quarto do casal)" value={linha.nome} onChange={(e) => setAtual({ nome: e.target.value })} data-amb-nome />
        </>
      )}
      {chave === "tamanho" && (
        <>
          <h2 className="mt-1 text-lg font-semibold text-cena-texto">Qual o tamanho do ambiente?</h2>
          <p className="mt-1 text-sm text-cena-apoio">Em metros quadrados (m²). Serve para ambientes pequenos e grandes.</p>
          <input className={`${INPUT} mt-4`} inputMode="decimal" placeholder="Ex.: 18" value={linha.area} onChange={(e) => setAtual({ area: e.target.value })} data-amb-area autoFocus />
        </>
      )}
      {chave === "pessoas" && (
        <>
          <h2 className="mt-1 text-lg font-semibold text-cena-texto">Quantas pessoas costumam ficar juntas?</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {[1, 2, 3, 4, 6, 8].map((p) => <Opcao key={p} ativo={linha.pessoas === p} onClick={() => setAtual({ pessoas: p })}>{p === 8 ? "8+" : p}</Opcao>)}
          </div>
        </>
      )}
      {chave === "sol" && (
        <>
          <h2 className="mt-1 text-lg font-semibold text-cena-texto">Pega sol forte à tarde?</h2>
          <div className="mt-4 flex gap-2">
            <Opcao ativo={linha.sol} onClick={() => setAtual({ sol: true })}>Sim, bastante</Opcao>
            <Opcao ativo={!linha.sol} onClick={() => setAtual({ sol: false })}>Não / pouco</Opcao>
          </div>
        </>
      )}
      {chave === "aparelhos" && (
        <>
          <h2 className="mt-1 text-lg font-semibold text-cena-texto">Aparelhos que esquentam no ambiente?</h2>
          <p className="mt-1 text-sm text-cena-apoio">TV, forno, computadores, servidores…</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {[0, 1, 2, 3, 5].map((a) => <Opcao key={a} ativo={linha.aparelhos === a} onClick={() => setAtual({ aparelhos: a })}>{a === 0 ? "Nenhum" : a === 5 ? "5+" : a}</Opcao>)}
          </div>
        </>
      )}
      {chave === "cobertura" && (
        <>
          <h2 className="mt-1 text-lg font-semibold text-cena-texto">É último andar ou cobertura?</h2>
          <p className="mt-1 text-sm text-cena-apoio">O telhado pega sol e aumenta a carga térmica.</p>
          <div className="mt-4 flex gap-2">
            <Opcao ativo={linha.cobertura} onClick={() => setAtual({ cobertura: true })}>Sim</Opcao>
            <Opcao ativo={!linha.cobertura} onClick={() => setAtual({ cobertura: false })}>Não</Opcao>
          </div>
        </>
      )}
    </div>
  );
}
