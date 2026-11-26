import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';

type CopyButtonProps = {
    text: string;
    label: string;
};

export function CopyButton({ text, label }: CopyButtonProps) {
    const [copied, setCopied] = useState(false);
    const [, copy] = useCopyToClipboard();

    return (
        <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
                copy(text)
                    .then((ok) => {
                        if (!ok) return;
                        setCopied(true);
                        window.setTimeout(() => setCopied(false), 1500);
                    })
                    .catch((error) => {
                        console.error('Failed to copy!', error);
                    });
            }}
        >
            {copied ? <Check /> : <Copy />}
            {copied ? 'Copied' : label}
        </Button>
    );
}
