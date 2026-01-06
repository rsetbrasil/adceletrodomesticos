
import CheckoutForm from '@/components/CheckoutForm';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function CheckoutPage() {
  return (
    <div className="min-h-screen bg-muted/20 overflow-x-hidden">
      <div className="mx-auto px-3 py-4 sm:px-4 sm:py-8 max-w-5xl">
        <Card className="w-full max-w-md md:max-w-4xl mx-auto shadow-lg">
          <CardHeader className="pb-3 sm:pb-4">
            <Button variant="ghost" asChild className="w-fit mb-2">
              <Link href="/">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Voltar para a loja
              </Link>
            </Button>
            <CardTitle className="text-2xl sm:text-3xl font-headline text-primary">
              Finalizar Compra
            </CardTitle>
            <CardDescription className="text-sm sm:text-base">
              Por favor, preencha suas informações e escolha a forma de pagamento.
            </CardDescription>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4 sm:pt-6">
            <CheckoutForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
