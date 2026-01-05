
import CheckoutForm from '@/components/CheckoutForm';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function CheckoutPage() {
    return (
        <div className="container mx-auto py-12 px-4">
            <Card className="max-w-4xl mx-auto shadow-lg">
                <CardHeader>
                    <Button variant="ghost" asChild className="w-fit mb-2">
                        <Link href="/">
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            Voltar para a loja
                        </Link>
                    </Button>
                    <CardTitle className="text-3xl font-headline text-primary">Finalizar Compra</CardTitle>
                    <CardDescription>
                        Por favor, preencha suas informações e escolha a forma de pagamento.
                    </CardDescription>
                </CardHeader>
                <Separator />
                <CardContent className="pt-6">
                    <CheckoutForm />
                </CardContent>
            </Card>
        </div>
    );
}
