

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
import { AlertTriangle, CreditCard, KeyRound, Trash2 } from 'lucide-react';
import { useSettings } from '@/context/SettingsContext';
import { useAdmin } from '@/context/AdminContext';
import { useAuth } from '@/context/AuthContext';
import { useAudit } from '@/context/AuditContext';
import { useData } from '@/context/DataContext';
import { Textarea } from './ui/textarea';
import { ToastAction } from '@/components/ui/toast';
import { getClientFirebase } from '@/lib/firebase-client';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';

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

  const openSupportWhatsApp = (cpf: string) => {
    if (!settings.storePhone) {
      return;
    }

    const storePhone = settings.storePhone.replace(/\D/g, '');
    if (!storePhone) return;

    const message = [
      'Olá! Preciso de suporte para finalizar uma compra.',
      `Meu CPF: ${cpf}`,
      'Apareceu que meu cadastro não está atualizado e não consigo prosseguir.',
    ].join('\n');

    const encodedMessage = encodeURIComponent(message);
    const webUrl = `https://wa.me/55${storePhone}?text=${encodedMessage}`;
    window.open(webUrl, '_blank');
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
      return;
    }

    const latestOrder = orders.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
    const customer = latestOrder.customer;

    if (!customer) {
      return;
    }

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
        showBlockedCpfToast(blockedCpf);
        form.setError('cpf', { type: 'manual', message: 'Cadastro não atualizado. Não é possível prosseguir.' });
        return;
      }

      const isBlocked = await checkCpfIsBlocked(cpfRaw);
      if (isBlocked) {
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
          setLastOrder(savedOrder);
          clearCart();
      
          if (settings.wapiInstance && settings.wapiToken) {
                // Not implemented, but this is where the W-API call would go
          } else if (settings.storePhone) {
              const storePhone = settings.storePhone.replace(/\D/g, '');
              const productNames = cartItemsWithDetails.map(item => item.name).join(', ');
              
              const messageParts = [
                  `*Novo Pedido Recebido pelo Catálogo Online!*`,
                  `*Pedido:* ${savedOrder.id}`,
                  `*Cliente:* ${values.name}`,
                  `*Origem:* Catálogo Online`,
                  `*Produtos:* ${productNames}`,
                  `*Total:* ${formatCurrency(total)}`,
                  `*Parcelamento Máximo:* Até ${maxAllowedInstallments}x`
              ];

              const message = messageParts.join('\n');
              const encodedMessage = encodeURIComponent(message);
              
              const webUrl = `https://wa.me/55${storePhone}?text=${encodedMessage}`;
              window.open(webUrl, '_blank');
          }
      
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
    <div className="grid md:grid-cols-2 gap-12">
      <div>
        <h3 className="text-xl font-semibold mb-4 font-headline">Resumo do Pedido</h3>
        <div className="space-y-4">
          {cartItemsWithDetails.map((item) => (
            <div key={item.id} className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-4 flex-grow">
                <div className="relative h-16 w-16 rounded-md overflow-hidden">
                  <Image src={item.imageUrl} alt={item.name} fill className="object-cover" />
                </div>
                <div className="flex-grow">
                  <p className="font-semibold">{item.name}</p>
                  <p className="text-sm text-muted-foreground">Qtd: {item.quantity}</p>
                   <p className="text-xs text-accent font-semibold">(em até {item.maxInstallments}x)</p>
                   {!item.hasEnoughStock && (
                      <div className="flex items-center gap-1 text-xs text-destructive mt-1">
                          <AlertTriangle className="h-3 w-3" />
                          <span>Estoque: {item.stock}. Ajuste a quantidade.</span>
                      </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <p className="font-semibold">{formatCurrency(item.price * item.quantity)}</p>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => removeFromCart(item.id)}>
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
           <div className="mt-4 p-4 bg-muted rounded-lg text-center">
              <p className="font-bold text-md text-accent flex items-center justify-center gap-2"><CreditCard /> Pagamento via Crediário</p>
              <p className="text-sm text-muted-foreground mt-1">
                O vendedor definirá as condições de parcelamento com você após a finalização do pedido.
              </p>
            </div>
        </div>
      </div>
      
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          <div>
            <h3 className="text-xl font-semibold mb-4 font-headline">Informações do Cliente</h3>
            <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField control={form.control} name="cpf" render={({ field }) => ( <FormItem><FormLabel>CPF</FormLabel><FormControl><Input placeholder="000.000.000-00" inputMode="numeric" {...field} onChange={(e) => field.onChange(formatCpf(e.target.value))} maxLength={14} onBlur={(e) => { field.onBlur(); void handleCpfBlurCheck(e.target.value); }} /></FormControl><FormMessage /></FormItem> )} />
                    <FormField control={form.control} name="name" render={({ field }) => ( <FormItem><FormLabel>Nome Completo</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem> )} />
                    <FormField control={form.control} name="phone" render={({ field }) => ( <FormItem><FormLabel>Telefone (WhatsApp)</FormLabel><FormControl><Input placeholder="(99) 99999-9999" {...field} onChange={e => field.onChange(formatPhone(e.target.value))} maxLength={15} /></FormControl><FormMessage /></FormItem> )} />
                    <FormField control={form.control} name="phone2" render={({ field }) => ( <FormItem><FormLabel>Telefone 2 (Opcional)</FormLabel><FormControl><Input placeholder="(99) 99999-9999" {...field} onChange={e => field.onChange(formatPhone(e.target.value))} maxLength={15} /></FormControl><FormMessage /></FormItem> )} />
                    <FormField control={form.control} name="phone3" render={({ field }) => ( <FormItem><FormLabel>Telefone 3 (Opcional)</FormLabel><FormControl><Input placeholder="(99) 99999-9999" {...field} onChange={e => field.onChange(formatPhone(e.target.value))} maxLength={15} /></FormControl><FormMessage /></FormItem> )} />
                    <FormField control={form.control} name="email" render={({ field }) => ( <FormItem className="md:col-span-2"><FormLabel>Email (Opcional)</FormLabel><FormControl><Input placeholder="seu@email.com" {...field} /></FormControl><FormMessage /></FormItem> )} />
                </div>
                 <div className="p-3 bg-blue-500/10 text-blue-800 rounded-lg text-sm">
                    <p><strong>Atenção:</strong> Se este for seu primeiro pedido, a senha de acesso para a Área do Cliente será os <strong>6 primeiros dígitos do seu CPF</strong>.</p>
                </div>
                <h4 className="text-lg font-semibold pt-4">Endereço de Entrega</h4>
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
          
          <Button type="submit" size="lg" className="w-full text-lg" disabled={!isCartValid || form.formState.isSubmitting}>
            Finalizar Compra
          </Button>
        </form>
      </Form>
    </div>
  );
}
