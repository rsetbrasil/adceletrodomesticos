
'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageSquare, X, Send, User, RotateCcw, Paperclip, FileText, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getClientFirebase } from '@/lib/firebase-client';
import { collection, doc, setDoc, onSnapshot, addDoc, query, orderBy, updateDoc, type Firestore } from 'firebase/firestore';
import type { ChatMessage, ChatSession, ChatAttachment } from '@/lib/types';
import { format } from 'date-fns';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import Image from 'next/image';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const getOrCreateVisitorId = (): string => {
    if (typeof window === 'undefined') return '';
    let visitorId = localStorage.getItem('visitorId');
    if (!visitorId) {
        visitorId = `visitor-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        localStorage.setItem('visitorId', visitorId);
    }
    return visitorId;
};

const notificationSound = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

export default function ChatWidget() {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [newMessage, setNewMessage] = useState('');
    const [visitorId] = useState(getOrCreateVisitorId);
    const [session, setSession] = useState<ChatSession | null>(null);
    const scrollAreaRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [db, setDb] = useState<Firestore | null>(null);
    const { toast } = useToast();
    const previousSessionRef = useRef<ChatSession | null>(null);
    
    const [visitorName, setVisitorName] = useState('');
    const [hasSetName, setHasSetName] = useState(false);
    const [imageToView, setImageToView] = useState<string | null>(null);

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [hasInteracted, setHasInteracted] = useState(false);

    useEffect(() => {
        try {
            setDb(getClientFirebase().db);
        } catch {
            setDb(null);
        }
    }, []);

    useEffect(() => {
        if (typeof window !== 'undefined' && !audioRef.current) {
          audioRef.current = new Audio(notificationSound);
        }
    }, []);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            const storedName = localStorage.getItem('visitorName');
            if (storedName) {
                setVisitorName(storedName);
                setHasSetName(true);
            }
        }
    }, []);

    useEffect(() => {
        if (session && previousSessionRef.current) {
            if (session.unreadByVisitor && !previousSessionRef.current.unreadByVisitor && !isOpen) {
                if (hasInteracted) {
                    audioRef.current?.play().catch(e => console.error("Error playing sound:", e));
                }
            }
        }
        previousSessionRef.current = session;
    }, [session, isOpen, hasInteracted]);

    useEffect(() => {
        if (!visitorId) return;
        if (!db) return;

        const sessionRef = doc(db, 'chatSessions', visitorId);

        const unsubscribeSession = onSnapshot(sessionRef, (docSnap) => {
            if (docSnap.exists()) {
                const sessionData = { id: docSnap.id, ...docSnap.data() } as ChatSession;
                setSession(sessionData);
                if (isOpen && sessionData.unreadByVisitor) {
                    updateDoc(sessionRef, { unreadByVisitor: false });
                }
            } else {
                setSession(null);
            }
        });
        
        const messagesRef = collection(db, 'chatSessions', visitorId, 'messages');
        const q = query(messagesRef, orderBy('timestamp', 'asc'));

        const unsubscribeMessages = onSnapshot(q, (querySnapshot) => {
            const fetchedMessages: ChatMessage[] = [];
            querySnapshot.forEach((doc) => {
                fetchedMessages.push({ id: doc.id, ...doc.data(), sessionId: visitorId } as ChatMessage);
            });
            setMessages(fetchedMessages);
        });

        return () => {
            unsubscribeSession();
            unsubscribeMessages();
        };
    }, [visitorId, db, isOpen]);

    useEffect(() => {
        if (scrollAreaRef.current) {
            scrollAreaRef.current.scrollTo({
                top: scrollAreaRef.current.scrollHeight,
                behavior: 'smooth'
            });
        }
    }, [messages]);

    const handleToggleChat = () => {
        if (!db) return;
        setIsOpen(prev => {
            const newOpenState = !prev;
            if (newOpenState && session?.unreadByVisitor) {
                const sessionRef = doc(db, 'chatSessions', visitorId);
                updateDoc(sessionRef, { unreadByVisitor: false });
            }
            return newOpenState;
        });
    };

    const handleStartChat = () => {
        if (visitorName.trim()) {
            if (!hasInteracted && audioRef.current) {
                audioRef.current.play().catch(() => {});
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
                setHasInteracted(true);
            }
            localStorage.setItem('visitorName', visitorName);
            setHasSetName(true);
        }
    };
    
    const handleStartNewChat = async () => {
        if (!db) return;
        if (!session) return;
        const sessionRef = doc(db, 'chatSessions', session.id);
        await updateDoc(sessionRef, { status: 'open', satisfaction: null });
    };
    
    const handleSendMessage = async (text: string, attachment: ChatAttachment | null) => {
        if (!db) return;
        const messageText = text || (attachment ? attachment.name : '');
        if (messageText.trim() === '' || !hasSetName) return;
        
        let messageData: Partial<ChatMessage> = {
            text: messageText,
            sender: 'visitor' as const,
            senderName: visitorName,
            timestamp: new Date().toISOString(),
        };

        if (attachment) {
            messageData.attachment = attachment;
        }

        const sessionRef = doc(db, 'chatSessions', visitorId);
        const messagesRef = collection(db, 'chatSessions', visitorId, 'messages');
        const timestamp = new Date().toISOString();

        if (!session) {
            const newSession: ChatSession = {
                id: visitorId,
                visitorId: visitorId,
                visitorName: visitorName,
                createdAt: timestamp,
                status: 'open',
                unreadBySeller: true,
                unreadByVisitor: false,
                lastMessageText: messageText,
                lastMessageAt: timestamp,
            };
            await setDoc(sessionRef, newSession);
        } else {
            const isReopening = session.status === 'closed' || session.status === 'awaiting-feedback';
            await updateDoc(sessionRef, {
                lastMessageAt: timestamp,
                lastMessageText: messageText,
                status: isReopening ? 'open' : session.status,
                unreadBySeller: true,
                satisfaction: isReopening ? null : (session.satisfaction ?? null),
            });
        }
    
        await addDoc(messagesRef, messageData);
        setNewMessage('');
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleSendFeedback = async (rating: 'Ótimo' | 'Bom' | 'Ruim') => {
        if (!db) return;
        if (!session) return;
        const sessionRef = doc(db, 'chatSessions', session.id);
        await updateDoc(sessionRef, {
            status: 'closed',
            satisfaction: rating,
        });

        const feedbackMessage: ChatMessage = {
            id: `feedback-${Date.now()}`,
            text: `Atendimento avaliado como: ${rating}`,
            sender: 'visitor',
            senderName: 'Sistema',
            timestamp: new Date().toISOString(),
            sessionId: session.id,
        };
        const messagesRef = collection(db, 'chatSessions', session.id, 'messages');
        await addDoc(messagesRef, feedbackMessage);

        toast({
            title: "Obrigado pelo seu feedback!",
            description: "Sua avaliação nos ajuda a melhorar sempre.",
        });
    };
    
    const processAndUploadFile = (file: File) => {
        let fileType: 'image' | 'pdf' | null = null;
        if (file.type.startsWith('image/')) {
            fileType = 'image';
        } else if (file.type === 'application/pdf') {
            fileType = 'pdf';
        } else {
            toast({ title: "Tipo de arquivo não suportado", description: "Por favor, envie apenas imagens ou arquivos PDF.", variant: "destructive" });
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const url = e.target?.result as string;
            if (url) {
                const attachment: ChatAttachment = {
                    name: file.name,
                    type: fileType as 'image' | 'pdf',
                    url: url,
                };
                handleSendMessage('', attachment);
            }
        };
        reader.onerror = (error) => {
            console.error("Error processing file:", error);
            toast({ title: "Erro ao processar anexo", variant: 'destructive' });
        };
        reader.readAsDataURL(file);
    };

    const handleFormSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        await handleSendMessage(newMessage, null);
    };
    
    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) { // 5MB limit
            toast({ title: "Arquivo muito grande", description: "O tamanho máximo do arquivo é 5MB.", variant: "destructive" });
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
            return;
        }
        processAndUploadFile(file);
    };

    const SurveyMessage = ({ message }: { message: ChatMessage }) => {
        const [feedbackSent, setFeedbackSent] = useState(session?.satisfaction !== undefined && session?.satisfaction !== null);
        
        useEffect(() => {
            setFeedbackSent(session?.satisfaction !== undefined && session?.satisfaction !== null);
        }, [session?.satisfaction]);

        const handleFeedbackClick = async (rating: 'Ótimo' | 'Bom' | 'Ruim') => {
            if (feedbackSent) return;
            await handleSendFeedback(rating);
            setFeedbackSent(true);
        };
        
        if (feedbackSent) {
            return (
                <div className="text-sm text-center text-muted-foreground p-3 bg-muted rounded-md">
                    Obrigado por avaliar este atendimento!
                </div>
            );
        }

        return (
            <div className="p-3 bg-muted rounded-md">
                <p className="text-sm font-semibold text-center mb-3">{message.text}</p>
                <div className="flex justify-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleFeedbackClick('Ótimo')}>Ótimo</Button>
                    <Button variant="outline" size="sm" onClick={() => handleFeedbackClick('Bom')}>Bom</Button>
                    <Button variant="outline" size="sm" onClick={() => handleFeedbackClick('Ruim')}>Ruim</Button>
                </div>
            </div>
        );
    };

    return (
        <>
            <div className={cn("fixed bottom-6 right-6 z-50 transition-transform duration-300", isOpen ? "translate-y-[200%]" : "translate-y-0")}>
                <Button onClick={handleToggleChat} className="rounded-full h-16 w-16 shadow-lg" aria-label="Abrir chat">
                    <MessageSquare className="h-8 w-8" />
                    {session?.unreadByVisitor && <span className="absolute top-0 right-0 h-4 w-4 rounded-full bg-destructive animate-ping"></span>}
                </Button>
            </div>
            {isOpen && (
                <div className="fixed bottom-0 right-0 sm:bottom-6 sm:right-6 z-50 w-full sm:w-80 h-[calc(100%-80px)] mt-20 sm:h-[500px] max-h-[600px] sm:rounded-lg">
                    <Card className="h-full flex flex-col shadow-2xl">
                        <CardHeader className="flex flex-row items-center justify-between bg-primary text-primary-foreground p-4">
                            <CardTitle className="text-lg">Atendimento Online</CardTitle>
                            <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-primary/80" onClick={handleToggleChat}>
                                <X className="h-5 w-5" />
                            </Button>
                        </CardHeader>

                        {!hasSetName ? (
                            <div className="flex-grow flex flex-col justify-center items-center p-6 gap-4">
                                <User className="h-12 w-12 text-muted-foreground" />
                                <h3 className="font-semibold text-center">Como podemos te chamar?</h3>
                                <div className="w-full space-y-2">
                                     <Label htmlFor="visitorName">Seu nome</Label>
                                     <Input 
                                        id="visitorName"
                                        placeholder="Digite seu nome aqui"
                                        value={visitorName}
                                        onChange={(e) => setVisitorName(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleStartChat()}
                                    />
                                </div>
                                <Button onClick={handleStartChat} disabled={!visitorName.trim()} className="w-full">
                                    Iniciar Atendimento
                                </Button>
                            </div>
                        ) : (
                            <>
                                <CardContent className="flex-grow p-0 overflow-hidden">
                                    <ScrollArea className="h-full" ref={scrollAreaRef}>
                                        <div className="p-4 space-y-4">
                                            {messages.map((msg, index) => (
                                                <div key={`${msg.id}-${index}`} className={cn("flex flex-col", msg.sender === 'visitor' ? 'items-end' : 'items-start')}>
                                                    {msg.type === 'survey' ? (
                                                        <SurveyMessage message={msg} />
                                                    ) : (
                                                        <>
                                                            <div className={cn("max-w-xs rounded-lg px-3 py-2", msg.sender === 'visitor' ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
                                                                {msg.attachment ? (
                                                                    <div className="space-y-2">
                                                                        {msg.attachment.type === 'image' ? (
                                                                            <div 
                                                                                className="block relative w-40 h-40 cursor-pointer"
                                                                                onClick={() => setImageToView(msg.attachment?.url || null)}
                                                                            >
                                                                                <Image src={msg.attachment.url} alt={msg.attachment.name} layout="fill" className="object-cover rounded-md" />
                                                                            </div>
                                                                        ) : (
                                                                            <a href={msg.attachment.url} download={msg.attachment.name} className="flex items-center gap-2 p-2 rounded-md bg-background/20 hover:bg-background/40">
                                                                                <FileText className="h-6 w-6" />
                                                                                <span className="truncate">{msg.attachment.name}</span>
                                                                                <Download className="h-4 w-4 ml-auto" />
                                                                            </a>
                                                                        )}
                                                                        {msg.text !== msg.attachment.name && <p className="text-sm">{msg.text}</p>}
                                                                    </div>
                                                                ) : (
                                                                    <p className="text-sm">{msg.text}</p>
                                                                )}
                                                            </div>
                                                            <span className="text-xs text-muted-foreground mt-1">
                                                                {msg.senderName} - {format(new Date(msg.timestamp), 'HH:mm')}
                                                            </span>
                                                        </>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </ScrollArea>
                                </CardContent>
                                {session?.status === 'closed' ? (
                                    <CardFooter className="p-4 border-t flex flex-col items-center justify-center gap-4">
                                        <p className="text-sm text-muted-foreground text-center">Atendimento encerrado.</p>
                                        <Button onClick={handleStartNewChat}>
                                            <RotateCcw className="mr-2 h-4 w-4" />
                                            Iniciar Novo Atendimento
                                        </Button>
                                    </CardFooter>
                                ) : (
                                    <CardFooter className="p-4 border-t">
                                        <form onSubmit={handleFormSubmit} className="w-full flex items-center gap-2">
                                            <input 
                                                type="file" 
                                                ref={fileInputRef} 
                                                onChange={handleFileChange}
                                                accept="image/*,application/pdf"
                                                className="hidden" 
                                            />
                                            <Button type="button" variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()}>
                                                <Paperclip className="h-5 w-5" />
                                            </Button>
                                            <Input
                                                value={newMessage}
                                                onChange={(e) => setNewMessage(e.target.value)}
                                                placeholder="Digite sua mensagem..."
                                                autoComplete="off"
                                                disabled={session?.status === 'awaiting-feedback'}
                                            />
                                            <Button type="submit" size="icon" disabled={!newMessage.trim() || session?.status === 'awaiting-feedback'}>
                                                <Send className="h-4 w-4" />
                                            </Button>
                                        </form>
                                    </CardFooter>
                                )}
                            </>
                        )}
                         <Dialog open={!!imageToView} onOpenChange={() => setImageToView(null)}>
                            <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-2 sm:p-4">
                                <DialogHeader>
                                    <DialogTitle>Visualizador de Imagem</DialogTitle>
                                </DialogHeader>
                                <div className="relative flex-1 w-full my-4">
                                    {imageToView && (
                                        <Image src={imageToView} alt="Visualização do anexo" fill className="object-contain" />
                                    )}
                                </div>
                            </DialogContent>
                        </Dialog>
                    </Card>
                </div>
            )}
        </>
    );
}
