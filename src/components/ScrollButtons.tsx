
'use client';

import { Button } from '@/components/ui/button';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';

export default function ScrollButtons({ className }: { className?: string }) {
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(true);

  useEffect(() => {
    const checkScrollPosition = () => {
      const isScrolled = window.scrollY > 300;
      const isAtBottom = window.innerHeight + window.scrollY >= document.body.offsetHeight - 150;
      
      setShowScrollTop(isScrolled);
      setShowScrollBottom(!isAtBottom);
    };

    window.addEventListener('scroll', checkScrollPosition);
    checkScrollPosition(); // Check on mount

    return () => window.removeEventListener('scroll', checkScrollPosition);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const scrollToBottom = () => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  };

  return (
    <div
      className={cn(
        'fixed z-50 flex flex-col gap-2 print-hidden',
        className ?? 'top-1/2 -translate-y-1/2 right-6'
      )}
    >
        <Button
            onClick={scrollToTop}
            className={cn(
                'h-12 w-12 rounded-full bg-primary/80 backdrop-blur-sm text-primary-foreground shadow-lg transition-all hover:bg-primary',
                showScrollTop ? 'opacity-100 scale-100' : 'opacity-0 scale-0'
            )}
            aria-label="Ir para o topo da página"
        >
            <ArrowUp className="h-6 w-6" />
        </Button>
        <Button
            onClick={scrollToBottom}
            className={cn(
                'h-12 w-12 rounded-full bg-primary/80 backdrop-blur-sm text-primary-foreground shadow-lg transition-all hover:bg-primary',
                showScrollBottom ? 'opacity-100 scale-100' : 'opacity-0 scale-0'
            )}
            aria-label="Ir para o final da página"
        >
            <ArrowDown className="h-6 w-6" />
        </Button>
    </div>
  );
}
