"use client";

import { useRef, useState } from "react";
import SignatureCanvas from "react-signature-canvas";
import { AlertCircle, CheckCircle2, Eraser, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { neutro } from "@/lib/ui/tokens";
import { AvaliacaoDoCliente } from "@/components/os/avaliacao-cliente";
import { escalarTracos, exportarAssinatura, useAssinaturaPreservada, type Tamanho, type Traco } from "@/lib/assinatura-quadro";
import { AssinaturaTelaCheia } from "@/components/os/assinatura-tela-cheia";
import { MSG_ASSINATURA, MSG_NOME, NOME_MAX, NOME_MIN, aceiteLocalSchema, type AceiteLocal } from "@/lib/os/aceite";

/**
 * Aceite NO LOCAL: o responsável do cliente informa o nome e assina no quadro, na tela de quem está
 * com ele (o app do técnico ou o escritório). `aoConfirmar` devolve a mensagem de erro, ou null se gravou.
 * `pedirAvaliacao`: a empresa pede a avaliação do serviço — o cliente dá a nota ali mesmo, se quiser.
 * `telaCheia` (D6, app do técnico): "Assinar em tela cheia" — o quadro do tamanho da tela, em paisagem; a assinatura
 * volta para o quadro daqui em escala (sem distorcer) e sai na mesma imagem de sempre.
 */
export function AssinaturaDoCliente({ resumo, aoConfirmar, aoCancelar, pedirAvaliacao = false, telaCheia = false }: {
  /** De qual serviço se trata, para quem assina ler antes ("OS-123 · Hospital Santa Clara") */
  resumo: string;
  aoConfirmar: (dados: AceiteLocal) => Promise<string | null>;
  aoCancelar: () => void;
  pedirAvaliacao?: boolean;
  telaCheia?: boolean;
}) {
  const quadro = useRef<SignatureCanvas | null>(null);
  // Girar o celular, abrir o teclado ou a janela mudar de tamanho não apaga nem distorce o traço
  useAssinaturaPreservada(quadro);
  const [nome, setNome] = useState("");
  const [nota, setNota] = useState<number | null>(null);
  const [comentario, setComentario] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [cheia, setCheia] = useState<{ tracos: Traco[]; tamanho: Tamanho } | null | false>(false);
  const tamanhoDoQuadro = (): Tamanho => { const c = quadro.current?.getCanvas(); return { largura: c?.offsetWidth ?? 0, altura: c?.offsetHeight ?? 0 }; };
  function abrirTelaCheia() {
    const tracos = (quadro.current?.toData() ?? []) as unknown as Traco[];
    setCheia(tracos.length ? { tracos, tamanho: tamanhoDoQuadro() } : null);
  }
  // A assinatura feita na tela cheia volta para o quadro daqui, em escala (a mesma conta de girar o aparelho)
  function usarDaTelaCheia(tracos: Traco[], de: Tamanho) {
    setCheia(false);
    const q = quadro.current;
    if (!q) return;
    const para = tamanhoDoQuadro();
    q.fromData((para.largura && para.altura ? escalarTracos(tracos, de, para) : tracos) as unknown as ReturnType<SignatureCanvas["toData"]>);
    setErro("");
  }

  // Dois toques rápidos em "Confirmar": um aceite só (o estado do React ainda não mudou no 2º toque)
  const travado = useRef(false);
  async function confirmar() {
    if (travado.current) return;
    setErro("");
    if (nome.trim().length < NOME_MIN) return setErro(MSG_NOME);
    if (!quadro.current || quadro.current.isEmpty()) return setErro(MSG_ASSINATURA);
    const dados = aceiteLocalSchema.safeParse({
      nome, assinatura: exportarAssinatura(quadro.current),
      ...(pedirAvaliacao && { avaliacao: nota, avaliacaoComentario: nota ? comentario : null }),
    });
    if (!dados.success) return setErro(dados.error.issues[0]?.message ?? MSG_ASSINATURA);
    setEnviando(true); travado.current = true;
    try {
      const falha = await aoConfirmar(dados.data);
      if (falha) setErro(falha);
    } catch { setErro("Não foi possível gravar a assinatura. Tente de novo."); } finally { setEnviando(false); travado.current = false; }
  }

  return (
    <div className="space-y-4" data-assinatura-cliente>
      <p className="text-sm text-ink" data-resumo-aceite>
        <span>Confirmo que o serviço foi realizado: </span><strong>{resumo}</strong>.
      </p>
      {erro && (
        <p role="alert" className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2 flex items-center gap-2" data-erro-aceite>
          <AlertCircle className="w-4 h-4 shrink-0" aria-hidden /> {erro}
        </p>
      )}
      <label className="block">
        <span className="text-sm font-semibold text-ink">Nome de quem recebeu o serviço</span>
        <input aria-label="Nome de quem recebeu o serviço" value={nome} maxLength={NOME_MAX} disabled={enviando} onChange={(e) => setNome(e.target.value)}
          placeholder="Nome completo" autoComplete="off"
          className="mt-1 w-full bg-white border border-surface-border rounded-lg px-3 py-3 text-base text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10" />
      </label>
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-semibold text-ink">Assinatura</span>
          <span className="inline-flex items-center gap-3">
            {telaCheia && (
              <button type="button" onClick={abrirTelaCheia} disabled={enviando} className="text-sm font-semibold text-primary-700 inline-flex items-center gap-1 min-h-[44px]" data-assinar-tela-cheia>
                <Maximize2 className="w-4 h-4" aria-hidden /> Assinar em tela cheia
              </button>
            )}
            <button type="button" onClick={() => quadro.current?.clear()} className={cn("text-ink-muted hover:text-primary-600 inline-flex items-center gap-1", telaCheia ? "text-sm min-h-[44px]" : "text-xs py-1")} data-limpar-assinatura>
              <Eraser className="w-3 h-3" aria-hidden /> Limpar
            </button>
          </span>
        </div>
        <div className="bg-surface-alt border-2 border-dashed border-surface-border rounded-lg overflow-hidden touch-none">
          <SignatureCanvas ref={quadro} clearOnResize={false} penColor={neutro.texto} canvasProps={{ className: "w-full h-44 bg-white", "aria-label": "Quadro de assinatura" } as React.CanvasHTMLAttributes<HTMLCanvasElement>} />
        </div>
        <p className="text-xs text-ink-subtle mt-1">Assine com o dedo, dentro do quadro.</p>
      </div>
      {cheia !== false && <AssinaturaTelaCheia inicial={cheia} aoUsar={usarDaTelaCheia} aoVoltar={() => setCheia(false)} />}
      {pedirAvaliacao && <AvaliacaoDoCliente nota={nota} comentario={comentario} aoMudarNota={setNota} aoMudarComentario={setComentario} desabilitado={enviando} />}
      <p className="text-xs text-ink-muted" data-aviso-registro>
        <span>Ficam registrados o nome, a assinatura, a data e a hora. </span>
        <span>A confirmação entra no relatório da OS.</span>
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="secondary" onClick={aoCancelar} disabled={enviando} className="py-3">Cancelar</Button>
        <Button type="button" variant="success" onClick={confirmar} loading={enviando} className="py-3" data-confirmar-aceite>
          <CheckCircle2 className="w-5 h-5" aria-hidden /> Confirmar
        </Button>
      </div>
    </div>
  );
}
