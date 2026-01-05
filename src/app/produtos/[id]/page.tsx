

'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCart } from '@/context/CartContext';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, ShoppingCart, Info } from 'lucide-react';
import { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { Product } from '@/lib/types';
import { useData } from '@/context/DataContext';
import CountdownTimer from '@/components/CountdownTimer';
import { getClientFirebase } from '@/lib/firebase-client';
import { doc, getDoc } from 'firebase/firestore';

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
};

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { addToCart, setIsCartOpen } = useCart();
  const { products, isLoading: isProductsLoading } = useData();
  const id = params.id as string;

  const product = useMemo(() => {
    if (isProductsLoading || !products) return null;
    return products.find(p => p.id === id) || null;
  }, [id, products, isProductsLoading]);

  const [resolvedProduct, setResolvedProduct] = useState<Product | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  
  useEffect(() => {
    setResolvedProduct(product);
  }, [product]);

  useEffect(() => {
    if (!product) return;
    if (product.longDescription && product.longDescription.trim().length > 0) return;

    let cancelled = false;
    setIsResolving(true);
    try {
      const { db } = getClientFirebase();
      getDoc(doc(db, 'products', product.id)).then((snap) => {
        if (cancelled) return;
        if (!snap.exists()) return;
        const full = { ...(snap.data() as Omit<Product, 'id'>), id: snap.id } as Product;
        setResolvedProduct(full);
      }).finally(() => {
        if (cancelled) return;
        setIsResolving(false);
      });
    } catch {
      setIsResolving(false);
    }

    return () => {
      cancelled = true;
    };
  }, [product]);
  
  const handleAddToCart = () => {
    if (!resolvedProduct) return;
    addToCart(resolvedProduct);
    setIsCartOpen(true);
  };


  if (isProductsLoading || isResolving) {
    return (
      <div className="container mx-auto py-24 text-center">
        <p>Carregando produto...</p>
      </div>
    );
  }

  if (!resolvedProduct) {
    return (
      <div className="container mx-auto py-24 text-center">
        <h1 className="text-2xl font-bold">Produto não encontrado</h1>
        <p className="text-muted-foreground mt-2">O produto que você está procurando não existe ou foi removido.</p>
        <Button onClick={() => router.push('/')} className="mt-6">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar para a loja
        </Button>
      </div>
    );
  }
  
  const maxInstallments = resolvedProduct.maxInstallments ?? 10;
  const installmentValue = maxInstallments > 0 ? resolvedProduct.price / maxInstallments : resolvedProduct.price;
  const showCountdown = resolvedProduct.onSale && resolvedProduct.promotionEndDate && new Date(resolvedProduct.promotionEndDate) > new Date();


  return (
    <>
    <div className="container mx-auto max-w-6xl py-12 px-4">
      <Button variant="ghost" onClick={() => router.back()} className="mb-8">
        <ArrowLeft className="mr-2 h-4 w-4" />
        Voltar
      </Button>
      <div className="grid md:grid-cols-2 gap-8 lg:gap-12">
        <div>
           <Carousel className="w-full">
              <CarouselContent>
                {(resolvedProduct.imageUrls && resolvedProduct.imageUrls.length > 0) ? resolvedProduct.imageUrls.map((url, index) => (
                  <CarouselItem key={index}>
                    <div className="p-1">
                      <Card>
                        <CardContent className="relative aspect-square w-full flex items-center justify-center p-0 overflow-hidden rounded-lg">
                          <Image
                            src={url}
                            alt={`${resolvedProduct.name} - imagem ${index + 1}`}
                            fill
                            className="object-contain"
                            sizes="(max-width: 768px) 100vw, 50vw"
                            quality={70}
                            priority={index === 0}
                            data-ai-hint={resolvedProduct['data-ai-hint']}
                          />
                        </CardContent>
                      </Card>
                    </div>
                  </CarouselItem>
                )) : (
                   <CarouselItem>
                    <div className="p-1">
                      <Card>
                        <CardContent className="relative aspect-square w-full flex items-center justify-center p-0 overflow-hidden rounded-lg bg-muted">
                           <Image
                            src="https://placehold.co/600x600.png"
                            alt={resolvedProduct.name}
                            fill
                            className="object-contain"
                            sizes="(max-width: 768px) 100vw, 50vw"
                            quality={70}
                            priority
                          />
                        </CardContent>
                      </Card>
                    </div>
                  </CarouselItem>
                )}
              </CarouselContent>
              <CarouselPrevious className="absolute left-2" />
              <CarouselNext className="absolute right-2" />
            </Carousel>
        </div>
        <div className="flex flex-col">
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="secondary" className="capitalize w-fit">{resolvedProduct.category}</Badge>
            {resolvedProduct.subcategory && <Badge variant="outline" className="capitalize w-fit">{resolvedProduct.subcategory}</Badge>}
          </div>
          <h1 className="text-3xl lg:text-4xl font-bold font-headline text-primary">{resolvedProduct.name}</h1>
          {resolvedProduct.code && <p className="text-sm text-muted-foreground mt-2">Cód. Item: {resolvedProduct.code}</p>}
          <p className="text-muted-foreground mt-4 text-lg">{resolvedProduct.description}</p>
          
          {showCountdown && <CountdownTimer endDate={resolvedProduct.promotionEndDate!} />}
          
          {resolvedProduct.paymentCondition && (
            <Alert className="mt-4 border-accent/50 text-accent-foreground bg-accent/5">
                <Info className="h-5 w-5 text-accent" />
                <AlertDescription className="font-semibold text-accent">
                    {resolvedProduct.paymentCondition}
                </AlertDescription>
            </Alert>
          )}

          <Separator className="my-6" />

          <div className="space-y-4">
            <p className="text-4xl font-bold text-foreground">
              {formatCurrency(resolvedProduct.price)}
            </p>
            {maxInstallments > 1 && (
              <p className="text-lg text-accent font-semibold">
                ou {maxInstallments}x de {formatCurrency(installmentValue)} sem juros
              </p>
            )}
          </div>
          
          <div className="mt-8">
            {resolvedProduct.stock > 0 ? (
              <>
                <Button size="lg" onClick={handleAddToCart} className="w-full md:w-auto bg-accent hover:bg-accent/90">
                  <ShoppingCart className="mr-2 h-5 w-5" />
                  Adicionar ao Carrinho
                </Button>
                <p className="text-sm text-green-600 mt-2">Em estoque: {resolvedProduct.stock} unidades</p>
              </>
            ) : (
              <Button size="lg" disabled className="w-full md:w-auto">
                Produto Indisponível
              </Button>
            )}
          </div>
        </div>
      </div>
      <Card className="mt-12">
        <CardHeader>
            <CardTitle>Descrição Detalhada do Produto</CardTitle>
        </CardHeader>
        <CardContent>
            <p className="text-muted-foreground whitespace-pre-line">{resolvedProduct.longDescription}</p>
        </CardContent>
      </Card>
    </div>
    </>
  );
}
