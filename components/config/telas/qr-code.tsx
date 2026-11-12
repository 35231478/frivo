import { auth } from "@/lib/auth";
import { getQrConfig } from "@/lib/qr-config";
import { PageHeader } from "@/components/ui/page-header";
import { QrConfigClient } from "@/components/config/qr-config-client";

export async function TelaQrCode() {
  const session = await auth();
  const empresaId = session!.user!.empresaId;
  const config = await getQrConfig(empresaId);

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="QR Code"
        description="Página pública aberta pelo QR Code dos equipamentos"
        backHref="/configuracoes"
      />
      <QrConfigClient inicial={config} />
    </div>
  );
}
