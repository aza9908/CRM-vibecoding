'use client';

/** Small inline form-field error message. */
export function FieldError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p className="text-sm text-destructive" role="alert">
      {message}
    </p>
  );
}
