

'use client';

import { useState, useMemo, useEffect } from 'react';
import { useAdmin, useAdminData } from '@/context/AdminContext';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DollarSign, History, PiggyBank, BadgePercent, Eye, Undo2, Printer, ShoppingCart, Users } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useAudit } from '@/context/AuditContext';
import { displayNumericCode } from '@/lib/utils';
import type { Order } from '@/lib/types';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSearchParams } from 'next/navigation';


const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
};

const meses = [
  { value: 'all', label: 'Todos os meses' },
  { value: '01', label: 'Janeiro' }, { value: '02', label: 'Fevereiro' },
  { value: '03', label: 'Março' }, { value: '04', label: 'Abril' },
  { value: '05', label: 'Maio' }, { value: '06', label: 'Junho' },
  { value: '07', label: 'Julho' }, { value: '08', label: 'Agosto' },
  { value: '09', label: 'Setembro' }, { value: '10', label: 'Outubro' },
  { value: '11', label: 'Novembro' }, { value: '12', label: 'Dezembro' },
];

type SellerSalesReport = {
  id: string;
  name: string;
  salesCount: number;
  totalSold: number;
  totalCommission: number;
  orders: Order[];
};

export default function MyCommissionsPage() {
  const searchParams = useSearchParams();
  const { reverseCommissionPayment } = useAdmin();
  const { orders, commissionPayments } = useAdminData();
  const { user, users } = useAuth();
  const { logAction } = useAudit();

  const isManagerOrAdmin = user?.role === 'admin' || user?.role === 'gerente';
  const requestedTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<string>(() => {
    if (requestedTab === 'reports') return 'reports';
    if (requestedTab === 'history') return 'history';
    if (requestedTab === 'team_pending') return 'team_pending';
    if (requestedTab === 'all_history') return 'all_history';
    return 'my_pending';
  });
  const [salesReportMonth, setSalesReportMonth] = useState<string>(() => String(new Date().getMonth() + 1).padStart(2, '0'));
  const [salesReportYear, setSalesReportYear] = useState<string>(() => String(new Date().getFullYear()));
  const [isSellerReportOpen, setIsSellerReportOpen] = useState(false);
  const [selectedSellerReport, setSelectedSellerReport] = useState<SellerSalesReport | null>(null);

  useEffect(() => {
    if (!requestedTab) return;
    const allowedTabs = new Set(['my_pending', 'history', 'reports']);
    if (isManagerOrAdmin) {
      allowedTabs.add('team_pending');
      allowedTabs.add('all_history');
    }
    if (allowedTabs.has(requestedTab)) {
      setActiveTab(requestedTab);
    }
  }, [isManagerOrAdmin, requestedTab]);
  
  const myPendingCommissions = useMemo(() => {
    if (!user || !orders) return [];
    return orders
      .filter(o => {
        const isPending = o.status === 'Entregue' && typeof o.commission === 'number' && o.commission > 0 && !o.commissionPaid;
        if (!isPending) return false;
        return o.sellerId === user.id;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [orders, user]);

  const teamPendingCommissions = useMemo(() => {
    if (!orders || !isManagerOrAdmin) return [];
    return orders
      .filter(o => o.status === 'Entregue' && typeof o.commission === 'number' && o.commission > 0 && !o.commissionPaid)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [orders, isManagerOrAdmin]);

  const myTotalPending = useMemo(() => {
    return myPendingCommissions.reduce((acc, order) => acc + (order.commission || 0), 0);
  }, [myPendingCommissions]);

  const myPaidCommissions = useMemo(() => {
    if (!user || !commissionPayments) return [];
    return commissionPayments
      .filter(p => p.sellerId === user.id)
      .sort((a,b) => parseISO(b.paymentDate).getTime() - parseISO(a.paymentDate).getTime());
  }, [commissionPayments, user]);

  const myTotalPaid = useMemo(() => {
    return myPaidCommissions.reduce((acc, p) => acc + p.amount, 0);
  }, [myPaidCommissions]);

  const teamTotalPending = useMemo(() => {
    return teamPendingCommissions.reduce((acc, order) => acc + (order.commission || 0), 0);
  }, [teamPendingCommissions]);

  const deliveredOrders = useMemo(() => {
    if (!orders) return [];
    return orders.filter(o => o.status === 'Entregue').sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [orders]);

  const availableYearsForSalesReport = useMemo(() => {
    const years = new Set<string>();
    deliveredOrders.forEach(order => {
      years.add(String(parseISO(order.date).getFullYear()));
    });
    const list = Array.from(years.values()).sort((a, b) => Number(b) - Number(a));
    if (list.length === 0) return [String(new Date().getFullYear())];
    return list;
  }, [deliveredOrders]);

  useEffect(() => {
    if (!availableYearsForSalesReport.includes(salesReportYear)) {
      setSalesReportYear(availableYearsForSalesReport[0]);
    }
  }, [availableYearsForSalesReport, salesReportYear]);

  const sellerSalesReport = useMemo(() => {
    if (!isManagerOrAdmin || !users) return [];

    const performanceMap = new Map<string, SellerSalesReport>();
    const ensureSeller = (id: string, name: string) => {
      if (!performanceMap.has(id)) {
        performanceMap.set(id, { id, name, salesCount: 0, totalSold: 0, totalCommission: 0, orders: [] });
      }
    };

    users.forEach(seller => {
      if (seller.role === 'vendedor' || seller.role === 'gerente' || seller.role === 'admin') {
        ensureSeller(seller.id, seller.name);
      }
    });

    const filteredOrders = deliveredOrders.filter(order => {
      const orderDate = parseISO(order.date);
      const yearMatches = String(orderDate.getFullYear()) === salesReportYear;
      if (!yearMatches) return false;
      if (salesReportMonth === 'all') return true;
      const orderMonth = String(orderDate.getMonth() + 1).padStart(2, '0');
      return orderMonth === salesReportMonth;
    });

    filteredOrders.forEach(order => {
      const sellerId = order.sellerId || 'unassigned';
      const sellerName =
        order.sellerName ||
        users.find(u => u.id === order.sellerId)?.name ||
        'Sem vendedor';

      ensureSeller(sellerId, sellerName);
      const sellerData = performanceMap.get(sellerId)!;
      sellerData.salesCount += 1;
      sellerData.totalSold += order.total;
      sellerData.totalCommission += order.commission || 0;
      sellerData.orders.push(order);
      performanceMap.set(sellerId, sellerData);
    });

    return Array.from(performanceMap.values())
      .filter(s => s.salesCount > 0)
      .sort((a, b) => b.totalSold - a.totalSold);
  }, [deliveredOrders, isManagerOrAdmin, salesReportMonth, salesReportYear, users]);

  const salesReportMonthLabel = useMemo(() => {
    if (salesReportMonth === 'all') return `Ano ${salesReportYear}`;
    const label = meses.find(m => m.value === salesReportMonth)?.label || salesReportMonth;
    return `${label}/${salesReportYear}`;
  }, [salesReportMonth, salesReportYear]);

  const sellerReportTotals = useMemo(() => {
    const totalSold = sellerSalesReport.reduce((acc, item) => acc + item.totalSold, 0);
    const totalSales = sellerSalesReport.reduce((acc, item) => acc + item.salesCount, 0);
    const totalCommission = sellerSalesReport.reduce((acc, item) => acc + item.totalCommission, 0);
    return { totalSold, totalSales, totalCommission };
  }, [sellerSalesReport]);

  const selectedSellerTotals = useMemo(() => {
    const list = selectedSellerReport?.orders ?? [];
    const totalSold = list.reduce((acc, order) => acc + (order.total || 0), 0);
    const totalCommission = list.reduce((acc, order) => acc + (order.commission || 0), 0);
    return { count: list.length, totalSold, totalCommission };
  }, [selectedSellerReport]);

  const handleOpenSellerReport = (seller: SellerSalesReport) => {
    setSelectedSellerReport(seller);
    setIsSellerReportOpen(true);
  };

  useEffect(() => {
    if (!selectedSellerReport) return;
    const updated = sellerSalesReport.find(s => s.id === selectedSellerReport.id);
    if (updated) {
      setSelectedSellerReport(updated);
    }
  }, [selectedSellerReport, sellerSalesReport]);

  const handlePrintHtml = (title: string, html: string) => {
    const header = `
      <div style="margin-bottom: 2rem; display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 1rem; border-bottom: 1px solid #ccc;">
        <div>
          <h1 style="font-size: 1.5rem; font-weight: bold;">${title}</h1>
          <p style="font-size: 0.9rem; color: #666;">Gerado em: ${new Date().toLocaleDateString('pt-BR')}</p>
        </div>
      </div>
    `;
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(iframe);

    const printWindow = iframe.contentWindow;
    const printDocument = printWindow?.document;

    if (!printWindow || !printDocument) {
      iframe.remove();
      return;
    }

    const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
      .map(node => node.outerHTML)
      .join('\n');

    printDocument.open();
    printDocument.write(`<!doctype html><html><head><title>${title}</title>${styles}</head><body><div class="print-container">${header}${html}</div></body></html>`);
    printDocument.close();

    const cleanup = () => {
      iframe.remove();
    };

    const onAfterPrint = () => {
      printWindow.removeEventListener('afterprint', onAfterPrint);
      cleanup();
    };

    printWindow.addEventListener('afterprint', onAfterPrint);
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 100);
  };

  const handlePrintTeamReport = () => {
    const contents = document.getElementById('team-sales-report-content')?.innerHTML;
    if (!contents) return;
    handlePrintHtml(`Relatório de Vendas por Vendedor - ${salesReportMonthLabel}`, contents);
  };

  const handlePrintSingleSeller = () => {
    if (!selectedSellerReport) return;
    const contents = document.getElementById('seller-sales-report-modal-content')?.innerHTML;
    if (!contents) return;
    handlePrintHtml(`Relatório de Vendas - ${selectedSellerReport.name} (${salesReportMonthLabel})`, contents);
  };

  const mySalesReportOrders = useMemo(() => {
    if (!user) return [];

    return deliveredOrders
      .filter(order => {
        if (order.sellerId !== user.id) return false;
        const orderDate = parseISO(order.date);
        const yearMatches = String(orderDate.getFullYear()) === salesReportYear;
        if (!yearMatches) return false;
        if (salesReportMonth === 'all') return true;
        const orderMonth = String(orderDate.getMonth() + 1).padStart(2, '0');
        return orderMonth === salesReportMonth;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [deliveredOrders, salesReportMonth, salesReportYear, user]);

  const mySalesReportTotals = useMemo(() => {
    const totalSold = mySalesReportOrders.reduce((acc, order) => acc + (order.total || 0), 0);
    const totalCommission = mySalesReportOrders.reduce((acc, order) => acc + (order.commission || 0), 0);
    return { count: mySalesReportOrders.length, totalSold, totalCommission };
  }, [mySalesReportOrders]);

  if (!user) {
    return <p>Carregando...</p>;
  }


  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BadgePercent className="h-6 w-6" />
            {isManagerOrAdmin ? 'Comissões' : 'Minhas Comissões'}
          </CardTitle>
          <CardDescription>
            {isManagerOrAdmin ? 'Acompanhe comissões da equipe e relatórios de vendedores.' : 'Acompanhe suas comissões a receber e o histórico de pagamentos.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
            {isManagerOrAdmin ? (
              <div className="grid gap-4 md:grid-cols-3 mb-8">
                <Card className="bg-amber-500/10 border-amber-500/20">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Minha Comissão a Receber</CardTitle>
                    <DollarSign className="h-4 w-4 text-amber-600" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-amber-600">{formatCurrency(myTotalPending)}</div>
                    <p className="text-xs text-muted-foreground">Comissões de {myPendingCommissions.length} vendas entregues.</p>
                  </CardContent>
                </Card>

                <Card className="bg-green-500/10 border-green-500/20">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Minha Comissão Já Recebida</CardTitle>
                    <PiggyBank className="h-4 w-4 text-green-600" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-green-600">{formatCurrency(myTotalPaid)}</div>
                    <p className="text-xs text-muted-foreground">Total de {myPaidCommissions.length} pagamentos recebidos.</p>
                  </CardContent>
                </Card>

                <Card className="bg-blue-500/10 border-blue-500/20">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Equipe a Receber</CardTitle>
                    <Users className="h-4 w-4 text-blue-600" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-blue-600">{formatCurrency(teamTotalPending)}</div>
                    <p className="text-xs text-muted-foreground">Comissões de {teamPendingCommissions.length} vendas entregues.</p>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 mb-8">
                <Card className="bg-amber-500/10 border-amber-500/20">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Saldo a Receber</CardTitle>
                    <DollarSign className="h-4 w-4 text-amber-600" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-amber-600">{formatCurrency(myTotalPending)}</div>
                    <p className="text-xs text-muted-foreground">Comissões de {myPendingCommissions.length} vendas entregues.</p>
                  </CardContent>
                </Card>

                <Card className="bg-green-500/10 border-green-500/20">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Já Recebido</CardTitle>
                    <PiggyBank className="h-4 w-4 text-green-600" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-green-600">{formatCurrency(myTotalPaid)}</div>
                    <p className="text-xs text-muted-foreground">Total de {myPaidCommissions.length} pagamentos recebidos.</p>
                  </CardContent>
                </Card>
              </div>
            )}

            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className={`w-full grid ${isManagerOrAdmin ? 'grid-cols-2' : 'grid-cols-3'} gap-1 h-auto sm:inline-flex sm:w-auto sm:h-10`}>
                    <TabsTrigger value="my_pending" className="w-full whitespace-normal text-xs leading-tight sm:w-auto sm:text-sm sm:whitespace-nowrap">
                      {isManagerOrAdmin ? (
                        <>
                          <span className="hidden sm:inline">Minhas Pendentes</span>
                          <span className="sm:hidden">Minhas</span>
                        </>
                      ) : (
                        <>
                          <span className="hidden sm:inline">Comissões Pendentes</span>
                          <span className="sm:hidden">Pendentes</span>
                        </>
                      )}
                    </TabsTrigger>
                    <TabsTrigger value="history" className="w-full whitespace-normal text-xs leading-tight sm:w-auto sm:text-sm sm:whitespace-nowrap">
                      <span className="hidden sm:inline">Meus Pagamentos</span>
                      <span className="sm:hidden">Pagamentos</span>
                    </TabsTrigger>
                    {isManagerOrAdmin && (
                      <TabsTrigger value="team_pending" className="w-full whitespace-normal text-xs leading-tight sm:w-auto sm:text-sm sm:whitespace-nowrap">
                        <span className="hidden sm:inline">Pendentes da Equipe</span>
                        <span className="sm:hidden">Equipe</span>
                      </TabsTrigger>
                    )}
                    {isManagerOrAdmin && (
                      <TabsTrigger value="all_history" className="w-full whitespace-normal text-xs leading-tight sm:w-auto sm:text-sm sm:whitespace-nowrap">
                        <span className="hidden sm:inline">Histórico Geral</span>
                        <span className="sm:hidden">Geral</span>
                      </TabsTrigger>
                    )}
                    <TabsTrigger value="reports" className="w-full whitespace-normal text-xs leading-tight sm:w-auto sm:text-sm sm:whitespace-nowrap">
                      {isManagerOrAdmin ? 'Relatórios' : 'Relatório'}
                    </TabsTrigger>
                </TabsList>
                <TabsContent value="my_pending" className="mt-4">
                     <Card>
                        <CardHeader>
                            <CardTitle>Minhas Comissões a Receber</CardTitle>
                            <CardDescription>Esta é a lista de todas as suas vendas concluídas cuja comissão ainda não foi paga.</CardDescription>
                        </CardHeader>
                        <CardContent>
                             <div className="rounded-md border overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Data da Venda</TableHead>
                                            <TableHead>Pedido ID</TableHead>
                                            <TableHead>Cliente</TableHead>
                                            <TableHead className="text-right">Valor da Comissão</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {myPendingCommissions.length > 0 ? (
                                            myPendingCommissions.map(order => (
                                                <TableRow key={order.id}>
                                                    <TableCell className="whitespace-nowrap">{format(parseISO(order.date), "dd/MM/yyyy")}</TableCell>
                                                    <TableCell className="font-mono whitespace-nowrap">{displayNumericCode(order.id)}</TableCell>
                                                    <TableCell>{order.customer.name}</TableCell>
                                                    <TableCell className="text-right font-semibold">{formatCurrency(order.commission || 0)}</TableCell>
                                                </TableRow>
                                            ))
                                        ) : (
                                            <TableRow>
                                                <TableCell colSpan={4} className="h-24 text-center">Você não tem comissões pendentes.</TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                     </Card>
                </TabsContent>
                {isManagerOrAdmin && (
                  <TabsContent value="team_pending" className="mt-4">
                    <Card>
                      <CardHeader>
                        <CardTitle>Comissões Pendentes (Equipe)</CardTitle>
                        <CardDescription>Lista de todas as vendas concluídas de todos os vendedores, cuja comissão ainda não foi paga.</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="rounded-md border overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Data da Venda</TableHead>
                                <TableHead>Vendedor</TableHead>
                                <TableHead>Pedido ID</TableHead>
                                <TableHead>Cliente</TableHead>
                                <TableHead className="text-right">Valor da Comissão</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {teamPendingCommissions.length > 0 ? (
                                teamPendingCommissions.map(order => (
                                  <TableRow key={order.id}>
                                    <TableCell className="whitespace-nowrap">{format(parseISO(order.date), "dd/MM/yyyy")}</TableCell>
                                    <TableCell>{order.sellerName}</TableCell>
                                    <TableCell className="font-mono whitespace-nowrap">{displayNumericCode(order.id)}</TableCell>
                                    <TableCell>{order.customer.name}</TableCell>
                                    <TableCell className="text-right font-semibold">{formatCurrency(order.commission || 0)}</TableCell>
                                  </TableRow>
                                ))
                              ) : (
                                <TableRow>
                                  <TableCell colSpan={5} className="h-24 text-center">Nenhuma comissão pendente para a equipe.</TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>
                )}
                <TabsContent value="history" className="mt-4">
                     <Card>
                        <CardHeader>
                            <CardTitle>Meus Pagamentos Recebidos</CardTitle>
                             <CardDescription>Histórico de todos os pagamentos de comissão que você já recebeu.</CardDescription>
                        </CardHeader>
                        <CardContent>
                             <div className="rounded-md border overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Data do Pagamento</TableHead>
                                            <TableHead>Período</TableHead>
                                            <TableHead className="text-right">Valor Recebido</TableHead>
                                            <TableHead className="text-right">Ação</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {myPaidCommissions.length > 0 ? (
                                            myPaidCommissions.map(payment => (
                                                <TableRow key={payment.id}>
                                                    <TableCell className="whitespace-nowrap">{format(parseISO(payment.paymentDate), "dd/MM/yyyy")}</TableCell>
                                                    <TableCell className="capitalize">{payment.period}</TableCell>
                                                    <TableCell className="text-right font-semibold">{formatCurrency(payment.amount)}</TableCell>
                                                    <TableCell className="text-right">
                                                        <div className="flex justify-end gap-2">
                                                            <Button variant="outline" size="sm" asChild>
                                                                <Link href={`/admin/comprovante-comissao/${payment.id}`}>
                                                                    <Eye className="mr-2 h-4 w-4" />
                                                                    Ver Comprovante
                                                                </Link>
                                                            </Button>
                                                             {isManagerOrAdmin && (
                                                                <AlertDialog>
                                                                    <AlertDialogTrigger asChild>
                                                                        <Button variant="destructive" outline size="sm">
                                                                            <Undo2 className="mr-2 h-4 w-4" />
                                                                            Estornar
                                                                        </Button>
                                                                    </AlertDialogTrigger>
                                                                    <AlertDialogContent>
                                                                        <AlertDialogHeader>
                                                                            <AlertDialogTitle>Confirmar Estorno?</AlertDialogTitle>
                                                                            <AlertDialogDescription>
                                                                                Esta ação não pode ser desfeita. O pagamento será excluído e as comissões dos pedidos voltarão a ficar pendentes.
                                                                            </AlertDialogDescription>
                                                                        </AlertDialogHeader>
                                                                        <AlertDialogFooter>
                                                                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                                            <AlertDialogAction onClick={() => reverseCommissionPayment(payment.id, logAction, user)}>
                                                                                Sim, estornar
                                                                            </AlertDialogAction>
                                                                        </AlertDialogFooter>
                                                                    </AlertDialogContent>
                                                                </AlertDialog>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        ) : (
                                            <TableRow>
                                                <TableCell colSpan={4} className="h-24 text-center">Nenhum pagamento recebido ainda.</TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                     </Card>
                </TabsContent>
                {isManagerOrAdmin && (
                    <TabsContent value="all_history" className="mt-4">
                        <Card>
                            <CardHeader>
                                <CardTitle>Histórico Geral de Pagamentos</CardTitle>
                                <CardDescription>Histórico de todos os pagamentos de comissão para todos os vendedores.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="rounded-md border overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Data</TableHead>
                                                <TableHead>Vendedor</TableHead>
                                                <TableHead>Período</TableHead>
                                                <TableHead className="text-right">Valor</TableHead>
                                                <TableHead className="text-right">Ação</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {commissionPayments && commissionPayments.length > 0 ? (
                                                commissionPayments.sort((a,b) => parseISO(b.paymentDate).getTime() - parseISO(a.paymentDate).getTime()).map(payment => (
                                                    <TableRow key={payment.id}>
                                                        <TableCell className="whitespace-nowrap">{format(parseISO(payment.paymentDate), "dd/MM/yyyy")}</TableCell>
                                                        <TableCell>{payment.sellerName}</TableCell>
                                                        <TableCell className="capitalize">{payment.period}</TableCell>
                                                        <TableCell className="text-right font-semibold">{formatCurrency(payment.amount)}</TableCell>
                                                        <TableCell className="text-right">
                                                            <div className="flex justify-end gap-2">
                                                                <Button variant="outline" size="sm" asChild>
                                                                    <Link href={`/admin/comprovante-comissao/${payment.id}`}>
                                                                        <Eye className="mr-2 h-4 w-4" />
                                                                        Ver Comprovante
                                                                    </Link>
                                                                </Button>
                                                                <AlertDialog>
                                                                    <AlertDialogTrigger asChild>
                                                                        <Button variant="destructive" outline size="sm">
                                                                            <Undo2 className="mr-2 h-4 w-4" />
                                                                            Estornar
                                                                        </Button>
                                                                    </AlertDialogTrigger>
                                                                    <AlertDialogContent>
                                                                        <AlertDialogHeader>
                                                                            <AlertDialogTitle>Confirmar Estorno?</AlertDialogTitle>
                                                                            <AlertDialogDescription>
                                                                                Esta ação não pode ser desfeita. O pagamento será excluído e as comissões dos pedidos voltarão a ficar pendentes.
                                                                            </AlertDialogDescription>
                                                                        </AlertDialogHeader>
                                                                        <AlertDialogFooter>
                                                                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                                            <AlertDialogAction onClick={() => reverseCommissionPayment(payment.id, logAction, user)}>
                                                                                Sim, estornar
                                                                            </AlertDialogAction>
                                                                        </AlertDialogFooter>
                                                                    </AlertDialogContent>
                                                                </AlertDialog>
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                ))
                                            ) : (
                                                <TableRow>
                                                    <TableCell colSpan={5} className="h-24 text-center">Nenhum pagamento foi realizado ainda.</TableCell>
                                                </TableRow>
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>
                )}

                <TabsContent value="reports" className="mt-4">
                  {isManagerOrAdmin ? (
                    <Card>
                      <CardHeader>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <CardTitle className="flex items-center gap-2">
                              <Users className="h-5 w-5" />
                              Relatório de Vendas por Vendedor
                            </CardTitle>
                            <CardDescription>
                              Vendas entregues por vendedor, com resumo geral e relatório individual.
                            </CardDescription>
                          </div>
                          <div className="flex gap-2">
                            <Button variant="outline" onClick={handlePrintTeamReport}>
                              <Printer className="mr-2 h-4 w-4" />
                              Imprimir
                            </Button>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                            <div className="w-full sm:w-[180px]">
                              <Select value={salesReportYear} onValueChange={setSalesReportYear}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Ano" />
                                </SelectTrigger>
                                <SelectContent>
                                  {availableYearsForSalesReport.map(year => (
                                    <SelectItem key={year} value={year}>{year}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="w-full sm:w-[220px]">
                              <Select value={salesReportMonth} onValueChange={setSalesReportMonth}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Mês" />
                                </SelectTrigger>
                                <SelectContent>
                                  {meses.map(mes => (
                                    <SelectItem key={mes.value} value={mes.value}>{mes.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>

                          <div className="text-sm text-muted-foreground">
                            <span className="font-medium text-foreground">{salesReportMonthLabel}</span>
                            <span className="mx-2">•</span>
                            <span>Vendas: {sellerReportTotals.totalSales}</span>
                            <span className="mx-2">•</span>
                            <span>Total vendido: {formatCurrency(sellerReportTotals.totalSold)}</span>
                            <span className="mx-2">•</span>
                            <span>Comissão total: {formatCurrency(sellerReportTotals.totalCommission)}</span>
                          </div>
                        </div>

                        <div id="team-sales-report-content">
                          <div className="rounded-md border overflow-x-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Vendedor</TableHead>
                                  <TableHead className="text-center">Vendas</TableHead>
                                  <TableHead className="text-right">Total Vendido</TableHead>
                                  <TableHead className="text-right">Comissão Gerada</TableHead>
                                  <TableHead className="text-right">Ações</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {sellerSalesReport.length > 0 ? (
                                  sellerSalesReport.map(seller => (
                                    <TableRow key={seller.id}>
                                      <TableCell className="font-medium">{seller.name}</TableCell>
                                      <TableCell className="text-center">{seller.salesCount}</TableCell>
                                      <TableCell className="text-right">{formatCurrency(seller.totalSold)}</TableCell>
                                      <TableCell className="text-right font-semibold">{formatCurrency(seller.totalCommission)}</TableCell>
                                      <TableCell className="text-right">
                                        <Button variant="outline" size="sm" onClick={() => handleOpenSellerReport(seller)}>
                                          <Eye className="mr-2 h-4 w-4" />
                                          Ver Vendas
                                        </Button>
                                      </TableCell>
                                    </TableRow>
                                  ))
                                ) : (
                                  <TableRow>
                                    <TableCell colSpan={5} className="h-24 text-center">
                                      <div className="flex flex-col items-center justify-center text-muted-foreground gap-2">
                                        <ShoppingCart className="h-6 w-6" />
                                        <span>Nenhuma venda entregue no período.</span>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                )}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ) : (
                    <Card>
                      <CardHeader>
                        <div className="flex flex-col gap-3">
                          <div>
                            <CardTitle className="flex items-center gap-2">
                              <BadgePercent className="h-5 w-5" />
                              Meu Relatório de Vendas
                            </CardTitle>
                            <CardDescription>
                              Vendas entregues no período selecionado, com total e comissão.
                            </CardDescription>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                            <div className="w-full sm:w-[180px]">
                              <Select value={salesReportYear} onValueChange={setSalesReportYear}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Ano" />
                                </SelectTrigger>
                                <SelectContent>
                                  {availableYearsForSalesReport.map(year => (
                                    <SelectItem key={year} value={year}>{year}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="w-full sm:w-[220px]">
                              <Select value={salesReportMonth} onValueChange={setSalesReportMonth}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Mês" />
                                </SelectTrigger>
                                <SelectContent>
                                  {meses.map(mes => (
                                    <SelectItem key={mes.value} value={mes.value}>{mes.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>

                          <div className="text-sm text-muted-foreground">
                            <span className="font-medium text-foreground">{salesReportMonthLabel}</span>
                            <span className="mx-2">•</span>
                            <span>Vendas: {mySalesReportTotals.count}</span>
                            <span className="mx-2">•</span>
                            <span>Total vendido: {formatCurrency(mySalesReportTotals.totalSold)}</span>
                            <span className="mx-2">•</span>
                            <span>Comissão total: {formatCurrency(mySalesReportTotals.totalCommission)}</span>
                          </div>
                        </div>

                        <div id="my-sales-report-content">
                          <div className="rounded-md border overflow-x-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Data</TableHead>
                                  <TableHead>Pedido</TableHead>
                                  <TableHead>Cliente</TableHead>
                                  <TableHead className="text-right">Valor</TableHead>
                                  <TableHead className="text-right">Comissão</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {mySalesReportOrders.length > 0 ? (
                                  mySalesReportOrders.map(order => (
                                    <TableRow key={order.id}>
                                      <TableCell className="whitespace-nowrap">{format(parseISO(order.date), "dd/MM/yyyy")}</TableCell>
                                      <TableCell className="font-mono whitespace-nowrap">{displayNumericCode(order.id)}</TableCell>
                                      <TableCell>{order.customer.name}</TableCell>
                                      <TableCell className="text-right font-semibold">{formatCurrency(order.total)}</TableCell>
                                      <TableCell className="text-right tabular-nums">{formatCurrency(order.commission || 0)}</TableCell>
                                    </TableRow>
                                  ))
                                ) : (
                                  <TableRow>
                                    <TableCell colSpan={5} className="h-24 text-center">Nenhuma venda entregue no período.</TableCell>
                                  </TableRow>
                                )}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>
            </Tabs>
        </CardContent>
      </Card>

      <Dialog open={isSellerReportOpen} onOpenChange={setIsSellerReportOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Relatório de Vendas - {selectedSellerReport?.name}</DialogTitle>
            <DialogDescription>
              Vendas entregues no período {salesReportMonthLabel}.
            </DialogDescription>
          </DialogHeader>
          <div id="seller-sales-report-modal-content">
            <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-md border px-3 py-2">
                <div className="text-xs text-muted-foreground">Vendas</div>
                <div className="text-base font-semibold tabular-nums">{selectedSellerTotals.count}</div>
              </div>
              <div className="rounded-md border px-3 py-2">
                <div className="text-xs text-muted-foreground">Total vendido</div>
                <div className="text-base font-semibold tabular-nums">{formatCurrency(selectedSellerTotals.totalSold)}</div>
              </div>
              <div className="rounded-md border px-3 py-2">
                <div className="text-xs text-muted-foreground">Total comissão</div>
                <div className="text-base font-semibold tabular-nums">{formatCurrency(selectedSellerTotals.totalCommission)}</div>
              </div>
            </div>
            <div className="rounded-md border max-h-[60vh] overflow-y-auto overflow-x-auto seller-report-table-wrapper">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Pedido</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="text-right">Comissão</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(selectedSellerReport?.orders.length ?? 0) > 0 ? (
                    selectedSellerReport?.orders.map(order => (
                      <TableRow key={order.id}>
                        <TableCell className="whitespace-nowrap">{format(parseISO(order.date), "dd/MM/yyyy")}</TableCell>
                        <TableCell className="font-mono whitespace-nowrap">{displayNumericCode(order.id)}</TableCell>
                        <TableCell>{order.customer.name}</TableCell>
                        <TableCell className="text-right font-semibold">{formatCurrency(order.total)}</TableCell>
                        <TableCell className="text-right font-semibold">{formatCurrency(order.commission || 0)}</TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5} className="h-24 text-center">Nenhuma venda encontrada para este vendedor.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setIsSellerReportOpen(false)}>Fechar</Button>
            <Button onClick={handlePrintSingleSeller}>
              <Printer className="mr-2 h-4 w-4" />
              Imprimir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

    
