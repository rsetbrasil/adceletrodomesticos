

'use client';

import { useParams } from 'next/navigation';
import { useMemo, useState, useEffect } from 'react';
import type { Order, StoreSettings } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Printer, ShoppingCart, Phone } from 'lucide-react';
import Logo from '@/components/Logo';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { generatePixPayload } from '@/lib/pix';
import PixQRCode from '@/components/PixQRCode';
import { cn, displayNumericCode } from '@/lib/utils';
import { getClientFirebase } from '@/lib/firebase-client';
import { doc, getDoc } from 'firebase/firestore';
import { useSettings } from '@/context/SettingsContext';


const formatCurrency = (value: number) => {
  if (typeof value !== 'number') return 'R$ 0,00';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
};

const CarnetContent = ({ order, settings, pixPayload }: { order: Order; settings: StoreSettings, pixPayload: string | null }) => {
    
    const subtotal = useMemo(() => order.items.reduce((acc, item) => acc + (item.price * item.quantity), 0), [order.items]);
    const valorFinanciado = order.total;

    return (
    <div className="carnet-content-wrapper bg-white break-inside-avoid print:p-0 text-sm print:text-[10px] print:leading-tight print-default:text-[9px] print-default:leading-tight print-a4:text-[11px] print-a4:leading-snug">
        <div className="pb-2 print:pb-1 print-default:pb-0.5 border-b">
            <div style={{ display: 'table', width: '100%' }}>
                <div style={{ display: 'table-row' }}>
                    <div style={{ display: 'table-cell', verticalAlign: 'middle', paddingRight: '0.75rem' }}>
                        <Logo />
                    </div>
                    <div style={{ display: 'table-cell', verticalAlign: 'middle' }}>
                        <div className="text-xs">
                            <p className="font-bold">{settings.storeName}</p>
                            <p className="whitespace-pre-line">{settings.storeAddress}</p>
                        </div>
                    </div>
                     <div style={{ display: 'table-cell', width: '30%', verticalAlign: 'middle', textAlign: 'right' }}>
                        {settings.storePhone && (
                            <p className="text-foreground flex items-center gap-1 justify-end font-semibold text-sm print:text-[11px] print-default:text-[11px] print-a4:text-[13px]">
                                <Phone className="h-4 w-4 print:h-3 print:w-3" /> WhatsApp: {settings.storePhone}
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </div>

        <div className="text-center my-2 print:my-1 print-default:my-0.5">
            <p className="font-semibold text-sm print:text-[11px] print-default:text-[10px] print-a4:text-[12px]">Pedido Nº</p>
            <p className="font-mono text-xl print:text-[16px] print-default:text-[14px] print-a4:text-[20px]">{displayNumericCode(order.id)}</p>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-start md:gap-4 print:flex-row print:items-start print:gap-2 print-default:gap-1 border-t py-2 print:py-0.5 print-default:py-0.5">
            <div className="flex-grow min-w-0">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 print:gap-x-2 print:gap-y-0 print-default:gap-x-2">
                    <div>
                        <p className="text-xs print:text-[9px] print-default:text-[8px] print-a4:text-[10px] text-muted-foreground">CLIENTE</p>
                        <p className="font-semibold">{order.customer.name}</p>
                        {order.customer.code && (
                            <p className="text-xs print:text-[9px] print-default:text-[8px] print-a4:text-[10px] text-muted-foreground">
                                CÓDIGO: <span className="font-semibold text-foreground">{displayNumericCode(order.customer.code)}</span>
                            </p>
                        )}
                    </div>
                    <div>
                        <p className="text-xs print:text-[9px] print-default:text-[8px] print-a4:text-[10px] text-muted-foreground">CPF</p>
                        <p className="font-semibold">{order.customer.cpf}</p>
                    </div>
                    <div>
                        <p className="text-xs print:text-[9px] print-default:text-[8px] print-a4:text-[10px] text-muted-foreground">TELEFONE</p>
                        <p className="font-semibold">{order.customer.phone}</p>
                    </div>
                    <div className="col-span-2">
                        <p className="text-xs print:text-[9px] print-default:text-[8px] print-a4:text-[10px] text-muted-foreground">ENDEREÇO</p>
                        <p className="font-semibold">{`${order.customer.address}, ${order.customer.number}${order.customer.complement ? `, ${order.customer.complement}` : ''}, ${order.customer.neighborhood} - ${order.customer.city}/${order.customer.state}`}</p>
                    </div>
                    <div>
                        <p className="text-xs print:text-[9px] print-default:text-[8px] print-a4:text-[10px] text-muted-foreground">DATA DA COMPRA</p>
                        <p className="font-semibold">{format(new Date(order.date), 'dd/MM/yyyy', { locale: ptBR })}</p>
                    </div>
                    <div>
                        <p className="text-xs print:text-[9px] print-default:text-[8px] print-a4:text-[10px] text-muted-foreground">VENDEDOR(A)</p>
                        <p className="font-semibold">{order.sellerName}</p>
                    </div>
                    <div className="col-span-2">
                        <p className="text-xs print:text-[9px] print-default:text-[8px] print-a4:text-[10px] text-muted-foreground">PRODUTOS</p>
                        <p className="font-semibold">{order.items.map(item => item.name).join(', ')}</p>
                    </div>
                </div>

                {order.observations && (
                    <div className="pt-2 print:pt-1 print-default:pt-0.5">
                        <p className="text-xs print:text-[9px] print-default:text-[8px] print-a4:text-[10px] text-muted-foreground">OBSERVAÇÕES</p>
                        <p className="font-semibold whitespace-pre-line">{order.observations}</p>
                    </div>
                )}
            </div>

            {pixPayload && (
                <div className="carnet-pix w-full sm:w-56 md:w-60 flex-shrink-0 print:w-40 print-default:w-36 print-a4:w-44">
                    <PixQRCode payload={pixPayload} />
                </div>
            )}
        </div>

        <div className="mt-2 print-default:mt-1">
            <div className="border rounded-md overflow-hidden">
                <table className="w-full text-xs print:text-[9px] print-default:text-[8px] print-a4:text-[10px] print:leading-tight carnet-table">
                    <thead className="bg-muted/50 print:bg-gray-100">
                        <tr className="border-b">
                            <th className="p-1 print:p-0.5 text-center font-medium w-[15%]">Parc.</th>
                            <th className="p-1 print:p-0.5 text-left font-medium w-[25%]">Venc.</th>
                            <th className="p-1 print:p-0.5 text-right font-medium w-[30%]">Valor (R$)</th>
                            <th className="p-1 print:p-0.5 text-center font-medium w-[30%]">Data Pag.</th>
                        </tr>
                    </thead>
                    <tbody>
                        {(order.installmentDetails || []).map((installment) => (
                            <tr key={installment.installmentNumber} className="border-b last:border-none">
                                <td className="p-1 print:p-0.5 text-center font-medium">{installment.installmentNumber}/{order.installments}</td>
                                <td className="p-1 print:p-0.5">{format(parseISO(installment.dueDate), 'dd/MM/yy')}</td>
                                <td className="p-1 print:p-0.5 text-right font-mono">{formatCurrency(installment.amount)}</td>
                                <td className="p-1 print:p-0.5 border-l text-center font-mono">
                                    {installment.status === 'Pago' 
                                        ? (installment.paymentDate ? format(parseISO(installment.paymentDate), 'dd/MM/yy') : 'Pago')
                                        : '___/__/____'
                                    }
                                </td>
                            </tr>
                        ))}
                    </tbody>
                     <tfoot className="bg-muted/50 print:bg-gray-100 font-bold">
                        <tr className="border-t">
                            <td colSpan={2} className="p-1 print:p-0.5 text-right">SUBTOTAL:</td>
                            <td className="p-1 print:p-0.5 text-right font-mono">{formatCurrency(subtotal)}</td>
                            <td className="p-1 print:p-0.5"></td>
                        </tr>
                        {(order.downPayment || 0) > 0 && (
                            <tr className="border-t">
                                <td colSpan={2} className="p-1 print:p-0.5 text-right text-green-600">ENTRADA:</td>
                                <td className="p-1 print:p-0.5 text-right font-mono text-green-600">- {formatCurrency(order.downPayment || 0)}</td>
                                <td className="p-1 print:p-0.5"></td>
                            </tr>
                        )}
                        {(order.discount || 0) > 0 && (
                            <tr className="border-t">
                                <td colSpan={2} className="p-1 print:p-0.5 text-right text-destructive">DESCONTO:</td>
                                <td className="p-1 print:p-0.5 text-right font-mono text-destructive">- {formatCurrency(order.discount || 0)}</td>
                                <td className="p-1 print:p-0.5"></td>
                            </tr>
                        )}
                        <tr className="border-t text-sm print:text-[10px] print-default:text-[9px] print-a4:text-[11px]">
                            <td colSpan={2} className="p-1 print:p-0.5 text-right">VALOR TOTAL:</td>
                            <td className="p-1 print:p-0.5 text-right font-mono">{formatCurrency(valorFinanciado)}</td>
                            <td className="p-1 print:p-0.5"></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>


        <div className="mt-2 print:mt-1 print-default:mt-1 text-xs print:text-[9px] print-default:text-[8px] print-a4:text-[10px] print-default:leading-tight text-muted-foreground">
            <p className="font-semibold">Observações:</p>
            <p>1. O pagamento pode ser realizado na loja ou via PIX (solicite o código ao vendedor).</p>
            <p>2. Em caso de atraso, juros e multas podem ser aplicados.</p>
        </div>
    </div>
);
}

export default function CarnetPage() {
  const params = useParams();
  const { settings, isLoading: isSettingsLoading } = useSettings();
  const [order, setOrder] = useState<Order | null>(null);
  const [isOrderLoading, setIsOrderLoading] = useState(true);

  useEffect(() => {
    const orderId = params.id as string;
    if (!orderId) {
      setIsOrderLoading(false);
      return;
    }
    
    const { db } = getClientFirebase();
    const orderRef = doc(db, 'orders', orderId);
    
    getDoc(orderRef)
      .then((orderDoc) => {
        if (orderDoc.exists()) {
          setOrder({ id: orderDoc.id, ...orderDoc.data() } as Order);
        }
      })
      .catch(error => {
        setOrder(null);
      })
      .finally(() => {
        setIsOrderLoading(false);
      });

  }, [params.id]);


  const nextPendingInstallment = useMemo(() => {
    if (!order || !order.installmentDetails) return null;
    // Garante que as parcelas estão ordenadas antes de encontrar a primeira pendente
    const sortedInstallments = [...order.installmentDetails].sort((a,b) => a.installmentNumber - b.installmentNumber);
    return sortedInstallments.find(inst => inst.status === 'Pendente');
  }, [order]);

  const pixPayload = useMemo(() => {
    if (!nextPendingInstallment || !settings.pixKey || !order) return null;
    
    return generatePixPayload(
      settings.pixKey,
      settings.storeName,
      settings.storeCity,
      `${order.id}-${nextPendingInstallment.installmentNumber}`,
      nextPendingInstallment.amount
    );
  }, [nextPendingInstallment, order, settings]);

  const handlePrint = (layout: 'default' | 'a4') => {
    document.body.classList.remove('print-layout-default', 'print-layout-a4');
    document.body.classList.add(`print-layout-${layout}`);
    
    // Use a short timeout to allow state to update and classes to be applied
    setTimeout(() => {
        window.print();
    }, 100);
  };


  if (isOrderLoading || isSettingsLoading) {
    return <div className="p-8 text-center">Carregando carnê...</div>;
  }

  if (!order) {
    return (
      <div className="container mx-auto py-24 text-center">
        <h1 className="text-2xl font-bold">Pedido não encontrado</h1>
        <Button onClick={() => window.close()} className="mt-6">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar
        </Button>
      </div>
    );
  }
  
  if (order.paymentMethod !== 'Crediário' || !order.installmentDetails || order.installmentDetails.length === 0) {
    return (
      <div className="container mx-auto py-24 text-center">
        <ShoppingCart className="mx-auto h-12 w-12 text-muted-foreground" />
        <h1 className="mt-4 text-2xl font-bold">Este pedido não é um carnê</h1>
        <p className="text-muted-foreground mt-2">O método de pagamento foi {order.paymentMethod} e não possui parcelamento.</p>
        <Button onClick={() => window.close()} className="mt-6">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar
        </Button>
      </div>
    );
  }

  return (
    <div className={cn("bg-muted/30 print:bg-white")}>
       <div className="container mx-auto max-w-7xl py-8 print:p-0 print:m-0 print:max-w-full">
        <header className="flex justify-between items-center mb-8 print-hidden">
          <Button variant="ghost" onClick={() => window.close()}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Button>
          <div className="text-center">
             <h1 className="text-2xl font-bold">Carnê de Pagamento</h1>
             <p className="text-muted-foreground">Pedido: {displayNumericCode(order.id)}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => handlePrint('default')}>
                <Printer className="mr-2 h-4 w-4" />
                Carnê Duas Vias
            </Button>
            <Button onClick={() => handlePrint('a4')}>
                <Printer className="mr-2 h-4 w-4" />
                Carnê Completo
            </Button>
          </div>
        </header>
        
        <main className="w-full bg-white p-6 print:p-0 print:shadow-none print-default:grid print-default:grid-cols-2 print-default:gap-x-4 print-a4:block">
            <div className="print-default:border-r print-default:border-dashed print-default:border-black print-default:pr-4">
                <CarnetContent order={order} settings={settings} pixPayload={pixPayload} />
            </div>
            <div className="hidden print-default:block print-default:pl-4">
                <CarnetContent order={order} settings={settings} pixPayload={pixPayload} />
            </div>
        </main>
      </div>
    </div>
  );
}
