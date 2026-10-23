import { QrCode } from "lucide-react";
import { FrivoLogo } from "@/components/layout/frivo-logo";

/**
 * UX-6 (G6): etiqueta QR inválida ou desativada não cai mais no 404 cru do Next.
 * A pessoa está na frente do equipamento — a página diz o que houve e o que fazer.
 */
export default function QrNaoEncontrado() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
      <QrCode className="w-12 h-12 text-ink-subtle mb-4" aria-hidden />
      <h1 className="text-xl font-bold text-ink">Etiqueta não encontrada</h1>
      <p className="text-sm text-ink-muted mt-2 max-w-sm">
        Este QR Code não existe mais ou foi desativado — pode ser uma etiqueta antiga ou de um
        equipamento que foi substituído.
      </p>
      <p className="text-sm text-ink-muted mt-2 max-w-sm">
        Precisa de atendimento? Fale com a empresa responsável pela manutenção do equipamento
        pelos canais de sempre (telefone ou WhatsApp).
      </p>
      <div className="mt-8 opacity-60"><FrivoLogo size="sm" variant="dark" /></div>
    </div>
  );
}
