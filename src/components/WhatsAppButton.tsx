
'use client';

import { useSettings } from '@/context/SettingsContext';
import { Button } from '@/components/ui/button';
import { WhatsAppIcon } from './WhatsAppIcon';
import { buildWhatsAppLink, toBrazilE164 } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useState } from 'react';

export default function WhatsAppButton() {
  const { settings, isLoading } = useSettings();
  const { toast } = useToast();
  const [isSending, setIsSending] = useState(false);

  if (isLoading || !settings.storePhone) {
    return null;
  }

  const handleSend = async () => {
    const to = toBrazilE164(settings.storePhone);
    if (!to) {
      toast({ title: 'Erro', description: 'Telefone da loja inválido.', variant: 'destructive' });
      return;
    }

    const message = 'Olá! Vim pelo site e gostaria de mais informações sobre os produtos.';
    const menuiaSendEnabled = settings.menuiaSendEnabled ?? true;
    if (isSending) return;
    setIsSending(true);
    try {
      if (!menuiaSendEnabled) {
        const link = buildWhatsAppLink(to, message);
        if (link) {
          window.open(link, '_blank', 'noopener,noreferrer');
          toast({ title: 'WhatsApp aberto', description: 'Envio manual.' });
          return;
        }
      }
      const res = await fetch('/api/menuia/send-text', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          to,
          message,
        }),
      });

      if (res.ok) {
        toast({ title: 'Enviado!', description: 'Mensagem enviada no WhatsApp da loja.' });
      } else {
        const link = buildWhatsAppLink(to, message);
        if (link) {
          window.open(link, '_blank', 'noopener,noreferrer');
          toast({ title: 'WhatsApp aberto', description: 'Envio manual.' });
          return;
        }
        toast({ title: 'Erro', description: `Falha ao enviar (status ${res.status}).`, variant: 'destructive' });
      }
    } catch {
      const link = buildWhatsAppLink(to, message);
      if (link) {
        window.open(link, '_blank', 'noopener,noreferrer');
        toast({ title: 'WhatsApp aberto', description: 'Envio manual.' });
        return;
      }
      toast({ title: 'Erro', description: 'Falha ao enviar mensagem.', variant: 'destructive' });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 print-hidden">
      <Button
        className="h-14 w-auto rounded-full bg-[#25D366] hover:bg-[#128C7E] text-white shadow-lg transition-transform hover:scale-105 flex items-center justify-center text-base font-bold px-6"
        aria-label="Falar com um vendedor pelo WhatsApp"
        onClick={handleSend}
        disabled={isSending}
      >
        <WhatsAppIcon />
        <span className="ml-2">Falar com vendedor</span>
      </Button>
    </div>
  );
}
