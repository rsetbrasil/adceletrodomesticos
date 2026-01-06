
import type { Metadata } from 'next';
import './print.css';

export const metadata: Metadata = {
  title: 'Carnê de Pagamento - ADC Móveis',
  description: 'Visualização e impressão de carnê de pagamento.',
};

export default function CarnetLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <>{children}</>;
}
