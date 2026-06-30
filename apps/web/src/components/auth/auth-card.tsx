'use client';

import type { ReactNode } from 'react';
import { Brand } from '@/components/brand';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/** Shared chrome for the login / register screens. */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-16">
      <div className="mb-8 flex justify-center">
        <Brand size="lg" />
      </div>
      <Card className="w-full max-w-md shadow-sm">
        <CardHeader className="space-y-1.5">
          <CardTitle className="text-2xl font-bold tracking-tight">
            {title}
          </CardTitle>
          {description ? (
            <CardDescription>{description}</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">{children}</CardContent>
        {footer ? (
          <div className="border-t px-6 py-4 text-center text-sm text-muted-foreground">
            {footer}
          </div>
        ) : null}
      </Card>
    </main>
  );
}
