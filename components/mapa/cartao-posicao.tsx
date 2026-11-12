import Link from "next/link";
import { BatteryMedium, Clock, ExternalLink, MapPin, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  frescor, linkNoMapa, textoBateria, textoCoordenadas, textoPrecisao, textoVisto, type OsNoMapa, type PosicaoNoMapa,
} from "@/lib/tecnico/posicao";

/** "Executando OS-2026-0102 · Hospital Santa Luzia" (ou "No local: …"), com o link para a OS */
export function LinhaOs({ os, className, semLink }: { os: OsNoMapa | null; className?: string; /** Só o texto (dentro de um botão não cabe link) */ semLink?: boolean }) {
  if (!os) return <span className={cn("text-ink-muted", className)} data-sem-os>Sem OS em andamento</span>;
  if (semLink) return <span className={cn("text-acento-hover font-medium", className)} data-os-do-tecnico={os.situacao}>{os.situacao === "EM_ANDAMENTO" ? "Executando" : "No local:"} {os.numero} · {os.cliente}</span>;
  return (
    <Link href={`/ordens/${os.osId}`} className={cn("text-acento-hover font-medium hover:underline", className)} data-os-do-tecnico={os.situacao}>
      {os.situacao === "EM_ANDAMENTO" ? "Executando" : "No local:"} {os.numero} · {os.cliente}
    </Link>
  );
}

/**
 * O que aparece ao clicar no marcador: quem é, a OS em que está, quando foi visto, as coordenadas e a
 * bateria. A bateria só existe quando o aparelho informa (Android); no iPhone a web não dá acesso —
 * aí é "—", nunca um número inventado. Posição antiga vem marcada, para não parecer tempo real.
 */
export function CartaoPosicao({ nome, os, posicao, agora }: { nome: string; os: OsNoMapa | null; posicao: PosicaoNoMapa; agora: number }) {
  const idade = frescor(posicao.registradoEm, agora);
  const precisao = textoPrecisao(posicao.precisaoM);
  const linha = "flex items-start gap-2";
  const icone = "w-4 h-4 text-ink-subtle shrink-0 mt-0.5";
  return (
    <div className="space-y-1.5 text-sm text-ink min-w-[14rem]" data-cartao-posicao data-frescor={idade}>
      <p className="font-display font-bold text-base leading-tight" data-nome>{nome}</p>
      <p className={linha}><Wrench className={icone} aria-hidden /><LinhaOs os={os} /></p>
      <p className={linha}>
        <Clock className={icone} aria-hidden />
        <span>
          <span data-visto>{textoVisto(posicao.registradoEm, agora)}</span>
          {idade === "antiga" && <span className="block w-fit mt-1 rounded-full bg-surface-linha text-ink-muted text-xs font-semibold px-2 py-0.5 whitespace-nowrap" data-posicao-antiga>Posição antiga</span>}
        </span>
      </p>
      <p className={linha}>
        <MapPin className={icone} aria-hidden />
        <span><span data-coordenadas>{textoCoordenadas(posicao.lat, posicao.lng)}</span>{precisao && <span className="text-ink-muted" data-precisao> · {precisao}</span>}</span>
      </p>
      <p className={linha}>
        <BatteryMedium className={icone} aria-hidden />
        <span><span className="text-ink-muted">Bateria: </span><span data-bateria>{textoBateria(posicao.bateria, posicao.carregando)}</span></span>
      </p>
      <a href={linkNoMapa(posicao.lat, posicao.lng)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-acento-hover hover:underline pt-1" data-abrir-google-maps>
        <ExternalLink className="w-3.5 h-3.5" aria-hidden /> Abrir no Google Maps
      </a>
    </div>
  );
}
