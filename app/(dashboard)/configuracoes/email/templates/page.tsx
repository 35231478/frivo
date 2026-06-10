import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { EmailTemplatesClient } from "@/components/config/email-templates-client";

export const metadata: Metadata = { title: "Templates de E-mail" };

export default function EmailTemplatesPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="Templates de E-mail" description="Personalize o assunto e o corpo dos e-mails automáticos" backHref="/configuracoes/email" />
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <EmailTemplatesClient />
      </div>
    </div>
  );
}
