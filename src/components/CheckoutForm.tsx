

'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useCart } from '@/context/CartContext';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import type { Order, CustomerInfo } from '@/lib/types';
import { addMonths } from 'date-fns';
import { AlertTriangle, CreditCard, KeyRound, Trash2, UserSquare } from 'lucide-react';
import { useSettings } from '@/context/SettingsContext';
import { useAdmin } from '@/context/AdminContext';
import { useAuth } from '@/context/AuthContext';
import { useAudit } from '@/context/AuditContext';
import { useData } from '@/context/DataContext';
import { Textarea } from './ui/textarea';
import { ToastAction } from '@/components/ui/toast';
import { getClientFirebase } from '@/lib/firebase-client';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { WhatsAppIcon } from '@/components/WhatsAppIcon';
import { buildWhatsAppLink, displayNumericCode, toBrazilE164 } from '@/lib/utils';

function isValidCPF(cpf: string) {
    if (typeof cpf !== 'string') return false;
    cpf = cpf.replace(/[^\d]+/g, '');
    if (cpf.length !== 11 || !!cpf.match(/(\d)\1{10}/)) return false;
    const cpfDigits = cpf.split('').map(el => +el);
    const rest = (count: number) => (cpfDigits.slice(0, count).reduce((soma, el, index) => soma + el * (count + 1 - index), 0) * 10) % 11 % 10;
    return rest(9) === cpfDigits[9] && rest(10) === cpfDigits[10];
}

const checkoutSchema = z.object({
  name: z.string().min(3, 'Nome completo é obrigatório.'),
  cpf: z.string().refine(isValidCPF, {
    message: 'CPF inválido.',
  }),
  phone: z.string().min(10, 'O telefone principal (WhatsApp) é obrigatório.'),
  phone2: z.string().optional(),
  phone3: z.string().optional(),
  email: z.string().email('E-mail inválido.').optional().or(z.literal('')),
  zip: z.string().refine((value) => {
    const justDigits = value.replace(/\D/g, '');
    return justDigits.length === 8;
  }, 'CEP inválido. Deve conter 8 dígitos.'),
  address: z.string().min(3, 'Endereço é obrigatório.'),
  number: z.string().min(1, 'Número é obrigatório.'),
  complement: z.string().optional(),
  neighborhood: z.string().min(2, 'Bairro é obrigatório.'),
  city: z.string().min(2, 'Cidade é obrigatória.'),
  state: z.string().min(2, 'Estado é obrigatório.'),
  observations: z.string().optional(),
});


const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
};

const formatPhone = (value: string) => {
    if (!value) return '';
    const digitsOnly = value.replace(/\D/g, '');
    if (digitsOnly.length <= 2) {
      return `(${digitsOnly}`;
    }
    if (digitsOnly.length <= 7) {
      return `(${digitsOnly.slice(0, 2)}) ${digitsOnly.slice(2)}`;
    }
    return `(${digitsOnly.slice(0, 2)}) ${digitsOnly.slice(2, 7)}-${digitsOnly.slice(7, 11)}`;
};

const formatCpf = (value: string) => {
  if (!value) return '';
  const digitsOnly = value.replace(/\D/g, '').slice(0, 11);
  if (digitsOnly.length <= 3) return digitsOnly;
  if (digitsOnly.length <= 6) {
    return `${digitsOnly.slice(0, 3)}.${digitsOnly.slice(3)}`;
  }
  if (digitsOnly.length <= 9) {
    return `${digitsOnly.slice(0, 3)}.${digitsOnly.slice(3, 6)}.${digitsOnly.slice(6)}`;
  }
  return `${digitsOnly.slice(0, 3)}.${digitsOnly.slice(3, 6)}.${digitsOnly.slice(6, 9)}-${digitsOnly.slice(9)}`;
};

export default function CheckoutForm() {
  const { cartItems, getCartTotal, clearCart, setLastOrder, removeFromCart } = useCart();
  const { settings } = useSettings();
  const { addOrder } = useAdmin();
  const { products } = useData();
  const { user } = useAuth();
  const { logAction } = useAudit();
  const router = useRouter();
  const { toast } = useToast();
  const [isNewCustomer, setIsNewCustomer] = useState(true);
  const [blockedCpf, setBlockedCpf] = useState<string | null>(null);
  const [lastCpfSearched, setLastCpfSearched] = useState<string | null>(null);
  const [customerSellerId, setCustomerSellerId] = useState<string | null>(null);
  const [customerSellerName, setCustomerSellerName] = useState<string | null>(null);
  
  const form = useForm<z.infer<typeof checkoutSchema>>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: {
      name: '',
      cpf: '',
      phone: '',
      phone2: '',
      phone3: '',
      email: '',
      zip: '',
      address: '',
      number: '',
      complement: '',
      neighborhood: '',
      city: 'Fortaleza',
      state: 'CE',
      observations: '',
    },
  });

  useEffect(() => {
    if (cartItems.length === 0 && typeof window !== 'undefined') {
      router.push('/');
    }
  }, [cartItems, router]);

  const cartItemsWithDetails = useMemo(() => {
    return cartItems.map(item => {
      const productInfo = products.find(p => p.id === item.id);
      return {
        ...item,
        code: productInfo?.code,
        stock: productInfo?.stock ?? 0,
        hasEnoughStock: (productInfo?.stock ?? 0) >= item.quantity,
        maxInstallments: productInfo?.maxInstallments ?? 1,
      };
    });
  }, [cartItems, products]);
  
  const maxAllowedInstallments = useMemo(() => {
    if (cartItemsWithDetails.length === 0) return 1;
    const maxInstallmentsArray = cartItemsWithDetails.map(item => item.maxInstallments);
    return Math.min(...maxInstallmentsArray);
  }, [cartItemsWithDetails]);

  const isCartValid = cartItemsWithDetails.every(item => item.hasEnoughStock);

  const handleZipBlur = async (e: React.FocusEvent<HTMLInputElement>) => {
    const zip = e.target.value.replace(/\D/g, '');

    if (zip.length !== 8) {
      return;
    }

    try {
      const response = await fetch(`https://viacep.com.br/ws/${zip}/json/`);
      if (!response.ok) {
        throw new Error('Falha ao buscar CEP.');
      }
      const data = await response.json();

      if (data.erro) {
        toast({
          title: "CEP não encontrado",
          description: "Por favor, verifique o CEP e tente novamente.",
          variant: "destructive",
        });
        return;
      }

      form.setValue('address', data.logradouro || '');
      form.setValue('neighborhood', data.bairro || '');
      form.setValue('city', data.localidade || '');
      form.setValue('state', data.uf || '');
      
      toast({
        title: "Endereço Encontrado!",
        description: "Seu endereço foi preenchido automaticamente.",
      });

    } catch (error) {
      console.error("Erro ao buscar CEP:", error);
      toast({
        title: "Erro de Rede",
        description: "Não foi possível buscar o CEP. Verifique sua conexão.",
        variant: "destructive",
      });
    }
  };


  const total = getCartTotal();
  
  if (cartItems.length === 0) {
      return null;
  }

  const openSupportWhatsApp = async (cpf: string) => {
    if (!settings.storePhone) {
      return;
    }

    const to = toBrazilE164(settings.storePhone);
    if (!to) return;

    const message = [
      'Olá! Preciso de suporte para finalizar uma compra.',
      `Meu CPF: ${cpf}`,
      'Apareceu que meu cadastro não está atualizado e não consigo prosseguir.',
    ].join('\n');

    try {
      const menuiaSendEnabled = settings.menuiaSendEnabled ?? true;
      if (!menuiaSendEnabled) {
        const link = buildWhatsAppLink(to, message);
        if (link) {
          window.open(link, '_blank', 'noopener,noreferrer');
          return;
        }
      }
      const res = await fetch('/api/menuia/send-text', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to, message }),
      });
      if (res.ok) {
        toast({ title: 'Enviado!', description: 'Mensagem enviada no WhatsApp da loja.' });
        return;
      }
    } catch {
    }
    const link = buildWhatsAppLink(to, message);
    if (link) {
      window.open(link, '_blank', 'noopener,noreferrer');
      return;
    }
    toast({
      title: 'Erro',
      description: 'Não foi possível enviar automaticamente pelo WhatsApp.',
      variant: 'destructive',
    });
  };

  const showBlockedCpfToast = (cpf: string) => {
    toast({
      title: 'Cadastro não atualizado',
      description: 'Seu cadastro não está atualizado e não é possível prosseguir. Fale com o suporte pelo WhatsApp.',
      variant: 'destructive',
      action: settings.storePhone ? (
        <ToastAction altText="Falar com suporte no WhatsApp" onClick={() => openSupportWhatsApp(cpf)}>
          Falar no WhatsApp
        </ToastAction>
      ) : undefined,
    });
  };

  const checkCpfIsBlocked = async (cpfRaw: string): Promise<boolean> => {
    const normalizedCpf = cpfRaw.replace(/\D/g, '');
    if (!normalizedCpf || normalizedCpf.length !== 11) {
      setBlockedCpf(null);
      return false;
    }
    if (!isValidCPF(normalizedCpf)) {
      setBlockedCpf(null);
      return false;
    }

    let db: ReturnType<typeof getClientFirebase>['db'] | null = null;
    try {
      ({ db } = getClientFirebase());
    } catch {
      setBlockedCpf(null);
      return false;
    }
    if (!db) {
      setBlockedCpf(null);
      return false;
    }

    const ordersRef = collection(db, 'orders');
    const q = query(ordersRef, where('customer.cpf', '==', normalizedCpf), limit(25));
    const snapshot = await getDocs(q);
    const isBlocked = snapshot.docs.some(d => {
      const data = d.data() as Order;
      return !!data.customer?.isDeleted;
    });

    setBlockedCpf(isBlocked ? normalizedCpf : null);
    return isBlocked;
  };

  const autoFillCustomerFromCpf = async (cpfRaw: string) => {
    const normalizedCpf = cpfRaw.replace(/\D/g, '');
    if (!normalizedCpf || normalizedCpf.length !== 11) {
      return;
    }
    if (!isValidCPF(normalizedCpf)) {
      return;
    }

    let db: ReturnType<typeof getClientFirebase>['db'] | null = null;
    try {
      ({ db } = getClientFirebase());
    } catch {
      return;
    }
    if (!db) {
      return;
    }

    const ordersRef = collection(db, 'orders');
    const q = query(ordersRef, where('customer.cpf', '==', normalizedCpf), limit(25));
    const snapshot = await getDocs(q);

    const orders = snapshot.docs
      .map(d => d.data() as Order)
      .filter(o => !o.customer?.isDeleted);

    if (orders.length === 0) {
      setIsNewCustomer(true);
      setCustomerSellerId(null);
      setCustomerSellerName(null);
      return;
    }

    const latestOrder = orders.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
    const customer = latestOrder.customer;

    if (!customer) {
      return;
    }

    setIsNewCustomer(false);
    const sellerIdCandidate = (customer.sellerId || latestOrder.sellerId || '').trim();
    const sellerNameCandidate = (customer.sellerName || latestOrder.sellerName || '').trim();
    setCustomerSellerId(sellerIdCandidate ? sellerIdCandidate : null);
    setCustomerSellerName(sellerNameCandidate ? sellerNameCandidate : null);

    form.setValue('name', customer.name || '');
    form.setValue('cpf', formatCpf(customer.cpf || normalizedCpf));
    form.setValue('phone', customer.phone || '');
    form.setValue('phone2', customer.phone2 || '');
    form.setValue('phone3', customer.phone3 || '');
    form.setValue('email', customer.email || '');
    form.setValue('zip', customer.zip || '');
    form.setValue('address', customer.address || '');
    form.setValue('number', customer.number || '');
    form.setValue('complement', customer.complement || '');
    form.setValue('neighborhood', customer.neighborhood || '');
    form.setValue('city', customer.city || '');
    form.setValue('state', customer.state || '');
    form.setValue('observations', customer.observations || '');

    toast({
      title: 'Cadastro encontrado',
      description: 'Preenchemos seus dados automaticamente. Confira se está tudo certo.',
    });
  };

  const handleCpfBlurCheck = async (cpfRaw: string) => {
    try {
      const normalizedCpf = cpfRaw.replace(/\D/g, '');
      if (blockedCpf && normalizedCpf === blockedCpf) {
        setCustomerSellerId(null);
        setCustomerSellerName(null);
        showBlockedCpfToast(blockedCpf);
        form.setError('cpf', { type: 'manual', message: 'Cadastro não atualizado. Não é possível prosseguir.' });
        return;
      }

      const isBlocked = await checkCpfIsBlocked(cpfRaw);
      if (isBlocked) {
        setCustomerSellerId(null);
        setCustomerSellerName(null);
        showBlockedCpfToast(cpfRaw.replace(/\D/g, ''));
        form.setError('cpf', { type: 'manual', message: 'Cadastro não atualizado. Não é possível prosseguir.' });
      } else {
        if (form.getFieldState('cpf').error?.message === 'Cadastro não atualizado. Não é possível prosseguir.') {
          form.clearErrors('cpf');
        }
        await autoFillCustomerFromCpf(cpfRaw);
      }
    } catch {
    }
  };

  async function onSubmit(values: z.infer<typeof checkoutSchema>) {
    const normalizedCpf = values.cpf.replace(/\D/g, '');
    if (blockedCpf && normalizedCpf === blockedCpf) {
      showBlockedCpfToast(blockedCpf);
      return;
    }

    const isBlocked = await checkCpfIsBlocked(values.cpf);
    if (isBlocked) {
      showBlockedCpfToast(normalizedCpf);
      return;
    }
    
    let customerData: CustomerInfo = {
      name: values.name,
      cpf: values.cpf?.replace(/\D/g, ''),
      phone: values.phone,
      phone2: values.phone2,
      phone3: values.phone3,
      email: values.email,
      zip: values.zip,
      address: values.address,
      number: values.number,
      complement: values.complement,
      neighborhood: values.neighborhood,
      city: values.city,
      state: values.state,
      observations: values.observations,
    };
    if (!isNewCustomer) {
      if (customerSellerId) customerData.sellerId = customerSellerId;
      if (customerSellerName) customerData.sellerName = customerSellerName;
    }
    
    // The logic to check for existing customer and assign password is now inside `addOrder`
    // to avoid loading all orders on the client-side.
    if (customerData.cpf) {
        customerData.password = customerData.cpf.substring(0, 6);
    }
    
    const finalInstallments = 1;
    const finalInstallmentValue = total / finalInstallments;
    const orderDate = new Date();

    const installmentDetails = Array.from({ length: finalInstallments }, (_, i) => ({
        id: `inst-temp-${i + 1}`, // Temporary ID
        installmentNumber: i + 1,
        amount: finalInstallmentValue,
        dueDate: addMonths(orderDate, i + 1).toISOString(),
        status: 'Pendente' as const,
        paidAmount: 0,
        payments: [],
    }));

    const order: Partial<Order> & { firstDueDate: Date } = {
      // ID will be generated by addOrder
      customer: customerData,
      items: cartItems.map(({ ...item }) => item),
      total,
      installments: finalInstallments,
      installmentValue: finalInstallmentValue,
      date: orderDate.toISOString(),
      firstDueDate: addMonths(orderDate, 1),
      status: 'Processando',
      paymentMethod: 'Crediário',
      installmentDetails,
      source: 'catalogo',
    };
    
    try {
        const savedOrder = await addOrder(order, logAction, user);
        if (savedOrder) {
          const productLines = cartItemsWithDetails.flatMap((item) => {
                const productCode = item.code || item.id;
                const unitPrice = item.price;
                const subtotal = item.price * item.quantity;

                return [
                  `*${item.name}* (Cód.: ${productCode})`,
                  `Valor: *${formatCurrency(unitPrice)}*`,
                  `Quantidade: *${item.quantity} un*`,
                  `Subtotal: *${formatCurrency(subtotal)}*`,
                  '',
                ];
              });

          if (productLines.length > 0) {
            productLines.pop();
          }

          const customerPhones: string[] = [];
          if (values.phone) customerPhones.push(values.phone);
          if (values.phone2) customerPhones.push(values.phone2);
          if (values.phone3) customerPhones.push(values.phone3);
          const customerPhonesText = customerPhones.filter(Boolean).join(' / ');
          const customerCode = displayNumericCode(savedOrder.customer.code || '-');
          const orderObservation = values.observations?.trim() ? values.observations.trim() : '-';
          const addressLine1 = `CEP: *${values.zip}*`;
          const addressLine2 = values.address;
          const addressLine3 = `N° ${values.number}${values.complement?.trim() ? ` (${values.complement.trim()})` : ''}`;
          const addressLine4 = `${values.neighborhood} - ${values.city}/${values.state}`;
          const orderId = displayNumericCode(savedOrder.id);
          const sellerText =
            savedOrder.customer.sellerName ||
            (savedOrder.customer.sellerId ? `ID: ${savedOrder.customer.sellerId}` : '');

          const storeMessageParts = [
            `Novo pedido do catálogo: *${orderId}*`,
            '',
            `Cliente: *${values.name}*`,
            `Telefones: ${customerPhonesText || '-'}`,
            `CPF/CNPJ: *${values.cpf}*`,
            `Cód. Cliente: *${customerCode}*`,
            ...(sellerText ? [`Vendedor: *${sellerText}*`] : []),
            '',
            '*Produtos:*',
            '',
            ...productLines,
            '',
            `Total do(s) produto(s): *${formatCurrency(total)}*`,
            `Observação: ${orderObservation}`,
            '',
            '*Endereço:*',
            addressLine1,
            addressLine2,
            addressLine3,
            addressLine4,
          ];

          const customerFirstName = values.name.split(' ')[0] || values.name;
          const customerMessageParts = [
            `Olá, ${customerFirstName}!`,
            `Recebemos seu pedido *${orderId}* no valor de *${formatCurrency(total)}*.`,
            ...(sellerText ? [`Vendedor responsável: *${sellerText}*.`] : []),
            'Em breve nossa equipe entrará em contato para combinar a entrega e condições.',
          ];

          const menuiaSendEnabled = settings.menuiaSendEnabled ?? true;
          const storeTo = toBrazilE164(settings.storePhone);
          const customerTo = toBrazilE164(values.phone);

          if (!menuiaSendEnabled) {
            const manualTo = storeTo || customerTo;
            const manualMessage = storeTo ? storeMessageParts.join('\n') : customerMessageParts.join('\n');
            const link = buildWhatsAppLink(manualTo, manualMessage);
            if (link) {
              window.open(link, '_blank', 'noopener,noreferrer');
              toast({ title: 'WhatsApp aberto', description: 'Envio manual do pedido.' });
            }
          } else {
            const sendMenuiaText = async (to: string, message: string) => {
              try {
                const res = await fetch('/api/menuia/send-text', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ to, message }),
                });
                if (res.ok) return true;
              } catch {
              }

              const link = buildWhatsAppLink(to, message);
              if (link) {
                window.open(link, '_blank', 'noopener,noreferrer');
                return true;
              }
              return false;
            };

          const sends: Promise<boolean>[] = [];
          if (storeTo) sends.push(sendMenuiaText(storeTo, storeMessageParts.join('\n')));
          if (customerTo) sends.push(sendMenuiaText(customerTo, customerMessageParts.join('\n')));

            if (sends.length > 0) {
            const results = await Promise.allSettled(sends);
            const failed = results.some(r => r.status === 'rejected' || r.value === false);
            if (failed) {
              toast({
                title: 'Aviso',
                description: 'Não foi possível enviar alguma mensagem automática no WhatsApp.',
                variant: 'destructive',
              });
            }
          }
          }

          setLastOrder(savedOrder);
          clearCart();
      
          toast({
              title: "Pedido Realizado com Sucesso!",
              description: `Seu pedido #${savedOrder.id} foi confirmado.`,
          });
      
          router.push(`/order-confirmation/${savedOrder.id}`);
        }
    } catch (error) {
        console.error("Failed to process order:", error);
        toast({
            title: "Erro ao Finalizar Pedido",
            description: error instanceof Error ? error.message : "Não foi possível completar o pedido.",
            variant: "destructive"
        });
    }
  }

  return (
    <div className="grid gap-8 md:grid-cols-2 md:gap-12 items-start w-full">
      <div className="min-w-0">
        <h3 className="text-xl font-semibold mb-4 font-headline text-center md:text-left">Resumo do Pedido</h3>
        <div className="space-y-4">
          {cartItemsWithDetails.map((item) => (
            <div key={item.id} className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-4 min-w-0">
                <div className="relative h-16 w-16 rounded-md overflow-hidden flex-shrink-0">
                  <Image src={item.imageUrl} alt={item.name} fill className="object-cover" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold break-words leading-tight">{item.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    <span>Qtd: {item.quantity}</span>
                    <span className="text-xs text-accent font-semibold">(em até {item.maxInstallments}x)</span>
                  </div>
                  {!item.hasEnoughStock && (
                    <div className="flex items-center gap-1 text-xs text-destructive mt-2">
                      <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                      <span className="break-words">Estoque: {item.stock}. Ajuste a quantidade.</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 sm:justify-end">
                <p className="font-semibold whitespace-nowrap">{formatCurrency(item.price * item.quantity)}</p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
                  onClick={() => removeFromCart(item.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
          <Separator />
          <div className="flex justify-between font-bold text-lg">
            <span>Total</span>
            <span>{formatCurrency(total)}</span>
          </div>
          <div className="mt-4 rounded-lg border bg-muted/40 p-4">
            <div className="flex items-start gap-3">
              <CreditCard className="h-5 w-5 text-accent mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <p className="font-semibold text-accent leading-tight">Pagamento via Crediário</p>
                <p className="text-sm text-muted-foreground mt-1 leading-snug">
                  O vendedor definirá as condições de parcelamento com você após a finalização do pedido.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 md:space-y-8 w-full max-w-2xl mx-auto min-w-0">
          <div>
            <h3 className="text-xl font-semibold mb-4 font-headline text-center md:text-left">Informações do Cliente</h3>
            <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="cpf"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>CPF</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="000.000.000-00"
                              inputMode="numeric"
                              {...field}
                              onChange={(e) => {
                                const formatted = formatCpf(e.target.value);
                                field.onChange(formatted);
                                const normalized = formatted.replace(/\D/g, '');
                                if (normalized.length === 11 && normalized !== lastCpfSearched) {
                                  setLastCpfSearched(normalized);
                                  void handleCpfBlurCheck(formatted);
                                }
                              }}
                              maxLength={14}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField control={form.control} name="name" render={({ field }) => ( <FormItem><FormLabel>Nome Completo</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem> )} />
                    <FormField control={form.control} name="phone" render={({ field }) => ( <FormItem><FormLabel>Telefone (WhatsApp)</FormLabel><FormControl><Input placeholder="(99) 99999-9999" {...field} onChange={e => field.onChange(formatPhone(e.target.value))} maxLength={15} /></FormControl><FormMessage /></FormItem> )} />
                    <FormField control={form.control} name="phone2" render={({ field }) => ( <FormItem><FormLabel>Telefone 2 (Opcional)</FormLabel><FormControl><Input placeholder="(99) 99999-9999" {...field} onChange={e => field.onChange(formatPhone(e.target.value))} maxLength={15} /></FormControl><FormMessage /></FormItem> )} />
                    <FormField control={form.control} name="phone3" render={({ field }) => ( <FormItem><FormLabel>Telefone 3 (Opcional)</FormLabel><FormControl><Input placeholder="(99) 99999-9999" {...field} onChange={e => field.onChange(formatPhone(e.target.value))} maxLength={15} /></FormControl><FormMessage /></FormItem> )} />
                    <FormField control={form.control} name="email" render={({ field }) => ( <FormItem className="md:col-span-2"><FormLabel>Email (Opcional)</FormLabel><FormControl><Input placeholder="seu@email.com" {...field} /></FormControl><FormMessage /></FormItem> )} />
                </div>
                {(customerSellerName || customerSellerId) && (
                  <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <UserSquare className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">Vendedor responsável:</span>
                      <span>{customerSellerName || `ID: ${customerSellerId}`}</span>
                    </div>
                  </div>
                )}
                <div className="p-3 bg-blue-500/10 text-blue-800 rounded-lg text-sm">
                    <p><strong>Atenção:</strong> Se este for seu primeiro pedido, a senha de acesso para a Área do Cliente será os <strong>6 primeiros dígitos do seu CPF</strong>.</p>
                </div>
                <h4 className="text-lg font-semibold pt-4 text-center md:text-left">Endereço de Entrega</h4>
                <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
                    <FormField control={form.control} name="zip" render={({ field }) => ( <FormItem className="md:col-span-2"><FormLabel>CEP</FormLabel><FormControl><Input placeholder="00000-000" {...field} onBlur={handleZipBlur} /></FormControl><FormMessage /></FormItem> )} />
                    <FormField control={form.control} name="address" render={({ field }) => ( <FormItem className="md:col-span-4"><FormLabel>Endereço</FormLabel><FormControl><Input placeholder="Rua, Av." {...field} /></FormControl><FormMessage /></FormItem> )} />
                    <FormField control={form.control} name="number" render={({ field }) => ( <FormItem className="md:col-span-2"><FormLabel>Número</FormLabel><FormControl><Input placeholder="123" {...field} /></FormControl><FormMessage /></FormItem> )} />
                    <FormField control={form.control} name="complement" render={({ field }) => ( <FormItem className="md:col-span-4"><FormLabel>Complemento (opcional)</FormLabel><FormControl><Input placeholder="Apto, bloco, casa, etc." {...field} /></FormControl><FormMessage /></FormItem> )} />
                    <FormField control={form.control} name="neighborhood" render={({ field }) => ( <FormItem className="md:col-span-3"><FormLabel>Bairro</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem> )} />
                    <FormField control={form.control} name="city" render={({ field }) => ( <FormItem className="md:col-span-3"><FormLabel>Cidade</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem> )} />
                    <FormField control={form.control} name="state" render={({ field }) => ( <FormItem className="md:col-span-6"><FormLabel>Estado</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem> )} />
                </div>
                 <FormField
                    control={form.control}
                    name="observations"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Observações (Opcional)</FormLabel>
                            <FormControl>
                                <Textarea placeholder="Ex: Deixar na portaria, ponto de referência..." {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </div>
          </div>
          
          <Button
            type="submit"
            size="lg"
            className="w-full max-w-full min-w-0 flex flex-wrap items-center justify-center gap-2 whitespace-normal text-center leading-tight h-auto py-3 px-4 text-base sm:text-lg"
            disabled={!isCartValid || form.formState.isSubmitting}
          >
            <WhatsAppIcon />
            <span>Enviar pedido para WhatsApp</span>
          </Button>
        </form>
      </Form>
    </div>
  );
}
