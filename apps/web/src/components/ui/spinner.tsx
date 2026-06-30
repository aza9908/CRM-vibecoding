import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SpinnerProps {
  className?: string;
  /** Optional accessible label. */
  label?: string;
}

/** A small loading spinner. */
export function Spinner({ className, label }: SpinnerProps) {
  return (
    <span role="status" aria-label={label ?? 'Loading'}>
      <Loader2 className={cn('h-4 w-4 animate-spin', className)} />
    </span>
  );
}
